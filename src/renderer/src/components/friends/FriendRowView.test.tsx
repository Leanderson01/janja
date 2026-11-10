// @vitest-environment jsdom
import '@/test/jsdom-setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FriendRowView } from './FriendRowView'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function wrap(node: React.JSX.Element) {
  return render(<TooltipProvider>{node}</TooltipProvider>)
}

describe('FriendRowView', () => {
  it('linha de amigo mostra nome, status e Mensagem', async () => {
    const onMessage = vi.fn()
    wrap(<FriendRowView userId="u1" displayName="VM" username="vm" online onMessage={onMessage} />)
    expect(screen.getByText('VM')).toBeTruthy()
    expect(screen.getByText('Online')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Mensagem' }))
    expect(onMessage).toHaveBeenCalledOnce()
  })
  it('pedido enviado não tem botão de cancelar', () => {
    wrap(
      <FriendRowView userId="u1" displayName="VM" username="vm" online={false} pending="enviado" />
    )
    expect(screen.getByText('Pedido de amizade enviado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Cancelar/ })).toBeNull()
  })
  it('pedido recebido tem aceitar e recusar', () => {
    wrap(
      <FriendRowView
        userId="u1"
        displayName="VM"
        username="vm"
        online={false}
        pending="recebido"
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Aceitar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeTruthy()
  })
})
