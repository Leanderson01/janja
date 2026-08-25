// A ponte entre o PCM cru que o processo main captura (Fase 8.6) e uma
// `MediaStreamTrack` que o LiveKit sabe publicar.
//
// O caminho, inteiro:
//
//   [main] loopback-capture -> Buffer s16le estéreo 48 kHz (~10 ms por chunk)
//     -> IPC (~100 msg/s, ~192 KB/s) -> window.screenshare.audio.onChunk
//     -> int16ToPlanarFloat32 (aqui, no thread principal do renderer)
//     -> port.postMessage(transferível) -> AudioWorkletProcessor (ring buffer)
//     -> AudioWorkletNode -> MediaStreamAudioDestinationNode
//     -> dest.stream.getAudioTracks()[0] -> publishTrack(...)
//
// Por que NÃO `MediaStreamTrackGenerator`, que eliminaria o AudioContext, o
// worklet e o ring buffer: o Chrome Platform Status só reconhece hoje a forma
// `VideoTrackGenerator`, e a própria spec registra que NÃO HÁ CONSENSO do WG
// sobre suportar áudio. Confiança LOW — não se constrói a fase em cima disso.
// Se um dia alguém quiser, que seja otimização opcional medida no Windows,
// nunca o caminho de que o produto depende.
import processorUrl from './screenshare-audio-processor.js?url'

/**
 * O nome com que o worklet se registra. Exportado para que o
 * `new AudioWorkletNode(...)` e o `registerProcessor(...)` não divirjam — uma
 * divergência aqui lança `NotSupportedError` só em runtime, no Windows.
 * `screenshare-audio-bridge.test.ts` compara este valor com o que está escrito
 * DENTRO do arquivo do worklet.
 */
export const SCREENSHARE_PCM_PROCESSOR_NAME = 'screenshare-pcm-player'

/**
 * Estatísticas que o worklet reporta ~1x por segundo. É o instrumento de
 * deriva de relógio do checkpoint humano (08.6-06): `depthMs` subindo sem
 * parar = a captura entrega mais rápido que o AudioContext consome;
 * `underruns` crescendo fora do silêncio = o contrário.
 */
export type ScreenShareAudioStats = {
  underruns: number
  overruns: number
  framesDropped: number
  framesPlayed: number
  framesRendered: number
  depth: number
  depthMs: number
}

export type ScreenShareAudioBridge = {
  /** Pronta para `publishTrack(track, { source: ScreenShareAudio, forceStereo: true })`. */
  track: MediaStreamTrack
  /** Um chunk do IPC. Depois de `stop()`, é no-op silencioso. */
  pushChunk(bytes: Uint8Array): void
  /** Fecha tudo que a ponte abriu. Idempotente: chamar duas vezes não lança. */
  stop(): Promise<void>
}

export type ScreenShareAudioBridgeOptions = {
  onStats?: (stats: ScreenShareAudioStats) => void
}

/**
 * PCM s16le INTERCALADO -> Float32 PLANAR (um array por canal), que é o
 * formato que o Web Audio entende.
 *
 * É função pura de propósito: é o coração desta ponte e a única parte dela que
 * um ambiente sem placa de som consegue provar de verdade.
 *
 * Decisões que parecem detalhe e não são:
 * - **little-endian**, e o formato é FIXADO no C++ do pacote
 *   (`LoopbackCapture.cpp:171-175`), não negociado;
 * - **divisor 32768, não 32767.** O intervalo de s16 é -32768..32767 (assimétrico).
 *   Dividir por 32768 mapeia exatamente para [-1, 1); dividir por 32767 faria
 *   -32768 virar -1.000030518 e ESTOURAR o intervalo do Web Audio — distorção
 *   no pico, que é justamente onde ninguém quer distorção;
 * - **`channels === 1` duplica** em vez de deixar um canal mudo;
 * - **byte solto / frame incompleto no fim é DESCARTADO**, nunca lançado. Um
 *   chunk truncado pelo IPC não pode derrubar a transmissão inteira; ele custa
 *   uma fração de milissegundo de áudio.
 */
export function int16ToPlanarFloat32(
  bytes: Uint8Array,
  channels: number
): { left: Float32Array; right: Float32Array } {
  // `channels` vem do main (nunca de uma constante duplicada aqui). Qualquer
  // valor esquisito degrada para mono em vez de produzir NaN ou array gigante.
  const lanes = Number.isFinite(channels) && channels >= 2 ? Math.floor(channels) : 1

  const totalSamples = Math.floor(bytes.byteLength / 2)
  const frames = Math.floor(totalSamples / lanes)

  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  if (frames === 0) return { left, right }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const frameStride = lanes * 2

  for (let frame = 0; frame < frames; frame++) {
    const base = frame * frameStride
    const l = view.getInt16(base, true) / 32768
    // Mono duplica; 3+ canais (não acontece com este addon, mas o código não
    // depende disso) usa os dois primeiros e ignora o resto.
    const r = lanes === 1 ? l : view.getInt16(base + 2, true) / 32768
    left[frame] = l
    right[frame] = r
  }

  return { left, right }
}

async function closeQuietly(ctx: AudioContext): Promise<void> {
  try {
    await ctx.close()
  } catch {
    // Um contexto já fechado (ou fechando) lança; não há nada a fazer com isso.
  }
}

/**
 * Abre AudioContext + worklet + destination e devolve a track publicável.
 *
 * `format` vem do `start()` do main — o renderer NÃO duplica 48000/2/16 como
 * constante própria. Fixar `sampleRate` no contexto é obrigatório: sem isso o
 * Chromium adota a taxa do dispositivo de saída (44,1 kHz existe no mundo
 * real) e passa a exigir reamostragem de cada chunk. Com a mesma taxa que o
 * addon entrega, a conversão é uma multiplicação por amostra e nada mais.
 */
export async function createScreenShareAudioBridge(
  format: ScreenShareAudioFormat,
  options: ScreenShareAudioBridgeOptions = {}
): Promise<ScreenShareAudioBridge> {
  const ctx = new AudioContext({ sampleRate: format.sampleRate, latencyHint: 'interactive' })

  try {
    await ctx.audioWorklet.addModule(processorUrl)
  } catch (error) {
    // Fechar ANTES de rejeitar: um AudioContext vazado segura um dispositivo de
    // áudio e um thread de render para sempre.
    await closeQuietly(ctx)
    throw new Error(
      `Não foi possível carregar o AudioWorklet do áudio de compartilhamento (${processorUrl}). ` +
        "A CSP deste app é `script-src 'self'`: o worklet PRECISA ser um asset .js real, servido " +
        'da própria origem (`?url` + assetsInlineLimit: 0). Se ele virou `data:`/`blob:`, o ' +
        'Chromium bloqueia e é isto que se vê. NÃO afrouxe a CSP para resolver. ' +
        `Causa: ${String(error)}`
    )
  }

  let node: AudioWorkletNode
  let dest: MediaStreamAudioDestinationNode
  let track: MediaStreamTrack | undefined
  try {
    node = new AudioWorkletNode(ctx, SCREENSHARE_PCM_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })
    dest = ctx.createMediaStreamDestination()
    // Conecta SÓ ao destination do MediaStream.
    //
    // Conectar em `ctx.destination` tocaria o áudio capturado de volta nos
    // alto-falantes de quem compartilha — e como a captura é loopback do
    // sistema, essa saída voltaria para dentro dela. É a segunda via de
    // realimentação, exatamente o defeito que esta fase existe para eliminar.
    node.connect(dest)
    track = dest.stream.getAudioTracks()[0]
  } catch (error) {
    await closeQuietly(ctx)
    throw new Error(
      `Não foi possível montar o grafo de áudio do compartilhamento: ${String(error)}`
    )
  }

  if (!track) {
    await closeQuietly(ctx)
    throw new Error(
      'O MediaStreamAudioDestinationNode não expôs nenhuma track de áudio — sem track não há o que publicar.'
    )
  }

  if (options.onStats) {
    const onStats = options.onStats
    node.port.onmessage = (event: MessageEvent): void => {
      const data = event?.data as { type?: string } | undefined
      if (data?.type === 'stats') onStats(data as unknown as ScreenShareAudioStats)
    }
  }

  // Um AudioContext criado sem gesto do usuário nasce `suspended`, e um
  // contexto suspenso NUNCA chama `process()`: a track existe, é publicada, e
  // transmite silêncio eterno sem erro nenhum. Retomar é barato; descobrir
  // isso num checkpoint com 4 pessoas na call, não.
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch (error) {
      console.warn('[screenshare-audio] AudioContext não retomou:', error)
    }
  }

  let stopped = false

  const pushChunk = (bytes: Uint8Array): void => {
    if (stopped) return
    const { left, right } = int16ToPlanarFloat32(bytes, format.channels)
    if (left.length === 0) return
    try {
      // TRANSFERÍVEL, não cópia: são ~192 KB/s atravessando para o thread de
      // áudio. E nada de SharedArrayBuffer — no Electron ele depende de
      // isolamento cross-origin, que este app não tem.
      node.port.postMessage({ type: 'chunk', left: left.buffer, right: right.buffer }, [
        left.buffer as ArrayBuffer,
        right.buffer as ArrayBuffer
      ])
    } catch (error) {
      // Porta fechada por uma corrida com o stop(): descartar o chunk é a
      // resposta certa. Lançar aqui subiria para dentro do handler de IPC.
      console.warn('[screenshare-audio] chunk descartado:', error)
    }
  }

  const stop = async (): Promise<void> => {
    // Reentrância primeiro, e não no fim: `stop()` tem `await` no meio, e o
    // caminho de saída pode ser disparado duas vezes (usuário para + o SDK
    // despublica a track). Mesmo motivo do teardown do main (08.6-02).
    if (stopped) return
    stopped = true

    try {
      node.port.postMessage({ type: 'flush' })
    } catch {
      /* porta já morta */
    }
    try {
      node.port.onmessage = null
    } catch {
      /* idem */
    }
    try {
      node.disconnect()
    } catch {
      /* já desconectado */
    }
    try {
      track.stop()
    } catch {
      /* já parada — o SDK do LiveKit pára a track ao despublicar */
    }
    await closeQuietly(ctx)
  }

  return { track, pushChunk, stop }
}
