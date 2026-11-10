import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Boundary LOCAL: isola uma seção da tela. Um `useQuery` do Convex relança erro
 * de servidor (ex.: função ainda não publicada) dentro do render; sem um
 * boundary perto, o `RootErrorBoundary` derruba o app inteiro. Aqui só a
 * seção vira uma linha discreta e o resto da tela continua funcionando.
 * Erros fora dos filhos não passam por aqui.
 */
interface Props {
  children: ReactNode
  message: string
}
interface State {
  failed: boolean
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[janja] seção falhou ao renderizar:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return <p className="px-5 py-4 text-sm text-muted-foreground">{this.props.message}</p>
  }
}
