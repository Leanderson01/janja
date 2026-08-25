import {
  desktopCapturer,
  ipcMain,
  session,
  type BrowserWindow,
  type DesktopCapturerSource
} from 'electron'
import {
  PICKER_TIMEOUT_MS,
  SCREENSHARE_CHANNELS,
  THUMBNAIL_SIZE,
  type ScreenShareChoice,
  type ScreenShareSource
} from './screenshare-types'
import { isProcessAudioSupported } from './screenshare-audio'
import type { ScreenShareAudioCapability } from './screenshare-audio-types'

// SHARE-01/03/04 (Planos 08-02 e 08-04): captura de tela com seletor próprio.
//
// Fase 8.6: este handler concede SÓ VÍDEO, sempre, em todos os caminhos. O
// áudio do compartilhamento deixou de sair daqui — ver o bloco no fim do
// handler e `src/main/screenshare-audio.ts`.
//
// O renderer nunca chama `desktopCapturer` — ele chama `getDisplayMedia()`
// (por baixo de `setScreenShareEnabled` do livekit-client), e o Chromium
// entrega essa requisição a ESTE handler no processo main. Quem escolhe a
// fonte é o app, não o Electron: não existe picker nativo no Windows
// (08-RESEARCH.md §2 — a doc oficial confirma que a UI de escolha é
// responsabilidade do app).
//
// O Plano 08-02 escolhia sempre a primeira tela, sem UI. O Plano 08-04
// substitui isso por uma ida e volta ao renderer: o main enumera telas E
// janelas com miniaturas, manda a lista pelo canal `pick-requested`, e espera
// o usuário escolher (`choose-source`) ou desistir (`cancel-picker`).
//
// NÃO passar `{ useSystemPicker: true }` como segundo argumento: é
// experimental e só existe no macOS 15+ (08-RESEARCH.md §1); aqui o app roda
// só em Windows, onde o handler é sempre chamado.
//
// ------------------------------------------------------------------
// Pitfall 2 (PITFALLS.md) é a restrição que governa este arquivo inteiro:
// se o handler terminar SEM chamar `callback`, a Promise de
// `getDisplayMedia()` no renderer nunca resolve NEM rejeita — a UI fica
// carregando para sempre e toda tentativa seguinte de compartilhar na mesma
// sessão do app trava junto. A espera pela escolha do usuário (o caminho novo
// deste plano) é onde isso fica difícil, porque agora existe um caminho em
// que ninguém responde nunca. As defesas, em camadas:
//
//   1. Nenhuma chamada a `callback` mora dentro de um `try` — cada `try`
//      envolve só o `await` que pode lançar. Assim é estruturalmente
//      impossível o `catch` chamar `callback` uma segunda vez.
//   2. Cancelamento explícito do renderer resolve a espera com `null`.
//   3. Timeout de 60s resolve a espera com `null` sem depender do renderer.
//   4. Um pedido novo resolve o pedido anterior com `null` antes de criar o
//      seu — nunca dois pendentes ao mesmo tempo.
//   5. Falha ao serializar/enviar a lista também resolve com `null`.
// ------------------------------------------------------------------

// Registrar `setDisplayMediaRequestHandler` duas vezes SUBSTITUI o handler
// anterior silenciosamente — não empilha. Esta guarda existe para que um
// segundo call-site adicionado por engano (hot-reload do main, um plano
// futuro chamando de novo) apareça como aviso no console em vez de virar um
// handler fantasma que ninguém sabe qual é. Vale também para os dois
// `ipcMain.on` deste módulo, que empilhariam de verdade (dois listeners
// resolvendo a mesma escolha).
let registered = false

/**
 * A escolha em andamento. `null` quando nenhum `getDisplayMedia()` está
 * esperando resposta do usuário — e é isso que torna qualquer evento de IPC
 * atrasado (usuário clicando depois do timeout, listener duplicado, renderer
 * recarregado) um no-op em vez de um segundo `callback`.
 */
/**
 * A escolha resolvida: a fonte concreta do `desktopCapturer` mais o que o
 * usuário decidiu sobre o áudio no diálogo.
 *
 * `systemAudio` continua atravessando o IPC e continua sendo LOGADO aqui, mas
 * o processo main não decide mais nada com ele: quem age sobre a escolha do
 * usuário é o renderer, que relê a preferência persistida depois que o seletor
 * fecha e só então inicia (ou não) a captura por processo.
 */
type PickResult = {
  source: DesktopCapturerSource
  systemAudio: boolean
}

type PendingPick = {
  resolve: (result: PickResult | null) => void
  sources: DesktopCapturerSource[]
  timeout: ReturnType<typeof setTimeout>
}
let pending: PendingPick | null = null

/**
 * Encerra a escolha pendente, se houver, com a escolha do usuário (ou `null`
 * para cancelar). Idempotente de propósito: limpa `pending` ANTES de resolver,
 * então uma segunda chamada — cancelar depois de escolher, dois cliques, um
 * timeout que corre contra o clique — não faz nada.
 */
function settlePending(choice: ScreenShareChoice | null): void {
  const current = pending
  if (!current) return
  pending = null
  clearTimeout(current.timeout)

  if (choice === null) {
    current.resolve(null)
    return
  }

  // Id desconhecido (renderer fora de sincronia, lista velha) cai no mesmo
  // caminho do cancelamento: `null`. Nunca deixa a espera pendurada.
  const source = current.sources.find((item) => item.id === choice.sourceId) ?? null
  if (source === null) {
    console.warn('[screenshare] fonte escolhida não existe mais na lista:', choice.sourceId)
    current.resolve(null)
    return
  }

  current.resolve({ source, systemAudio: choice.systemAudio })
}

/**
 * Traduz o que chegou pelo IPC em uma escolha confiável, ou `null` (=
 * cancelar) se não der para confiar.
 *
 * `sourceId` é exigido como string: sem ele não há o que conceder. Já
 * `systemAudio` é comparado com `=== true` em vez de validado — payload
 * malformado vira "sem áudio de sistema", não vira cancelamento. É a mesma
 * escolha do `sanitize` de `screenshare-preferences.ts`, pelo mesmo motivo:
 * o único valor que LIGA o áudio é um `true` literal e explícito, e a
 * degradação (compartilhar sem som) é infinitamente melhor que a falha
 * (não compartilhar) ou que o defeito (eco de volta na call).
 */
function toChoice(payload: unknown): ScreenShareChoice | null {
  if (typeof payload !== 'object' || payload === null) return null
  const candidate = payload as Partial<Record<keyof ScreenShareChoice, unknown>>
  if (typeof candidate.sourceId !== 'string') return null
  return { sourceId: candidate.sourceId, systemAudio: candidate.systemAudio === true }
}

function toSerializableSource(source: DesktopCapturerSource): ScreenShareSource {
  // `NativeImage` não atravessa o IPC — vira `{}` do outro lado. Data URL é o
  // formato que o `<img>` do renderer consome direto.
  const appIconDataUrl = source.appIcon?.toDataURL()
  return {
    id: source.id,
    name: source.name,
    thumbnailDataUrl: source.thumbnail.toDataURL(),
    // Telas e janelas não têm ícone da mesma forma; `appIcon` é `null` para
    // telas e para janelas sem ícone associado.
    ...(appIconDataUrl ? { appIconDataUrl } : {}),
    isScreen: source.id.startsWith('screen:')
  }
}

/**
 * Manda a lista para o renderer e espera a decisão. Resolve com a fonte
 * escolhida, ou com `null` em cancelamento, timeout, id desconhecido, falha de
 * serialização/envio ou chegada de um pedido novo. NUNCA rejeita, e nunca fica
 * pendurada para sempre.
 */
function requestPick(
  window: BrowserWindow,
  sources: DesktopCapturerSource[],
  audioCapability: ScreenShareAudioCapability
): Promise<PickResult | null> {
  // Defesa 4: se por algum caminho inesperado um pedido anterior ainda estiver
  // pendente, ele é cancelado agora. Sem isto, o `getDisplayMedia` antigo
  // ficaria esperando para sempre, porque a resposta do renderer resolveria só
  // o novo.
  if (pending) {
    console.warn(
      '[screenshare] novo pedido de captura com escolha anterior pendente — cancelando a anterior'
    )
    settlePending(null)
  }

  return new Promise<PickResult | null>((resolve) => {
    const timeout = setTimeout(() => {
      console.warn('[screenshare] nenhuma escolha em %dms — cancelando o pedido', PICKER_TIMEOUT_MS)
      settlePending(null)
    }, PICKER_TIMEOUT_MS)

    // Registrar o pendente ANTES de enviar: o renderer pode responder no
    // mesmo tick em que recebe, e uma resposta que chegasse antes de
    // `pending` existir seria descartada — a espera nunca terminaria.
    pending = { resolve, sources, timeout }

    try {
      window.webContents.send(SCREENSHARE_CHANNELS.PICK_REQUESTED, {
        sources: sources.map(toSerializableSource),
        // O diálogo precisa saber se ESTA MÁQUINA consegue áudio por processo,
        // para poder ser honesto no toggle — ver `ScreenSharePickRequest`.
        // Não é mais "o renderer pediu áudio nesta chamada": nada de áudio é
        // fixado antes do diálogo, então ligar o toggle aqui dentro passa a
        // valer para ESTA transmissão.
        audioAvailable: audioCapability.supported,
        ...(audioCapability.supported ? {} : { audioUnavailableReason: audioCapability.reason })
      })
    } catch (err) {
      console.error('[screenshare] falha ao enviar a lista de fontes ao renderer:', err)
      settlePending(null)
    }
  })
}

/**
 * @param getMainWindow resolvido no momento do pedido, não no registro: este
 * handler é registrado dentro de `app.whenReady()`, ANTES de a janela existir
 * (`session.defaultSession` também só existe depois do ready). Guardar a
 * janela aqui guardaria `null` para sempre.
 */
export function registerScreenShareHandler(getMainWindow: () => BrowserWindow | null): void {
  if (registered) {
    console.warn(
      '[screenshare] registerScreenShareHandler() chamada mais de uma vez — ignorando a segunda'
    )
    return
  }
  registered = true

  // Uma via (`ipcRenderer.send`/`ipcMain.on`), não `invoke`/`handle`: o
  // renderer não espera valor de volta. Quem "responde" é o `callback` do
  // `setDisplayMediaRequestHandler`, do outro lado da Promise que estes dois
  // listeners resolvem por efeito colateral. Registrados uma única vez, aqui
  // fora do handler de captura — dentro dele empilhariam um par novo a cada
  // pedido.
  ipcMain.on(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, (_event, payload: unknown) => {
    const choice = toChoice(payload)
    if (choice === null) {
      console.warn('[screenshare] choose-source com payload inválido — tratando como cancelamento')
      settlePending(null)
      return
    }
    settlePending(choice)
  })

  ipcMain.on(SCREENSHARE_CHANNELS.CANCEL_PICKER, () => {
    settlePending(null)
  })

  // `session.defaultSession` só existe depois de `app.whenReady()` — quem
  // chama é responsável por isso (ver src/main/index.ts).
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    // `audioRequested` reflete a constraint que o renderer passou a
    // `getDisplayMedia()`. Desde a Fase 8.6 ela é SEMPRE `false` (o renderer
    // pede `audio: false`) e não compõe mais concessão nenhuma — é lida só
    // para o log, porque saber que alguém pediu algo que não vai receber é
    // exatamente o tipo de coisa que se quer ver no console quando o áudio
    // sumir sem explicação.
    const audioRequested = request?.audioRequested === true
    let sources: DesktopCapturerSource[]
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        // Miniaturas de verdade agora que existe um seletor para exibi-las
        // (no Plano 08-02 isto era `{ width: 0, height: 0 }`, porque nada era
        // mostrado e gerar bitmap por pedido era trabalho jogado fora).
        thumbnailSize: THUMBNAIL_SIZE,
        fetchWindowIcons: true
      })
    } catch (err) {
      console.error('[screenshare] Falha ao enumerar fontes de tela:', err)
      callback({}) // cancelamento explícito — nunca `callback({ video: undefined })`
      return
    }

    if (sources.length === 0) {
      // Não deveria acontecer (sempre há ao menos uma tela), e por isso mesmo
      // não pode depender do renderer para se resolver.
      console.error('[screenshare] Nenhuma fonte disponível para captura')
      callback({}) // idem: objeto vazio é a forma documentada de "sem seleção"
      return
    }

    const window = getMainWindow()
    if (!window || window.isDestroyed()) {
      // Sem janela não há como exibir o seletor. Cancelar é a única saída
      // honesta — esperar seria pendurar a Promise do renderer.
      console.error('[screenshare] Janela principal indisponível para exibir o seletor')
      callback({})
      return
    }

    // A capacidade REAL desta máquina de capturar áudio por processo — é isso
    // que o seletor recebe em `audioAvailable`. Barato de consultar: em
    // não-Windows nem chega a tocar no addon, e a carga do addon é cacheada.
    const audioCapability = isProcessAudioSupported()

    let chosen: PickResult | null
    try {
      chosen = await requestPick(window, sources, audioCapability)
    } catch (err) {
      // `requestPick` foi escrita para nunca rejeitar; este catch existe para
      // que "nunca" continue verdadeiro se alguém a mudar.
      console.error('[screenshare] Falha ao aguardar a escolha da fonte:', err)
      callback({})
      return
    }

    if (!chosen) {
      // Cancelamento, timeout ou id desconhecido. `callback({})` faz o
      // `getDisplayMedia()` do renderer REJEITAR (não pendurar), o que
      // `startScreenShare()` já trata como caminho esperado — e é o que
      // permite a próxima tentativa funcionar (SHARE-07).
      callback({})
      return
    }

    // ------------------------------------------------------------------
    // ESTA CONCESSÃO É SÓ VÍDEO, EM TODOS OS CAMINHOS. NÃO ACRESCENTE `audio`.
    //
    // 1. `audio: 'loopback'` é loopback de DISPOSITIVO: o Windows entrega
    //    tudo que sai pela saída padrão da placa — inclusive a voz dos outros
    //    participantes, que é este mesmo app que está tocando. Quem
    //    compartilhava devolvia todo mundo para a call com atraso. É o
    //    defeito de 2026-08-20, com 4 pessoas numa chamada, e ele vinha da
    //    CONCESSÃO (não do pedido do renderer): era o `callback` daqui que
    //    criava a captura WASAPI. NUNCA CONCEDER, EM NENHUM CAMINHO. O E
    //    lógico com o pedido do renderer, que existiu entre o FIX e esta
    //    fase, também morreu: uma porta que só abre às vezes continua sendo
    //    uma porta.
    //
    // 2. `'loopbackWithMute'` — a outra string que o Electron aceita
    //    (`electron.d.ts:23719-23723`) — NÃO É a saída. Ela silencia a
    //    reprodução local do dispositivo: mata o eco calando quem
    //    compartilha, que passa a não ouvir mais a call em que está. Trocar
    //    "todo mundo se ouvindo" por "o apresentador surdo" não é correção.
    //
    // 3. O áudio agora vem de outro lugar: `src/main/screenshare-audio.ts`,
    //    captura WASAPI POR PROCESSO em modo EXCLUIR (o sistema inteiro menos
    //    a árvore de processos deste app), entregue como PCM ao renderer e
    //    publicada por ele como uma track SEPARADA
    //    (`Track.Source.ScreenShareAudio`). O `getDisplayMedia` desta fase é
    //    só vídeo, e é por isso que ele pode ser incondicional.
    // ------------------------------------------------------------------
    console.log(
      '[screenshare] concedendo captura (só vídeo): fonte=%s audioRequested=%s escolhaDoUsuario=%s audioPorProcessoDisponivel=%s',
      chosen.source.id,
      audioRequested,
      chosen.systemAudio,
      audioCapability.supported
    )
    callback({ video: chosen.source })
  })
}
