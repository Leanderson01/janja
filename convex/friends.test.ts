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

describe('friends.listFriends', () => {
  test('rejeita sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')

    await expect(t.query(anyApi.friends.listFriends, {})).rejects.toThrow()
  })

  test('amigo aparece na lista independente de quem é userA no par canônico', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const brunoId = await insertUser(t, 'workos_bruno', 'bruno', '0002')
    const [userA, userB] = anaId < brunoId ? [anaId, brunoId] : [brunoId, anaId]
    await t.run((ctx) => ctx.db.insert('friendships', { userA, userB, createdAt: Date.now() }))

    const asAna = t.withIdentity({ subject: 'workos_ana' })
    const asBruno = t.withIdentity({ subject: 'workos_bruno' })

    const anaFriends = await asAna.query(anyApi.friends.listFriends, {})
    expect(anaFriends).toHaveLength(1)
    expect(anaFriends[0].userId).toBe(brunoId)
    expect(anaFriends[0].username).toBe('bruno')

    const brunoFriends = await asBruno.query(anyApi.friends.listFriends, {})
    expect(brunoFriends).toHaveLength(1)
    expect(brunoFriends[0].userId).toBe(anaId)
    expect(brunoFriends[0].username).toBe('ana')
  })

  test('presença: amigo com heartbeat recente aparece online, sem heartbeat ou com heartbeat antigo aparece offline', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const brunoId = await insertUser(t, 'workos_bruno', 'bruno', '0002')
    const carlaId = await insertUser(t, 'workos_carla', 'carla', '0003')

    // Ana é amiga de Bruno (heartbeat recente) e de Carla (heartbeat antigo).
    await t.run(async (ctx) => {
      const [pairAB0, pairAB1] = anaId < brunoId ? [anaId, brunoId] : [brunoId, anaId]
      await ctx.db.insert('friendships', {
        userA: pairAB0,
        userB: pairAB1,
        createdAt: Date.now()
      })
      const [pairAC0, pairAC1] = anaId < carlaId ? [anaId, carlaId] : [carlaId, anaId]
      await ctx.db.insert('friendships', {
        userA: pairAC0,
        userB: pairAC1,
        createdAt: Date.now()
      })

      await ctx.db.insert('presence', { userId: brunoId, lastSeen: Date.now() })
      await ctx.db.insert('presence', { userId: carlaId, lastSeen: Date.now() - 200_000 })
    })

    const asAna = t.withIdentity({ subject: 'workos_ana' })
    // anyApi devolve `any`, então o retorno precisa de forma explícita aqui —
    // sem isso o parâmetro do find fica implicitamente any e o typecheck da
    // raiz (que, ao contrário do convex/tsconfig.json, inclui os testes) falha.
    const friends: Array<{ userId: Id<'users'>; online: boolean }> = await asAna.query(
      anyApi.friends.listFriends,
      {}
    )

    const brunoEntry = friends.find((f) => f.userId === brunoId)
    const carlaEntry = friends.find((f) => f.userId === carlaId)
    expect(brunoEntry?.online).toBe(true)
    expect(carlaEntry?.online).toBe(false)
  })

  test('amigo sem nenhum registro em presence aparece offline', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const brunoId = await insertUser(t, 'workos_bruno', 'bruno', '0002')
    const [userA, userB] = anaId < brunoId ? [anaId, brunoId] : [brunoId, anaId]
    await t.run((ctx) => ctx.db.insert('friendships', { userA, userB, createdAt: Date.now() }))

    const asAna = t.withIdentity({ subject: 'workos_ana' })
    const friends = await asAna.query(anyApi.friends.listFriends, {})
    expect(friends).toHaveLength(1)
    expect(friends[0].online).toBe(false)
  })
})

describe('friends.listIncomingFriendRequests', () => {
  test('rejeita sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')

    await expect(t.query(anyApi.friends.listIncomingFriendRequests, {})).rejects.toThrow()
  })

  test('retorna só os pedidos onde eu sou o destinatário, nunca os que eu enviei', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')
    await insertUser(t, 'workos_bruno', 'bruno', '0002')
    const carlaId = await insertUser(t, 'workos_carla', 'carla', '0003')

    const asAna = t.withIdentity({ subject: 'workos_ana' })
    const asCarla = t.withIdentity({ subject: 'workos_carla' })

    // Ana envia um pedido para Bruno (não deve aparecer na lista de Ana).
    await asAna.mutation(anyApi.friends.sendFriendRequest, { username: 'bruno', tag: '0002' })
    // Carla envia um pedido para Ana (deve aparecer na lista de Ana).
    await asCarla.mutation(anyApi.friends.sendFriendRequest, { username: 'ana', tag: '0001' })

    const incoming = await asAna.query(anyApi.friends.listIncomingFriendRequests, {})
    expect(incoming).toHaveLength(1)
    expect(incoming[0].fromUserId).toBe(carlaId)
    expect(incoming[0].username).toBe('carla')
  })
})

describe('friends.removeFriendship', () => {
  test('rejeita sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')

    await expect(
      t.mutation(anyApi.friends.removeFriendship, { friendUserId: anaId })
    ).rejects.toThrow()
  })

  test('friendUserId que não é amigo lança erro, nenhuma escrita acontece', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t, 'workos_ana', 'ana', '0001')
    const brunoId = await insertUser(t, 'workos_bruno', 'bruno', '0002')

    const asAna = t.withIdentity({ subject: 'workos_ana' })

    await expect(
      asAna.mutation(anyApi.friends.removeFriendship, { friendUserId: brunoId })
    ).rejects.toThrow(/não são amigos/i)

    const friendships = await t.run((ctx) => ctx.db.query('friendships').collect())
    expect(friendships).toHaveLength(0)
  })

  test('AUTORIZAÇÃO: terceiro usuário não consegue remover amizade alheia', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const brunoId = await insertUser(t, 'workos_bruno', 'bruno', '0002')
    await insertUser(t, 'workos_carla', 'carla', '0003')
    const [userA, userB] = anaId < brunoId ? [anaId, brunoId] : [brunoId, anaId]
    await t.run((ctx) => ctx.db.insert('friendships', { userA, userB, createdAt: Date.now() }))

    const asCarla = t.withIdentity({ subject: 'workos_carla' })

    // Carla passando o id de Ana ou Bruno não forma o par canônico dela com
    // nenhum dos dois — a amizade continua intacta.
    await expect(
      asCarla.mutation(anyApi.friends.removeFriendship, { friendUserId: anaId })
    ).rejects.toThrow(/não são amigos/i)
    await expect(
      asCarla.mutation(anyApi.friends.removeFriendship, { friendUserId: brunoId })
    ).rejects.toThrow(/não são amigos/i)

    const friendships = await t.run((ctx) => ctx.db.query('friendships').collect())
    expect(friendships).toHaveLength(1)
  })

  test('amizade existente é removida chamada por qualquer um dos dois lados (bidirecional)', async () => {
    // Lado A: Ana remove.
    const t1 = convexTest(schema, modules)
    const anaId1 = await insertUser(t1, 'workos_ana', 'ana', '0001')
    const brunoId1 = await insertUser(t1, 'workos_bruno', 'bruno', '0002')
    const [userA1, userB1] = anaId1 < brunoId1 ? [anaId1, brunoId1] : [brunoId1, anaId1]
    await t1.run((ctx) =>
      ctx.db.insert('friendships', { userA: userA1, userB: userB1, createdAt: Date.now() })
    )
    const asAna1 = t1.withIdentity({ subject: 'workos_ana' })
    const asBruno1 = t1.withIdentity({ subject: 'workos_bruno' })

    await asAna1.mutation(anyApi.friends.removeFriendship, { friendUserId: brunoId1 })

    const friendshipsAfter1 = await t1.run((ctx) => ctx.db.query('friendships').collect())
    expect(friendshipsAfter1).toHaveLength(0)
    expect(await asAna1.query(anyApi.friends.listFriends, {})).toHaveLength(0)
    expect(await asBruno1.query(anyApi.friends.listFriends, {})).toHaveLength(0)

    // Lado B: Bruno remove.
    const t2 = convexTest(schema, modules)
    const anaId2 = await insertUser(t2, 'workos_ana', 'ana', '0001')
    const brunoId2 = await insertUser(t2, 'workos_bruno', 'bruno', '0002')
    const [userA2, userB2] = anaId2 < brunoId2 ? [anaId2, brunoId2] : [brunoId2, anaId2]
    await t2.run((ctx) =>
      ctx.db.insert('friendships', { userA: userA2, userB: userB2, createdAt: Date.now() })
    )
    const asAna2 = t2.withIdentity({ subject: 'workos_ana' })
    const asBruno2 = t2.withIdentity({ subject: 'workos_bruno' })

    await asBruno2.mutation(anyApi.friends.removeFriendship, { friendUserId: anaId2 })

    const friendshipsAfter2 = await t2.run((ctx) => ctx.db.query('friendships').collect())
    expect(friendshipsAfter2).toHaveLength(0)
    expect(await asAna2.query(anyApi.friends.listFriends, {})).toHaveLength(0)
    expect(await asBruno2.query(anyApi.friends.listFriends, {})).toHaveLength(0)
  })
})
