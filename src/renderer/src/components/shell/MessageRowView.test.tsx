// @vitest-environment jsdom
import '@/test/jsdom-setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MessageRowView } from './MessageRowView'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const at = new Date(2026, 10, 9, 10, 0).getTime()

function renderRow(
  over: Partial<{
    isGroupStart: boolean
    authorName: string
    children: ReactNode
  }> = {}
) {
  return render(
    <TooltipProvider>
      <MessageRowView
        authorId="u1"
        authorName={over.authorName ?? 'Leo'}
        createdAt={at}
        now={at + 60_000}
        isGroupStart={over.isGroupStart ?? true}
      >
        {over.children ?? 'oi'}
      </MessageRowView>
    </TooltipProvider>
  )
}

describe('MessageRowView', () => {
  it('início de grupo mostra foto, nome e horário', () => {
    renderRow({ isGroupStart: true, authorName: 'Leo' })
    expect(screen.getByText('Leo')).toBeTruthy()
    expect(screen.getByText(/Hoje às/)).toBeTruthy()
  })
  it('continuação mostra só o texto e a hora na margem', () => {
    renderRow({ isGroupStart: false, authorName: 'Leo' })
    expect(screen.queryByText('Leo')).toBeNull()
    expect(screen.getByText('10:00').className).toContain('group-hover:')
  })
  it('URL gigante quebra a linha', () => {
    const { container } = renderRow({ children: 'https://x.com/' + 'a'.repeat(300) })
    expect(container.querySelector('[data-message-content]')!.className).toContain('break-words')
  })
  it('mensagem só com anexo não renderiza linha de texto vazia', () => {
    const { container } = renderRow({ children: <img alt="anexo" /> })
    expect(container.querySelector('[data-message-content]')).toBeNull()
    expect(screen.getByAltText('anexo')).toBeTruthy()
  })
})
