// @vitest-environment jsdom
import '@/test/jsdom-setup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SectionErrorBoundary } from './SectionErrorBoundary'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function Explode(): React.JSX.Element {
  throw new Error('função não publicada')
}

describe('SectionErrorBoundary', () => {
  it('filho que lança mostra a mensagem e não propaga', () => {
    render(
      <div>
        <p>resto da tela</p>
        <SectionErrorBoundary message="Não deu para carregar os pedidos enviados.">
          <Explode />
        </SectionErrorBoundary>
      </div>
    )
    expect(screen.getByText('Não deu para carregar os pedidos enviados.')).toBeTruthy()
    expect(screen.getByText('resto da tela')).toBeTruthy()
  })

  it('filho normal é renderizado', () => {
    render(
      <SectionErrorBoundary message="falhou">
        <p>tudo certo</p>
      </SectionErrorBoundary>
    )
    expect(screen.getByText('tudo certo')).toBeTruthy()
    expect(screen.queryByText('falhou')).toBeNull()
  })
})
