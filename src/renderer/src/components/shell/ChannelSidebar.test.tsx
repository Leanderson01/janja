// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServerMenu, TextChannelRow } from './ChannelSidebar'
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

function renderTextRow(
  markAsRead: (args: { channelId: Id<'channels'> }) => Promise<unknown> = () =>
    Promise.resolve(null),
  onClick: () => void = () => {}
): { linha: HTMLElement; gatilhoDoMenu: HTMLElement } {
  render(
    <TextChannelRow
      channel={canalDeTexto}
      isSelected={false}
      unreadCount={0}
      onClick={onClick}
      markAsRead={markAsRead}
    />
  )
  return {
    linha: screen.getByRole('button', { name: 'geral' }),
    gatilhoDoMenu: screen.getByRole('button', { name: 'Opções do canal geral' })
  }
}

describe('TextChannelRow — teclado e menu do canal', () => {
  it('Tab alcança a linha e, num segundo Tab, o gatilho do menu', async () => {
    const user = userEvent.setup()
    const { linha, gatilhoDoMenu } = renderTextRow()

    await user.tab()
    // O clique esquerdo da linha continua sendo a ação primária (selecionar o
    // canal): o menu não roubou a primeira parada de Tab.
    expect(document.activeElement).toBe(linha)

    await user.tab()

    expect(document.activeElement).toBe(gatilhoDoMenu)
    expect(gatilhoDoMenu.getAttribute('aria-haspopup')).toBe('menu')
    expect(gatilhoDoMenu.getAttribute('aria-expanded')).toBe('false')
  })

  it('Enter no gatilho abre o menu do canal de texto', async () => {
    const user = userEvent.setup()
    const { gatilhoDoMenu } = renderTextRow()

    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)

    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')

    const itens = screen.getAllByRole('menuitem')
    expect(itens.map((item) => item.textContent)).toEqual([
      'Marcar como lido',
      'Copiar nome do canal'
    ])
    expect(gatilhoDoMenu.getAttribute('aria-expanded')).toBe('true')
    // Abrir por teclado tem que levar o foco PARA dentro do menu; se ficasse no
    // gatilho, a seta seguinte não navegaria nada.
    expect(document.activeElement).toBe(itens[0])
  })

  it('Escape fecha o menu e devolve o foco ao gatilho', async () => {
    const user = userEvent.setup()
    const { gatilhoDoMenu } = renderTextRow()

    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)

    await user.keyboard('{Escape}')

    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    expect(gatilhoDoMenu.getAttribute('aria-expanded')).toBe('false')
    // Fechar sem devolver o foco joga quem usa teclado para o começo do
    // documento — é a parte que mais quebra na prática.
    expect(document.activeElement).toBe(gatilhoDoMenu)
  })

  it('botão direito em qualquer ponto da linha abre o MESMO menu', () => {
    const { linha, gatilhoDoMenu } = renderTextRow()

    // O `onContextMenu` está no container da linha, não no gatilho: o evento
    // disparado sobre o botão da ação primária tem que borbulhar até ele.
    fireEvent.contextMenu(linha)

    const itens = screen.getAllByRole('menuitem')
    expect(itens.map((item) => item.textContent)).toEqual([
      'Marcar como lido',
      'Copiar nome do canal'
    ])
    expect(gatilhoDoMenu.getAttribute('aria-expanded')).toBe('true')
  })

  it('"Marcar como lido" chama a mutation com o channelId da linha', async () => {
    const user = userEvent.setup()
    const markAsRead = vi.fn(() => Promise.resolve(null))
    renderTextRow(markAsRead)

    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')

    expect(markAsRead).toHaveBeenCalledWith({ channelId: 'channel_1' })
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    expect(toast.success).toHaveBeenCalledWith('Canal marcado como lido')
  })

  it('abrir o menu não dispara a ação primária da linha', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    renderTextRow(() => Promise.resolve(null), onClick)

    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')

    // O gatilho do menu é um botão IRMÃO da linha, não um filho dela: se
    // estivesse aninhado (HTML inválido), abrir o menu selecionaria o canal
    // junto.
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
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
