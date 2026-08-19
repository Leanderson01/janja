import { desktopCapturer, session, type DesktopCapturerSource } from 'electron'

// SHARE-01/03/04 (Plano 08-02): captura de tela + áudio de sistema.
//
// O renderer nunca chama `desktopCapturer` — ele chama `getDisplayMedia()`
// (por baixo de `setScreenShareEnabled` do livekit-client), e o Chromium
// entrega essa requisição a ESTE handler no processo main. Quem escolhe a
// fonte é o app, não o Electron: não existe picker nativo no Windows
// (08-RESEARCH.md §2 — a doc oficial confirma que a UI de escolha é
// responsabilidade do app).
//
// Versão mínima deliberada: `types: ['screen']` e sempre a PRIMEIRA tela,
// sem UI de seleção e sem suporte a janela. O seletor de verdade (com
// thumbnails e janelas) é o Plano 08-04, que estende este mesmo arquivo. A
// ordem é intencional: só faz sentido investir no seletor depois que o
// Plano 08-03 provar, em Windows nativo, que o áudio de sistema não ecoa.
//
// NÃO passar `{ useSystemPicker: true }` como segundo argumento: é
// experimental e só existe no macOS 15+ (08-RESEARCH.md §1); aqui o app roda
// só em Windows, onde o handler é sempre chamado.

// Registrar `setDisplayMediaRequestHandler` duas vezes SUBSTITUI o handler
// anterior silenciosamente — não empilha. Esta guarda existe para que um
// segundo call-site adicionado por engano (hot-reload do main, um plano
// futuro chamando de novo) apareça como aviso no console em vez de virar um
// handler fantasma que ninguém sabe qual é.
let registered = false

export function registerScreenShareHandler(): void {
  if (registered) {
    console.warn(
      '[screenshare] registerScreenShareHandler() chamada mais de uma vez — ignorando a segunda'
    )
    return
  }
  registered = true

  // `session.defaultSession` só existe depois de `app.whenReady()` — quem
  // chama é responsável por isso (ver src/main/index.ts).
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    // Pitfall 2 (PITFALLS.md): se o handler terminar sem chamar `callback`,
    // a Promise de `getDisplayMedia()` no renderer nunca resolve NEM
    // rejeita — a UI fica carregando para sempre e toda tentativa seguinte
    // de compartilhar na mesma sessão do app trava junto. Por isso os três
    // caminhos abaixo (falha ao enumerar, nenhuma tela, sucesso) terminam
    // cada um em exatamente uma chamada a `callback`, e o `try` envolve só
    // o `await` que pode lançar — nunca a chamada de `callback` em si, que
    // dentro de um `try/catch` compartilhado poderia ser chamada duas vezes
    // se ela própria lançasse.
    let sources: DesktopCapturerSource[]
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen'],
        // Sem thumbnail: nada é exibido nesta versão (a escolha é sempre a
        // primeira tela). Gerar bitmap de cada tela a cada requisição é
        // trabalho jogado fora. O Plano 08-04 volta a pedir thumbnails
        // quando existir seletor para exibi-las.
        thumbnailSize: { width: 0, height: 0 }
      })
    } catch (err) {
      console.error('[screenshare] Falha ao enumerar fontes de tela:', err)
      callback({}) // cancelamento explícito — nunca `callback({ video: undefined })`
      return
    }

    if (sources.length === 0) {
      console.error('[screenshare] Nenhuma tela disponível para captura')
      callback({}) // idem: objeto vazio é a forma documentada de "sem seleção"
      return
    }

    // `audio: 'loopback'` é o áudio de SISTEMA do Windows (WASAPI loopback),
    // não o microfone. O filtro do próprio áudio da call (`restrictOwnAudio`,
    // Pitfall 1) não mora aqui: ele é uma constraint de captura, passada do
    // renderer em `voice-context.tsx` — este handler só concede a fonte.
    callback({ video: sources[0], audio: 'loopback' })
  })
}
