import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

const TOP_THRESHOLD_PX = 150
const BOTTOM_THRESHOLD_PX = 100

/**
 * Rolagem do chat (CHAT-03/CHAT-04/CHAT-14), movida do MessageList sem mudar o comportamento:
 * - `loadMore` só pelo evento nativo de scroll (`scrollTop < 150`), nunca por `results.length`;
 * - compensação de altura quando `oldestId` muda (histórico entra no topo);
 * - grudar no fundo quando chega mensagem e você está a menos de 100px dele;
 * - contador de novas mensagens quando você não está no fundo;
 * - `isViewingOld`: distância do fundo maior que uma tela.
 * A posição inicial (divisor de não lidas ou fundo) é decidida por `initialScroll`, chamado uma
 * única vez, quando houver mensagem e `ready` for verdadeiro (openChannel já respondeu).
 * `viewportRef` precisa estar preenchido antes deste hook rodar os efeitos.
 */
export function useChatScroll(opts: {
  viewportRef: RefObject<HTMLElement | null>
  newestId?: string
  oldestId?: string
  canLoadMore: boolean
  loadMore(): void
  onReachBottom?(): void
  initialScroll(viewport: HTMLElement): void
  /** Falso enquanto a posição inicial ainda depende de dado que não chegou. */
  ready?: boolean
}): { isViewingOld: boolean; newMessageCount: number; scrollToBottom(): void } {
  const { viewportRef, newestId, oldestId, ready = true } = opts

  const isAtBottomRef = useRef(true)
  const scrollHeightBeforeLoadMoreRef = useRef<number | null>(null)
  const previousNewestIdRef = useRef<string | undefined>(undefined)
  const previousOldestIdRef = useRef<string | undefined>(undefined)
  const hasScrolledToBottomOnceRef = useRef(false)
  const attachedRef = useRef<HTMLElement | null>(null)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const [isViewingOld, setIsViewingOld] = useState(false)

  // Os callbacks mudam de identidade a cada render; o listener lê sempre o mais recente.
  const latest = useRef(opts)
  latest.current = opts

  const handleScrollRef = useRef<() => void>(() => {})
  handleScrollRef.current = (): void => {
    const el = viewportRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distance < BOTTOM_THRESHOLD_PX
    isAtBottomRef.current = atBottom
    if (atBottom) setNewMessageCount(0)
    setIsViewingOld(distance > el.clientHeight)

    if (el.scrollTop < TOP_THRESHOLD_PX && latest.current.canLoadMore) {
      scrollHeightBeforeLoadMoreRef.current = el.scrollHeight
      latest.current.loadMore()
    }
  }

  // O viewport pode aparecer depois do mount (troca de "Carregando..." pela lista), então a cada
  // render confere se mudou e religa o listener.
  const listener = useRef(() => handleScrollRef.current()).current
  useEffect(() => {
    const el = viewportRef.current
    if (el === attachedRef.current) return
    attachedRef.current?.removeEventListener('scroll', listener)
    attachedRef.current = el
    el?.addEventListener('scroll', listener)
  })
  useEffect(
    () => () => {
      attachedRef.current?.removeEventListener('scroll', listener)
      attachedRef.current = null
    },
    [listener]
  )

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    if (!hasScrolledToBottomOnceRef.current) {
      if (newestId === undefined) return
      // Não decide a posição inicial com dado incompleto: marcar como feito cedo demais
      // impediria a correção certa quando o divisor chegasse (05-07-PLAN.md).
      if (!ready) return

      latest.current.initialScroll(viewport)

      hasScrolledToBottomOnceRef.current = true
      previousNewestIdRef.current = newestId
      previousOldestIdRef.current = oldestId
      return
    }

    if (
      oldestId !== previousOldestIdRef.current &&
      scrollHeightBeforeLoadMoreRef.current !== null
    ) {
      const delta = viewport.scrollHeight - scrollHeightBeforeLoadMoreRef.current
      viewport.scrollTop += delta
      scrollHeightBeforeLoadMoreRef.current = null
    }

    if (newestId !== previousNewestIdRef.current && previousNewestIdRef.current !== undefined) {
      if (isAtBottomRef.current) {
        viewport.scrollTop = viewport.scrollHeight
        latest.current.onReachBottom?.()
      } else {
        setNewMessageCount((n) => n + 1)
      }
    }

    previousNewestIdRef.current = newestId
    previousOldestIdRef.current = oldestId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId, oldestId, ready])

  function scrollToBottom(): void {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
    setNewMessageCount(0)
    setIsViewingOld(false)
    isAtBottomRef.current = true
    latest.current.onReachBottom?.()
  }

  return { isViewingOld, newMessageCount, scrollToBottom }
}
