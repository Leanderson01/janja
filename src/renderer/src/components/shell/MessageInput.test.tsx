// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, createRef, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { MessageInput, type MessageInputHandle } from '@/components/shell/MessageInput'

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
  vi.clearAllMocks()
})

URL.createObjectURL = vi.fn(() => 'blob:x')
URL.revokeObjectURL = vi.fn()

function renderInput(props: Partial<ComponentProps<typeof MessageInput>> = {}) {
  return render(
    <TooltipProvider>
      <MessageInput placeholder="Conversar em #geral" onSend={vi.fn()} {...props} />
    </TooltipProvider>
  )
}

function campo(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('Conversar em #geral') as HTMLTextAreaElement
}

describe('MessageInput — teclado', () => {
  it('Enter com texto envia uma vez, com o texto aparado, e limpa o campo', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    renderInput({ onSend })

    await user.type(campo(), '  ola mundo  ')
    fireEvent.keyDown(campo(), { key: 'Enter' })

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('ola mundo')
    expect(campo().value).toBe('')
  })

  it('Shift+Enter NAO envia e o texto continua no campo', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    renderInput({ onSend })

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
    renderInput({ onSend })

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
    renderInput({ onSend })

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
    renderInput({ onSend })

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
    renderInput({ onSend })

    fireEvent.keyDown(campo(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()

    await user.type(campo(), '    ')
    fireEvent.keyDown(campo(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('MessageInput — caixa do Discord', () => {
  it('não existe botão Enviar', () => {
    renderInput()
    expect(screen.queryByRole('button', { name: 'Enviar mensagem' })).toBeNull()
  })

  it('o “+” só aparece quando dá para anexar', () => {
    renderInput({ onSendWithAttachments: undefined })
    expect(screen.queryByRole('button', { name: 'Enviar um arquivo' })).toBeNull()
  })

  it('o “+” aparece com anexos habilitados', () => {
    renderInput({ onSendWithAttachments: vi.fn() })
    expect(screen.getByRole('button', { name: 'Enviar um arquivo' })).toBeTruthy()
  })

  it('colar imagem vira miniatura dentro da caixa', () => {
    renderInput({ onSendWithAttachments: vi.fn() })
    const file = new File(['x'], 'image.png', { type: 'image/png' })
    fireEvent.paste(screen.getByPlaceholderText('Conversar em #geral'), {
      clipboardData: { files: [file] }
    })
    expect(screen.getByRole('button', { name: 'Remover image.png' })).toBeTruthy()
  })

  it('addFiles pela ref também adiciona', () => {
    const ref = createRef<MessageInputHandle>()
    renderInput({ onSendWithAttachments: vi.fn(), ref })
    act(() => ref.current!.addFiles([new File(['x'], 'a.txt', { type: 'text/plain' })]))
    expect(screen.getByRole('button', { name: 'Remover a.txt' })).toBeTruthy()
  })

  it('só texto colado não é interceptado', () => {
    renderInput({ onSendWithAttachments: vi.fn() })
    const notCancelled = fireEvent.paste(campo(), { clipboardData: { files: [] } })
    expect(notCancelled).toBe(true)
  })

  it('remover a miniatura revoga a URL', () => {
    renderInput({ onSendWithAttachments: vi.fn() })
    fireEvent.paste(campo(), {
      clipboardData: { files: [new File(['x'], 'image.png', { type: 'image/png' })] }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remover image.png' }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
  })

  it('no StrictMode a miniatura aponta para uma URL não revogada', () => {
    let n = 0
    const revoked = new Set<string>()
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:${++n}`)
    vi.mocked(URL.revokeObjectURL).mockImplementation((u) => void revoked.add(u))
    const ref = createRef<MessageInputHandle>()
    render(
      <StrictMode>
        <TooltipProvider>
          <MessageInput
            placeholder="Conversar em #geral"
            onSend={vi.fn()}
            onSendWithAttachments={vi.fn()}
            ref={ref}
          />
        </TooltipProvider>
      </StrictMode>
    )
    act(() => ref.current!.addFiles([new File(['x'], 'p.png', { type: 'image/png' })]))
    const src = document.querySelector('img')!.getAttribute('src')!
    expect(src).toMatch(/^blob:/)
    expect(revoked.has(src)).toBe(false)
    expect(revoked.size).toBe(n - 1)
  })
})
