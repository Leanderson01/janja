import { describe, expect, it } from 'vitest'

import { readableConvexError } from './convex-error'

// Módulo puro: roda no `edge-runtime` global do vitest, sem jsdom.
describe('readableConvexError', () => {
  it('extrai a frase do usuário do embrulho do cliente Convex', () => {
    const err = new Error(
      '[CONVEX M(friends:sendFriendRequest)] [Request ID: 4f2a9c] Server Error\n' +
        'Uncaught Error: Usuário não encontrado\n' +
        '    at handler (../convex/friends.ts:42:11)'
    )

    expect(readableConvexError(err)).toBe('Usuário não encontrado')
  })

  it('não deixa passar stack nem ID de request junto com a frase', () => {
    const err = new Error(
      '[CONVEX M(friends:sendFriendRequest)] [Request ID: 4f2a9c] Server Error\n' +
        'Uncaught Error: Você não pode adicionar a si mesmo\n' +
        '    at handler (../convex/friends.ts:31:11)'
    )

    const message = readableConvexError(err)

    expect(message).not.toMatch(/Request ID/)
    expect(message).not.toMatch(/at handler/)
    expect(message).not.toMatch(/\n/)
  })

  // Erro de rede, TypeError e afins não têm o formato do Convex. Devolver o texto
  // cru é o comportamento certo: um toast feio ainda diz mais que um toast vazio.
  it('devolve o texto cru quando não é erro do Convex', () => {
    expect(readableConvexError(new Error('Failed to fetch'))).toBe('Failed to fetch')
  })

  it('aceita valor lançado que não é Error', () => {
    expect(readableConvexError('quebrou')).toBe('quebrou')
    expect(readableConvexError(undefined)).toBe('undefined')
  })
})
