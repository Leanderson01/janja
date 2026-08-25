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
import type { PlatformScreenShare } from '@/platform/contract'

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
   *   originado desta aba, sem avisar. Por isso `startAudio` tem que ler de
   *   volta `getSettings().restrictOwnAudio` (Plano 10-06): é a única prova de
   *   que o pedido foi atendido.
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
   * STUB HONESTO — e ele é honesto porque diz o que não faz.
   *
   * Na web não existe "iniciar o áudio": ou ele veio junto do
   * `getDisplayMedia` (a pessoa marcou a caixinha) ou não veio, e nos dois
   * casos o LiveKit já resolveu sozinho antes desta função ser chamada.
   *
   * O que FALTA aqui é o Plano 10-06, dono deste arquivo depois: ler de volta
   * `track.getSettings().restrictOwnAudio` da faixa publicada, transformar
   * isso num veredito e dizer à pessoa o que aconteceu ("vai com som e sem
   * eco", "vai com som mas pode ter eco", "veio sem som"). Enquanto esse
   * plano não chega, um `console.info` é mais honesto do que um corpo vazio:
   * corpo vazio parece decisão tomada, e isto é uma pendência com dono.
   */
  async startAudio() {
    console.info(
      '[screenshare] alvo web: o áudio (se houver) veio junto do getDisplayMedia e o LiveKit já o publicou como ScreenShareAudio. Leitura de volta de restrictOwnAudio: Plano 10-06.'
    )
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
