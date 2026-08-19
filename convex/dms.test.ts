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
      displayName: username,
    })
  )
}

// Insere a amizade diretamente via t.run, em ordem canônica (userA < userB),
// mesmo padrão descrito em 06-RESEARCH.md §2 — não depende de convex/friends.ts
// (plano 06-02), mantendo os dois arquivos de teste independentes.
async function insertFriendship(
  t: ReturnType<typeof convexTest>,
  userIdA: Id<'users'>,
  userIdB: Id<'users'>
) {
  const [userA, userB] = [userIdA, userIdB].sort()
  return t.run((ctx) =>
    ctx.db.insert('friendships', {
      userA,
      userB,
      createdAt: Date.now(),
    })
  )
}

describe('dms.getOrCreateDmChannel', () => {
  test('rejeita chamada sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')

    await expect(
      t.mutation(anyApi.dms.getOrCreateDmChannel, { friendUserId: anaId })
    ).rejects.toThrow()
  })

  test('rejeita par que não é amigo — nenhum canal é criado', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const brunoWorkosId = 'workos_bruno'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await expect(
      asAna.mutation(anyApi.dms.getOrCreateDmChannel, { friendUserId: brunoId })
    ).rejects.toThrow()

    const channels = await t.run((ctx) => ctx.db.query('dmChannels').collect())
    expect(channels).toHaveLength(0)
  })

  test('primeira chamada entre amigos cria exatamente 1 canal e 2 membros', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const brunoWorkosId = 'workos_bruno'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    await insertFriendship(t, anaId, brunoId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    const dmChannelId = await asAna.mutation(anyApi.dms.getOrCreateDmChannel, {
      friendUserId: brunoId,
    })

    expect(dmChannelId).toBeDefined()

    const channels = await t.run((ctx) => ctx.db.query('dmChannels').collect())
    expect(channels).toHaveLength(1)
    expect(channels[0]._id).toBe(dmChannelId)

    const members = await t.run((ctx) => ctx.db.query('dmMembers').collect())
    expect(members).toHaveLength(2)
    const memberUserIds = members.map((m) => m.userId).sort()
    expect(memberUserIds).toEqual([anaId, brunoId].sort())
    for (const member of members) {
      expect(member.dmChannelId).toBe(dmChannelId)
    }
  })

  test('chamar repetidamente com o mesmo par nunca cria um segundo canal', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const brunoWorkosId = 'workos_bruno'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    await insertFriendship(t, anaId, brunoId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    const first = await asAna.mutation(anyApi.dms.getOrCreateDmChannel, {
      friendUserId: brunoId,
    })
    const second = await asAna.mutation(anyApi.dms.getOrCreateDmChannel, {
      friendUserId: brunoId,
    })

    expect(second).toBe(first)

    const channels = await t.run((ctx) => ctx.db.query('dmChannels').collect())
    expect(channels).toHaveLength(1)
    const members = await t.run((ctx) => ctx.db.query('dmMembers').collect())
    expect(members).toHaveLength(2)
  })

  test('chamado pelo outro lado do par encontra o mesmo canal — não duplica', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const brunoWorkosId = 'workos_bruno'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    await insertFriendship(t, anaId, brunoId)
    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asBruno = t.withIdentity({ subject: brunoWorkosId })

    const anaOpens = await asAna.mutation(anyApi.dms.getOrCreateDmChannel, {
      friendUserId: brunoId,
    })
    const brunoOpens = await asBruno.mutation(anyApi.dms.getOrCreateDmChannel, {
      friendUserId: anaId,
    })

    expect(brunoOpens).toBe(anaOpens)

    const channels = await t.run((ctx) => ctx.db.query('dmChannels').collect())
    expect(channels).toHaveLength(1)
    const members = await t.run((ctx) => ctx.db.query('dmMembers').collect())
    expect(members).toHaveLength(2)
  })
})

describe('dms.sendDmMessage', () => {
  async function setupChannelWithMembers(t: ReturnType<typeof convexTest>) {
    const anaWorkosId = 'workos_ana'
    const brunoWorkosId = 'workos_bruno'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    await insertFriendship(t, anaId, brunoId)
    const asAna = t.withIdentity({ subject: anaWorkosId })
    const dmChannelId: Id<'dmChannels'> = await asAna.mutation(
      anyApi.dms.getOrCreateDmChannel,
      { friendUserId: brunoId }
    )
    return { anaId, brunoId, anaWorkosId, brunoWorkosId, dmChannelId }
  }

  test('rejeita envio sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    const { dmChannelId } = await setupChannelWithMembers(t)

    await expect(
      t.mutation(anyApi.dms.sendDmMessage, { dmChannelId, content: 'oi' })
    ).rejects.toThrow()
  })

  test('membro válido envia mensagem — aparece com authorId correto', async () => {
    const t = convexTest(schema, modules)
    const { anaId, anaWorkosId, dmChannelId } = await setupChannelWithMembers(t)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await asAna.mutation(anyApi.dms.sendDmMessage, {
      dmChannelId,
      content: 'Oi, tudo bem?',
    })

    const messages = await t.run((ctx) => ctx.db.query('dmMessages').collect())
    expect(messages).toHaveLength(1)
    expect(messages[0].authorId).toBe(anaId)
    expect(messages[0].content).toBe('Oi, tudo bem?')
    expect(messages[0].dmChannelId).toBe(dmChannelId)
  })

  test('o outro membro do canal também consegue enviar mensagem', async () => {
    const t = convexTest(schema, modules)
    const { brunoId, brunoWorkosId, dmChannelId } = await setupChannelWithMembers(t)
    const asBruno = t.withIdentity({ subject: brunoWorkosId })

    await asBruno.mutation(anyApi.dms.sendDmMessage, {
      dmChannelId,
      content: 'Opa!',
    })

    const messages = await t.run((ctx) => ctx.db.query('dmMessages').collect())
    expect(messages).toHaveLength(1)
    expect(messages[0].authorId).toBe(brunoId)
  })

  test('não-membro não consegue enviar mensagem, mesmo sabendo o dmChannelId', async () => {
    const t = convexTest(schema, modules)
    const { dmChannelId } = await setupChannelWithMembers(t)
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.mutation(anyApi.dms.sendDmMessage, { dmChannelId, content: 'intrusa' })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('dmMessages').collect())
    expect(messages).toHaveLength(0)
  })

  test('rejeita conteúdo vazio ou só espaços — nenhuma mensagem inserida', async () => {
    const t = convexTest(schema, modules)
    const { anaWorkosId, dmChannelId } = await setupChannelWithMembers(t)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await expect(
      asAna.mutation(anyApi.dms.sendDmMessage, { dmChannelId, content: '' })
    ).rejects.toThrow()
    await expect(
      asAna.mutation(anyApi.dms.sendDmMessage, { dmChannelId, content: '   ' })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('dmMessages').collect())
    expect(messages).toHaveLength(0)
  })
})

describe('dms.listMyDmChannels', () => {
  test('usuário sem nenhuma conversa vê lista vazia, sem erro', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: anaWorkosId })

    const result = await asAna.query(anyApi.dms.listMyDmChannels, {})
    expect(result).toEqual([])
  })

  test('usuário com 2 conversas diretas vê as 2, cada uma com o otherUser correto', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const brunoWorkosId = 'workos_bruno'
    const carlaWorkosId = 'workos_carla'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    const carlaId = await insertUser(t, carlaWorkosId, 'carla', '0003')

    // Seed direto via t.run: 2 dmChannels + 4 dmMembers (ana-bruno, ana-carla).
    const channelAnaBruno = await t.run((ctx) => ctx.db.insert('dmChannels', { createdAt: Date.now() }))
    await t.run((ctx) => ctx.db.insert('dmMembers', { dmChannelId: channelAnaBruno, userId: anaId }))
    await t.run((ctx) => ctx.db.insert('dmMembers', { dmChannelId: channelAnaBruno, userId: brunoId }))

    const channelAnaCarla = await t.run((ctx) => ctx.db.insert('dmChannels', { createdAt: Date.now() }))
    await t.run((ctx) => ctx.db.insert('dmMembers', { dmChannelId: channelAnaCarla, userId: anaId }))
    await t.run((ctx) => ctx.db.insert('dmMembers', { dmChannelId: channelAnaCarla, userId: carlaId }))

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const result: Array<{
      dmChannelId: Id<'dmChannels'>
      otherUser: {
        userId: Id<'users'>
        username: string
        tag: string
        displayName: string
        avatarUrl?: string
      } | null
    }> = await asAna.query(anyApi.dms.listMyDmChannels, {})

    expect(result).toHaveLength(2)
    const byChannel = new Map(result.map((r) => [r.dmChannelId, r.otherUser]))
    expect(byChannel.get(channelAnaBruno)?.userId).toBe(brunoId)
    expect(byChannel.get(channelAnaBruno)?.username).toBe('bruno')
    expect(byChannel.get(channelAnaCarla)?.userId).toBe(carlaId)
    expect(byChannel.get(channelAnaCarla)?.username).toBe('carla')
  })
})

describe('dms.listDmMessages', () => {
  async function setupChannelWithMembers(t: ReturnType<typeof convexTest>) {
    const anaWorkosId = 'workos_ana'
    const brunoWorkosId = 'workos_bruno'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    await insertFriendship(t, anaId, brunoId)
    const asAna = t.withIdentity({ subject: anaWorkosId })
    const dmChannelId: Id<'dmChannels'> = await asAna.mutation(
      anyApi.dms.getOrCreateDmChannel,
      { friendUserId: brunoId }
    )
    return { anaId, brunoId, anaWorkosId, brunoWorkosId, dmChannelId }
  }

  test('rejeita chamada sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    const { dmChannelId } = await setupChannelWithMembers(t)

    await expect(
      t.query(anyApi.dms.listDmMessages, {
        dmChannelId,
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).rejects.toThrow()
  })

  test('não-membro é rejeitado antes de qualquer paginação, mesmo sabendo o dmChannelId', async () => {
    const t = convexTest(schema, modules)
    const { dmChannelId } = await setupChannelWithMembers(t)
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.query(anyApi.dms.listDmMessages, {
        dmChannelId,
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).rejects.toThrow()
  })

  test('membro do canal recebe as mensagens paginadas, mais recente primeiro', async () => {
    const t = convexTest(schema, modules)
    const { anaId, brunoId, anaWorkosId, dmChannelId } = await setupChannelWithMembers(t)

    await t.run((ctx) =>
      ctx.db.insert('dmMessages', {
        dmChannelId,
        authorId: anaId,
        content: 'primeira',
        createdAt: Date.now(),
      })
    )
    await t.run((ctx) =>
      ctx.db.insert('dmMessages', {
        dmChannelId,
        authorId: brunoId,
        content: 'segunda',
        createdAt: Date.now(),
      })
    )
    await t.run((ctx) =>
      ctx.db.insert('dmMessages', {
        dmChannelId,
        authorId: anaId,
        content: 'terceira',
        createdAt: Date.now(),
      })
    )

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const page = await asAna.query(anyApi.dms.listDmMessages, {
      dmChannelId,
      paginationOpts: { numItems: 2, cursor: null },
    })

    expect(page.page).toHaveLength(2)
    expect(page.isDone).toBe(false)
    expect(page.page[0].content).toBe('terceira')
    expect(page.page[1].content).toBe('segunda')
  })
})
