import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { AccessToken } from 'livekit-server-sdk'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import type { Doc, Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

// --- Spike (07-RESEARCH.md §1): confirma que livekit-server-sdk assina um JWT
// via jose/Web Crypto sem precisar de "use node" no runtime padrão do Convex.
// Roda fora de qualquer convexTest — é só a lib em isolamento, provando que o
// import por si só e a assinatura funcionam no mesmo ambiente edge-runtime
// (vitest.config.ts) usado pelos testes das actions.
describe('spike: livekit-server-sdk roda sem "use node"', () => {
  test('AccessToken assina e produz um JWT decodificável', async () => {
    const token = new AccessToken('fake-api-key', 'fake-api-secret-fake-api-secret', {
      identity: 'user_abc123',
      ttl: '10m'
    })
    token.addGrant({ room: 'channel_xyz', roomJoin: true, canPublish: true, canSubscribe: true })

    const jwt = await token.toJwt()

    expect(typeof jwt).toBe('string')
    expect(jwt.length).toBeGreaterThan(0)
    expect(jwt.split('.')).toHaveLength(3)

    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))
    expect(payload.sub).toBe('user_abc123')
    expect(payload.video.room).toBe('channel_xyz')
  })
})

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

async function insertServerWithChannel(
  t: ReturnType<typeof convexTest>,
  ownerId: Id<'users'>,
  channelType: 'text' | 'voice' = 'voice'
) {
  const serverId = await t.run((ctx) =>
    ctx.db.insert('servers', { name: 'Galera do Sinuca', ownerId })
  )
  await t.run((ctx) =>
    ctx.db.insert('serverMembers', { serverId, userId: ownerId, joinedAt: Date.now() })
  )
  const channelId = await t.run((ctx) =>
    ctx.db.insert('channels', { serverId, name: 'geral', type: channelType, position: 0 })
  )
  return { serverId, channelId }
}

async function addMember(
  t: ReturnType<typeof convexTest>,
  serverId: Id<'servers'>,
  userId: Id<'users'>
) {
  return t.run((ctx) => ctx.db.insert('serverMembers', { serverId, userId, joinedAt: Date.now() }))
}

const LIVEKIT_ENV = {
  LIVEKIT_API_KEY: 'fake-api-key',
  LIVEKIT_API_SECRET: 'fake-api-secret-fake-api-secret',
  LIVEKIT_URL: 'wss://livekit.usesenju.com'
}

function withLiveKitEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = {
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
    LIVEKIT_URL: process.env.LIVEKIT_URL
  }
  Object.assign(process.env, LIVEKIT_ENV)
  return fn().finally(() => {
    process.env.LIVEKIT_API_KEY = previous.LIVEKIT_API_KEY
    process.env.LIVEKIT_API_SECRET = previous.LIVEKIT_API_SECRET
    process.env.LIVEKIT_URL = previous.LIVEKIT_URL
  })
}

describe('voice.joinVoiceChannel — rejeições', () => {
  test('rejeita sem identidade autenticada, nenhuma linha em voiceStates', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)

      await expect(t.action(anyApi.voiceToken.joinVoiceChannel, { channelId })).rejects.toThrow()

      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    })
  })

  test('rejeita identidade sem documento users, nenhuma linha em voiceStates', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)
      const asGhost = t.withIdentity({ subject: 'workos_sem_documento' })

      await expect(
        asGhost.action(anyApi.voiceToken.joinVoiceChannel, { channelId })
      ).rejects.toThrow()

      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    })
  })

  test('rejeita canal inexistente', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaWorkosId = 'workos_ana'
      const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)
      await t.run((ctx) => ctx.db.delete(channelId))
      const asAna = t.withIdentity({ subject: anaWorkosId })

      await expect(
        asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId })
      ).rejects.toThrow()

      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    })
  })

  test('rejeita canal do tipo text', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaWorkosId = 'workos_ana'
      const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId, 'text')
      const asAna = t.withIdentity({ subject: anaWorkosId })

      await expect(
        asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId })
      ).rejects.toThrow()

      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    })
  })

  test('rejeita não-membro do servidor dono do canal', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
      const carlaWorkosId = 'workos_carla'
      await insertUser(t, carlaWorkosId, 'carla', '0003')
      const { channelId } = await insertServerWithChannel(t, anaId)
      const asCarla = t.withIdentity({ subject: carlaWorkosId })

      await expect(
        asCarla.action(anyApi.voiceToken.joinVoiceChannel, { channelId })
      ).rejects.toThrow()

      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    })
  })

  test('sem LIVEKIT_API_KEY/SECRET/URL configurados, lança erro explícito', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    const previous = {
      LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
      LIVEKIT_URL: process.env.LIVEKIT_URL
    }
    delete process.env.LIVEKIT_API_KEY
    delete process.env.LIVEKIT_API_SECRET
    delete process.env.LIVEKIT_URL

    try {
      await expect(asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId })).rejects.toThrow(
        /LiveKit não configurado/
      )

      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    } finally {
      if (previous.LIVEKIT_API_KEY !== undefined)
        process.env.LIVEKIT_API_KEY = previous.LIVEKIT_API_KEY
      if (previous.LIVEKIT_API_SECRET !== undefined)
        process.env.LIVEKIT_API_SECRET = previous.LIVEKIT_API_SECRET
      if (previous.LIVEKIT_URL !== undefined) process.env.LIVEKIT_URL = previous.LIVEKIT_URL
    }
  })
})

describe('voice.joinVoiceChannel — sucesso', () => {
  test('membro autorizado recebe token escopado à sala e ganha uma linha em voiceStates', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaWorkosId = 'workos_ana'
      const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)
      const asAna = t.withIdentity({ subject: anaWorkosId })

      const result = await asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId })

      expect(result.token).toBeTruthy()
      expect(result.url).toBe(LIVEKIT_ENV.LIVEKIT_URL)

      const payload = JSON.parse(
        Buffer.from(result.token.split('.')[1], 'base64url').toString('utf8')
      )
      expect(payload.video.room).toBe(channelId)
      expect(payload.sub).toBe(anaId)

      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(1)
      expect(rows[0].channelId).toBe(channelId)
      expect(rows[0].userId).toBe(anaId)
      expect(rows[0].muted).toBe(false)
      expect(rows[0].deafened).toBe(false)
      expect(rows[0].sharing).toBe(false)
    })
  })

  test('join duas vezes seguidas para o mesmo usuário/canal produz exatamente uma linha', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaWorkosId = 'workos_ana'
      await insertUser(t, anaWorkosId, 'ana', '0001')
      const anaId = (await t.run((ctx) => ctx.db.query('users').collect()))[0]._id
      const { channelId } = await insertServerWithChannel(t, anaId)
      const asAna = t.withIdentity({ subject: anaWorkosId })

      await asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId })
      await asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId })

      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(1)
    })
  })

  test('join não reseta muted/deafened de uma sessão anterior no mesmo canal', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaWorkosId = 'workos_ana'
      const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)
      const asAna = t.withIdentity({ subject: anaWorkosId })

      await asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId })
      await asAna.mutation(anyApi.voice.setMuted, { muted: true })
      await asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId })

      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(1)
      expect(rows[0].muted).toBe(true)
    })
  })
})

describe('voiceToken.mintMicTestTokens (Plano 07-09: testador de microfone)', () => {
  test('assina dois tokens com identities distintos, para a MESMA sala, sem tocar em channels/voiceStates', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaWorkosId = 'workos_ana'
      const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
      const asAna = t.withIdentity({ subject: anaWorkosId })

      const result = await asAna.action(anyApi.voiceToken.mintMicTestTokens, {})

      expect(result.url).toBe(LIVEKIT_ENV.LIVEKIT_URL)
      expect(result.publisherToken).not.toBe(result.subscriberToken)

      const publisherPayload = JSON.parse(
        Buffer.from(result.publisherToken.split('.')[1], 'base64url').toString('utf8')
      )
      const subscriberPayload = JSON.parse(
        Buffer.from(result.subscriberToken.split('.')[1], 'base64url').toString('utf8')
      )

      // Mesma sala efêmera para as duas conexões...
      expect(publisherPayload.video.room).toBe(result.roomName)
      expect(subscriberPayload.video.room).toBe(result.roomName)
      // ...mas identities DIFERENTES da mesma pessoa — é o que impede o LiveKit de
      // derrubar a primeira conexão assim que a segunda entrar (dedup de identity).
      expect(publisherPayload.sub).not.toBe(subscriberPayload.sub)
      expect(publisherPayload.sub).toContain(anaId)
      expect(subscriberPayload.sub).toContain(anaId)

      // Nunca uma sala de canal real, e nunca uma linha em voiceStates — o teste de
      // microfone nunca aparece para o resto do grupo.
      expect(result.roomName).not.toBe(anaId)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    })
  })

  test('rejeita sem identidade autenticada', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      await expect(t.action(anyApi.voiceToken.mintMicTestTokens, {})).rejects.toThrow()
    })
  })

  test('duas chamadas seguidas produzem salas efêmeras diferentes', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaWorkosId = 'workos_ana'
      await insertUser(t, anaWorkosId, 'ana', '0001')
      const asAna = t.withIdentity({ subject: anaWorkosId })

      const first = await asAna.action(anyApi.voiceToken.mintMicTestTokens, {})
      const second = await asAna.action(anyApi.voiceToken.mintMicTestTokens, {})

      expect(first.roomName).not.toBe(second.roomName)
    })
  })
})

describe('voice.leaveVoiceChannel', () => {
  test('remove a própria linha de voiceStates', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaWorkosId = 'workos_ana'
      const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)
      const asAna = t.withIdentity({ subject: anaWorkosId })

      await asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId })
      await asAna.mutation(anyApi.voice.leaveVoiceChannel, {})

      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    })
  })

  test('idempotente: chamar sem nunca ter entrado em canal nenhum não lança', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await expect(asAna.mutation(anyApi.voice.leaveVoiceChannel, {})).resolves.not.toThrow()

    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    expect(rows).toHaveLength(0)
  })

  test('rejeita sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    await expect(t.mutation(anyApi.voice.leaveVoiceChannel, {})).rejects.toThrow()
  })
})

describe('voice.setMuted / voice.setDeafened — semântica', () => {
  async function joinedAna() {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })
    await withLiveKitEnv(() => asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId }))
    return { t, asAna, anaId, channelId }
  }

  async function currentState(t: ReturnType<typeof convexTest>): Promise<Doc<'voiceStates'>> {
    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    return rows[0]
  }

  test('setDeafened(true) seta deafened e muted juntos', async () => {
    const { t, asAna } = await joinedAna()

    await asAna.mutation(anyApi.voice.setDeafened, { deafened: true })

    const state = await currentState(t)
    expect(state.deafened).toBe(true)
    expect(state.muted).toBe(true)
  })

  test('setMuted(false) enquanto ensurdecido também remove o ensurdecimento', async () => {
    const { t, asAna } = await joinedAna()

    await asAna.mutation(anyApi.voice.setDeafened, { deafened: true })
    await asAna.mutation(anyApi.voice.setMuted, { muted: false })

    const state = await currentState(t)
    expect(state.muted).toBe(false)
    expect(state.deafened).toBe(false)
  })

  test('setMuted(true) isolado não mexe em deafened', async () => {
    const { t, asAna } = await joinedAna()

    await asAna.mutation(anyApi.voice.setMuted, { muted: true })

    const state = await currentState(t)
    expect(state.muted).toBe(true)
    expect(state.deafened).toBe(false)
  })

  test('setDeafened(false) isolado não mexe em muted', async () => {
    const { t, asAna } = await joinedAna()

    await asAna.mutation(anyApi.voice.setMuted, { muted: true })
    await asAna.mutation(anyApi.voice.setDeafened, { deafened: false })

    const state = await currentState(t)
    expect(state.muted).toBe(true)
    expect(state.deafened).toBe(false)
  })

  test('setMuted sem estar em nenhum canal lança erro', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await expect(asAna.mutation(anyApi.voice.setMuted, { muted: true })).rejects.toThrow()
  })

  test('setDeafened sem estar em nenhum canal lança erro', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await expect(asAna.mutation(anyApi.voice.setDeafened, { deafened: true })).rejects.toThrow()
  })
})

// --- SHARE-05 (Plano 08-01): `sharing` deixa de ser sempre `false` e passa a ser
// escrito de verdade. A regra que os testes abaixo travam: compartilhar tela só existe
// DENTRO de um canal de voz já conectado (design §6), então `setSharing` fora de canal
// é erro, nunca um upsert silencioso que criaria uma linha órfã de `voiceStates`.

describe('voice.setSharing', () => {
  async function joinedAna(): Promise<{
    t: ReturnType<typeof convexTest>
    asAna: ReturnType<ReturnType<typeof convexTest>['withIdentity']>
    anaId: Id<'users'>
    channelId: Id<'channels'>
  }> {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })
    await withLiveKitEnv(() => asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId }))
    return { t, asAna, anaId, channelId }
  }

  test('setSharing(true) marca sharing na própria linha, sem tocar em muted/deafened', async () => {
    const { t, asAna } = await joinedAna()

    await asAna.mutation(anyApi.voice.setSharing, { sharing: true })

    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].sharing).toBe(true)
    expect(rows[0].muted).toBe(false)
    expect(rows[0].deafened).toBe(false)
  })

  test('setSharing(false) desmarca sharing (parar de compartilhar pelo cliente)', async () => {
    const { t, asAna } = await joinedAna()

    await asAna.mutation(anyApi.voice.setSharing, { sharing: true })
    await asAna.mutation(anyApi.voice.setSharing, { sharing: false })

    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].sharing).toBe(false)
  })

  test('setSharing sem estar em nenhum canal de voz lança, e não cria linha nenhuma', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await expect(asAna.mutation(anyApi.voice.setSharing, { sharing: true })).rejects.toThrow(
      /canal de voz/i
    )

    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    expect(rows).toHaveLength(0)
  })

  test('setSharing sem identidade autenticada lança', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    await insertVoiceState(t, channelId, anaId)

    await expect(t.mutation(anyApi.voice.setSharing, { sharing: true })).rejects.toThrow()

    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    expect(rows[0].sharing).toBe(false)
  })

  test('setSharing só afeta a própria linha — a de outro participante do mesmo canal fica intacta', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { serverId, channelId } = await insertServerWithChannel(t, anaId)
    const biaId = await insertUser(t, 'workos_bia', 'bia', '0002')
    await addMember(t, serverId, biaId)
    await insertVoiceState(t, channelId, anaId)
    await insertVoiceState(t, channelId, biaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await asAna.mutation(anyApi.voice.setSharing, { sharing: true })

    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    expect(rows.find((row) => row.userId === anaId)?.sharing).toBe(true)
    expect(rows.find((row) => row.userId === biaId)?.sharing).toBe(false)
  })
})

// --- VOICE-04 / Pitfall 3 (PITFALLS.md): reconciliação de usuário-fantasma via
// webhook do LiveKit. Nada além disto apaga uma linha de `voiceStates` quando o app
// morre sem rodar `leaveVoiceChannel` (crash, Alt+F4, Windows Update, perda de rede).

async function insertVoiceState(
  t: ReturnType<typeof convexTest>,
  channelId: Id<'channels'>,
  userId: Id<'users'>
) {
  return t.run((ctx) =>
    ctx.db.insert('voiceStates', {
      channelId,
      userId,
      muted: false,
      deafened: false,
      sharing: false
    })
  )
}

describe('voice.reconcileParticipantLeft (internalMutation)', () => {
  test('remove a linha (channelId, userId) correspondente', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    await insertVoiceState(t, channelId, anaId)

    await t.mutation(anyApi.voice.reconcileParticipantLeft, { channelId, userId: anaId })

    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    expect(rows).toHaveLength(0)
  })

  test('idempotente: chamar duas vezes seguidas não lança e não afeta outras linhas', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaId = await insertUser(t, 'workos_carla', 'carla', '0003')
    const { serverId, channelId } = await insertServerWithChannel(t, anaId)
    await addMember(t, serverId, carlaId)
    await insertVoiceState(t, channelId, anaId)
    await insertVoiceState(t, channelId, carlaId)

    await t.mutation(anyApi.voice.reconcileParticipantLeft, { channelId, userId: anaId })
    await expect(
      t.mutation(anyApi.voice.reconcileParticipantLeft, { channelId, userId: anaId })
    ).resolves.not.toThrow()

    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe(carlaId)
  })
})

describe('voice.reconcileScreenShareStopped (internalMutation)', () => {
  test('zera sharing da linha (channelId, userId) SEM apagar a linha', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const stateId = await insertVoiceState(t, channelId, anaId)
    await t.run((ctx) => ctx.db.patch(stateId, { sharing: true, muted: true }))

    await t.mutation(anyApi.voice.reconcileScreenShareStopped, { channelId, userId: anaId })

    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    // A pessoa continua no canal de voz — só parou de compartilhar tela. Isto é o que
    // separa esta mutation de `reconcileParticipantLeft`, que apaga a linha inteira.
    expect(rows).toHaveLength(1)
    expect(rows[0].sharing).toBe(false)
    expect(rows[0].muted).toBe(true)
  })

  test('idempotente: chamar duas vezes seguidas não lança nem apaga a linha', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const stateId = await insertVoiceState(t, channelId, anaId)
    await t.run((ctx) => ctx.db.patch(stateId, { sharing: true }))

    await t.mutation(anyApi.voice.reconcileScreenShareStopped, { channelId, userId: anaId })
    await expect(
      t.mutation(anyApi.voice.reconcileScreenShareStopped, { channelId, userId: anaId })
    ).resolves.not.toThrow()

    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].sharing).toBe(false)
  })

  test('sem linha correspondente (pessoa já saiu do canal) não lança', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)

    await expect(
      t.mutation(anyApi.voice.reconcileScreenShareStopped, { channelId, userId: anaId })
    ).resolves.not.toThrow()

    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    expect(rows).toHaveLength(0)
  })

  test('nunca toca na linha de outro canal do mesmo usuário nem na de outro usuário', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const biaId = await insertUser(t, 'workos_bia', 'bia', '0002')
    const { serverId, channelId: channelA } = await insertServerWithChannel(t, anaId)
    const channelB = await t.run((ctx) =>
      ctx.db.insert('channels', { serverId, name: 'sala-2', type: 'voice', position: 1 })
    )
    const anaA = await insertVoiceState(t, channelA, anaId)
    const anaB = await insertVoiceState(t, channelB, anaId)
    const biaA = await insertVoiceState(t, channelA, biaId)
    await t.run(async (ctx) => {
      await ctx.db.patch(anaA, { sharing: true })
      await ctx.db.patch(anaB, { sharing: true })
      await ctx.db.patch(biaA, { sharing: true })
    })

    await t.mutation(anyApi.voice.reconcileScreenShareStopped, {
      channelId: channelA,
      userId: anaId
    })

    const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
    expect(rows).toHaveLength(3)
    expect(rows.find((row) => row._id === anaA)?.sharing).toBe(false)
    expect(rows.find((row) => row._id === anaB)?.sharing).toBe(true)
    expect(rows.find((row) => row._id === biaA)?.sharing).toBe(true)
  })
})

describe('voice.resolveAuthenticatedUserId (internalQuery)', () => {
  test('resolve o users._id do chamador autenticado, sem canal nenhum envolvido', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const asAna = t.withIdentity({ subject: 'workos_ana' })

    const result = await asAna.query(anyApi.voice.resolveAuthenticatedUserId, {})

    expect(result.userId).toBe(anaId)
  })

  test('lança sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)

    await expect(t.query(anyApi.voice.resolveAuthenticatedUserId, {})).rejects.toThrow()
  })
})

describe('voice.reconcileRoomFinished (internalMutation)', () => {
  test('remove todas as linhas do canal informado, preserva as de outro canal', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaId = await insertUser(t, 'workos_carla', 'carla', '0003')
    const beloId = await insertUser(t, 'workos_belo', 'belo', '0005')
    const danId = await insertUser(t, 'workos_dan', 'dan', '0007')
    const { serverId, channelId: channelA } = await insertServerWithChannel(t, anaId)
    await addMember(t, serverId, carlaId)
    await addMember(t, serverId, beloId)
    await addMember(t, serverId, danId)
    const channelB = await t.run((ctx) =>
      ctx.db.insert('channels', { serverId, name: 'outro-canal', type: 'voice', position: 1 })
    )
    await insertVoiceState(t, channelA, anaId)
    await insertVoiceState(t, channelA, carlaId)
    await insertVoiceState(t, channelA, beloId)
    await insertVoiceState(t, channelB, danId)

    await t.mutation(anyApi.voice.reconcileRoomFinished, { channelId: channelA })

    const remainingA = await t.run((ctx) =>
      ctx.db
        .query('voiceStates')
        .withIndex('by_channel', (q) => q.eq('channelId', channelA))
        .collect()
    )
    expect(remainingA).toHaveLength(0)

    const remainingB = await t.run((ctx) =>
      ctx.db
        .query('voiceStates')
        .withIndex('by_channel', (q) => q.eq('channelId', channelB))
        .collect()
    )
    expect(remainingB).toHaveLength(1)
    expect(remainingB[0].userId).toBe(danId)
  })

  test('canal sem nenhuma linha não lança', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)

    await expect(
      t.mutation(anyApi.voice.reconcileRoomFinished, { channelId })
    ).resolves.not.toThrow()
  })
})

/**
 * Constrói o header `Authorization` exatamente como o `livekit-server` real
 * constrói: um JWT HS256 (mesmo `AccessToken` do SDK, sem grant de vídeo) cujo claim
 * `sha256` é o hash SHA-256 em base64 do corpo bruto — o mesmo par (claim, hash) que
 * `WebhookReceiver.receive` decodifica e confere em `voiceToken.verifyLiveKitWebhook`.
 */
async function signWebhookAuthHeader(
  rawBody: string,
  apiKey: string,
  apiSecret: string
): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody))
  const hashBase64 = Buffer.from(new Uint8Array(hash)).toString('base64')
  const token = new AccessToken(apiKey, apiSecret, { ttl: '1m' })
  token.sha256 = hashBase64
  return token.toJwt()
}

function webhookBody(payload: {
  event: string
  room?: { name: string }
  participant?: { identity: string }
  // `source` vai como o NOME do enum protobuf ('SCREEN_SHARE', 'CAMERA', ...): é assim
  // que o livekit-server serializa `TrackSource` no JSON do webhook, e é o que
  // `WebhookReceiver.receive` volta a decodificar para o valor numérico do enum.
  track?: { sid?: string; source?: string }
}): string {
  return JSON.stringify(payload)
}

describe('POST /livekit/webhook — assinatura', () => {
  test('sem header Authorization, responde 401 e não altera voiceStates', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)
      await insertVoiceState(t, channelId, anaId)

      const rawBody = webhookBody({
        event: 'participant_left',
        room: { name: channelId },
        participant: { identity: anaId }
      })

      const response = await t.fetch('/livekit/webhook', { method: 'POST', body: rawBody })

      expect(response.status).toBe(401)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(1)
    })
  })

  test('assinatura inválida, responde 401 e não altera voiceStates', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)
      await insertVoiceState(t, channelId, anaId)

      const rawBody = webhookBody({
        event: 'participant_left',
        room: { name: channelId },
        participant: { identity: anaId }
      })

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: rawBody,
        headers: { Authorization: 'Bearer nao-e-um-jwt-assinado-de-verdade' }
      })

      expect(response.status).toBe(401)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(1)
    })
  })

  test('corpo re-serializado (mesmo JSON, espaçamento diferente) falha a verificação — prova que o handler usa o corpo bruto, não uma versão re-parseada', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)
      await insertVoiceState(t, channelId, anaId)

      const signedBody = webhookBody({
        event: 'participant_left',
        room: { name: channelId },
        participant: { identity: anaId }
      })
      // Mesmo conteúdo lógico, bytes diferentes (espaçamento) — a assinatura foi
      // calculada sobre `signedBody`, não sobre isto.
      const reserializedBody = JSON.stringify(JSON.parse(signedBody), null, 2)
      const authHeader = await signWebhookAuthHeader(
        signedBody,
        LIVEKIT_ENV.LIVEKIT_API_KEY,
        LIVEKIT_ENV.LIVEKIT_API_SECRET
      )

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: reserializedBody,
        headers: { Authorization: authHeader }
      })

      expect(response.status).toBe(401)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(1)
    })
  })

  test('sem LIVEKIT_API_KEY/LIVEKIT_API_SECRET configurados, responde 500 sem tentar validar', async () => {
    const t = convexTest(schema, modules)
    const previous = {
      key: process.env.LIVEKIT_API_KEY,
      secret: process.env.LIVEKIT_API_SECRET
    }
    delete process.env.LIVEKIT_API_KEY
    delete process.env.LIVEKIT_API_SECRET

    try {
      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: webhookBody({ event: 'room_finished', room: { name: 'nao-importa' } }),
        headers: { Authorization: 'qualquer-coisa' }
      })

      expect(response.status).toBe(500)
    } finally {
      if (previous.key !== undefined) process.env.LIVEKIT_API_KEY = previous.key
      if (previous.secret !== undefined) process.env.LIVEKIT_API_SECRET = previous.secret
    }
  })
})

describe('POST /livekit/webhook — roteamento por evento', () => {
  test('participant_left remove a linha correspondente', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)
      await insertVoiceState(t, channelId, anaId)

      const rawBody = webhookBody({
        event: 'participant_left',
        room: { name: channelId },
        participant: { identity: anaId }
      })
      const authHeader = await signWebhookAuthHeader(
        rawBody,
        LIVEKIT_ENV.LIVEKIT_API_KEY,
        LIVEKIT_ENV.LIVEKIT_API_SECRET
      )

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: rawBody,
        headers: { Authorization: authHeader }
      })

      expect(response.status).toBe(200)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    })
  })

  test('participant_connection_aborted remove a linha correspondente (caso crash/perda de rede)', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)
      await insertVoiceState(t, channelId, anaId)

      const rawBody = webhookBody({
        event: 'participant_connection_aborted',
        room: { name: channelId },
        participant: { identity: anaId }
      })
      const authHeader = await signWebhookAuthHeader(
        rawBody,
        LIVEKIT_ENV.LIVEKIT_API_KEY,
        LIVEKIT_ENV.LIVEKIT_API_SECRET
      )

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: rawBody,
        headers: { Authorization: authHeader }
      })

      expect(response.status).toBe(200)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    })
  })

  test('room_finished remove todas as linhas do canal, preserva outro canal', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
      const carlaId = await insertUser(t, 'workos_carla', 'carla', '0003')
      const danId = await insertUser(t, 'workos_dan', 'dan', '0007')
      const { serverId, channelId: channelA } = await insertServerWithChannel(t, anaId)
      await addMember(t, serverId, carlaId)
      await addMember(t, serverId, danId)
      const channelB = await t.run((ctx) =>
        ctx.db.insert('channels', { serverId, name: 'outro-canal', type: 'voice', position: 1 })
      )
      await insertVoiceState(t, channelA, anaId)
      await insertVoiceState(t, channelA, carlaId)
      await insertVoiceState(t, channelB, danId)

      const rawBody = webhookBody({ event: 'room_finished', room: { name: channelA } })
      const authHeader = await signWebhookAuthHeader(
        rawBody,
        LIVEKIT_ENV.LIVEKIT_API_KEY,
        LIVEKIT_ENV.LIVEKIT_API_SECRET
      )

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: rawBody,
        headers: { Authorization: authHeader }
      })

      expect(response.status).toBe(200)
      const remainingA = await t.run((ctx) =>
        ctx.db
          .query('voiceStates')
          .withIndex('by_channel', (q) => q.eq('channelId', channelA))
          .collect()
      )
      expect(remainingA).toHaveLength(0)
      const remainingB = await t.run((ctx) =>
        ctx.db
          .query('voiceStates')
          .withIndex('by_channel', (q) => q.eq('channelId', channelB))
          .collect()
      )
      expect(remainingB).toHaveLength(1)
    })
  })

  test('evento desconhecido responde 200 e não altera voiceStates (LiveKit reenvia com retry se não vir 2xx)', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)
      await insertVoiceState(t, channelId, anaId)

      // `egress_started`: evento real do LiveKit que este switch não trata (era
      // `track_unpublished` aqui até o Plano 08-01, que passou a tratá-lo).
      const rawBody = webhookBody({ event: 'egress_started', room: { name: channelId } })
      const authHeader = await signWebhookAuthHeader(
        rawBody,
        LIVEKIT_ENV.LIVEKIT_API_KEY,
        LIVEKIT_ENV.LIVEKIT_API_SECRET
      )

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: rawBody,
        headers: { Authorization: authHeader }
      })

      expect(response.status).toBe(200)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(1)
    })
  })

  test('participant_left para linha já removida (evento duplicado) responde 200 sem lançar', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)
      // Nenhuma linha inserida — simula que leaveVoiceChannel do cliente já rodou
      // antes do webhook chegar, ou que o LiveKit reenviou o mesmo evento.

      const rawBody = webhookBody({
        event: 'participant_left',
        room: { name: channelId },
        participant: { identity: anaId }
      })
      const authHeader = await signWebhookAuthHeader(
        rawBody,
        LIVEKIT_ENV.LIVEKIT_API_KEY,
        LIVEKIT_ENV.LIVEKIT_API_SECRET
      )

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: rawBody,
        headers: { Authorization: authHeader }
      })

      expect(response.status).toBe(200)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    })
  })
})

/**
 * SHARE-06 (Plano 08-01): `track_unpublished` estende o MESMO switch e a MESMA
 * verificação de assinatura de 07-02 — nenhuma rota nova. O filtro é por
 * `TrackSource.SCREEN_SHARE` (enum, não string literal): microfone e câmera também
 * disparam `track_unpublished` o tempo todo numa call normal, e nenhum dos dois é dado
 * que `voiceStates` rastreia.
 */
describe('POST /livekit/webhook — track_unpublished (compartilhamento de tela)', () => {
  async function sharingAna(): Promise<{
    t: ReturnType<typeof convexTest>
    anaId: Id<'users'>
    channelId: Id<'channels'>
  }> {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const stateId = await insertVoiceState(t, channelId, anaId)
    await t.run((ctx) => ctx.db.patch(stateId, { sharing: true }))
    return { t, anaId, channelId }
  }

  async function postSigned(
    t: ReturnType<typeof convexTest>,
    rawBody: string
  ): Promise<Response> {
    const authHeader = await signWebhookAuthHeader(
      rawBody,
      LIVEKIT_ENV.LIVEKIT_API_KEY,
      LIVEKIT_ENV.LIVEKIT_API_SECRET
    )
    return t.fetch('/livekit/webhook', {
      method: 'POST',
      body: rawBody,
      headers: { Authorization: authHeader }
    })
  }

  test('track de tela despublicada zera sharing e MANTÉM a pessoa no canal', async () => {
    await withLiveKitEnv(async () => {
      const { t, anaId, channelId } = await sharingAna()

      const response = await postSigned(
        t,
        webhookBody({
          event: 'track_unpublished',
          room: { name: channelId },
          participant: { identity: anaId },
          track: { sid: 'TR_tela', source: 'SCREEN_SHARE' }
        })
      )

      expect(response.status).toBe(200)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(1)
      expect(rows[0].sharing).toBe(false)
    })
  })

  test.each(['CAMERA', 'MICROPHONE', 'SCREEN_SHARE_AUDIO'])(
    'track_unpublished de %s responde 200 e NÃO toca em sharing (prova que o filtro não é catch-all)',
    async (source) => {
      await withLiveKitEnv(async () => {
        const { t, anaId, channelId } = await sharingAna()

        const response = await postSigned(
          t,
          webhookBody({
            event: 'track_unpublished',
            room: { name: channelId },
            participant: { identity: anaId },
            track: { sid: 'TR_outra', source }
          })
        )

        expect(response.status).toBe(200)
        const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
        expect(rows).toHaveLength(1)
        expect(rows[0].sharing).toBe(true)
      })
    }
  )

  test('track_unpublished sem campo track responde 200 e não altera nada', async () => {
    await withLiveKitEnv(async () => {
      const { t, anaId, channelId } = await sharingAna()

      const response = await postSigned(
        t,
        webhookBody({
          event: 'track_unpublished',
          room: { name: channelId },
          participant: { identity: anaId }
        })
      )

      expect(response.status).toBe(200)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows[0].sharing).toBe(true)
    })
  })

  test('track de tela sem linha correspondente (pessoa já saiu) responde 200 sem lançar', async () => {
    await withLiveKitEnv(async () => {
      const t = convexTest(schema, modules)
      const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
      const { channelId } = await insertServerWithChannel(t, anaId)

      const response = await postSigned(
        t,
        webhookBody({
          event: 'track_unpublished',
          room: { name: channelId },
          participant: { identity: anaId },
          track: { sid: 'TR_tela', source: 'SCREEN_SHARE' }
        })
      )

      expect(response.status).toBe(200)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    })
  })

  test('track de tela com assinatura inválida responde 401 e sharing continua true', async () => {
    await withLiveKitEnv(async () => {
      const { t, anaId, channelId } = await sharingAna()

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: webhookBody({
          event: 'track_unpublished',
          room: { name: channelId },
          participant: { identity: anaId },
          track: { sid: 'TR_tela', source: 'SCREEN_SHARE' }
        }),
        headers: { Authorization: 'Bearer nao-e-um-jwt-assinado-de-verdade' }
      })

      expect(response.status).toBe(401)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows[0].sharing).toBe(true)
    })
  })
})

describe('voice.voiceParticipantsByChannel', () => {
  test('rejeita não-membro do servidor dono do canal', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.query(anyApi.voice.voiceParticipantsByChannel, { channelId })
    ).rejects.toThrow()
  })

  test('membro vê participantes reais do canal, enriquecidos e sem workosId', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    const carlaId = await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { channelId } = await insertServerWithChannel(t, anaId)
    await addMember(t, (await t.run((ctx) => ctx.db.get(channelId)))!.serverId, carlaId)

    await t.run((ctx) =>
      ctx.db.insert('voiceStates', {
        channelId,
        userId: anaId,
        muted: false,
        deafened: false,
        sharing: false
      })
    )
    await t.run((ctx) =>
      ctx.db.insert('voiceStates', {
        channelId,
        userId: carlaId,
        muted: true,
        deafened: false,
        sharing: false
      })
    )

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const result = await asAna.query(anyApi.voice.voiceParticipantsByChannel, { channelId })

    expect(result).toHaveLength(2)
    const carla = result.find((p: { userId: Id<'users'> }) => p.userId === carlaId)
    expect(carla).toMatchObject({ username: 'carla', tag: '0003', muted: true })
    expect(carla).not.toHaveProperty('workosId')
  })
})

describe('voice.voiceParticipantsByServer', () => {
  test('rejeita não-membro do servidor', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { serverId } = await insertServerWithChannel(t, anaId)
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.query(anyApi.voice.voiceParticipantsByServer, { serverId })
    ).rejects.toThrow()
  })

  test('membro vê participantes de todos os canais de voz do servidor', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { serverId, channelId: channelA } = await insertServerWithChannel(t, anaId)
    const channelB = await t.run((ctx) =>
      ctx.db.insert('channels', { serverId, name: 'outro-canal-voz', type: 'voice', position: 1 })
    )

    await t.run((ctx) =>
      ctx.db.insert('voiceStates', {
        channelId: channelA,
        userId: anaId,
        muted: false,
        deafened: false,
        sharing: false
      })
    )

    const carlaWorkosId = 'workos_carla'
    const carlaId = await insertUser(t, carlaWorkosId, 'carla', '0003')
    await addMember(t, serverId, carlaId)
    await t.run((ctx) =>
      ctx.db.insert('voiceStates', {
        channelId: channelB,
        userId: carlaId,
        muted: false,
        deafened: false,
        sharing: false
      })
    )

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const result = await asAna.query(anyApi.voice.voiceParticipantsByServer, { serverId })

    expect(result).toHaveLength(2)
    expect(result.map((p: { channelId: Id<'channels'> }) => p.channelId).sort()).toEqual(
      [channelA, channelB].sort()
    )
  })
})
