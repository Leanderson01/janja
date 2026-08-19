import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

async function insertUser(
  t: ReturnType<typeof convexTest>,
  workosId: string,
  username: string,
  tag: string
) {
  return t.run((ctx) =>
    ctx.db.insert('users', {
      workosId,
      username,
      tag,
      displayName: username
    })
  )
}

describe('friends.sendFriendRequest', () => {
  test('rejeita sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_bruno', 'bruno', '0002')

    await expect(
      t.mutation(anyApi.friends.sendFriendRequest, { username: 'bruno', tag: '0002' })
    ).rejects.toThrow()
  })

  test('alvo inexistente lança erro claro e não cria nada', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')
    const asAna = t.withIdentity({ subject: 'workos_ana' })

    await expect(
      asAna.mutation(anyApi.friends.sendFriendRequest, { username: 'fantasma', tag: '9999' })
    ).rejects.toThrow(/não encontrado/i)

    const requests = await t.run((ctx) => ctx.db.query('friendRequests').collect())
    expect(requests).toHaveLength(0)
  })

  test('username/tag resolvendo para o próprio chamador lança erro', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')
    const asAna = t.withIdentity({ subject: 'workos_ana' })

    await expect(
      asAna.mutation(anyApi.friends.sendFriendRequest, { username: 'ana', tag: '0001' })
    ).rejects.toThrow(/si mesmo/i)
  })

  test('já são amigos: lança erro e não cria pedido duplicado', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const brunoId = await insertUser(t, 'workos_bruno', 'bruno', '0002')
    const [userA, userB] = anaId < brunoId ? [anaId, brunoId] : [brunoId, anaId]
    await t.run((ctx) => ctx.db.insert('friendships', { userA, userB, createdAt: Date.now() }))

    const asAna = t.withIdentity({ subject: 'workos_ana' })

    await expect(
      asAna.mutation(anyApi.friends.sendFriendRequest, { username: 'bruno', tag: '0002' })
    ).rejects.toThrow(/já são amigos/i)

    const requests = await t.run((ctx) => ctx.db.query('friendRequests').collect())
    expect(requests).toHaveLength(0)
  })

  test('pedido duplicado na mesma direção lança erro', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')
    await insertUser(t, 'workos_bruno', 'bruno', '0002')
    const asAna = t.withIdentity({ subject: 'workos_ana' })

    await asAna.mutation(anyApi.friends.sendFriendRequest, { username: 'bruno', tag: '0002' })

    await expect(
      asAna.mutation(anyApi.friends.sendFriendRequest, { username: 'bruno', tag: '0002' })
    ).rejects.toThrow(/já enviado/i)

    const requests = await t.run((ctx) => ctx.db.query('friendRequests').collect())
    expect(requests).toHaveLength(1)
  })

  test('pedido reverso existente orienta a aceitar em vez de duplicar', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')
    await insertUser(t, 'workos_bruno', 'bruno', '0002')
    const asAna = t.withIdentity({ subject: 'workos_ana' })
    const asBruno = t.withIdentity({ subject: 'workos_bruno' })

    // Bruno já enviou um pedido para Ana.
    await asBruno.mutation(anyApi.friends.sendFriendRequest, { username: 'ana', tag: '0001' })

    // Ana tenta enviar para Bruno — deve ser orientada a aceitar, não duplicar.
    await expect(
      asAna.mutation(anyApi.friends.sendFriendRequest, { username: 'bruno', tag: '0002' })
    ).rejects.toThrow(/aceite/i)

    const requests = await t.run((ctx) => ctx.db.query('friendRequests').collect())
    expect(requests).toHaveLength(1)
  })

  test('caminho feliz: cria exatamente um documento com os campos corretos', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const brunoId = await insertUser(t, 'workos_bruno', 'bruno', '0002')
    const asAna = t.withIdentity({ subject: 'workos_ana' })

    await asAna.mutation(anyApi.friends.sendFriendRequest, { username: 'bruno', tag: '0002' })

    const requests = await t.run((ctx) => ctx.db.query('friendRequests').collect())
    expect(requests).toHaveLength(1)
    expect(requests[0].fromUserId).toBe(anaId)
    expect(requests[0].toUserId).toBe(brunoId)
    expect(typeof requests[0].createdAt).toBe('number')
  })
})

describe('friends.acceptFriendRequest', () => {
  test('id inexistente lança erro claro', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')
    const asAna = t.withIdentity({ subject: 'workos_ana' })

    // Gera um id de formato válido mas inexistente: insere e apaga.
    const ghostId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('friendRequests', {
        fromUserId: (await ctx.db.query('users').first())!._id,
        toUserId: (await ctx.db.query('users').first())!._id,
        createdAt: Date.now()
      })
      await ctx.db.delete(id)
      return id
    })

    await expect(
      asAna.mutation(anyApi.friends.acceptFriendRequest, { requestId: ghostId })
    ).rejects.toThrow(/não encontrado/i)
  })

  test('AUTORIZAÇÃO CRÍTICA: terceiro usuário não pode aceitar pedido alheio, e nada é criado como efeito colateral', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')
    await insertUser(t, 'workos_bruno', 'bruno', '0002')
    await insertUser(t, 'workos_carla', 'carla', '0003')

    const asAna = t.withIdentity({ subject: 'workos_ana' })
    const asCarla = t.withIdentity({ subject: 'workos_carla' })

    const requestId: Id<'friendRequests'> = await asAna.mutation(
      anyApi.friends.sendFriendRequest,
      { username: 'bruno', tag: '0002' }
    )

    // Carla não é remetente nem destinatária — não pode aceitar.
    await expect(
      asCarla.mutation(anyApi.friends.acceptFriendRequest, { requestId })
    ).rejects.toThrow()

    // O pedido continua intacto e nenhuma amizade foi criada.
    const stillPending = await t.run((ctx) => ctx.db.get(requestId))
    expect(stillPending).not.toBeNull()

    const friendships = await t.run((ctx) => ctx.db.query('friendships').collect())
    expect(friendships).toHaveLength(0)
  })

  test('o próprio remetente não pode auto-aceitar o pedido que enviou', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')
    await insertUser(t, 'workos_bruno', 'bruno', '0002')
    const asAna = t.withIdentity({ subject: 'workos_ana' })

    const requestId: Id<'friendRequests'> = await asAna.mutation(
      anyApi.friends.sendFriendRequest,
      { username: 'bruno', tag: '0002' }
    )

    await expect(
      asAna.mutation(anyApi.friends.acceptFriendRequest, { requestId })
    ).rejects.toThrow()

    const stillPending = await t.run((ctx) => ctx.db.get(requestId))
    expect(stillPending).not.toBeNull()
    const friendships = await t.run((ctx) => ctx.db.query('friendships').collect())
    expect(friendships).toHaveLength(0)
  })

  test('destinatário real aceita: cria friendships em ordem canônica e apaga o pedido', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const brunoId = await insertUser(t, 'workos_bruno', 'bruno', '0002')
    const asAna = t.withIdentity({ subject: 'workos_ana' })
    const asBruno = t.withIdentity({ subject: 'workos_bruno' })

    const requestId: Id<'friendRequests'> = await asAna.mutation(
      anyApi.friends.sendFriendRequest,
      { username: 'bruno', tag: '0002' }
    )

    await asBruno.mutation(anyApi.friends.acceptFriendRequest, { requestId })

    const requestsAfter = await t.run((ctx) => ctx.db.query('friendRequests').collect())
    expect(requestsAfter).toHaveLength(0)

    const friendships = await t.run((ctx) => ctx.db.query('friendships').collect())
    expect(friendships).toHaveLength(1)
    const [expectedA, expectedB] = anaId < brunoId ? [anaId, brunoId] : [brunoId, anaId]
    expect(friendships[0].userA).toBe(expectedA)
    expect(friendships[0].userB).toBe(expectedB)
    expect(friendships[0].userA < friendships[0].userB).toBe(true)
  })

  test('userA < userB independe de quem enviou ou aceitou o pedido', async () => {
    // Cenário 1: Ana envia a Bruno, Bruno aceita.
    const t1 = convexTest(schema, modules)
    const anaId1 = await insertUser(t1, 'workos_ana', 'ana', '0001')
    const brunoId1 = await insertUser(t1, 'workos_bruno', 'bruno', '0002')
    const asAna1 = t1.withIdentity({ subject: 'workos_ana' })
    const asBruno1 = t1.withIdentity({ subject: 'workos_bruno' })
    const requestId1: Id<'friendRequests'> = await asAna1.mutation(
      anyApi.friends.sendFriendRequest,
      { username: 'bruno', tag: '0002' }
    )
    await asBruno1.mutation(anyApi.friends.acceptFriendRequest, { requestId: requestId1 })
    const friendships1 = await t1.run((ctx) => ctx.db.query('friendships').collect())

    // Cenário 2: Bruno envia a Ana, Ana aceita (mesmos dois usuários, fluxo invertido).
    const t2 = convexTest(schema, modules)
    const anaId2 = await insertUser(t2, 'workos_ana', 'ana', '0001')
    const brunoId2 = await insertUser(t2, 'workos_bruno', 'bruno', '0002')
    const asAna2 = t2.withIdentity({ subject: 'workos_ana' })
    const asBruno2 = t2.withIdentity({ subject: 'workos_bruno' })
    const requestId2: Id<'friendRequests'> = await asBruno2.mutation(
      anyApi.friends.sendFriendRequest,
      { username: 'ana', tag: '0001' }
    )
    await asAna2.mutation(anyApi.friends.acceptFriendRequest, { requestId: requestId2 })
    const friendships2 = await t2.run((ctx) => ctx.db.query('friendships').collect())

    const [expectedA1, expectedB1] = anaId1 < brunoId1 ? [anaId1, brunoId1] : [brunoId1, anaId1]
    const [expectedA2, expectedB2] = anaId2 < brunoId2 ? [anaId2, brunoId2] : [brunoId2, anaId2]

    expect(friendships1[0].userA).toBe(expectedA1)
    expect(friendships1[0].userB).toBe(expectedB1)
    expect(friendships2[0].userA).toBe(expectedA2)
    expect(friendships2[0].userB).toBe(expectedB2)
  })
})

describe('friends.rejectFriendRequest', () => {
  test('terceiro usuário não pode recusar pedido alheio', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')
    await insertUser(t, 'workos_bruno', 'bruno', '0002')
    await insertUser(t, 'workos_carla', 'carla', '0003')

    const asAna = t.withIdentity({ subject: 'workos_ana' })
    const asCarla = t.withIdentity({ subject: 'workos_carla' })

    const requestId: Id<'friendRequests'> = await asAna.mutation(
      anyApi.friends.sendFriendRequest,
      { username: 'bruno', tag: '0002' }
    )

    await expect(
      asCarla.mutation(anyApi.friends.rejectFriendRequest, { requestId })
    ).rejects.toThrow()

    const stillPending = await t.run((ctx) => ctx.db.get(requestId))
    expect(stillPending).not.toBeNull()
  })

  test('destinatário recusa: pedido some e nenhuma amizade é criada', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')
    await insertUser(t, 'workos_bruno', 'bruno', '0002')
    const asAna = t.withIdentity({ subject: 'workos_ana' })
    const asBruno = t.withIdentity({ subject: 'workos_bruno' })

    const requestId: Id<'friendRequests'> = await asAna.mutation(
      anyApi.friends.sendFriendRequest,
      { username: 'bruno', tag: '0002' }
    )

    await asBruno.mutation(anyApi.friends.rejectFriendRequest, { requestId })

    const requestsAfter = await t.run((ctx) => ctx.db.query('friendRequests').collect())
    expect(requestsAfter).toHaveLength(0)

    const friendships = await t.run((ctx) => ctx.db.query('friendships').collect())
    expect(friendships).toHaveLength(0)
  })
})
