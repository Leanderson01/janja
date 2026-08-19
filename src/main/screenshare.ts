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
  type ScreenShareSource
} from './screenshare-types'

// SHARE-01/03/04 (Planos 08-02 e 08-04): captura de tela + áudio de sistema,
// com seletor próprio.
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
type PendingPick = {
  resolve: (source: DesktopCapturerSource | null) => void
  sources: DesktopCapturerSource[]
  timeout: ReturnType<typeof setTimeout>
}
let pending: PendingPick | null = null

/**
 * Encerra a escolha pendente, se houver, com a fonte de `sourceId` (ou `null`
 * para cancelar). Idempotente de propósito: limpa `pending` ANTES de resolver,
 * então uma segunda chamada — cancelar depois de escolher, dois cliques, um
 * timeout que corre contra o clique — não faz nada.
 */
function settlePending(sourceId: string | null): void {
  const current = pending
  if (!current) return
  pending = null
  clearTimeout(current.timeout)

  // Id desconhecido (renderer fora de sincronia, lista velha) cai no mesmo
  // caminho do cancelamento: `null`. Nunca deixa a espera pendurada.
  const source =
    sourceId === null ? null : (current.sources.find((item) => item.id === sourceId) ?? null)
  if (sourceId !== null && source === null) {
    console.warn('[screenshare] fonte escolhida não existe mais na lista:', sourceId)
  }
  current.resolve(source)
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
  sources: DesktopCapturerSource[]
): Promise<DesktopCapturerSource | null> {
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

  return new Promise<DesktopCapturerSource | null>((resolve) => {
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
        sources: sources.map(toSerializableSource)
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
  ipcMain.on(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, (_event, sourceId: unknown) => {
    if (typeof sourceId !== 'string') {
      console.warn('[screenshare] choose-source com id inválido — tratando como cancelamento')
      settlePending(null)
      return
    }
    settlePending(sourceId)
  })

  ipcMain.on(SCREENSHARE_CHANNELS.CANCEL_PICKER, () => {
    settlePending(null)
  })

  // `session.defaultSession` só existe depois de `app.whenReady()` — quem
  // chama é responsável por isso (ver src/main/index.ts).
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
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

    let chosen: DesktopCapturerSource | null
    try {
      chosen = await requestPick(window, sources)
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

    // `audio: 'loopback'` é o áudio de SISTEMA do Windows (WASAPI loopback),
    // não o microfone. O filtro do próprio áudio da call (`restrictOwnAudio`,
    // Pitfall 1) não mora aqui: ele é uma constraint de captura, passada do
    // renderer em `voice-context.tsx` — este handler só concede a fonte.
    callback({ video: chosen, audio: 'loopback' })
  })
}
