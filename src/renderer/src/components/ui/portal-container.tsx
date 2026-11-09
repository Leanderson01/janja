import { createContext, useContext } from 'react'

// Em tela cheia só o elemento em tela cheia e seus filhos são pintados; menus e
// tooltips do Radix vão por padrão para `document.body` e sumiriam. O palco da
// call fornece o próprio elemento aqui. Fora dele, `null` = `document.body`.
const PortalContainerContext = createContext<HTMLElement | null>(null)

export const PortalContainerProvider = PortalContainerContext.Provider

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined
}
