// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MessageInput } from '@/components/shell/MessageInput'

// Os quatro caminhos de tecla do UNICO composer do app (canal de servidor e DM
// compartilham este componente), mais a prova de que a guarda de IME nao deixa
// o Enter normal de funcionar.
//
// O teste que justifica o arquivo e o de IME. Quem digita em japones confirma o
// candidato do teclado com Enter — o MESMO Enter que envia a mensagem. Sem a
// guarda, a frase sai pela metade. O sinal `isComposing` do KeyboardEvent e
// observavel em jsdom (medido, nao suposto: `fireEvent` propaga o init dict ate
// `event.nativeEvent`), entao da para provar o comportamento do handler sem IME
// instalado.
//
// O que este arquivo NAO prova: que um teclado japones REAL no Windows emite
// esse evento na hora certa. Isso e do checkpoint humano (Plano 08.5-17).
//
// Asseracoes em DOM puro (`getAttribute`, `.value`): `@testing-library/jest-dom`
// nao esta instalado e `toHaveAttribute` falha com "Invalid Chai property"
// (licao do Plano 08.5-02). E o `afterEach(cleanup)` e obrigatorio: o vitest
// aqui nao roda com `globals: true`, entao a limpeza automatica da
// testing-library nao se registra e o render anterior fica no documento.
afterEach(() => {
  cleanup()
})

function campo(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('Enviar mensagem...') as HTMLTextAreaElement
}

describe('MessageInput — teclado', () => {
  it('Enter com texto envia uma vez, com o texto aparado, e limpa o campo', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<MessageInput onSend={onSend} />)

    await user.type(campo(), '  ola mundo  ')
    fireEvent.keyDown(campo(), { key: 'Enter' })

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('ola mundo')
    expect(campo().value).toBe('')
  })

  it('Shift+Enter NAO envia e o texto continua no campo', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<MessageInput onSend={onSend} />)

    await user.type(campo(), 'primeira linha')
    fireEvent.keyDown(campo(), { key: 'Enter', shiftKey: true })

    expect(onSend).not.toHaveBeenCalled()
    expect(campo().value).toBe('primeira linha')
  })

  // O TESTE DO IME. Enter durante composicao confirma o candidato do teclado;
  // se ele enviasse, a mensagem sairia no meio da palavra.
  it('Enter durante composicao de IME NAO envia e nao perde o texto', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<MessageInput onSend={onSend} />)

    await user.type(campo(), 'nihon')
    fireEvent.keyDown(campo(), { key: 'Enter', isComposing: true })

    expect(onSend).not.toHaveBeenCalled()
    expect(campo().value).toBe('nihon')
  })

  // Segunda metade da guarda: alguns IMEs disparam `compositionend` ANTES do
  // `keydown`, e nesse instante `isComposing` ja voltou a `false`. O keyCode 229
  // ("processando tecla no IME") e o unico sinal que sobra.
  it('Enter com keyCode 229 (compositionend antes do keydown) NAO envia', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<MessageInput onSend={onSend} />)

    await user.type(campo(), 'nihon')
    fireEvent.keyDown(campo(), { key: 'Enter', keyCode: 229 })

    expect(onSend).not.toHaveBeenCalled()
    expect(campo().value).toBe('nihon')
  })

  // A guarda nao pode ser um bloqueio permanente: terminada a composicao, o
  // proximo Enter envia normalmente.
  it('Enter DEPOIS da composicao envia — a guarda nao trava o campo', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<MessageInput onSend={onSend} />)

    await user.type(campo(), 'konnichiwa')
    fireEvent.keyDown(campo(), { key: 'Enter', isComposing: true })
    expect(onSend).not.toHaveBeenCalled()

    fireEvent.keyDown(campo(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('konnichiwa')
  })

  it('Enter com o campo vazio ou so com espacos NAO envia', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<MessageInput onSend={onSend} />)

    fireEvent.keyDown(campo(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()

    await user.type(campo(), '    ')
    fireEvent.keyDown(campo(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('MessageInput — botao de envio', () => {
  it('fica desabilitado com o campo vazio ou so com espacos e habilita com texto', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<MessageInput onSend={onSend} />)

    const botao = screen.getByLabelText('Enviar mensagem') as HTMLButtonElement
    expect(botao.disabled).toBe(true)

    await user.type(campo(), '   ')
    expect(botao.disabled).toBe(true)

    await user.type(campo(), 'oi')
    expect(botao.disabled).toBe(false)

    await user.click(botao)
    expect(onSend).toHaveBeenCalledWith('oi')
    expect(botao.disabled).toBe(true)
  })
})
