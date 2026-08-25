// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@/test/jsdom-setup'

// Caminho RELATIVO de propósito: o alias `@platform` do `vitest.config.ts`
// aponta para o alvo Electron (é a suíte do desktop que roda por padrão), e
// este arquivo existe para provar o alvo WEB. Importar por `@platform/ptt`
// aqui testaria o outro lado da costura sem que nada no arquivo dissesse isso.
import { pushToTalk } from './ptt'

function key(type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent(type, { code, bubbles: true, ...init })
}

function subscribeSpies(): {
  onDown: ReturnType<typeof vi.fn>
  onUp: ReturnType<typeof vi.fn>
  stop: () => void
} {
  const onDown = vi.fn()
  const onUp = vi.fn()
  const stop = pushToTalk.subscribe({ onDown, onUp })
  cleanups.push(stop)
  return { onDown, onUp, stop }
}

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
  document.body.innerHTML = ''
  setHidden(false)
})

// `document.hidden` é somente-leitura no jsdom (vem do `visibilityState`), e
// nenhum dos dois é escrevível. Redefinir a propriedade é a única forma de
// simular a aba indo para o fundo.
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
}

describe('push-to-talk do alvo web', () => {
  it('abre no primeiro keydown de ControlRight, ignora o auto-repeat e fecha no keyup', () => {
    const { onDown, onUp } = subscribeSpies()

    window.dispatchEvent(key('keydown', 'ControlRight'))
    expect(onDown).toHaveBeenCalledTimes(1)

    // O SO repete `keydown` dezenas de vezes por segundo enquanto a tecla fica
    // presa. Sem o filtro, seriam dezenas de `setMicrophoneEnabled(true)`/s.
    window.dispatchEvent(key('keydown', 'ControlRight', { repeat: true }))
    window.dispatchEvent(key('keydown', 'ControlRight', { repeat: true }))
    expect(onDown).toHaveBeenCalledTimes(1)
    expect(onUp).not.toHaveBeenCalled()

    window.dispatchEvent(key('keyup', 'ControlRight'))
    expect(onUp).toHaveBeenCalledTimes(1)
  })

  it('ignora qualquer outra tecla, inclusive o Ctrl da ESQUERDA', () => {
    const { onDown, onUp } = subscribeSpies()

    window.dispatchEvent(key('keydown', 'KeyA'))
    window.dispatchEvent(key('keyup', 'KeyA'))
    // `ControlLeft` é a armadilha: mesmo `event.key` ('Control'), tecla
    // diferente. O filtro é por `code`, e este teste é o que garante isso.
    window.dispatchEvent(key('keydown', 'ControlLeft'))
    window.dispatchEvent(key('keyup', 'ControlLeft'))

    expect(onDown).not.toHaveBeenCalled()
    expect(onUp).not.toHaveBeenCalled()
  })

  it('não aciona quando a tecla é digitada dentro de um campo de texto', () => {
    const { onDown, onUp } = subscribeSpies()

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(key('keydown', 'ControlRight'))
    expect(onDown).not.toHaveBeenCalled()

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.dispatchEvent(key('keydown', 'ControlRight'))
    expect(onDown).not.toHaveBeenCalled()

    const editable = document.createElement('div')
    // `isContentEditable` no jsdom não deriva do atributo; definir direto é o
    // que torna o caso testável.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    document.body.appendChild(editable)
    editable.dispatchEvent(key('keydown', 'ControlRight'))
    expect(onDown).not.toHaveBeenCalled()

    expect(onUp).not.toHaveBeenCalled()
  })

  it('FECHA o microfone ao perder o foco com a tecla ainda pressionada', () => {
    const { onDown, onUp } = subscribeSpies()

    window.dispatchEvent(key('keydown', 'ControlRight'))
    expect(onDown).toHaveBeenCalledTimes(1)

    // Alt+Tab segurando a tecla: o `keyup` vai acontecer na OUTRA janela e
    // nunca chega aqui. Sem esta trava o microfone ficaria aberto para sempre.
    window.dispatchEvent(new Event('blur'))
    expect(onUp).toHaveBeenCalledTimes(1)

    // E o `keyup` que chegar depois (a pessoa voltou e soltou) não pode
    // fechar de novo — `onUp` sem `onDown` antes é o sintoma de estado sujo.
    window.dispatchEvent(key('keyup', 'ControlRight'))
    expect(onUp).toHaveBeenCalledTimes(1)
  })

  it('FECHA o microfone quando a aba vai para o fundo (visibilitychange)', () => {
    const { onDown, onUp } = subscribeSpies()

    window.dispatchEvent(key('keydown', 'ControlRight'))
    setHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onUp).toHaveBeenCalledTimes(1)

    // Voltar a ficar visível não reabre nada: só a tecla abre.
    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onDown).toHaveBeenCalledTimes(1)
    expect(onUp).toHaveBeenCalledTimes(1)
  })

  it('não chama onUp sem um onDown antes', () => {
    const { onUp } = subscribeSpies()

    window.dispatchEvent(key('keyup', 'ControlRight'))
    window.dispatchEvent(new Event('blur'))
    setHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(onUp).not.toHaveBeenCalled()
  })

  it('o cleanup remove os QUATRO listeners', () => {
    const { onDown, onUp, stop } = subscribeSpies()
    stop()

    window.dispatchEvent(key('keydown', 'ControlRight'))
    window.dispatchEvent(key('keyup', 'ControlRight'))
    window.dispatchEvent(new Event('blur'))
    setHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(onDown).not.toHaveBeenCalled()
    expect(onUp).not.toHaveBeenCalled()
  })

  it('setActive é no-op e não lança', () => {
    // Documentado no módulo: na web não existe captura nativa para ligar ou
    // desligar. O teste existe para que "no-op" seja uma decisão verificada, e
    // não algo que alguém apagou sem querer.
    expect(() => pushToTalk.setActive(true)).not.toThrow()
    expect(() => pushToTalk.setActive(false)).not.toThrow()
  })
})
