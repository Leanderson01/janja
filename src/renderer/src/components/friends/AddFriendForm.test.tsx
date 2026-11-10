// @vitest-environment jsdom
import '@/test/jsdom-setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AddFriendForm } from './AddFriendForm'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function setup(onSend: (u: string, t: string) => Promise<void>): {
  input: HTMLInputElement
  button: HTMLButtonElement
} {
  render(
    <TooltipProvider>
      <AddFriendForm onSend={onSend} myTag="eu#0001" />
    </TooltipProvider>
  )
  return {
    input: screen.getByPlaceholderText('Digite o identificador, ex.: leo#1234') as HTMLInputElement,
    button: screen.getByRole('button', { name: 'Enviar pedido de amizade' }) as HTMLButtonElement
  }
}

describe('AddFriendForm', () => {
  it('botão fica desabilitado com texto inválido e habilita com válido', async () => {
    const { input, button } = setup(vi.fn().mockResolvedValue(undefined))
    expect(button.disabled).toBe(true)
    await userEvent.type(input, 'leo')
    expect(button.disabled).toBe(true)
    await userEvent.type(input, '#1234')
    expect(button.disabled).toBe(false)
  })

  it('Enter com leo#1234 chama onSend', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const { input } = setup(onSend)
    await userEvent.type(input, 'leo#1234{Enter}')
    expect(onSend).toHaveBeenCalledWith('leo', '1234')
  })

  it('sucesso mostra a mensagem e limpa o campo', async () => {
    const { input } = setup(vi.fn().mockResolvedValue(undefined))
    await userEvent.type(input, 'leo#1234{Enter}')
    expect(await screen.findByText('Pedido de amizade enviado para leo#1234.')).toBeTruthy()
    expect(input.value).toBe('')
  })

  it('erro de não encontrado mostra a mensagem amigável', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('Uncaught Error: Usuário não encontrado'))
    const { input } = setup(onSend)
    await userEvent.type(input, 'leo#1234{Enter}')
    expect(
      await screen.findByText(
        'Não encontramos ninguém com esse identificador. Confira as maiúsculas e o número.'
      )
    ).toBeTruthy()
    expect(input.value).toBe('leo#1234')
  })

  it('erro desconhecido mostra a mensagem genérica', async () => {
    const { input } = setup(vi.fn().mockRejectedValue(new Error('rede caiu')))
    await userEvent.type(input, 'leo#1234{Enter}')
    expect(await screen.findByText('Não deu para enviar o pedido. Tente de novo.')).toBeTruthy()
  })

  it('formato inválido mostra aviso sem chamar onSend', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const { input } = setup(onSend)
    await userEvent.type(input, 'leo{Enter}')
    await waitFor(() => expect(screen.getByText('Use o formato usuário#1234.')).toBeTruthy())
    expect(onSend).not.toHaveBeenCalled()
  })

  it('mostra o próprio identificador e o botão Copiar', () => {
    setup(vi.fn())
    expect(screen.getByText('eu#0001')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeTruthy()
  })
})
