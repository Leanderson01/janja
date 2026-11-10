// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { ChannelSection, ServerMenu, TextChannelRow, VoiceParticipantRow } from './ChannelSidebar'
import type { Doc, Id } from '../../../../../convex/_generated/dataModel'

// Prova de que os menus da sidebar (Plano 08.5-12) são operáveis por TECLADO.
//
// Este é o ponto inteiro de não instalar o `ContextMenu` do Radix: um menu que
// só abre com o botão direito não existe para quem usa teclado. A promessa só
// vale se Tab CHEGA no gatilho, Enter ABRE, Escape FECHA e DEVOLVE o foco — e é
// isso que este arquivo executa, em vez de afirmar.
//
// Por que `TextChannelRow` e `ServerMenu`, e não a `ChannelSidebar`: a sidebar
// inteira chama três `useQuery` do Convex, `useSelection()` e `useVoice()`,
// então montá-la exigiria `ConvexProvider` + dois providers em jsdom. Os dois
// componentes daqui são exportados justamente para poderem ser montados
// sozinhos — e é pelo mesmo motivo que a mutation `openChannel` entra na linha
// por prop: `useMutation` joga "Could not find Convex client!" fora de um
// `ConvexProvider` (defeito já pago no Plano 08.5-04).
//
// `VoiceChannelRow` NÃO é testada aqui: ela chama `useQuery` e `useVoice()`
// internamente e não tem como ser montada isolada sem inventar providers. O
// menu dela é o MESMO `ChannelRowMenu` que a linha de texto usa — o que muda
// são os itens.
//
// Receita do Plano 08.5-02 (não improvisar): docblock de ambiente na 1ª linha,
// `@/test/jsdom-setup` na 2ª, `afterEach(cleanup)` obrigatório (o vitest aqui
// não roda com `globals: true`, então a limpeza automática não se registra e o
// render anterior continua no documento roubando o foco do `user.tab()`).
// Asserções em DOM puro: `@testing-library/jest-dom` não está instalado, então
// `toHaveAttribute` NÃO existe e falharia com "Invalid Chai property".
//
// O que este arquivo NÃO prova (jsdom não faz layout, nem pintura, nem CSS):
// que o botão "..." aparece no hover e permanece visível no foco (é
// `group-hover`/`focus-visible`), que o anel de foco não é cortado pela
// `ScrollArea`, e que o menu não escapa da janela quando o canal está no fim da
// lista. Isso é do checkpoint humano em Windows (Plano 08.5-17).

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))
import { toast } from 'sonner'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const canalDeTexto: Doc<'channels'> = {
  _id: 'channel_1' as Id<'channels'>,
  _creationTime: 0,
  serverId: 'server_1' as Id<'servers'>,
  name: 'geral',
  type: 'text',
  position: 0
}

function renderRow(
  props: {
    isSelected?: boolean
    unreadCount?: number
    onInvite?: () => void
    markAsRead?: (args: { channelId: Id<'channels'> }) => Promise<unknown>
  } = {}
): void {
  render(
    <TooltipProvider>
      <TextChannelRow
        channel={canalDeTexto}
        isSelected={props.isSelected ?? false}
        unreadCount={props.unreadCount ?? 0}
        onClick={() => {}}
        markAsRead={props.markAsRead ?? (() => Promise.resolve(null))}
        onInvite={props.onInvite ?? (() => {})}
      />
    </TooltipProvider>
  )
}

function renderVoiceRow(
  overrides: Partial<{
    displayName: string
    muted: boolean
    deafened: boolean
    sharing: boolean
  }> = {},
  speaking = false,
  handlers: { onWatchStream?: (userId: string) => void; onRowClick?: () => void } = {}
): void {
  // O `div` com `onClick` faz o papel da linha/canal em volta: o clique no AO
  // VIVO não pode chegar nele.
  render(
    <TooltipProvider>
      <div onClick={handlers.onRowClick}>
        <VoiceParticipantRow
          participant={{
            userId: 'user_1',
            displayName: 'Ana',
            username: 'ana',
            avatarUrl: null,
            muted: false,
            deafened: false,
            sharing: false,
            ...overrides
          }}
          speaking={speaking}
          onWatchStream={handlers.onWatchStream ?? (() => {})}
        />
      </div>
    </TooltipProvider>
  )
}

function renderSection(opts: { open: boolean; pinnedName: string; hiddenName: string }): void {
  render(
    <ChannelSection
      label="Canais de texto"
      open={opts.open}
      onOpenChange={() => {}}
      pinned={<div>{opts.pinnedName}</div>}
    >
      <div>{opts.hiddenName}</div>
    </ChannelSection>
  )
}

describe('TextChannelRow', () => {
  it('canal não lido fica branco com a pílula e sem número', () => {
    renderRow({ unreadCount: 3 })
    const row = screen.getByRole('button', { name: /geral/ })
    expect(row.getAttribute('data-unread')).toBe('true')
    expect(row.textContent).not.toContain('3')
  })

  it('canal lido não tem data-unread', () => {
    renderRow({})
    expect(screen.getByRole('button', { name: /geral/ }).getAttribute('data-unread')).toBeNull()
  })

  it('clique direito abre Marcar como lido e Copiar nome', () => {
    renderRow({})
    fireEvent.contextMenu(screen.getByRole('button', { name: /geral/ }))
    expect(screen.getByRole('menuitem', { name: 'Marcar como lido' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Copiar nome' })).toBeTruthy()
  })

  it('Marcar como lido chama a mutation com o channelId da linha', async () => {
    const markAsRead = vi.fn(() => Promise.resolve(null))
    renderRow({ markAsRead })
    fireEvent.contextMenu(screen.getByRole('button', { name: /geral/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Marcar como lido' }))
    expect(markAsRead).toHaveBeenCalledWith({ channelId: 'channel_1' })
    expect(toast.success).toHaveBeenCalledWith('Canal marcado como lido')
  })

  it('canal aberto mostra o botão de criar convite', () => {
    renderRow({ isSelected: true })
    expect(screen.getByRole('button', { name: 'Criar convite' })).toBeTruthy()
  })

  it('o botão de convite chama onInvite sem selecionar o canal', async () => {
    const onInvite = vi.fn()
    renderRow({ isSelected: true, onInvite })
    await userEvent.click(screen.getByRole('button', { name: 'Criar convite' }))
    expect(onInvite).toHaveBeenCalledTimes(1)
  })

  it('não existe mais o botão de opções', () => {
    renderRow({})
    expect(screen.queryByRole('button', { name: /Opções do canal/ })).toBeNull()
  })

  it('nome longo de canal corta com reticências e mantém o nome inteiro no title', () => {
    render(
      <TooltipProvider>
        <TextChannelRow
          channel={{ ...canalDeTexto, name: 'canal-com-um-nome-muito-comprido-mesmo' }}
          isSelected={false}
          unreadCount={0}
          onClick={() => {}}
          markAsRead={() => Promise.resolve(null)}
          onInvite={() => {}}
        />
      </TooltipProvider>
    )
    const name = screen.getByText('canal-com-um-nome-muito-comprido-mesmo')
    expect(name.className).toContain('truncate')
    expect(name.getAttribute('title')).toBe('canal-com-um-nome-muito-comprido-mesmo')
  })
})

describe('VoiceParticipantRow', () => {
  it('ensurdecido mostra o fone cortado e AO VIVO aparece para quem transmite', () => {
    renderVoiceRow({ deafened: true, muted: true, sharing: true })
    expect(screen.getByLabelText('Ensurdecido')).toBeTruthy()
    expect(screen.queryByLabelText('Mutado')).toBeNull()
    expect(screen.getByText('AO VIVO')).toBeTruthy()
  })

  it('mutado sem ensurdecer mostra só o microfone cortado', () => {
    renderVoiceRow({ muted: true })
    expect(screen.getByLabelText('Mutado')).toBeTruthy()
    expect(screen.queryByLabelText('Ensurdecido')).toBeNull()
    expect(screen.queryByText('AO VIVO')).toBeNull()
  })

  it('nome longo corta com reticências e mantém o nome inteiro no title', () => {
    renderVoiceRow({ displayName: 'Gordão Guerreiro do Norte da Silva' })
    const name = screen.getByText('Gordão Guerreiro do Norte da Silva')
    expect(name.className).toContain('truncate')
    expect(name.getAttribute('title')).toBe('Gordão Guerreiro do Norte da Silva')
  })

  it('falando acende o anel verde no avatar', () => {
    renderVoiceRow({}, true)
    expect(document.querySelector('.ring-success')).not.toBeNull()
  })

  // Follow-up 1: o AO VIVO leva para a transmissão.
  it('AO VIVO é um botão "Assistir transmissão de {nome}" que chama o handler com o userId', () => {
    const onWatchStream = vi.fn()
    renderVoiceRow({ sharing: true }, false, { onWatchStream })
    const button = screen.getByRole('button', { name: 'Assistir transmissão de Ana' })
    expect(button.textContent).toBe('AO VIVO')
    fireEvent.click(button)
    expect(onWatchStream).toHaveBeenCalledTimes(1)
    expect(onWatchStream).toHaveBeenCalledWith('user_1')
  })

  it('clicar no AO VIVO não chama o clique da linha', () => {
    const onWatchStream = vi.fn()
    const onRowClick = vi.fn()
    renderVoiceRow({ sharing: true }, false, { onWatchStream, onRowClick })
    fireEvent.click(screen.getByRole('button', { name: 'Assistir transmissão de Ana' }))
    expect(onWatchStream).toHaveBeenCalledTimes(1)
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('o rótulo usa o nome de exibição (cai no usuário sem apelido)', () => {
    renderVoiceRow({ sharing: true, displayName: '' })
    expect(screen.getByRole('button', { name: 'Assistir transmissão de ana' })).toBeTruthy()
  })

  it('sem transmissão não há botão de assistir', () => {
    renderVoiceRow({ sharing: false })
    expect(screen.queryByRole('button', { name: /Assistir transmissão/ })).toBeNull()
  })
})

describe('ChannelSection', () => {
  it('seção recolhida continua mostrando o canal aberto', () => {
    renderSection({ open: false, pinnedName: 'geral', hiddenName: 'memes' })
    expect(screen.getByText('geral')).toBeTruthy()
    expect(screen.queryByText('memes')).toBeNull()
  })

  it('seção aberta mostra tudo', () => {
    renderSection({ open: true, pinnedName: 'geral', hiddenName: 'memes' })
    expect(screen.getByText('memes')).toBeTruthy()
  })
})

describe('ServerMenu — teclado e menu do servidor', () => {
  function renderServerMenu(
    onInvite: () => void = () => {},
    onCreateChannel: () => void = () => {}
  ): HTMLElement {
    render(<ServerMenu serverName="Janja" onInvite={onInvite} onCreateChannel={onCreateChannel} />)
    return screen.getByRole('button', { name: 'Menu do servidor Janja' })
  }

  it('o nome do servidor é o gatilho e é alcançável por Tab', async () => {
    const user = userEvent.setup()
    const gatilho = renderServerMenu()

    expect(gatilho.textContent).toBe('Janja')

    await user.tab()

    expect(document.activeElement).toBe(gatilho)
    expect(gatilho.getAttribute('aria-haspopup')).toBe('menu')
    expect(gatilho.getAttribute('aria-expanded')).toBe('false')
  })

  it('Enter no nome do servidor abre o menu com as ações do cabeçalho', async () => {
    const user = userEvent.setup()
    const gatilho = renderServerMenu()

    await user.tab()
    await user.keyboard('{Enter}')

    const itens = screen.getAllByRole('menuitem')
    expect(itens.map((item) => item.textContent)).toEqual([
      'Convidar pessoas',
      'Criar canal',
      'Copiar nome do servidor'
    ])
    expect(gatilho.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(itens[0])
  })

  it('"Convidar pessoas" abre o diálogo de convite que já existia', async () => {
    const user = userEvent.setup()
    const onInvite = vi.fn()
    renderServerMenu(onInvite)

    await user.tab()
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')

    expect(onInvite).toHaveBeenCalledTimes(1)
  })

  it('"Criar canal" abre o diálogo de criar canal que já existia', async () => {
    const user = userEvent.setup()
    const onCreateChannel = vi.fn()
    renderServerMenu(() => {}, onCreateChannel)

    await user.tab()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onCreateChannel).toHaveBeenCalledTimes(1)
  })

  it('botão direito no nome do servidor abre o MESMO menu, e Escape devolve o foco', async () => {
    const user = userEvent.setup()
    const gatilho = renderServerMenu()

    fireEvent.contextMenu(gatilho)

    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    expect(gatilho.getAttribute('aria-expanded')).toBe('true')

    await user.keyboard('{Escape}')

    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    expect(document.activeElement).toBe(gatilho)
  })
})
