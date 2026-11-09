// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemberRow } from './MemberList'
import { MemberSectionHeader } from './MemberSectionHeader'
import type { Id } from '../../../../../convex/_generated/dataModel'

// Prova de que a linha da lista de membros é operável por TECLADO — a promessa
// do Plano 08.5-04. Antes dele a linha era um `<div>`: nada de Tab, nada de
// Enter, e o menu só existiria para quem usa mouse.
//
// Por que testar `MemberRow` e não `MemberList`: a lista chama dois `useQuery`
// do Convex e `useVoice()`, então montá-la exigiria `ConvexProvider` +
// `SelectionProvider` + `VoiceProvider` em jsdom. `MemberRow` é exportado
// justamente para poder ser montado sozinho — e é por isso também que a
// mutation entra por prop: `useMutation` joga "Could not find Convex client!"
// fora de um `ConvexProvider`.
//
// Receita do Plano 08.5-02 (não improvisar): docblock de ambiente na 1ª linha,
// `@/test/jsdom-setup` na 2ª, `afterEach(cleanup)` obrigatório (o vitest aqui
// não roda com `globals: true`, então a limpeza automática não se registra e o
// render anterior continua no documento roubando o foco do `user.tab()`).
//
// Asserções em DOM puro: `@testing-library/jest-dom` não está instalado, então
// `toHaveAttribute` NÃO existe e falharia com "Invalid Chai property".
//
// O que este arquivo NÃO prova (jsdom não faz layout nem pintura): que o anel
// de foco é visível e não é cortado pelo `overflow` da `ScrollArea` que envolve
// a lista, e que a ordem de tabulação da janela inteira faz sentido. Isso é do
// checkpoint humano em Windows (Plano 08.5-17).

// `toast()` global do sonner: sem um `<Toaster />` montado ele não quebra, mas
// mockar deixa o teste hermético e permite afirmar a mensagem exata.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))
import { toast } from 'sonner'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const membro = {
  userId: 'user_1' as Id<'users'>,
  username: 'ana',
  tag: '0001',
  displayName: 'Ana',
  avatarUrl: undefined,
  nickname: undefined,
  online: true
}

const semVoz = { speaking: false, muted: false, sharing: false, inVoice: false }

type Overrides = {
  displayName?: string
  online?: boolean
  isOwner?: boolean
  voiceState?: typeof semVoz
  audio?: {
    preference: undefined
    onVolumeChange: (v: number) => void
    onToggleSilenced: () => void
  }
}

function renderRow(
  overrides: Overrides = {},
  sendFriendRequest: (args: { username: string; tag: string }) => Promise<unknown> = () =>
    Promise.resolve(null)
): { linha: HTMLElement; container: HTMLElement } {
  const { container } = render(
    <MemberRow
      member={{
        ...membro,
        displayName: overrides.displayName ?? membro.displayName,
        online: overrides.online ?? true
      }}
      voiceState={overrides.voiceState ?? semVoz}
      isOwner={overrides.isOwner ?? false}
      sendFriendRequest={sendFriendRequest}
      audio={overrides.audio}
    />
  )
  return { linha: screen.getByRole('button', { name: /Ana|Leo|Gordão/ }), container }
}

describe('MemberRow — teclado e menu do membro', () => {
  it('a linha do membro é alcançável por Tab', async () => {
    const user = userEvent.setup()
    const { linha } = renderRow()

    expect(document.activeElement).not.toBe(linha)

    await user.tab()

    expect(document.activeElement).toBe(linha)
    expect(linha.getAttribute('aria-haspopup')).toBe('menu')
    expect(linha.getAttribute('aria-expanded')).toBe('false')
  })

  it('Enter na linha abre o menu do membro', async () => {
    const user = userEvent.setup()
    const { linha } = renderRow()

    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)

    await user.tab()
    await user.keyboard('{Enter}')

    const itens = screen.getAllByRole('menuitem')
    expect(itens.map((item) => item.textContent)).toEqual([
      'Copiar identificador',
      'Adicionar amigo'
    ])
    expect(linha.getAttribute('aria-expanded')).toBe('true')
    // Abrir por teclado tem que levar o foco PARA dentro do menu; se ficasse na
    // linha, a seta seguinte não navegaria nada.
    expect(document.activeElement).toBe(itens[0])
  })

  it('Escape fecha o menu e devolve o foco à linha', async () => {
    const user = userEvent.setup()
    const { linha } = renderRow()

    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)

    await user.keyboard('{Escape}')

    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    expect(linha.getAttribute('aria-expanded')).toBe('false')
    // Fechar sem devolver o foco joga quem usa teclado para o começo do
    // documento — é a parte que mais quebra na prática.
    expect(document.activeElement).toBe(linha)
  })

  it('botão direito na linha abre o MESMO menu', () => {
    const { linha } = renderRow()

    fireEvent.contextMenu(linha)

    const itens = screen.getAllByRole('menuitem')
    expect(itens.map((item) => item.textContent)).toEqual([
      'Copiar identificador',
      'Adicionar amigo'
    ])
    expect(linha.getAttribute('aria-expanded')).toBe('true')
  })

  it('"Adicionar amigo" chama a mutation com username e tag do membro', async () => {
    const user = userEvent.setup()
    const sendFriendRequest = vi.fn(() => Promise.resolve(null))
    renderRow({}, sendFriendRequest)

    await user.tab()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(sendFriendRequest).toHaveBeenCalledWith({ username: 'ana', tag: '0001' })
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    expect(toast.success).toHaveBeenCalledWith('Pedido de amizade enviado')
  })

  it('erro da mutation vira toast com a mensagem legível, sem o embrulho do Convex', async () => {
    const user = userEvent.setup()
    // Formato real do erro que o cliente do Convex entrega ao renderer.
    const erroDoConvex = new Error(
      '[CONVEX M(friends:sendFriendRequest)] [Request ID: abc123] Server Error\n' +
        'Uncaught Error: Você não pode adicionar a si mesmo\n' +
        '    at handler (../convex/friends.ts:63:13)'
    )
    renderRow({}, () => Promise.reject(erroDoConvex))

    await user.tab()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(toast.error).toHaveBeenCalledWith('Você não pode adicionar a si mesmo')
  })

  it('nome sem #tag', () => {
    renderRow({})
    expect(screen.queryByText(/#\d{4}/)).toBeNull()
  })

  it('dono tem coroa', () => {
    renderRow({ isOwner: true })
    expect(screen.getByLabelText('Dono do servidor')).toBeTruthy()
  })

  it('quem está em call mostra Em voz', () => {
    renderRow({ voiceState: { speaking: false, muted: false, sharing: false, inVoice: true } })
    expect(screen.getByText('Em voz')).toBeTruthy()
  })

  it('compartilhando tela tem prioridade', () => {
    renderRow({ voiceState: { speaking: false, muted: false, sharing: true, inVoice: true } })
    expect(screen.getByText('Compartilhando tela')).toBeTruthy()
    expect(screen.queryByText('Em voz')).toBeNull()
  })

  it('offline fica a 30%', () => {
    const { container } = renderRow({ online: false })
    expect(container.firstElementChild!.className).toContain('opacity-30')
  })

  it('clique direito em quem está na sua call mostra volume e silenciar', () => {
    const { linha } = renderRow({
      audio: { preference: undefined, onVolumeChange: vi.fn(), onToggleSilenced: vi.fn() }
    })
    fireEvent.contextMenu(linha)
    expect(screen.getByRole('menuitem', { name: 'Silenciar para mim' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Copiar identificador' })).toBeTruthy()
  })

  it('nome longo corta com reticências e mantém o title', () => {
    renderRow({ displayName: 'Gordão Guerreiro do Norte da Silva' })
    const n = screen.getByText('Gordão Guerreiro do Norte da Silva')
    expect(n.className).toContain('truncate')
    expect(n.getAttribute('title')).toBe('ana#0001')
  })
})

describe('MemberSectionHeader', () => {
  it('cabeçalho de seção sem caixa alta', () => {
    render(<MemberSectionHeader label="Online" count={3} />)
    const h = screen.getByRole('heading', { name: 'Online — 3' })
    expect(h.className).not.toContain('uppercase')
  })
})
