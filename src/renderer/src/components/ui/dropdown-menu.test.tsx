// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

// Primeiro teste de componente React do projeto. Ele existe por dois motivos,
// e o segundo é o que importa mais:
//
// 1. Provar que o par jsdom + testing-library funciona AQUI — ambiente por
//    arquivo (docblock acima), sem mexer no `environment: 'edge-runtime'`
//    global que os testes de `convex/` exigem.
// 2. Provar que o comportamento de TECLADO do Radix é observável neste
//    ambiente. Os planos 05, 06, 07 e 09 desta fase prometem menus navegáveis
//    por teclado; sem isto, "navegável por teclado" seria afirmação por leitura
//    de código — que é exatamente o Pitfall 4 do `08.5-RESEARCH.md`.
//
// Só teclado, nunca clique de mouse: o mouse é o caminho que funciona sozinho.
//
// O que este teste NÃO prova (jsdom não pinta e não faz layout): que o anel de
// foco é visível, que o menu não é cortado por `overflow:hidden` de um pai, e
// que um leitor de tela real anuncia alguma coisa. Isso é do checkpoint humano
// em Windows (Plano 08.5-17).

// Asserções em DOM puro (`getAttribute`, `document.activeElement`), sem
// `@testing-library/jest-dom`: `toHaveAttribute` NÃO existe aqui e falha com
// "Invalid Chai property". Foi decisão do plano não instalar um quinto pacote
// só para açucarar asserção.
//
// `@testing-library/react` só registra limpeza automática quando o vitest roda
// com `globals: true`, que não é o caso aqui. Sem este afterEach, o segundo
// render acha DOIS gatilhos "Abrir" no documento e o teste quebra por um motivo
// que não tem nada a ver com o que ele mede.
afterEach(() => {
  cleanup()
})

function MenuDeTeste(): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button>Abrir</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Primeiro</DropdownMenuItem>
        <DropdownMenuItem>Segundo</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('DropdownMenu — navegação por teclado', () => {
  it('Tab leva o foco ao gatilho, que anuncia menu fechado', async () => {
    const user = userEvent.setup()
    render(<MenuDeTeste />)

    const gatilho = screen.getByRole('button', { name: 'Abrir' })
    expect(document.activeElement).not.toBe(gatilho)

    await user.tab()

    expect(document.activeElement).toBe(gatilho)
    expect(gatilho.getAttribute('aria-haspopup')).toBe('menu')
    expect(gatilho.getAttribute('aria-expanded')).toBe('false')
  })

  it('Enter no gatilho abre o menu e move o foco para o primeiro item', async () => {
    const user = userEvent.setup()
    render(<MenuDeTeste />)

    const gatilho = screen.getByRole('button', { name: 'Abrir' })
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)

    await user.tab()
    await user.keyboard('{Enter}')

    const itens = screen.getAllByRole('menuitem')
    expect(itens.map((item) => item.textContent)).toEqual(['Primeiro', 'Segundo'])
    expect(gatilho.getAttribute('aria-expanded')).toBe('true')
    // Abrir por teclado tem que levar o foco PARA dentro do menu; se ficasse no
    // gatilho, a seta seguinte não navegaria nada.
    expect(document.activeElement).toBe(itens[0])
  })

  it('ArrowDown move o item ativo do primeiro para o segundo', async () => {
    const user = userEvent.setup()
    render(<MenuDeTeste />)

    await user.tab()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')

    const [primeiro, segundo] = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(segundo)
    // O Radix marca o item ativo com `data-highlighted` (atributo vazio no
    // ativo, ausente nos demais) — é por ele que o CSS pinta o realce, então
    // vale checar os dois sinais: foco de verdade E marcação visual.
    expect(segundo.getAttribute('data-highlighted')).not.toBeNull()
    expect(primeiro.getAttribute('data-highlighted')).toBeNull()
  })

  it('Escape fecha o menu e devolve o foco ao gatilho', async () => {
    const user = userEvent.setup()
    render(<MenuDeTeste />)

    const gatilho = screen.getByRole('button', { name: 'Abrir' })
    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)

    await user.keyboard('{Escape}')

    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    expect(gatilho.getAttribute('aria-expanded')).toBe('false')
    // A parte que mais quebra na prática: fechar sem devolver o foco joga o
    // usuário de teclado para o começo do documento.
    expect(document.activeElement).toBe(gatilho)
  })

  it('Enter num item dispara onSelect e fecha o menu', async () => {
    const user = userEvent.setup()
    const selecionados: string[] = []
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button>Abrir</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => selecionados.push('primeiro')}>
            Primeiro
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => selecionados.push('segundo')}>Segundo</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.tab()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(selecionados).toEqual(['segundo'])
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  })
})
