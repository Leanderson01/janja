import { capabilities } from '@platform/capabilities'

// Faixa de 32px que arrasta a janela nas telas ANTES do AppShell (login,
// carregando, erro). Com `titleBarStyle: 'hidden'` a `TitleBar` é a única outra
// área arrastável e só existe dentro do AppShell. Não há botões na faixa, então
// ela inteira arrasta. Só existe onde a janela é nativa (Electron).
export function WindowDragStrip(): React.JSX.Element | null {
  if (!capabilities.nativeWindowControls) return null
  return (
    <div
      data-testid="window-drag-strip"
      className="absolute inset-x-0 top-0 h-8 [app-region:drag]"
    />
  )
}
