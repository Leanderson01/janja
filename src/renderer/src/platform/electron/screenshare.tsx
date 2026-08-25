/**
 * Compartilhamento de tela do alvo DESKTOP.
 *
 * Este arquivo é o destino de um MOVIMENTO, não de uma reescrita: as ~190
 * linhas de `startAudio`/`stopAudio` abaixo saíram inteiras de
 * `state/voice-context.tsx` (Fase 8.6), com a mesma ordem de chamadas, as
 * mesmas guardas, o mesmo try/catch por passo do teardown e os mesmos cinco
 * parâmetros de `publishTrack`. As únicas diferenças são de endereço: o
 * `useRef` do componente virou um `let` de módulo e o `room` virou parâmetro.
 *
 * Cada comentário veio junto de propósito. Todos eles registram um modo de
 * falha que já aconteceu de verdade — o eco de 2026-08-20, a track publicada
 * em mono e em silêncio, o WASAPI capturando para ninguém depois de uma
 * despublicação. Comentário que fica para trás numa mudança de arquivo é
 * exatamente como uma lição cara é reaprendida.
 *
 * Nada disto é verificável em WSL2: o caminho inteiro é Windows nativo, e a
 * prova continua sendo a Parte 3 de `.planning/CHECKPOINT-WINDOWS.md`.
 */
import { AudioPresets, Track, type Room, type ScreenShareCaptureOptions } from 'livekit-client'
import { toast } from 'sonner'

import type { PlatformScreenShare } from '@/platform/contract'
import {
  createScreenShareAudioBridge,
  type ScreenShareAudioBridge
} from '@/lib/screenshare-audio-bridge'
import { loadScreenSharePreferences } from '@/lib/screenshare-preferences'

// O seletor próprio mora AQUI desde o Plano 10-02, e não em
// `components/shell/`: ele fala `window.screenshare` em quatro linhas, e
// enquanto vivesse na pasta de componentes um import descuidado poderia
// arrastá-lo para o bundle web — onde `window.screenshare` é `undefined`.
// Movido, a regra "nada de `window.*` fora de `platform/electron/**`" fica sem
// exceção nominal nenhuma. Os 23 testes vieram junto, sem uma asserção
// alterada.
import { ScreenSharePicker } from './ScreenSharePicker'

// Fase 8.6: o texto que a pessoa lê quando o áudio do compartilhamento não vai
// acontecer. A degradação é SEMPRE "compartilha sem som, com aviso" — nunca
// "não compartilha", e nunca, jamais, um fallback para loopback de
// dispositivo: trocar "sem som" por "todo mundo se ouvindo" não é degradar, é
// devolver o defeito que originou esta fase.
//
// `not-windows` e `addon-unavailable` compartilham o mesmo texto de propósito:
// para quem está usando, os dois são "esta instalação não consegue". A
// distinção entre eles é de diagnóstico e vive no console/log do main.
const AUDIO_UNAVAILABLE_MESSAGES: Record<ScreenShareAudioUnavailableReason, string> = {
  'windows-too-old':
    'Seu Windows não suporta áudio por aplicativo (precisa do Windows 11). A tela vai sem som.',
  'not-windows':
    'Não foi possível iniciar o áudio do compartilhamento nesta máquina. A tela vai sem som.',
  'addon-unavailable':
    'Não foi possível iniciar o áudio do compartilhamento nesta máquina. A tela vai sem som.',
  // O HRESULT fica SÓ no console: ele é a informação que resolve o caso para
  // quem for depurar, e ruído puro para quem só queria mostrar a tela.
  'start-failed': 'O Windows recusou a captura de áudio. A tela vai sem som.'
}

// A ponte não montou (worklet bloqueado pela CSP, AudioContext recusado). A
// captura nativa já começou quando isto acontece — quem trata precisa pará-la.
const AUDIO_BRIDGE_FAILED_MESSAGE =
  'Não foi possível preparar o áudio do compartilhamento. A tela vai sem som.'

// Watchdog do processo main: a captura iniciou sem erro e nada chegou. Existe
// aplicativo cujo áudio simplesmente não aparece no process loopback do
// Windows (issue #414 do `microsoft/Windows-classic-samples`, relatada com o
// Teams). Falhar de forma legível é o requisito — silêncio inexplicado é o
// modo de falha que esta fase existe para não repetir.
const NO_AUDIO_YET_MESSAGE =
  'Nenhum áudio chegou do compartilhamento. Alguns aplicativos não permitem captura de áudio.'

const AUDIO_PUBLISH_FAILED_MESSAGE =
  'O áudio do compartilhamento não pôde ser publicado. A tela continua, sem som.'
// Fase 8.6: tudo que o áudio do compartilhamento abriu e que precisa ser
// fechado — a ponte (AudioContext + worklet + track) e as DUAS assinaturas
// de IPC. Ref e não estado: quem lê são callbacks assíncronos e handlers de
// evento do `Room`, onde uma closure sobre estado estaria velha; e mudar
// isto não deve rerenderizar nada (não há UI pendurada nele). Ao sair de
// `voice-context.tsx` ele deixou de ser `useRef` e virou um `let` de módulo,
// pelo mesmo motivo pelo qual era um ref: MÓDULO, e não estado de React —
// existe uma captura de áudio de compartilhamento por app, não uma por
// instância de componente, e `screenShare` é um singleton do módulo.
//
// `null` significa exatamente "não há áudio de compartilhamento no ar", e é
// o que torna `stopProcessAudio()` idempotente.
let activeAudio: {
  bridge: ScreenShareAudioBridge
  unsubscribeChunk: () => void
  unsubscribeStatus: () => void
} | null = null

/**
 * O segundo passo do compartilhamento: captura de áudio POR PROCESSO no
 * main, convertida em track pela ponte do renderer e publicada como
 * `ScreenShareAudio`.
 *
 * Contrato desta função: ela NUNCA lança e NUNCA derruba o vídeo. Todo
 * caminho de falha termina em "compartilha sem som, com aviso legível" — e
 * nunca em loopback de dispositivo, que é o defeito de 2026-08-20 (ver a
 * nota histórica em `captureOptions` abaixo e a proibição por extenso em
 * `src/main/screenshare-audio-types.ts`).
 */
async function startProcessAudio(room: Room): Promise<void> {
  // A PREFERÊNCIA É RELIDA AQUI, DEPOIS de `setScreenShareEnabled` resolver
  // — e a mudança de lugar é uma melhoria de comportamento, não arrumação.
  //
  // Até o FIX de 2026-08-25 ela era lida ANTES, porque compunha a constraint
  // de `getDisplayMedia()`, que é fixada no momento da chamada — ou seja,
  // antes de o seletor abrir. Consequência: ligar o toggle DENTRO do diálogo
  // não valia para aquela transmissão, e o próprio diálogo precisava avisar
  // "vale a partir do próximo compartilhamento".
  //
  // Agora nada de áudio é fixado antes do diálogo. O `ScreenSharePicker`
  // persiste a escolha no clique, esta leitura acontece depois, e o toggle
  // passa a valer IMEDIATAMENTE.
  const { systemAudio } = loadScreenSharePreferences()
  if (!systemAudio) return

  try {
    const result = await window.screenshare.audio.start()
    if (!result.ok) {
      // Não é falha do compartilhamento: é uma máquina que não consegue.
      // `detail` (HRESULT, release do Windows, erro do `require`) fica no
      // console; a pessoa lê a frase curta.
      console.warn(
        '[screenshare] áudio por processo indisponível (%s)%s',
        result.reason,
        result.detail ? `: ${result.detail}` : ''
      )
      toast.warning(AUDIO_UNAVAILABLE_MESSAGES[result.reason])
      return
    }

    // `result.format` vem do main: o renderer não duplica 48000/2/16 como
    // constante própria (o número mora no C++ de um pacote de terceiro).
    const bridge = await createScreenShareAudioBridge(result.format).catch((err: unknown) => {
      console.error('[screenshare] falha ao montar a ponte de áudio', err)
      return null
    })
    if (!bridge) {
      toast.warning(AUDIO_BRIDGE_FAILED_MESSAGE)
      // A captura nativa JÁ começou. Sem isto o WASAPI ficaria capturando e
      // o processo main mandando ~100 chunks/s para ninguém, para sempre.
      window.screenshare.audio.stop()
      return
    }

    const unsubscribeChunk = window.screenshare.audio.onChunk((bytes) => {
      // Depois de `bridge.stop()` isto é no-op silencioso — o que cobre a
      // corrida entre um último chunk em voo e o encerramento.
      bridge.pushChunk(bytes)
    })

    const unsubscribeStatus = window.screenshare.audio.onStatus((status) => {
      if (status.kind === 'no-audio-yet') {
        console.warn('[screenshare] o watchdog do main não viu nenhum chunk de áudio')
        toast.warning(NO_AUDIO_YET_MESSAGE)
        return
      }
      if (status.kind === 'failed') {
        console.error(
          '[screenshare] a captura de áudio falhou (%s)%s',
          status.reason,
          status.detail ? `: ${status.detail}` : ''
        )
        toast.warning(AUDIO_UNAVAILABLE_MESSAGES[status.reason])
        // A captura morreu do lado de lá; aqui sobrariam AudioContext,
        // worklet e uma track publicada transmitindo silêncio.
        void stopProcessAudio()
      }
    })

    // Guardar ANTES de publicar: se `publishTrack` falhar, o `catch` abaixo
    // precisa encontrar tudo para desmontar.
    activeAudio = { bridge, unsubscribeChunk, unsubscribeStatus }

    await room.localParticipant.publishTrack(bridge.track, {
      // O gancho oficial (`livekit-client.esm.mjs:30086-30088`), e ganhar a
      // fonte certa dá TRÊS coisas de graça:
      //  1. `setScreenShareEnabled(false)` despublica esta track junto com a
      //     de vídeo (`29822-29824`);
      //  2. o republish pós-reconexão não tenta REINICIAR a track (`30743`)
      //     — reiniciar uma track de `MediaStreamDestination` não faz
      //     sentido e é onde uma reconexão viraria silêncio permanente;
      //  3. o lado remoto agrupa este áudio com o vídeo do mesmo
      //     compartilhamento.
      // Publicar sem `source` deixaria `Unknown` e custaria as três.
      source: Track.Source.ScreenShareAudio,
      // NÃO É OTIMIZAÇÃO. O SDK decide estéreo lendo `channelCount` de
      // `getSettings()`/`getConstraints()` (`30067-30070`), e a track de um
      // `MediaStreamAudioDestinationNode` pode não reportar esse campo. Sem
      // isto o resultado seria publicar MONO — e, na prática, em silêncio,
      // sem erro nenhum no console.
      forceStereo: true,
      // Com estéreo o SDK já desliga os dois por padrão (`30071-30081`).
      // Explícitos para que uma mudança de default não reintroduza DTX
      // (transmissão descontínua) em música/jogo, onde ela pica o som.
      dtx: false,
      red: false,
      // 128 kbps (`13098-13100`) — a escolha certa para áudio de
      // transmissão, e o preço a pagar: somados aos ~2,0–2,5 Mbps do vídeo,
      // são ~0,13 Mbps a mais de subida enquanto durar o compartilhamento.
      audioPreset: AudioPresets.musicHighQualityStereo
      // NÃO passar `stream`: a doc do próprio SDK (`options.d.ts:152-155`)
      // diz que `screen_share` e `screen_share_audio` já vão para o mesmo
      // `MediaStream` por padrão. Nomear à mão só cria a chance de errar.
    })

    // Esperado no console logo depois desta linha: um "silence detected" do
    // `checkForSilence()` que o construtor de `LocalAudioTrack` dispara
    // (`21107`). Publicamos antes do primeiro chunk chegar, então a track
    // está mesmo em silêncio nesse instante. É COSMÉTICO — anotado aqui para
    // ninguém caçar esse fantasma.
    console.log('[screenshare] áudio por processo publicado (ScreenShareAudio, estéreo)')
  } catch (err) {
    console.error('[screenshare] falha ao publicar o áudio do compartilhamento', err)
    toast.warning(AUDIO_PUBLISH_FAILED_MESSAGE)
    await stopProcessAudio()
  }
}

/**
 * Fecha tudo que o áudio do compartilhamento abriu. Idempotente: chamar
 * duas vezes (ou reentrar de dentro de um dos passos) não faz nada na
 * segunda.
 *
 * Esta função é a resposta à Armadilha 5 da pesquisa: ao despublicar, o
 * LiveKit chama `track.stop()` na track do `MediaStreamDestination`
 * (`stopOnUnpublish` é `true` por padrão) — e não sabe NADA do
 * `loopback-capture` nem do `AudioContext`. Sem este gancho explícito, o
 * WASAPI continuaria capturando e o processo main continuaria mandando ~100
 * callbacks/s para sempre.
 */
async function stopProcessAudio(): Promise<void> {
  const active = activeAudio
  // Zerado no INÍCIO, não no fim — mesma regra do teardown do processo main
  // (08.6-02). Há `await` no meio desta função, e durante ele chegam
  // eventos (`LocalTrackUnpublished` que o próprio despublicar provoca, o
  // `Disconnected` de uma queda). Zerar no fim faria essa reentrada
  // desmontar tudo uma segunda vez.
  activeAudio = null
  if (!active) return

  // Cada passo no seu try/catch: um `unsubscribe` que lance não pode
  // impedir a captura nativa de parar, que é o que realmente custa caro
  // deixar vivo.
  try {
    // Primeiro parar de RECEBER: ~100 mensagens/s, ~192 KB/s.
    active.unsubscribeChunk()
  } catch (err) {
    console.warn('[screenshare] falha ao remover o listener de chunks', err)
  }
  try {
    active.unsubscribeStatus()
  } catch (err) {
    console.warn('[screenshare] falha ao remover o listener de status', err)
  }
  try {
    // Depois parar de PRODUZIR, do outro lado do IPC.
    window.screenshare.audio.stop()
  } catch (err) {
    console.warn('[screenshare] falha ao pedir a parada da captura nativa', err)
  }
  try {
    // Por último o grafo local: AudioContext, worklet e a track.
    await active.bridge.stop()
  } catch (err) {
    console.warn('[screenshare] falha ao fechar a ponte de áudio', err)
  }
}

export const screenShare: PlatformScreenShare = {
  // SHARE-01/02/03/04 (Plano 08-02) + Fase 8.6: opções de captura do
  // compartilhamento de tela. Só vídeo, sempre — `contentHint` é a única parte
  // variável, e vem da preferência de qualidade (Plano 08-05).
  //
  // ------------------------------------------------------------------
  // NOTA HISTÓRICA: `restrictOwnAudio`, e por que NÃO voltar a apostar nela.
  //
  // Ela era a premissa da Fase 8 inteira: uma constraint pedindo ao Chromium
  // que o loopback não capturasse o áudio que o próprio app está tocando (= a
  // voz dos outros participantes). Chegou a ser CONFIRMADA como reconhecida por
  // este Chromium — não foi o caso de constraint descartada em silêncio, o
  // diagnóstico da época mediu isso — e o eco aconteceu assim mesmo, com quatro
  // pessoas numa call em 2026-08-20.
  //
  // O motivo é estrutural, não de versão: uma constraint é no máximo um PEDIDO,
  // e o loopback do WASAPI é de DISPOSITIVO — ele entrega a saída inteira da
  // placa por definição. Nenhuma flag muda o que o dispositivo é. Quem quiser
  // áudio de sistema sem eco precisa de outra CAPTURA, não de outra constraint:
  // é o que `src/main/screenshare-audio.ts` faz, mandando o próprio Windows
  // excluir a árvore de processos deste app.
  //
  // `echoCancellation`/`noiseSuppression`/`autoGainControl` saíram junto: sem
  // pedir áudio não há o que configurar (e as três foram desenhadas para voz de
  // microfone — em música/jogo/vídeo só degradam a fidelidade).
  // ------------------------------------------------------------------
  //
  // E A WEB? LÁ A HISTÓRIA É OUTRA — não leia a proibição acima e conclua que
  // vale para os dois alvos. O que quebrou no desktop foi o CAMINHO DE
  // CONCESSÃO: quem concede a fonte é o processo main, e o tipo publicado
  // (`electron.d.ts`, `Streams.audio`) só aceita `'loopback'`,
  // `'loopbackWithMute'` ou um `WebFrameMain` — a fonte já está fixada como "o
  // dispositivo inteiro" ANTES de qualquer constraint ser avaliada. No
  // navegador não existe esse passo: o próprio Chrome monta a captura a partir
  // das constraints, e `restrictOwnAudio` é avaliada por quem de fato produz o
  // stream. Ver `platform/web/screenshare.tsx`.
  // ------------------------------------------------------------------
  //
  // `audio: false` não é redundante com a concessão só-vídeo do processo main
  // (`src/main/screenshare.ts`): é a mesma afirmação dita nas duas pontas, e
  // custa uma linha. Pedir áudio aqui só produziria um `audioRequested: true`
  // que nunca será atendido.
  //
  // O segundo parâmetro do contrato (`wantsAudio`) NÃO é declarado aqui, e a
  // ausência é a documentação: no desktop o áudio nunca vem do
  // `getDisplayMedia`, em nenhuma circunstância. Ele é um SEGUNDO passo
  // (`startAudio` abaixo), decidido depois que o seletor fecha — que é o que
  // o FIX de 2026-08-25 comprou. Ramificar as constraints por `wantsAudio`
  // aqui seria desfazer esse conserto sem parecer que desfaz.
  captureOptions(contentHint): ScreenShareCaptureOptions {
    return { audio: false, video: true, contentHint }
  },

  // Fase 8.6, o 2º passo. Envelope fino de propósito: o corpo é o mesmo de
  // sempre, e mantê-lo como função nomeada do módulo preserva as duas
  // chamadas internas (`stopProcessAudio()` de dentro do handler de status e
  // do `catch`) exatamente como estavam.
  startAudio: (room) => startProcessAudio(room),
  stopAudio: () => stopProcessAudio(),

  Extras: ScreenSharePicker
}
