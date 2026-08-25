// Diagnóstico do áudio de compartilhamento de tela — Pitfall 1 (PITFALLS.md),
// confirmado em uso real em 2026-08-20 com 4 pessoas numa call: quem
// compartilhava tela com áudio fazia as outras 3 se ouvirem.
//
// ------------------------------------------------------------------
// Por que este arquivo existe.
//
// A Fase 8 foi construída sobre uma premissa: `restrictOwnAudio: true` nas
// constraints de `getDisplayMedia()` impede que o loopback do WASAPI capture o
// áudio que o próprio app está tocando (a voz dos outros participantes). Está
// verificado que a flag CHEGA ao `getDisplayMedia` — `livekit-client` repassa
// `options.audio` sem filtrar — e que o Electron instalado é o 43.4.0, a
// versão que a pesquisa apontou como a que parou de descartar a flag.
//
// E o eco aconteceu assim mesmo.
//
// Uma constraint não-padrão que o Chromium não conhece é IGNORADA EM SILÊNCIO:
// nenhum erro, nenhum aviso, a Promise resolve normalmente e a captura vem sem
// o filtro. Não dá para distinguir "aplicada e insuficiente" de "descartada"
// olhando o código — só perguntando ao navegador. É o que este módulo faz, e
// é a única coisa capaz de fechar a causa raiz.
//
// Nada aqui altera comportamento: só observa e imprime. Toda função é
// defensiva a ponto de nunca lançar — um diagnóstico que derruba o
// compartilhamento que veio diagnosticar seria pior que a doença.
// ------------------------------------------------------------------
//
// O QUE PROCURAR NO CONSOLE (DevTools do app, aba Console): a palavra
// `diagnóstico`. São 4 linhas numeradas, impressas sozinhas ao começar a
// compartilhar, mais uma linha final de VEREDITO.

const PREFIX = '[screenshare] diagnóstico'

/** Nunca deixa uma falha do diagnóstico virar falha do compartilhamento. */
function safely(what: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    console.warn('%s: falhou ao coletar %s (ignorado)', PREFIX, what, err)
  }
}

/**
 * `getSettings()`/`getConstraints()` não expõem chaves não-padrão nos tipos do
 * TS. O objeto em si é comum — o cast é só para poder lê-lo por nome.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>
}

function electronVersion(): string {
  try {
    return window.electron?.process?.versions?.electron ?? 'desconhecida'
  } catch {
    return 'desconhecida'
  }
}

/**
 * Estado de `restrictOwnAudio` neste Chromium, do jeito que só o navegador
 * pode responder.
 *
 * `getSupportedConstraints()` lista as constraints que a engine RECONHECE. Se
 * `restrictOwnAudio` não estiver lá (ou estiver como `false`), a constraint
 * que o app passa é jogada fora sem aviso — e toda a defesa contra o eco da
 * Fase 8 nunca existiu de fato.
 */
export function isRestrictOwnAudioSupported(): boolean | 'indisponível' {
  try {
    // "Não deu para perguntar" e "perguntei e a resposta foi não" são
    // diagnósticos DIFERENTES, e confundi-los aqui faria o veredito acusar a
    // constraint por um ambiente sem `mediaDevices`. Daí a checagem explícita
    // em vez de encadear optional chaining até um `{}`.
    const query = navigator.mediaDevices?.getSupportedConstraints
    if (typeof query !== 'function') return 'indisponível'
    const supported = asRecord(query.call(navigator.mediaDevices))
    if (!('restrictOwnAudio' in supported)) return false
    return supported.restrictOwnAudio === true
  } catch {
    return 'indisponível'
  }
}

/**
 * Linha 1: o que este Chromium reconhece. Chamada ANTES de a captura começar,
 * porque não depende dela — e porque é a linha que sozinha decide se a
 * premissa da Fase 8 era verdadeira.
 */
export function logCaptureSupport(systemAudioRequested: boolean): void {
  safely('o suporte a constraints', () => {
    const supported = isRestrictOwnAudioSupported()
    console.log(
      '%s 1/4 — restrictOwnAudio reconhecida por este Chromium: %s (Electron %s). Áudio de sistema nesta captura: %s',
      PREFIX,
      supported,
      electronVersion(),
      systemAudioRequested ? 'LIGADO' : 'desligado'
    )
    if (supported !== true && systemAudioRequested) {
      // A conclusão dita por extenso, para não depender de quem lê saber o que
      // um `false` ali significa.
      console.warn(
        '%s 1/4 — VEREDITO PARCIAL: a constraint restrictOwnAudio NÃO é reconhecida e está sendo DESCARTADA EM SILÊNCIO. Nada impede o loopback de capturar a voz dos outros participantes; o eco do Pitfall 1 é esperado enquanto o áudio de sistema estiver ligado.',
        PREFIX
      )
    }
  })
}

/**
 * Linhas 2 e 3: o que foi pedido ao `getDisplayMedia` e o que ele devolveu.
 *
 * Envolve `navigator.mediaDevices.getDisplayMedia` pelo tempo de UMA captura e
 * devolve a função que desfaz. É a única forma de ver o MediaStream cru: o
 * `livekit-client` fica com `stream.getAudioTracks()[0]` e descarta o resto
 * sem dizer nada (`createScreenTracks`), então contar as tracks depois de
 * publicado não responderia "quantas vieram".
 *
 * Contrato: nunca engole erro (o cancelamento do usuário precisa continuar
 * rejeitando), nunca troca o valor de retorno, e restaura o original mesmo se
 * a coleta falhar.
 */
export function instrumentGetDisplayMedia(): () => void {
  const media = navigator.mediaDevices as MediaDevices | undefined
  const original = media?.getDisplayMedia
  if (!media || typeof original !== 'function') {
    console.warn('%s: getDisplayMedia indisponível — sem linhas 2/4 e 3/4', PREFIX)
    return () => {}
  }

  const patched = async function (
    this: MediaDevices,
    constraints?: DisplayMediaStreamOptions
  ): Promise<MediaStream> {
    safely('as constraints pedidas', () => {
      console.log(
        '%s 2/4 — constraints pedidas ao getDisplayMedia: %o',
        PREFIX,
        // Cópia rasa: o objeto original é do SDK e não deve ser exposto a
        // mutação pelo inspetor do DevTools.
        { ...(constraints ?? {}) }
      )
    })

    // Sem try/catch em volta: rejeição (usuário cancelou, main devolveu
    // `callback({})`) precisa subir intacta para `startScreenShare()`.
    const stream = await original.call(this, constraints)

    safely('as tracks devolvidas', () => {
      const audio = stream.getAudioTracks()
      const video = stream.getVideoTracks()
      console.log(
        '%s 3/4 — getDisplayMedia devolveu %d track(s) de vídeo e %d de áudio%s',
        PREFIX,
        video.length,
        audio.length,
        audio.length > 1 ? ' (o livekit-client publica APENAS a primeira)' : ''
      )
      audio.forEach((track, index) => {
        console.log(
          '%s 3/4 — track de áudio #%d: label=%s settings=%o constraints=%o',
          PREFIX,
          index,
          track.label,
          asRecord(track.getSettings?.()),
          asRecord(track.getConstraints?.())
        )
      })
    })

    return stream
  }

  try {
    media.getDisplayMedia = patched
  } catch (err) {
    console.warn('%s: não foi possível instrumentar getDisplayMedia (ignorado)', PREFIX, err)
    return () => {}
  }

  return () => {
    try {
      media.getDisplayMedia = original
    } catch {
      // Se nem restaurar dá, o wrapper continua no lugar. Ele é transparente
      // (mesmos argumentos, mesmo retorno, mesmas rejeições), então o pior
      // efeito é console mais falante.
    }
  }
}

/**
 * Linha 4 + veredito: a track de áudio que foi DE FATO publicada.
 *
 * É a fonte de verdade do que está no ar. `getConstraints()` devolve o que foi
 * pedido para aquela track; `getSettings()`, o que a engine efetivamente
 * aplicou. Se `restrictOwnAudio` some dos dois, a constraint não sobreviveu ao
 * caminho — que é exatamente a hipótese a testar.
 *
 * @param track a MediaStreamTrack de `Track.Source.ScreenShareAudio`, ou
 * `null` se nenhuma foi publicada.
 */
export function logPublishedScreenShareAudio(
  track: MediaStreamTrack | null,
  systemAudioRequested: boolean
): void {
  safely('a track publicada', () => {
    if (!track) {
      console.log(
        '%s 4/4 — nenhuma track de áudio publicada%s',
        PREFIX,
        systemAudioRequested
          ? ' apesar de o áudio de sistema estar LIGADO (o processo main não concedeu loopback — ver o log do main)'
          : ' (áudio de sistema desligado: é o esperado, e é o que garante eco zero)'
      )
      return
    }

    const settings = asRecord(track.getSettings?.())
    const constraints = asRecord(track.getConstraints?.())
    console.log(
      '%s 4/4 — track de áudio PUBLICADA: label=%s readyState=%s settings=%o constraints=%o',
      PREFIX,
      track.label,
      track.readyState,
      settings,
      constraints
    )

    // O veredito escrito por extenso. Três estados possíveis, e o do meio é o
    // que a leitura de código não conseguia distinguir.
    const supported = isRestrictOwnAudioSupported()
    const inConstraints = constraints.restrictOwnAudio
    const inSettings = settings.restrictOwnAudio

    if (supported !== true) {
      console.warn(
        '%s VEREDITO: restrictOwnAudio NÃO é reconhecida por este Chromium. A premissa da Fase 8 é falsa — a flag é descartada em silêncio e o eco é esperado. Mitigação disponível hoje: desligar o áudio de sistema no seletor.',
        PREFIX
      )
      return
    }
    if (inConstraints === undefined && inSettings === undefined) {
      console.warn(
        '%s VEREDITO: restrictOwnAudio é reconhecida, mas NÃO aparece nem em getConstraints() nem em getSettings() da track publicada — ela se perdeu no caminho até a captura. Tratar como não aplicada.',
        PREFIX
      )
      return
    }
    console.log(
      '%s VEREDITO: restrictOwnAudio chegou à track publicada (constraints=%o settings=%o). Se AINDA houver eco, a flag está sendo aplicada e é INSUFICIENTE para o loopback de dispositivo — vale o plano B do Pitfall 1.',
      PREFIX,
      inConstraints,
      inSettings
    )
  })
}
