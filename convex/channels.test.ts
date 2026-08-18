import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import type { Doc, Id } from './_generated/dataModel'

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

async function createServerWithOwner(t: ReturnType<typeof convexTest>, ownerWorkosId: string) {
  const asOwner = t.withIdentity({ subject: ownerWorkosId })
  const serverId: Id<'servers'> = await asOwner.mutation(anyApi.servers.createServer, {
    name: 'Galera do Sinuca',
  })
  return { serverId, asOwner }
}

describe('channels.createChannel', () => {
  test('membro cria canal de texto e canal de voz, em posições sequenciais', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const { serverId, asOwner } = await createServerWithOwner(t, workosId)

    const textChannelId: Id<'channels'> = await asOwner.mutation(anyApi.channels.createChannel, {
      serverId,
      name: 'geral',
      type: 'text',
    })
    const voiceChannelId: Id<'channels'> = await asOwner.mutation(
      anyApi.channels.createChannel,
      {
        serverId,
        name: 'Sala de voz',
        type: 'voice',
      }
    )

    const textChannel = await t.run((ctx) => ctx.db.get(textChannelId))
    const voiceChannel = await t.run((ctx) => ctx.db.get(voiceChannelId))

    expect(textChannel).not.toBeNull()
    expect(textChannel?.type).toBe('text')
    expect(textChannel?.position).toBe(0)

    expect(voiceChannel).not.toBeNull()
    expect(voiceChannel?.type).toBe('voice')
    expect(voiceChannel?.position).toBe(1)
  })

  test('rejeita nome vazio ou só espaços', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const { serverId, asOwner } = await createServerWithOwner(t, workosId)

    await expect(
      asOwner.mutation(anyApi.channels.createChannel, { serverId, name: '', type: 'text' })
    ).rejects.toThrow()
    await expect(
      asOwner.mutation(anyApi.channels.createChannel, { serverId, name: '   ', type: 'text' })
    ).rejects.toThrow()
  })

  test('rejeita nome com mais de 50 caracteres', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const { serverId, asOwner } = await createServerWithOwner(t, workosId)

    const tooLong = 'a'.repeat(51)
    await expect(
      asOwner.mutation(anyApi.channels.createChannel, { serverId, name: tooLong, type: 'text' })
    ).rejects.toThrow()
  })

  test('SRV-06: não-membro não consegue criar canal em um servidor do qual não participa', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const carlaWorkosId = 'workos_user_carla'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { serverId } = await createServerWithOwner(t, anaWorkosId)

    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.mutation(anyApi.channels.createChannel, { serverId, name: 'geral', type: 'text' })
    ).rejects.toThrow()

    const channels = await t.run((ctx) => ctx.db.query('channels').collect())
    expect(channels).toHaveLength(0)
  })
})

describe('channels.listChannels', () => {
  test('lista canais de um servidor ordenados por position crescente', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const { serverId, asOwner } = await createServerWithOwner(t, workosId)

    const firstId = await asOwner.mutation(anyApi.channels.createChannel, {
      serverId,
      name: 'primeiro',
      type: 'text',
    })
    const secondId = await asOwner.mutation(anyApi.channels.createChannel, {
      serverId,
      name: 'segundo',
      type: 'voice',
    })
    const thirdId = await asOwner.mutation(anyApi.channels.createChannel, {
      serverId,
      name: 'terceiro',
      type: 'text',
    })

    const list: Doc<'channels'>[] = await asOwner.query(anyApi.channels.listChannels, {
      serverId,
    })

    expect(list.map((c) => c._id)).toEqual([firstId, secondId, thirdId])
  })

  test('canais de outro servidor não aparecem na lista', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const brunoWorkosId = 'workos_user_bruno'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    await insertUser(t, brunoWorkosId, 'bruno', '0002')

    const { serverId: serverAId, asOwner: asAna } = await createServerWithOwner(t, anaWorkosId)
    const { serverId: serverBId, asOwner: asBruno } = await createServerWithOwner(
      t,
      brunoWorkosId
    )

    await asAna.mutation(anyApi.channels.createChannel, {
      serverId: serverAId,
      name: 'canal-a',
      type: 'text',
    })
    await asBruno.mutation(anyApi.channels.createChannel, {
      serverId: serverBId,
      name: 'canal-b',
      type: 'text',
    })

    const listA = await asAna.query(anyApi.channels.listChannels, { serverId: serverAId })
    expect(listA).toHaveLength(1)
    expect(listA[0].name).toBe('canal-a')
  })

  test('SRV-06: não-membro não consegue listar canais de um servidor do qual não participa', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const carlaWorkosId = 'workos_user_carla'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { serverId, asOwner } = await createServerWithOwner(t, anaWorkosId)

    await asOwner.mutation(anyApi.channels.createChannel, {
      serverId,
      name: 'geral',
      type: 'text',
    })

    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(asCarla.query(anyApi.channels.listChannels, { serverId })).rejects.toThrow()
  })
})

describe('channels.getChannel', () => {
  test('membro busca canal existente e recebe seus dados', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const { serverId, asOwner } = await createServerWithOwner(t, workosId)

    const channelId = await asOwner.mutation(anyApi.channels.createChannel, {
      serverId,
      name: 'geral',
      type: 'text',
    })

    const channel = await asOwner.query(anyApi.channels.getChannel, { channelId })
    expect(channel).not.toBeNull()
    expect(channel?.name).toBe('geral')
    expect(channel?.type).toBe('text')
  })

  test('retorna null para channelId inexistente, sem lançar', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const { serverId, asOwner } = await createServerWithOwner(t, workosId)

    const channelId = await asOwner.mutation(anyApi.channels.createChannel, {
      serverId,
      name: 'geral',
      type: 'text',
    })
    await t.run((ctx) => ctx.db.delete(channelId))

    const channel = await asOwner.query(anyApi.channels.getChannel, { channelId })
    expect(channel).toBeNull()
  })

  test('SRV-06: não-membro chamando getChannel de um canal real recebe rejeição, não null nem os dados', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const carlaWorkosId = 'workos_user_carla'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { serverId, asOwner } = await createServerWithOwner(t, anaWorkosId)

    const channelId = await asOwner.mutation(anyApi.channels.createChannel, {
      serverId,
      name: 'geral',
      type: 'text',
    })

    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(asCarla.query(anyApi.channels.getChannel, { channelId })).rejects.toThrow()
  })
})
