import { app, ipcMain, type BrowserWindow } from 'electron'
import { release } from 'os'
import {
  MIN_WINDOWS_BUILD_FOR_PROCESS_LOOPBACK,
  SCREENSHARE_AUDIO_CHANNELS,
  SILENCE_WATCHDOG_MS,
  type ScreenShareAudioCapability,
  type ScreenShareAudioStartResult,
  type ScreenShareAudioStatus
} from './screenshare-audio-types'

// Fase 8.6: áudio de compartilhamento por PROCESSO, no processo main.
//
// O que este módulo faz: captura "tudo que este computador toca, MENOS o Hydra
// e seus filhos" e entrega o PCM cru ao renderer — ou diz, com motivo legível,
// que esta máquina não consegue.
//
// A Fase 8 apostou numa constraint (`restrictOwnAudio`) e perdeu: o áudio de
// sistema do Electron (`audio: 'loopback'`) é loopback de DISPOSITIVO, captura
// a saída inteira da placa, e a saída inteira inclui a voz dos outros
// participantes que o próprio app está tocando. Resultado: eco, com 4 pessoas
// numa call em 2026-08-20. O FIX matou o eco desligando o som.
//
// Aqui o eco morre por CONSTRUÇÃO, sem constraint nenhuma: o Windows sabe
// excluir uma árvore de processos da captura, e a árvore que se exclui é a
// nossa. Ver o comentário gigante sobre o `false` em `startCapture()` — ele é
// o coração da fase.
//
// A PROIBIÇÃO do loopback de DISPOSITIVO do mesmo pacote (a função que entrega
// áudio em qualquer Windows e devolve o eco junto) está escrita por extenso em
// `./screenshare-audio-types.ts`, com o nome dela. Não existe fallback para
// aquilo. Nunca. Este arquivo não a menciona nem por nome, para que a busca
// pelo nome dela neste módulo continue voltando vazia.

/**
 * A superfície do addon que este módulo usa — declarada aqui, ESTRUTURALMENTE,
 * em vez de importada do pacote.
 *
 * Motivo: o pacote é dependência de outro plano desta fase (08.6-01) e o
 * `.node` só existe para Windows x64. Depender do tipo dele acoplaria o
 * typecheck deste arquivo à instalação de um binário que não roda aqui.
 */
type LoopbackCaptureInstance = {
  start(processId: number, includeProcessTree: boolean, cb: (chunk: Buffer) => void): void
  stop(): void
}
type LoopbackCaptureModule = { LoopbackCapture: new () => LoopbackCaptureInstance }

/**
 * Como o chunk (e o status) chega ao renderer.
 *
 * Devolve `false` quando não há para onde enviar (janela fechada/destruída) —
 * um BOOLEANO, não uma exceção, porque "a janela morreu" é um caminho de saída
 * normal que precisa de teardown, enquanto uma exceção vinda do `send` é um
 * defeito a ser logado sem derrubar a captura. São coisas diferentes e o
 * callback do addon trata cada uma do seu jeito.
 */
export type ScreenShareAudioSender = (channel: string, payload: unknown) => boolean

/**
 * O que precisa ser observado para não deixar a captura viva: o `webContents`
 * do renderer. Tipado estruturalmente para o teste poder injetar um duplo sem
 * fabricar um `WebContents` inteiro do Electron.
 */
export type ScreenShareAudioTeardownTarget = {
  on(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown
}

// ---------------------------------------------------------------------------
// Carga do addon — PREGUIÇOSA e injetável, nunca `import` no topo.
//
// Este projeto é desenvolvido em WSL2 e o `.node` publicado é PE32+ de Windows
// x64: um `import ... from 'loopback-capture'` no topo derrubaria o processo
// main em `npm run dev` aqui, todo dia, antes de a janela abrir.
//
// É a diferença para o `uiohook-napi`, que PODE ser importado no topo de
// `voice/ptt.ts`: aquele pacote publica prebuild de Linux junto: este publica
// só o binário de Windows.
// ---------------------------------------------------------------------------

type ModuleLoader = () => LoopbackCaptureModule

const defaultLoader: ModuleLoader = () =>
  // O bundle do processo main sai em CommonJS (`out/main/index.js` começa com
  // `"use strict"` e usa `require`), então `require` direto basta — não é
  // preciso `createRequire(import.meta.url)`. E o electron-vite EXTERNALIZA
  // dependências do main, então esta chamada continua um `require` de verdade
  // no bundle, resolvido em runtime a partir de `node_modules` (é o que faz o
  // `bindings` do pacote achar o `.node` pela pilha de chamada, e o que exige
  // `asarUnpack` no empacotamento — plano 08.6-01).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('loopback-capture') as LoopbackCaptureModule

let loadModule: ModuleLoader = defaultLoader

/** Resultado do `require`, cacheado — sucesso E falha. Tentar carregar 100 vezes um `.node` que não existe é só barulho no log. */
let addonCache: { ok: true; module: LoopbackCaptureModule } | { ok: false; detail: string } | null =
  null

/**
 * Injeta um loader falso e limpa o cache. Existe para o teste de contrato:
 * neste ambiente o `require` real SEMPRE falha, então sem injeção só o caminho
 * `addon-unavailable` seria exercitável.
 */
export function __setModuleLoaderForTests(loader: ModuleLoader | null): void {
  loadModule = loader ?? defaultLoader
  addonCache = null
}

function loadAddon(): { ok: true; module: LoopbackCaptureModule } | { ok: false; detail: string } {
  if (addonCache) return addonCache
  try {
    addonCache = { ok: true, module: loadModule() }
  } catch (err) {
    addonCache = { ok: false, detail: String(err) }
  }
  return addonCache
}

/**
 * O portão de capacidade. NUNCA lança — quem chama sempre recebe um veredito.
 *
 * Três camadas, parando na primeira que reprovar. A terceira (`start()`
 * lançando) mora em `startScreenShareAudioCapture`, porque só se descobre
 * tentando.
 */
export function isProcessAudioSupported(): ScreenShareAudioCapability {
  // 1. Plataforma. O process loopback é Win32 puro (WASAPI + Media
  //    Foundation). Em WSL2/Linux/macOS é este o caminho que roda.
  if (process.platform !== 'win32') {
    return { supported: false, reason: 'not-windows' }
  }

  // 2. Build do Windows. `os.release()` devolve "10.0.<build>" (o libuv
  //    moderno usa `RtlGetVersion`, que não mente por manifesto de
  //    compatibilidade).
  //
  //    Se NÃO der para ler o build, não reprovar por isso: seguir e deixar o
  //    `start()` decidir. O portão de versão é barato e falível (a zona
  //    cinzenta de Windows 10 2004+ atualizado, onde há relato de
  //    funcionamento); o portão que vale é tentar.
  const currentRelease = release()
  const build = Number.parseInt(currentRelease.split('.')[2] ?? '', 10)
  if (Number.isFinite(build) && build < MIN_WINDOWS_BUILD_FOR_PROCESS_LOOPBACK) {
    return { supported: false, reason: 'windows-too-old', detail: currentRelease }
  }

  // 3. O addon carrega? (arquitetura errada, `.node` ausente, preso dentro do
  //    asar — tudo cai aqui.)
  const addon = loadAddon()
  if (!addon.ok) {
    return { supported: false, reason: 'addon-unavailable', detail: addon.detail }
  }

  return { supported: true }
}

type ActiveCapture = {
  capture: LoopbackCaptureInstance
  send: ScreenShareAudioSender
  watchdog: ReturnType<typeof setTimeout> | null
  chunks: number
  bytes: number
  /** Remove os listeners de ciclo de vida do renderer. Sempre chamado no stop. */
  detach: () => void
}

let active: ActiveCapture | null = null

function emitStatus(send: ScreenShareAudioSender, status: ScreenShareAudioStatus): void {
  try {
    send(SCREENSHARE_AUDIO_CHANNELS.STATUS, status)
  } catch (err) {
    console.error('[screenshare-audio] falha ao enviar status ao renderer:', err)
  }
}

/**
 * Para a captura nativa. IDEMPOTENTE de propósito, e chamada de TODO caminho
 * de saída.
 *
 * Armadilha 5 da pesquisa (que é o Pitfall 2 da Fase 8 com outra roupa): o SDK
 * do LiveKit dá `track.stop()` ao despublicar, mas não sabe nada do
 * `loopback-capture`. Sem um gancho explícito o WASAPI continua capturando o
 * computador inteiro e 100 callbacks/s continuam chegando para sempre — é o
 * equivalente sonoro do microfone que fica aberto depois da reunião.
 *
 * NOTA DE DESEMPENHO, conhecida e aceita na v1: `stop()` BLOQUEIA a thread que
 * chama até o Media Foundation confirmar a parada (comentário explícito em
 * `package/src/LoopbackCaptureWrap.cpp`). No processo main isso trava o event
 * loop por dezenas de ms. É o principal argumento para mover o addon para um
 * `utilityProcess` numa versão seguinte — evolução conhecida, não dívida
 * esquecida.
 */
export function stopScreenShareAudioCapture(): void {
  const current = active
  if (!current) return

  // Zerar o estado ANTES de qualquer coisa que possa lançar ou reentrar: é o
  // que torna a segunda chamada um no-op de verdade, mesmo que `capture.stop()`
  // exploda ou que um último chunk chegue durante a parada.
  active = null

  if (current.watchdog) clearTimeout(current.watchdog)
  current.detach()

  try {
    current.capture.stop()
  } catch (err) {
    console.error('[screenshare-audio] falha ao parar a captura nativa:', err)
  }

  console.log(
    '[screenshare-audio] captura encerrada: %d chunks, %d bytes',
    current.chunks,
    current.bytes
  )
  emitStatus(current.send, { kind: 'stopped' })
}

/**
 * Inicia a captura em modo EXCLUIR. Nunca lança: toda falha vira um
 * `ScreenShareAudioStartResult` com `ok: false` e um motivo legível.
 */
export function startScreenShareAudioCapture(
  send: ScreenShareAudioSender,
  teardownTarget?: ScreenShareAudioTeardownTarget | null
): ScreenShareAudioStartResult {
  // Uma instância = uma captura. `start()` numa instância já iniciada LANÇA
  // ("Capture already started on this instance"), então nunca se reaproveita:
  // a anterior morre aqui e a nova nasce logo abaixo.
  if (active) {
    console.warn('[screenshare-audio] nova captura pedida com uma ativa — parando a anterior')
    stopScreenShareAudioCapture()
  }

  const capability = isProcessAudioSupported()
  if (!capability.supported) {
    // Degradação honesta: SEM ÁUDIO, com motivo. Jamais loopback de
    // dispositivo (ver a proibição em `screenshare-audio-types.ts`).
    console.warn(
      '[screenshare-audio] áudio por processo indisponível: %s (%s)',
      capability.reason,
      capability.detail ?? 'sem detalhe'
    )
    const failure = {
      kind: 'failed' as const,
      reason: capability.reason,
      ...(capability.detail === undefined ? {} : { detail: capability.detail })
    }
    emitStatus(send, failure)
    return capability.detail === undefined
      ? { ok: false, reason: capability.reason }
      : { ok: false, reason: capability.reason, detail: capability.detail }
  }

  const addon = loadAddon()
  if (!addon.ok) {
    // Inalcançável na prática (a capacidade acabou de carregar o módulo), mas
    // é o que mantém o tipo honesto sem um `!`.
    emitStatus(send, { kind: 'failed', reason: 'addon-unavailable', detail: addon.detail })
    return { ok: false, reason: 'addon-unavailable', detail: addon.detail }
  }

  const capture = new addon.module.LoopbackCapture()

  const onChunk = (chunk: Buffer): void => {
    // Este callback vem de uma `Napi::ThreadSafeFunction`: uma exceção que
    // escape daqui atravessa a fronteira do addon. Nada, jamais, pode vazar.
    try {
      const current = active
      if (!current) return

      if (current.watchdog) {
        clearTimeout(current.watchdog)
        current.watchdog = null
      }
      current.chunks += 1
      current.bytes += chunk?.length ?? 0

      const delivered = current.send(SCREENSHARE_AUDIO_CHANNELS.CHUNK, chunk)
      if (!delivered) {
        // Janela destruída: ignorar em silêncio e agendar a parada. Agendar,
        // e não parar aqui, porque `stop()` bloqueia e estamos dentro da
        // entrega do addon.
        setTimeout(() => stopScreenShareAudioCapture(), 0)
      }
    } catch (err) {
      // Falha ao entregar UM chunk não derruba a captura — o próximo pode ir.
      console.error('[screenshare-audio] falha ao encaminhar chunk:', err)
    }
  }

  try {
    // ------------------------------------------------------------------
    // O `false` É O CORAÇÃO DA FASE 8.6. Não troque por `true`.
    //
    // `start(processId, includeProcessTree, cb)` do pacote mapeia o segundo
    // parâmetro direto para (`package/src/LoopbackCapture.cpp:89`):
    //
    //   true  -> PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
    //   false -> PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
    //
    // Com `process.pid` (o PID do processo main) e `false`, o Windows captura
    // o sistema inteiro TIRANDO este processo e todos os seus filhos. Como é
    // o próprio app que toca a voz dos outros participantes, o eco morre por
    // construção — e compartilhar uma janela ou a tela inteira vira exatamente
    // o mesmo código, sem ramo especial.
    //
    // PREMISSA MAIS FRÁGIL DA FASE INTEIRA, escrita aqui para não se perder:
    // isto depende de o serviço de áudio do Chromium (o processo utilitário
    // `audio.mojom.AudioService`, que é quem realmente toca a voz dos outros)
    // ser filho do processo-navegador, e portanto estar DENTRO da árvore
    // excluída. É coerente com a arquitetura do Chromium, mas não há afirmação
    // oficial explícita dizendo isso. É o item nº 1 do checkpoint humano
    // 08.6-06. Se a premissa for falsa, a voz dos outros continua entrando e a
    // fase precisa de outro desenho (addon em `utilityProcess` fora da árvore
    // não resolve — pioraria; o caminho seria modo INCLUIR com o PID do app
    // compartilhado).
    //
    // PREÇO ACEITO do modo EXCLUIR: vai junto TUDO que o computador toca menos
    // o Hydra — o Spotify, a notificação do Windows, o vídeo da outra aba. Não
    // é o comportamento do Discord; é o do OBS "Desktop Audio" com o app
    // removido. Troca de escopo por robustez, e o texto do toggle precisa
    // dizer isso.
    // ------------------------------------------------------------------
    capture.start(process.pid, false, onChunk)
  } catch (err) {
    // `Error("Failed to start loopback capture (HRESULT 0x...)")` é o que o
    // addon lança quando a ativação falha. O HRESULT é o número que distingue
    // "Windows velho demais" de "outra coisa" — por isso o erro INTEIRO vai
    // para o log, e não só a mensagem resumida.
    console.error('[screenshare-audio] start() do addon falhou:', err)
    const detail = String(err)
    emitStatus(send, { kind: 'failed', reason: 'start-failed', detail })
    return { ok: false, reason: 'start-failed', detail }
  }

  const detach = attachTeardownListeners(teardownTarget)

  active = {
    capture,
    send,
    // Watchdog de silêncio: o addon DESCARTA buffers silenciosos
    // (`IsBufferSilent`, -70 dBFS), então "nenhum chunk" pode ser só um trecho
    // quieto. Ele NÃO para a captura — só transforma o modo de falha "iniciou
    // e só chegam zeros" (issue #414 do Windows-classic-samples, com o Teams)
    // em aviso legível em vez de silêncio inexplicado.
    watchdog: setTimeout(() => {
      if (!active) return
      active.watchdog = null
      console.warn(
        '[screenshare-audio] nenhum chunk em %dms — o app compartilhado pode não estar tocando nada, ou o áudio dele pode não aparecer no process loopback',
        SILENCE_WATCHDOG_MS
      )
      emitStatus(active.send, { kind: 'no-audio-yet' })
    }, SILENCE_WATCHDOG_MS),
    chunks: 0,
    bytes: 0,
    detach
  }

  console.log('[screenshare-audio] captura iniciada em modo EXCLUIR (pid %d)', process.pid)
  emitStatus(send, { kind: 'capturing' })

  // O formato NÃO é negociado: está fixado no C++ do pacote
  // (`LoopbackCapture.cpp:171-175`). `GetMixFormat()` devolve `E_NOTIMPL` no
  // dispositivo virtual de process loopback (bug conhecido, documentado na
  // Microsoft Q&A) e o pacote contorna pedindo
  // `AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM`. Ele viaja no resultado para o
  // renderer não duplicar estes três números.
  return { ok: true, format: { sampleRate: 48000, channels: 2, bitsPerSample: 16 } }
}

/**
 * Liga a captura ao ciclo de vida do renderer. Devolve a função que desfaz o
 * vínculo (chamada no stop, para não acumular listeners a cada transmissão).
 */
function attachTeardownListeners(target?: ScreenShareAudioTeardownTarget | null): () => void {
  if (!target) return () => {}

  const onGone = (): void => {
    console.warn('[screenshare-audio] renderer saiu de cena — parando a captura')
    stopScreenShareAudioCapture()
  }

  const onNavigation = (...args: unknown[]): void => {
    // F5/HMR no renderer. Sem isto, a captura nativa sobrevive à recarga e 100
    // callbacks/s passam a ir para uma janela que não existe mais (Armadilha 5
    // da pesquisa).
    //
    // Electron 43 entrega um objeto de detalhes; versões antigas entregavam
    // `(event, url, isInPlace, isMainFrame)`. Lê-se defensivamente e, na
    // dúvida, PARA: parar sem precisar custa um compartilhamento sem som,
    // enquanto não parar custa captura do sistema inteiro rodando à toa.
    const details = args[0] as { isInPlace?: unknown; isMainFrame?: unknown } | undefined
    const isInPlace = details?.isInPlace === true || args[2] === true
    const isMainFrame = details?.isMainFrame !== false && args[3] !== false
    if (isInPlace || !isMainFrame) return
    onGone()
  }

  target.on('did-start-navigation', onNavigation)
  target.on('destroyed', onGone)

  return () => {
    try {
      target.removeListener('did-start-navigation', onNavigation)
      target.removeListener('destroyed', onGone)
    } catch (err) {
      // `removeListener` num `webContents` já destruído pode lançar; não é
      // motivo para o teardown falhar.
      console.error('[screenshare-audio] falha ao remover listeners do renderer:', err)
    }
  }
}

// Mesma guarda de `registerScreenShareHandler`: os `ipcMain.on`/`handle` deste
// módulo empilhariam de verdade num segundo registro (dois listeners parando a
// mesma captura, dois handlers para o mesmo canal — o segundo `handle` do
// Electron ainda LANÇA).
let registered = false

/**
 * @param getMainWindow resolvido no MOMENTO DO USO, não no registro: este
 * registro acontece dentro de `app.whenReady()`, antes de `createWindow()`.
 * Guardar a janela aqui guardaria `null` para sempre.
 */
export function registerScreenShareAudioHandlers(getMainWindow: () => BrowserWindow | null): void {
  if (registered) {
    console.warn(
      '[screenshare-audio] registerScreenShareAudioHandlers() chamada mais de uma vez — ignorando a segunda'
    )
    return
  }
  registered = true

  const send: ScreenShareAudioSender = (channel, payload) => {
    const window = getMainWindow()
    // `false` = "não há para onde enviar", e o callback do chunk trata isso
    // como caminho de saída (agenda o stop), não como erro.
    if (!window || window.isDestroyed()) return false
    window.webContents.send(channel, payload)
    return true
  }

  ipcMain.handle(
    SCREENSHARE_AUDIO_CHANNELS.START,
    async (): Promise<ScreenShareAudioStartResult> => {
      const window = getMainWindow()
      const target =
        window && !window.isDestroyed()
          ? (window.webContents as unknown as ScreenShareAudioTeardownTarget)
          : null
      // NUNCA rejeita: o renderer recebe sempre um `ScreenShareAudioStartResult`,
      // porque "não deu, e o motivo é este" é informação de produto (o aviso na
      // tela), não uma exceção de IPC para ninguém tratar.
      return startScreenShareAudioCapture(send, target)
    }
  )

  ipcMain.on(SCREENSHARE_AUDIO_CHANNELS.STOP, () => {
    stopScreenShareAudioCapture()
  })

  // Último caminho de saída: o app inteiro encerrando. Mesmo padrão do
  // `stopPttHook()` em `src/main/index.ts`.
  app.on('before-quit', () => {
    stopScreenShareAudioCapture()
  })
}
