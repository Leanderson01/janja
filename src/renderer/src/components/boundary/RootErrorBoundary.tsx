import { Component, type ErrorInfo, type ReactNode } from 'react'
import { HydraMark } from '@/components/brand/HydraMark'

/**
 * A REDE QUE IMPEDE A PRÓXIMA TELA PRETA.
 *
 * Motivo de existir, com nome e data: em 2026-08-25 o primeiro cadastro na web
 * terminava numa tela preta. A causa foi corrigida onde nasceu (`AuthGate`
 * espera a conta existir antes de montar o app — ver o comentário longo lá), e
 * este componente existe para o RESTO: qualquer erro lançado durante o render
 * em qualquer lugar da árvore.
 *
 * O problema não era só o erro — era o SILÊNCIO. Sem error boundary, o React
 * desmonta a raiz inteira, e `#root` vazio sobre um `body` com `bg-background`
 * (`oklch(0.145 0 0)`, `index.html class="dark"`) é indistinguível de "o app
 * não abriu". Quem usa vê um retângulo preto; quem recebe o relato não tem por
 * onde começar. Um `useQuery` do Convex relança erro de servidor DENTRO do
 * render (client.js:465), então esse caminho está sempre a uma query de
 * distância.
 *
 * Vale para os dois alvos: no desktop a mesma raiz vazia aparece como uma
 * janela preta, e o console fica atrás do DevTools que ninguém abre.
 *
 * Classe (e não hook) por obrigação do React: `componentDidCatch` /
 * `getDerivedStateFromError` não têm equivalente em função.
 */
interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // O React já loga o erro, mas sem o prefixo que torna o relato buscável e
    // sem o trecho da árvore num lugar só. Esta linha é o que transforma
    // "ficou preto" em "achei no console".
    console.error(
      '[hydra] a árvore do React foi derrubada por um erro não tratado:',
      error,
      info.componentStack
    )
  }

  render(): React.JSX.Element | ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
        <div className="flex max-w-md flex-col items-center gap-2 text-center">
          <HydraMark className="size-10" />
          <h1 className="text-xl font-semibold tracking-tight">Hydra</h1>
          <p className="text-sm text-destructive">Alguma coisa quebrou ao desenhar a tela.</p>
          <p className="text-muted-foreground text-xs break-words">{error.message}</p>
          <button
            type="button"
            className="text-muted-foreground mt-2 text-xs underline underline-offset-4"
            onClick={() => window.location.reload()}
          >
            Recarregar
          </button>
        </div>
      </div>
    )
  }
}
