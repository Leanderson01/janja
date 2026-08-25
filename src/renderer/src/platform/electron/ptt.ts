/**
 * Push-to-talk do alvo DESKTOP — o mesmo caminho do Plano 07-06, agora atrás
 * do contrato.
 *
 * Este arquivo não implementa nada: ele só empacota o que já existe
 * (`window.voice`, servido pelo preload a partir do hook global de teclado em
 * `src/main/voice/ptt.ts`). Nenhuma linha de comportamento mudou ao sair de
 * `state/voice-context.tsx` — a tecla continua sendo `CtrlRight` decidida no
 * main, o anti-repeat continua sendo `isKeyCurrentlyDown` no main, e os
 * handlers continuam sendo os mesmos de antes.
 */
import type { PlatformPushToTalk } from '@/platform/contract'

export const pushToTalk: PlatformPushToTalk = {
  subscribe(h) {
    const offDown = window.voice.onPttKeyDown(h.onDown)
    const offUp = window.voice.onPttKeyUp(h.onUp)
    // Um único cleanup para os dois: quem assina não precisa saber que por
    // baixo são dois canais de IPC distintos.
    return () => {
      offDown()
      offUp()
    }
  },

  /**
   * O QUE ESTA CHAMADA SUSTENTA (Plano 07-06, `src/main/voice/ptt.ts:25-32`):
   * o hook nativo de teclado é REGISTRADO uma vez no `app.whenReady()`, mas a
   * captura de fato (`uIOhook.start()`) só liga quando o renderer avisa que o
   * modo de voz salvo é 'ptt'. Em modo 'vad' — que é o PADRÃO — nenhuma
   * captura de teclado do sistema chega a existir.
   *
   * Perder esta chamada não quebraria teste nenhum e não apareceria na tela:
   * o app simplesmente passaria a ler o teclado do sistema inteiro à toa,
   * para sempre, para quem nem usa push-to-talk. É o tipo de regressão que só
   * um comentário evita.
   */
  setActive(active) {
    window.voice.setPttModeActive(active)
  }
}
