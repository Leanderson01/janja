/**
 * Push-to-talk do alvo WEB — a versão que degrada DIZENDO.
 *
 * O desktop escuta o teclado do sistema inteiro (`uiohook-napi`, no processo
 * main) e por isso funciona com o app minimizado. Nenhuma API de navegador faz
 * isso, nem vai fazer: capturar tecla fora de foco é keylogger. Então aqui o
 * push-to-talk é `keydown`/`keyup` na `window`, e **só funciona com a janela
 * em foco** — degradação declarada em `capabilities.globalPushToTalk = false`,
 * que é a fonte única do texto que a UI mostra.
 *
 * A MESMA TECLA do desktop, de propósito: `src/main/voice/ptt.ts:38` fixa
 * `UiohookKey.CtrlRight`, e aqui é `event.code === 'ControlRight'`. A web não
 * inventa uma tecla diferente — quem usa os dois alvos usa o mesmo dedo.
 */
import type { PlatformPushToTalk } from '@/platform/contract'

const PTT_CODE = 'ControlRight'

/**
 * Digitar não pode abrir microfone.
 *
 * `CtrlRight` fica ao lado da barra de espaço em teclado ABNT2 — escrever no
 * chat com a mão nessa região acionaria push-to-talk no meio de uma frase, e a
 * pessoa nem saberia que foi ao ar. O `contenteditable` está aqui porque o
 * composer de mensagem pode virar um (é `<textarea>` hoje, mas a checagem por
 * tag sozinha é frágil demais para uma consequência dessas).
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA'
}

export const pushToTalk: PlatformPushToTalk = {
  subscribe(h) {
    // Estado explícito de "a tecla está presa AGORA", no closure.
    //
    // Ele faz duas coisas e as duas são obrigatórias:
    //  1. filtra o auto-repeat do `keydown` (o mesmo papel de
    //     `isKeyCurrentlyDown` em `src/main/voice/ptt.ts`);
    //  2. garante que `onUp` NUNCA é chamado sem um `onDown` antes. Chamar
    //     `setMicrophoneEnabled(false)` a mais é inofensivo em produção, mas
    //     sem este estado o teste não consegue afirmar "não houve chamada" —
    //     e é justamente essa afirmação que prova a trava de `blur` abaixo.
    let isDown = false

    function press(event: KeyboardEvent): void {
      if (event.code !== PTT_CODE) return
      // `keydown` dispara repetidamente enquanto a tecla continua pressionada.
      if (event.repeat) return
      if (isTypingTarget(event.target)) return
      if (isDown) return
      isDown = true
      h.onDown()
    }

    function release(event: KeyboardEvent): void {
      if (event.code !== PTT_CODE) return
      // Sem checar `isTypingTarget` aqui de propósito: se a pessoa apertou
      // fora de um campo e clicou dentro de um antes de soltar, o `keyup`
      // ainda precisa FECHAR o microfone. Fechar é sempre permitido; só abrir
      // é que tem guarda.
      forceUp()
    }

    /**
     * ------------------------------------------------------------------
     * A TRAVA QUE NÃO PODE FALTAR — perder o foco conta como "soltou".
     *
     * Este é o modo de falha mais caro desta costura, e ele só existe na web:
     *
     *   a pessoa segura CtrlRight para falar, e faz Alt+Tab AINDA SEGURANDO.
     *   O `keyup` acontece numa janela que não é a nossa. O evento NUNCA
     *   chega aqui. `isDown` continua `true`, o microfone continua ABERTO —
     *   e continua aberto para sempre, porque não existe nenhum outro evento
     *   que vá fechá-lo.
     *
     * O resultado é uma pessoa transmitindo o quarto dela para dez pessoas
     * sem saber, achando que "fechou". É a mesma família do vazamento de
     * microfone que a quick task 001 deste projeto corrigiu, e é pior: lá o
     * microfone ficava aberto depois de sair do canal, aqui ele fica aberto
     * DENTRO do canal, com todo mundo ouvindo.
     *
     * Por isso `blur` (perdeu o foco) e `visibilitychange` com
     * `document.hidden` (a aba foi para o fundo, minimizou, o SO trocou de
     * espaço de trabalho) forçam `onUp` e zeram `isDown`. Fechar cedo demais
     * é um inconveniente — a pessoa aperta de novo. Não fechar não tem
     * conserto do lado de quem está falando.
     *
     * `visibilitychange` NÃO é redundante com `blur`: há navegador/SO em que
     * a aba fica oculta sem que a janela perca foco (troca de aba dentro da
     * mesma janela dispara `visibilitychange`, não necessariamente `blur` na
     * `window`). Os dois juntos custam duas linhas.
     * ------------------------------------------------------------------
     */
    function forceUp(): void {
      if (!isDown) return
      isDown = false
      h.onUp()
    }

    function onVisibilityChange(): void {
      if (document.hidden) forceUp()
    }

    window.addEventListener('keydown', press)
    window.addEventListener('keyup', release)
    window.addEventListener('blur', forceUp)
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Os QUATRO listeners saem juntos. Um `subscribe` que devolvesse cleanup
    // parcial deixaria a trava de blur pendurada num handler de um provider
    // já desmontado — que é como remontagem por hot-reload vira microfone
    // fantasma.
    return () => {
      window.removeEventListener('keydown', press)
      window.removeEventListener('keyup', release)
      window.removeEventListener('blur', forceUp)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  },

  /**
   * NO-OP DE PROPÓSITO, não esquecimento.
   *
   * No Electron esta chamada liga e desliga a captura NATIVA do teclado do
   * sistema — coisa que custa caro deixar ligada à toa. Aqui não existe
   * captura nativa nenhuma: são dois `addEventListener` na própria janela,
   * que só recebem eventos que o navegador já ia entregar de qualquer jeito.
   * Ligar e desligar isso conforme o modo salvo não economizaria nada e
   * criaria um segundo estado para manter em sincronia.
   *
   * Quem decide se a tecla faz algo é o handler no `voice-context`, que já
   * relê `loadVoicePreferences().mode` a cada evento — o mesmo early-return
   * dos dois alvos.
   */
  setActive() {
    // Vazio de propósito — ver o bloco acima.
  }
}
