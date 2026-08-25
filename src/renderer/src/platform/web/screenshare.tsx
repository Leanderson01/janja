/**
 * Compartilhamento de tela do alvo WEB.
 *
 * A diferença entre os dois alvos não é cosmética. No Electron o áudio é um
 * SEGUNDO passo — captura WASAPI por processo no main, ponte de PCM no
 * renderer, ~100 mensagens de IPC por segundo, ~190 linhas (Fase 8.6). Aqui o
 * áudio vem no MESMO `getDisplayMedia`, e o LiveKit publica sozinho: se o
 * stream trouxer faixa de áudio, ele cria um `LocalAudioTrack` com
 * `source = Track.Source.ScreenShareAudio` e publica junto
 * (`livekit-client.esm.mjs:29010-29013`). Nada de ponte, nada de worklet,
 * nada de IPC.
 */
import { Track, type Room } from 'livekit-client'
import { toast } from 'sonner'

import { describeWebScreenShareAudio } from '@/lib/web-screenshare-audio'
import type { PlatformScreenShare } from '@/platform/contract'

/**
 * O que este arquivo lê de volta de `getSettings()` — e por que não é `any`.
 *
 * `displaySurface` existe no `MediaTrackSettings` do TypeScript instalado
 * (5.9.3, `lib.dom.d.ts`). `restrictOwnAudio` NÃO existe: ela shipou no Chrome
 * 141 e ainda não desceu para os tipos do DOM. O objeto devolvido por
 * `getSettings()` é um dicionário comum e traz a chave em runtime; o que falta
 * é só o TypeScript saber o nome dela.
 *
 * Um tipo local nomeado, em vez de `any`, porque `any` apagaria também o erro
 * de digitar `restrictOwnAudi` — e um erro de digitação aqui não quebraria
 * teste nenhum: ele apareceria como `undefined`, ou seja, EXATAMENTE como
 * "este navegador não suporta a flag". O veredito acusaria o Chrome de uma
 * letra faltando.
 */
type ScreenShareTrackSettings = {
  displaySurface?: string
  restrictOwnAudio?: boolean
}

/** Prefixo das linhas que este arquivo imprime fora do veredito. */
const LOG_PREFIX = '[screenshare-web]'

/**
 * `getSettings()` de uma faixa, sem nunca lançar.
 *
 * Falhar em LER não pode encerrar um compartilhamento que já está no ar — e um
 * `{}` silencioso mentiria, porque viraria "o navegador não reporta a flag".
 * Daí o aviso explícito no console quando a leitura em si falha.
 */
function readTrackSettings(
  track: MediaStreamTrack | undefined,
  qualFaixa: string
): ScreenShareTrackSettings {
  try {
    return (track?.getSettings?.() ?? {}) as ScreenShareTrackSettings
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} não foi possível ler getSettings() da faixa de ${qualFaixa} (ignorado; o veredito abaixo sai incompleto)`,
      err
    )
    return {}
  }
}

export const screenShare: PlatformScreenShare = {
  /**
   * As constraints que o Chrome entende — e a única ordem delas que funciona.
   *
   * ------------------------------------------------------------------
   * `restrictOwnAudio` VAI DENTRO DE `audio: { ... }`, NUNCA NO NÍVEL DE CIMA.
   *
   * Verificado no SDK instalado: `screenCaptureToDisplayMediaStreamOptions`
   * (`livekit-client.esm.mjs:13350-13359`) repassa ao `getDisplayMedia`
   * APENAS `{ audio, video, controller, selfBrowserSurface, surfaceSwitching,
   * systemAudio, preferCurrentTab }`. O irmão dela, `suppressLocalAudioPlayback`,
   * existe no tipo do nível de cima e **não é repassado** — quem o escrever
   * ali vai vê-lo sumir sem erro, sem aviso e sem log.
   *
   * Ignorado em silêncio é pior que erro: o build passa, o typecheck passa, o
   * compartilhamento funciona, e a única coisa que não acontece é justamente
   * a que se queria. Esta nota existe para a próxima pessoa não "ligar a
   * opção" no lugar errado e passar uma tarde sem entender por que nada mudou.
   * ------------------------------------------------------------------
   *
   * O que cada campo compra:
   *
   * - `audio: { restrictOwnAudio: true }` — pede ao Chrome que o áudio de
   *   sistema capturado EXCLUA o que este documento está tocando, ou seja: a
   *   voz dos outros participantes. É a resposta da web ao eco de 2026-08-20.
   *   Shipped no Chrome 141 (Windows e Mac). É *best-effort* por
   *   especificação — se a remoção falhar, o agente pode excluir TODO o áudio
   *   originado desta aba, sem avisar. Por isso `startAudio` LÊ DE VOLTA
   *   `getSettings().restrictOwnAudio` logo abaixo: é a única prova de que o
   *   pedido foi atendido, e o veredito que sai dela está em
   *   `@/lib/web-screenshare-audio`.
   * - `systemAudio: 'include'` — faz o Chrome OFERECER a caixinha de "também
   *   compartilhar o áudio" no próprio diálogo. Sem isto ela não aparece e não
   *   há áudio nenhum a discutir.
   * - `selfBrowserSurface: 'exclude'` — tira a própria aba do Hydra da lista
   *   de opções. Compartilhar a si mesmo é o túnel de espelhos infinito, e
   *   ninguém escolhe isso de propósito.
   * - `surfaceSwitching: 'include'` — deixa trocar de aba/janela compartilhada
   *   sem parar e recomeçar a transmissão.
   *
   * O segundo parâmetro do contrato (`wantsAudio`) NÃO é declarado, e a
   * ausência é a documentação: na web quem decide se o áudio vai junto é a
   * PESSOA, dentro do diálogo do Chrome, na caixinha que `systemAudio:
   * 'include'` fez aparecer. Pré-excluir por preferência salva tiraria dela
   * essa escolha no exato momento em que ela está sendo feita — e a
   * preferência de máquina do desktop existe justamente porque lá NÃO há
   * caixinha nenhuma no diálogo.
   */
  captureOptions(contentHint) {
    return {
      audio: { restrictOwnAudio: true },
      video: true,
      contentHint,
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include'
    }
  },

  /**
   * A LEITURA DE VOLTA. Não é "iniciar o áudio" — é PROVAR o que existe.
   *
   * Na web não há áudio a iniciar: ou ele veio junto do `getDisplayMedia` (a
   * pessoa marcou a caixinha) ou não veio, e nos dois casos o LiveKit já
   * resolveu sozinho antes desta função ser chamada — se o stream trouxe faixa
   * de áudio, ele a publicou com `source = Track.Source.ScreenShareAudio`
   * (`livekit-client.esm.mjs:29010-29013`).
   *
   * ------------------------------------------------------------------
   * POR QUE LER DE VOLTA, E POR QUE ISSO NÃO É INSTRUMENTAÇÃO OPCIONAL.
   *
   * `restrictOwnAudio: true` foi PEDIDA em `captureOptions`. Pedir não é obter:
   * a spec permite ao agente ignorar o pedido, ou excluir todo o áudio da aba,
   * sem erro e sem aviso. `getSettings().restrictOwnAudio` é a única resposta
   * possível — e ela é barata.
   *
   * Foi exatamente este passo que faltou no desktop em 2026-08-20:
   * `getSupportedConstraints()` dizia `true`, a constraint era aceita, e o eco
   * acontecia mesmo assim. Dois dias para descobrir que "aceita" e "aplicada"
   * são coisas diferentes. Aqui isso é uma linha de console por
   * compartilhamento.
   * ------------------------------------------------------------------
   *
   * Contrato, igual ao do Electron: NUNCA lança e NUNCA derruba o vídeo. Um
   * `getSettings()` que falhe não pode encerrar uma transmissão que já está no
   * ar — daí o try/catch de fora, que só loga.
   *
   * O que esta função deliberadamente NÃO faz: retry, republicar áudio, mexer
   * nas constraints. Se a faixa de áudio não veio, ela não vem — quem decidiu
   * foi a pessoa, no diálogo do Chrome, e o app não tem como voltar atrás sem
   * parar e recomeçar a transmissão.
   */
  async startAudio(room: Room): Promise<void> {
    try {
      let hasAudioTrack = false
      let videoSettings: ScreenShareTrackSettings = {}
      let audioSettings: ScreenShareTrackSettings = {}

      room.localParticipant.trackPublications.forEach((publication) => {
        if (publication.source === Track.Source.ScreenShare) {
          videoSettings = readTrackSettings(publication.track?.mediaStreamTrack, 'vídeo')
          return
        }
        if (publication.source === Track.Source.ScreenShareAudio) {
          // A EXISTÊNCIA da publicação é o que responde "veio áudio?" — não o
          // resultado de `getSettings()`. Se a leitura falhar, continua sendo
          // verdade que há áudio no ar; o que se perde é só o `restrictOwnAudio`.
          hasAudioTrack = true
          audioSettings = readTrackSettings(publication.track?.mediaStreamTrack, 'áudio')
        }
      })

      const verdict = describeWebScreenShareAudio({
        hasAudioTrack,
        displaySurface: videoSettings.displaySurface,
        restrictOwnAudio: audioSettings.restrictOwnAudio
      })

      // SEMPRE, inclusive quando deu tudo certo: é esta linha que o experimento
      // do eco (Plano 10-09) vai pedir para colar. Procure por `VEREDITO`.
      console.info(verdict.log)

      // E só nos dois casos em que a pessoa precisa AGIR (transmissão muda por
      // ser janela; som indo sem o filtro de eco). Quando o filtro foi
      // aplicado, `message` é `null` e ninguém é interrompido por uma boa
      // notícia.
      if (verdict.message !== null) toast.warning(verdict.message)
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} falha ao ler de volta o que o navegador concedeu no compartilhamento (ignorado — a transmissão continua no ar)`,
        err
      )
    }
  },

  /**
   * NO-OP DOCUMENTADO.
   *
   * Não há captura nativa própria para encerrar. A faixa de áudio nasceu com
   * `source = Track.Source.ScreenShareAudio` dentro do SDK, e é isso que faz
   * `setScreenShareEnabled(false)` despublicar as duas juntas
   * (`livekit-client.esm.mjs:29010-29013`) — exatamente a mesma propriedade
   * que o Electron compra à mão passando `source` no `publishTrack`.
   */
  async stopAudio() {
    // Vazio de propósito — ver o bloco acima.
  },

  /**
   * Quem desenha o seletor é o Chrome. Não montar nada.
   *
   * Os 23 testes de `platform/electron/ScreenSharePicker.test.tsx` continuam
   * válidos e continuam rodando — eles testam o alvo ELECTRON, que é onde o
   * seletor próprio existe (o Electron não tem picker nativo no Windows,
   * 08-RESEARCH.md §2). Aqui ele não é "desligado": ele simplesmente nunca
   * entra no grafo de módulos, porque o alias `@platform` resolve para esta
   * pasta e nada nesta pasta o importa.
   */
  Extras: () => null
}
