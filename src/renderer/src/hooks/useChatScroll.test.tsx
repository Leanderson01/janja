// @vitest-environment jsdom
import '@/test/jsdom-setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useChatScroll } from './useChatScroll'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function fakeViewport(init: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  const el = document.createElement('div')
  const state = { ...init }
  for (const k of ['scrollTop', 'scrollHeight', 'clientHeight'] as const) {
    Object.defineProperty(el, k, {
      get: () => state[k],
      set: (v: number) => {
        state[k] = v
      },
      configurable: true
    })
  }
  return { el, state }
}

function setup(
  init: { scrollTop: number; scrollHeight: number; clientHeight: number },
  over: { canLoadMore?: boolean } = {}
) {
  const { el, state } = fakeViewport(init)
  const loadMore = vi.fn()
  const onReachBottom = vi.fn()
  const initialScroll = vi.fn()
  const viewportRef = { current: el as HTMLElement | null }
  const hook = renderHook(
    (p: { newestId?: string; oldestId?: string }) =>
      useChatScroll({
        viewportRef,
        newestId: p.newestId,
        oldestId: p.oldestId,
        canLoadMore: over.canLoadMore ?? true,
        loadMore,
        onReachBottom,
        initialScroll
      }),
    { initialProps: { newestId: 'n1', oldestId: 'o1' } }
  )
  return { ...hook, el, state, loadMore, onReachBottom, initialScroll }
}

describe('useChatScroll', () => {
  it('perto do topo carrega mais', () => {
    const { el, state, loadMore } = setup({ scrollTop: 100, scrollHeight: 5000, clientHeight: 600 })
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
    expect(loadMore).toHaveBeenCalledOnce()
    expect(state.scrollTop).toBe(100)
  })
  it('não carrega mais quando não há mais páginas', () => {
    const { el, loadMore } = setup({ scrollTop: 100, scrollHeight: 5000, clientHeight: 600 }, { canLoadMore: false })
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
    expect(loadMore).not.toHaveBeenCalled()
  })
  it('marca que está vendo antigas quando sobe mais de uma tela', () => {
    const { el, result } = setup({ scrollTop: 3000, scrollHeight: 5000, clientHeight: 600 })
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
    expect(result.current.isViewingOld).toBe(true)
  })
  it('chama a posição inicial uma única vez', () => {
    const { initialScroll, rerender } = setup({ scrollTop: 0, scrollHeight: 5000, clientHeight: 600 })
    expect(initialScroll).toHaveBeenCalledOnce()
    rerender({ newestId: 'n1', oldestId: 'o1' })
    expect(initialScroll).toHaveBeenCalledOnce()
  })
  it('cola no fundo quando chega mensagem e você está no fundo', () => {
    const { el, state, rerender, onReachBottom } = setup({ scrollTop: 4400, scrollHeight: 5000, clientHeight: 600 })
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
    state.scrollHeight = 5100
    rerender({ newestId: 'n2', oldestId: 'o1' })
    expect(state.scrollTop).toBe(5100)
    expect(onReachBottom).toHaveBeenCalledOnce()
  })
  it('conta novas mensagens quando você está lendo antigas e scrollToBottom zera', () => {
    const { el, state, rerender, result, onReachBottom } = setup({
      scrollTop: 1000,
      scrollHeight: 5000,
      clientHeight: 600
    })
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
    rerender({ newestId: 'n2', oldestId: 'o1' })
    expect(result.current.newMessageCount).toBe(1)
    act(() => result.current.scrollToBottom())
    expect(result.current.newMessageCount).toBe(0)
    expect(state.scrollTop).toBe(5000)
    expect(onReachBottom).toHaveBeenCalledOnce()
  })
  it('compensa a altura quando páginas antigas entram no topo', () => {
    const { el, state, rerender } = setup({ scrollTop: 100, scrollHeight: 5000, clientHeight: 600 })
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
    state.scrollHeight = 7000
    rerender({ newestId: 'n1', oldestId: 'o0' })
    expect(state.scrollTop).toBe(2100)
  })
})
