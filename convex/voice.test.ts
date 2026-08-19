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
      ttl: '10m',
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
      displayName: username,
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
  return t.run((ctx) =>
    ctx.db.insert('serverMembers', { serverId, userId, joinedAt: Date.now() })
  )
}

const LIVEKIT_ENV = {
  LIVEKIT_API_KEY: 'fake-api-key',
  LIVEKIT_API_SECRET: 'fake-api-secret-fake-api-secret',
  LIVEKIT_URL: 'wss://livekit.usesenju.com',
}

function withLiveKitEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = {
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
    LIVEKIT_URL: process.env.LIVEKIT_URL,
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

      await expect(asGhost.action(anyApi.voiceToken.joinVoiceChannel, { channelId })).rejects.toThrow()

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

      await expect(asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId })).rejects.toThrow()

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

      await expect(asAna.action(anyApi.voiceToken.joinVoiceChannel, { channelId })).rejects.toThrow()

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

      await expect(asCarla.action(anyApi.voiceToken.joinVoiceChannel, { channelId })).rejects.toThrow()

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
      LIVEKIT_URL: process.env.LIVEKIT_URL,
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
      if (previous.LIVEKIT_API_KEY !== undefined) process.env.LIVEKIT_API_KEY = previous.LIVEKIT_API_KEY
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

// --- VOICE-04 / Pitfall 3 (PITFALLS.md): reconciliação de usuário-fantasma via
// webhook do LiveKit. Nada além disto apaga uma linha de `voiceStates` quando o app
// morre sem rodar `leaveVoiceChannel` (crash, Alt+F4, Windows Update, perda de rede).

async function insertVoiceState(
  t: ReturnType<typeof convexTest>,
  channelId: Id<'channels'>,
  userId: Id<'users'>
) {
  return t.run((ctx) =>
    ctx.db.insert('voiceStates', { channelId, userId, muted: false, deafened: false, sharing: false })
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
        participant: { identity: anaId },
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
        participant: { identity: anaId },
      })

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: rawBody,
        headers: { Authorization: 'Bearer nao-e-um-jwt-assinado-de-verdade' },
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
        participant: { identity: anaId },
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
        headers: { Authorization: authHeader },
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
      secret: process.env.LIVEKIT_API_SECRET,
    }
    delete process.env.LIVEKIT_API_KEY
    delete process.env.LIVEKIT_API_SECRET

    try {
      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: webhookBody({ event: 'room_finished', room: { name: 'nao-importa' } }),
        headers: { Authorization: 'qualquer-coisa' },
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
        participant: { identity: anaId },
      })
      const authHeader = await signWebhookAuthHeader(
        rawBody,
        LIVEKIT_ENV.LIVEKIT_API_KEY,
        LIVEKIT_ENV.LIVEKIT_API_SECRET
      )

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: rawBody,
        headers: { Authorization: authHeader },
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
        participant: { identity: anaId },
      })
      const authHeader = await signWebhookAuthHeader(
        rawBody,
        LIVEKIT_ENV.LIVEKIT_API_KEY,
        LIVEKIT_ENV.LIVEKIT_API_SECRET
      )

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: rawBody,
        headers: { Authorization: authHeader },
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
        headers: { Authorization: authHeader },
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

      const rawBody = webhookBody({ event: 'track_unpublished', room: { name: channelId } })
      const authHeader = await signWebhookAuthHeader(
        rawBody,
        LIVEKIT_ENV.LIVEKIT_API_KEY,
        LIVEKIT_ENV.LIVEKIT_API_SECRET
      )

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: rawBody,
        headers: { Authorization: authHeader },
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
        participant: { identity: anaId },
      })
      const authHeader = await signWebhookAuthHeader(
        rawBody,
        LIVEKIT_ENV.LIVEKIT_API_KEY,
        LIVEKIT_ENV.LIVEKIT_API_SECRET
      )

      const response = await t.fetch('/livekit/webhook', {
        method: 'POST',
        body: rawBody,
        headers: { Authorization: authHeader },
      })

      expect(response.status).toBe(200)
      const rows = await t.run((ctx) => ctx.db.query('voiceStates').collect())
      expect(rows).toHaveLength(0)
    })
  })
})
