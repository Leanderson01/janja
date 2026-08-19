// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LinkPreviewCard } from './LinkPreviewCard'

// Prova das quatro promessas do Plano 08.5-16 que NÃO dependem do deployment
// do Convex: quando o cartão aparece, quando ele não aparece, e quantas vezes
// a busca é pedida ao servidor. O caminho real (a action buscando um site de
// verdade) só existe depois do `npx convex dev` no Windows — ver 08.5-17.
//
// Receita do Plano 08.5-02: docblock de ambiente na 1ª linha, `@/test/jsdom-setup`
// na 2ª, `afterEach(cleanup)` obrigatório (o vitest aqui não roda com
// `globals: true`). Asserções em DOM puro — `jest-dom` não está instalado.
//
// `convex/react` é mockado porque `useQuery`/`useAction` exigem um
// `ConvexProvider` com cliente real ("Could not find Convex client!"), e o que
// se quer provar aqui é a LÓGICA do componente diante de cada resposta
// possível do cache, não a biblioteca do Convex.
const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  fetchPreview: vi.fn()
}))

vi.mock('convex/react', () => ({
  useQuery: mocks.useQuery,
  useAction: () => mocks.fetchPreview
}))

// Cada teste usa uma URL diferente de propósito: a guarda de disparo único vive
// num `Set` de MÓDULO, que sobrevive entre os testes do mesmo arquivo. Reusar a
// mesma URL faria um teste esconder o defeito do outro — e o teste de remontagem
// (que reusa a URL de propósito) deixaria de provar coisa alguma.
function okPreview(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: 'preview1',
    url: 'https://exemplo.com',
    status: 'ok',
    title: 'Título do site',
    description: 'Descrição do site',
    siteName: 'exemplo.com',
    fetchedAt: 0,
    ...over
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  mocks.fetchPreview.mockResolvedValue(null)
})

describe('LinkPreviewCard', () => {
  it('não renderiza nada e NÃO pede busca enquanto a query não respondeu', () => {
    mocks.useQuery.mockReturnValue(undefined)
    const { container } = render(<LinkPreviewCard url="https://a.exemplo/1" />)

    expect(container.innerHTML).toBe('')
    expect(mocks.fetchPreview).not.toHaveBeenCalled()
  })

  it('cache vazio: pede a busca UMA vez e não renderiza nada enquanto isso', () => {
    mocks.useQuery.mockReturnValue(null)
    const { container, rerender } = render(<LinkPreviewCard url="https://a.exemplo/2" />)

    expect(container.innerHTML).toBe('')
    expect(mocks.fetchPreview).toHaveBeenCalledTimes(1)
    expect(mocks.fetchPreview).toHaveBeenCalledWith({ url: 'https://a.exemplo/2' })

    // Re-render (o que a lista faz o tempo todo) não pode virar nova requisição.
    rerender(<LinkPreviewCard url="https://a.exemplo/2" />)
    rerender(<LinkPreviewCard url="https://a.exemplo/2" />)
    expect(mocks.fetchPreview).toHaveBeenCalledTimes(1)
  })

  it('remontar a linha (paginação/troca de canal) NÃO redispara a busca', () => {
    mocks.useQuery.mockReturnValue(null)
    const first = render(<LinkPreviewCard url="https://a.exemplo/3" />)
    expect(mocks.fetchPreview).toHaveBeenCalledTimes(1)
    first.unmount()

    render(<LinkPreviewCard url="https://a.exemplo/3" />)
    expect(mocks.fetchPreview).toHaveBeenCalledTimes(1)
  })

  it('action que rejeita não vira loop nem erro na tela', async () => {
    mocks.fetchPreview.mockRejectedValue(new Error('rede caiu'))
    mocks.useQuery.mockReturnValue(null)
    const { container, rerender } = render(<LinkPreviewCard url="https://a.exemplo/4" />)
    await Promise.resolve()

    rerender(<LinkPreviewCard url="https://a.exemplo/4" />)
    expect(mocks.fetchPreview).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe('')
  })

  it('status failed: nenhum cartão, nenhuma nova busca', () => {
    // O título vai preenchido DE PROPÓSITO, mesmo o servidor apagando os campos
    // de conteúdo ao gravar `failed`: sem isso o teste passaria por causa da
    // guarda de "ok sem título" e não provaria nada sobre o status. Provado por
    // mutação — apagando a checagem de status, este teste falha.
    mocks.useQuery.mockReturnValue({
      _id: 'p',
      url: 'https://a.exemplo/5',
      status: 'failed',
      title: 'Título de uma tentativa antiga',
      fetchedAt: 0
    })
    const { container } = render(<LinkPreviewCard url="https://a.exemplo/5" />)

    expect(container.innerHTML).toBe('')
    expect(mocks.fetchPreview).not.toHaveBeenCalled()
  })

  it('status ok sem título não vira cartão vazio', () => {
    mocks.useQuery.mockReturnValue(okPreview({ title: undefined }))
    const { container } = render(<LinkPreviewCard url="https://a.exemplo/6" />)

    expect(container.innerHTML).toBe('')
  })

  it('status ok: título, descrição, site e link que abre fora do app', () => {
    mocks.useQuery.mockReturnValue(okPreview())
    render(<LinkPreviewCard url="https://a.exemplo/7" />)

    expect(screen.getByText('Título do site')).toBeTruthy()
    expect(screen.getByText('Descrição do site')).toBeTruthy()
    expect(screen.getByText('exemplo.com')).toBeTruthy()

    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://a.exemplo/7')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
    // Não pede busca de novo com o cache quente.
    expect(mocks.fetchPreview).not.toHaveBeenCalled()
  })

  it('sem imagem no cache, nenhum <img> é renderizado', () => {
    mocks.useQuery.mockReturnValue(okPreview())
    const { container } = render(<LinkPreviewCard url="https://a.exemplo/8" />)

    expect(container.querySelector('img')).toBeNull()
  })

  it('com imagem: renderiza com alt vazio e some se a imagem falhar', () => {
    mocks.useQuery.mockReturnValue(okPreview({ imageUrl: 'https://exemplo.com/capa.png' }))
    const { container } = render(<LinkPreviewCard url="https://a.exemplo/9" />)

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://exemplo.com/capa.png')
    // Decorativa: o título logo acima já é o texto acessível do link.
    expect(img?.getAttribute('alt')).toBe('')
    expect(img?.getAttribute('loading')).toBe('lazy')

    // og:image morta não pode virar ícone de imagem quebrada dentro da conversa.
    fireEvent.error(img as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()
    // O resto do cartão continua de pé.
    expect(screen.getByText('Título do site')).toBeTruthy()
  })
})
