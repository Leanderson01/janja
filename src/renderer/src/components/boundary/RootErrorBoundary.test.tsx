// @vitest-environment jsdom
//
// O contrato deste componente é curto e é o oposto de uma tela preta: quando
// algo lança durante o render, (1) a raiz NÃO fica vazia, (2) a mensagem
// aparece na tela e (3) o motivo aparece no console com prefixo buscável.
//
// Contraprova incluída: o MESMO componente que quebra, montado SEM o boundary,
// esvazia o container — que é exatamente o que o usuário vê como "tela preta"
// (`body` tem `bg-background`, `index.html class="dark"`).
//
// Asserções em DOM puro: `@testing-library/jest-dom` não está instalado neste
// projeto (ver o cabeçalho de `MessageInput.test.tsx`).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RootErrorBoundary } from './RootErrorBoundary'

function Explode(): React.JSX.Element {
  throw new Error('Usuário sem documento em users — ensureUser deveria ter rodado antes')
}

// As chamadas ficam num array em vez de serem lidas de um `MockInstance`
// tipado: `ReturnType<typeof vi.spyOn>` não casa com a assinatura variádica de
// `console.error` e o typecheck do projeto reclama (TS2322).
const chamadasDeConsoleError: unknown[][] = []

beforeEach(() => {
  chamadasDeConsoleError.length = 0
  // O React loga o erro por conta própria, além do nosso `componentDidCatch`;
  // silenciar aqui mantém a saída do vitest legível sem esconder a asserção.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    chamadasDeConsoleError.push(args)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RootErrorBoundary', () => {
  it('sem boundary, um erro de render esvazia o container — a tela preta', () => {
    const alvo = document.createElement('div')
    document.body.appendChild(alvo)

    // Sem nada que contenha o erro, ele sobe pelo render e o React desmonta a
    // raiz. `render` relança, então o `try` é obrigatório para chegar na
    // asserção que interessa: o container ficou VAZIO.
    let escapou: unknown = null
    try {
      render(<Explode />, { container: alvo })
    } catch (err) {
      escapou = err
    }

    expect((escapou as Error)?.message).toContain('ensureUser deveria ter rodado antes')
    expect(alvo.innerHTML).toBe('')
  })

  it('com boundary, a mesma quebra vira texto legível em vez de raiz vazia', () => {
    const { container } = render(
      <RootErrorBoundary>
        <Explode />
      </RootErrorBoundary>
    )

    expect(container.innerHTML).not.toBe('')
    expect(container.textContent).toContain('Alguma coisa quebrou ao desenhar a tela')
    expect(container.textContent).toContain('ensureUser deveria ter rodado antes')
    expect(screen.getByRole('button', { name: 'Recarregar' })).not.toBeNull()
  })

  it('e o motivo vai para o console com prefixo buscável', () => {
    render(
      <RootErrorBoundary>
        <Explode />
      </RootErrorBoundary>
    )

    const nossa = chamadasDeConsoleError.find(
      (args) => typeof args[0] === 'string' && args[0].startsWith('[hydra]')
    )
    expect(nossa).toBeDefined()
    expect(String(nossa?.[0])).toContain('derrubada por um erro não tratado')
    expect((nossa?.[1] as Error).message).toContain('ensureUser deveria ter rodado antes')
  })

  it('é inerte quando nada lança — a árvore do desktop não muda', () => {
    const { container } = render(
      <RootErrorBoundary>
        <p data-testid="filho">conteúdo normal</p>
      </RootErrorBoundary>
    )

    // Nenhuma moldura, nenhum wrapper: `children` e mais nada.
    expect(container.innerHTML).toBe('<p data-testid="filho">conteúdo normal</p>')
    expect(chamadasDeConsoleError).toHaveLength(0)
  })
})
