import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from './messages'
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

async function insertServerWithChannel(
  t: ReturnType<typeof convexTest>,
  ownerId: Id<'users'>,
  channelType: 'text' | 'voice' = 'text'
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

async function addMember(t: ReturnType<typeof convexTest>, serverId: Id<'servers'>, userId: Id<'users'>) {
  return t.run((ctx) => ctx.db.insert('serverMembers', { serverId, userId, joinedAt: Date.now() }))
}

/** Grava um arquivo de verdade no storage emulado pelo `convex-test` e devolve o
 * `Id<'_storage'>` real. O harness emula `storage.store`, `getUrl` e `delete`
 * (node_modules/convex-test/dist/index.js — `storage/storeBlob`,
 * `1.0/storageGetUrl`, `1.0/storageDelete`), então estes testes exercitam o
 * caminho real de `db.system.get('_storage', ...)`, e não um mock. O que o
 * harness NÃO guarda é o `contentType` (o insert em `_storage` só tem `size` e
 * `sha256`) — por isso nenhum teste aqui afirma nada sobre contentType. */
async function storeFile(
  t: ReturnType<typeof convexTest>,
  bytes: number
): Promise<Id<'_storage'>> {
  return t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)])))
}

describe('messages.sendMessage', () => {
  test('membro válido envia mensagem — aparece com authorId correto', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await asAna.mutation(anyApi.messages.sendMessage, {
      channelId,
      content: 'Oi, pessoal!',
    })

    const messages: Doc<'messages'>[] = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(1)
    expect(messages[0].authorId).toBe(anaId)
    expect(messages[0].content).toBe('Oi, pessoal!')
    expect(messages[0].channelId).toBe(channelId)
  })

  test('rejeita envio sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)

    await expect(
      t.mutation(anyApi.messages.sendMessage, { channelId, content: 'oi' })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })

  test('SRV-06 aplicado a chat: não-membro do servidor não consegue enviar mensagem no canal', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.mutation(anyApi.messages.sendMessage, { channelId, content: 'intruso' })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })

  test('rejeita mensagem vazia ou só espaços — nenhuma linha é inserida', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await expect(
      asAna.mutation(anyApi.messages.sendMessage, { channelId, content: '' })
    ).rejects.toThrow()
    await expect(
      asAna.mutation(anyApi.messages.sendMessage, { channelId, content: '   ' })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })

  test('rejeita mensagem acima de 2000 caracteres — nenhuma linha é inserida', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    const tooLong = 'a'.repeat(2001)
    await expect(
      asAna.mutation(anyApi.messages.sendMessage, { channelId, content: tooLong })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })

  test('rejeita envio em canal de voz mesmo sendo membro do servidor', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId, 'voice')
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await expect(
      asAna.mutation(anyApi.messages.sendMessage, { channelId, content: 'oi' })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })
})

describe('messages.listMessages', () => {
  test('SRV-06 aplicado a chat: não-membro não consegue listar mensagens, mesmo sabendo o channelId', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { channelId } = await insertServerWithChannel(t, anaId)
    await t.run((ctx) =>
      ctx.db.insert('messages', {
        channelId,
        authorId: anaId,
        content: 'segredo',
        createdAt: Date.now(),
      })
    )
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.query(anyApi.messages.listMessages, {
        channelId,
        paginationOpts: { numItems: 30, cursor: null },
      })
    ).rejects.toThrow()
  })

  test('mensagem enviada por Ana aparece com isMine correto para cada chamador', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const brunoWorkosId = 'workos_bruno'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    const { serverId, channelId } = await insertServerWithChannel(t, anaId)
    await addMember(t, serverId, brunoId)

    const asAna = t.withIdentity({ subject: anaWorkosId })
    await asAna.mutation(anyApi.messages.sendMessage, { channelId, content: 'Oi, Bruno!' })

    const asBruno = t.withIdentity({ subject: brunoWorkosId })

    const anaView = await asAna.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: null },
    })
    const brunoView = await asBruno.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: null },
    })

    expect(anaView.page).toHaveLength(1)
    expect(anaView.page[0].isMine).toBe(true)
    expect(brunoView.page[0].isMine).toBe(false)
  })

  test('autor da mensagem vem com username/tag/displayName corretos e sem workosId', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })
    await asAna.mutation(anyApi.messages.sendMessage, { channelId, content: 'oi' })

    const view = await asAna.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: null },
    })

    expect(view.page[0].author).not.toBeNull()
    expect(view.page[0].author?.username).toBe('ana')
    expect(view.page[0].author?.tag).toBe('0001')
    expect(view.page[0].author?.displayName).toBe('ana')
    expect(view.page[0].author).not.toHaveProperty('workosId')
  })

  test('paginação: 35 mensagens — primeira página traz 30, mais nova primeiro, cursor traz o resto', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)

    const baseTime = Date.now()
    for (let i = 0; i < 35; i++) {
      await t.run((ctx) =>
        ctx.db.insert('messages', {
          channelId,
          authorId: anaId,
          content: `mensagem ${i}`,
          createdAt: baseTime + i,
        })
      )
    }

    const asAna = t.withIdentity({ subject: anaWorkosId })

    const firstPage = await asAna.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: null },
    })

    expect(firstPage.page).toHaveLength(30)
    expect(firstPage.isDone).toBe(false)
    expect(firstPage.page[0].content).toBe('mensagem 34')
    expect(firstPage.page[29].content).toBe('mensagem 5')

    const secondPage = await asAna.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: firstPage.continueCursor },
    })

    expect(secondPage.page).toHaveLength(5)
    expect(secondPage.isDone).toBe(true)
    expect(secondPage.page[0].content).toBe('mensagem 4')
    expect(secondPage.page[4].content).toBe('mensagem 0')
  })
})


describe('messages.generateUploadUrl (CHAT-10)', () => {
  test('SRV-06 aplicado ao storage: não-membro não obtém URL de upload', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.mutation(anyApi.messages.generateUploadUrl, { channelId })
    ).rejects.toThrow()
  })

  test('rejeita sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)

    await expect(t.mutation(anyApi.messages.generateUploadUrl, { channelId })).rejects.toThrow()
  })

  test('rejeita URL de upload para canal de voz', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId, 'voice')
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await expect(
      asAna.mutation(anyApi.messages.generateUploadUrl, { channelId })
    ).rejects.toThrow()
  })

  test('membro do canal de texto recebe uma URL', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    const url = await asAna.mutation(anyApi.messages.generateUploadUrl, { channelId })

    expect(typeof url).toBe('string')
  })
})

describe('messages.sendMessage com anexos (CHAT-10)', () => {
  test('mensagem sem texto mas com anexo é válida — size vem do storage, não do cliente', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })
    const storageId = await storeFile(t, 1234)

    await asAna.mutation(anyApi.messages.sendMessage, {
      channelId,
      content: '',
      attachments: [{ storageId, name: 'print.png' }]
    })

    const messages: Doc<'messages'>[] = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('')
    expect(messages[0].attachments).toHaveLength(1)
    expect(messages[0].attachments?.[0].name).toBe('print.png')
    expect(messages[0].attachments?.[0].storageId).toBe(storageId)
    // O cliente nunca informou tamanho: 1234 só pode ter vindo do `_storage`.
    expect(messages[0].attachments?.[0].size).toBe(1234)
  })

  test('regressão: mensagem sem texto e SEM anexo continua recusada', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await expect(
      asAna.mutation(anyApi.messages.sendMessage, { channelId, content: '', attachments: [] })
    ).rejects.toThrow()
    await expect(
      asAna.mutation(anyApi.messages.sendMessage, { channelId, content: '   ' })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })

  test('mensagem sem anexo não grava o campo attachments — documento igual ao de antes', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await asAna.mutation(anyApi.messages.sendMessage, { channelId, content: 'sem anexo' })

    const messages: Doc<'messages'>[] = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages[0].attachments).toBeUndefined()
  })

  test(`recusa mais de ${MAX_ATTACHMENTS_PER_MESSAGE} anexos — nada é inserido`, async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    const attachments: { storageId: Id<'_storage'>; name: string }[] = []
    for (let i = 0; i <= MAX_ATTACHMENTS_PER_MESSAGE; i++) {
      attachments.push({ storageId: await storeFile(t, 10), name: `arquivo-${i}.txt` })
    }
    expect(attachments).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE + 1)

    await expect(
      asAna.mutation(anyApi.messages.sendMessage, { channelId, content: 'muitos', attachments })
    ).rejects.toThrow(/No máximo/i)

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })

  test('recusa storageId cujo arquivo não existe mais — nada é inserido', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    // Id de formato válido, arquivo apagado: é o caso "cliente inventou o id" e
    // também o caso "arquivo sumiu entre o upload e o envio".
    const storageId = await storeFile(t, 10)
    await t.run((ctx) => ctx.storage.delete(storageId))

    await expect(
      asAna.mutation(anyApi.messages.sendMessage, {
        channelId,
        content: 'olha o arquivo',
        attachments: [{ storageId, name: 'sumiu.txt' }]
      })
    ).rejects.toThrow(/não encontrado/i)

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })

  test('recusa arquivo acima do limite de tamanho — o servidor decide, não o cliente', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    const storageId = await storeFile(t, MAX_ATTACHMENT_BYTES + 1)

    await expect(
      asAna.mutation(anyApi.messages.sendMessage, {
        channelId,
        content: '',
        attachments: [{ storageId, name: 'video-grande.mp4' }]
      })
    ).rejects.toThrow(/limite/i)

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })

  test('aceita arquivo exatamente no limite — o teto é inclusivo', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    const storageId = await storeFile(t, MAX_ATTACHMENT_BYTES)

    await asAna.mutation(anyApi.messages.sendMessage, {
      channelId,
      content: '',
      attachments: [{ storageId, name: 'no-limite.bin' }]
    })

    const messages: Doc<'messages'>[] = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(1)
    expect(messages[0].attachments?.[0].size).toBe(MAX_ATTACHMENT_BYTES)
  })

  test('SRV-06: não-membro não envia mensagem com anexo, mesmo com storageId válido', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const storageId = await storeFile(t, 10)
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.mutation(anyApi.messages.sendMessage, {
        channelId,
        content: '',
        attachments: [{ storageId, name: 'intruso.txt' }]
      })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })
})

describe('messages.listMessages com anexos (CHAT-10)', () => {
  test('regressão do contrato: mensagem sem anexo vem com attachments vazio e o resto igual', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })
    await asAna.mutation(anyApi.messages.sendMessage, { channelId, content: 'oi' })

    const view = await asAna.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: null }
    })

    expect(view.page[0].attachments).toEqual([])
    expect(view.page[0].content).toBe('oi')
    expect(view.page[0].isMine).toBe(true)
    expect(view.page[0].author?.username).toBe('ana')
  })

  test('anexo existente vem com URL utilizável, e nome/tamanho preservados', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })
    const storageId = await storeFile(t, 42)

    await asAna.mutation(anyApi.messages.sendMessage, {
      channelId,
      content: '',
      attachments: [{ storageId, name: 'print.png' }]
    })

    const view = await asAna.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: null }
    })

    expect(view.page[0].attachments).toHaveLength(1)
    expect(view.page[0].attachments[0].name).toBe('print.png')
    expect(view.page[0].attachments[0].size).toBe(42)
    expect(typeof view.page[0].attachments[0].url).toBe('string')
  })

  test('arquivo apagado do storage não quebra a listagem: url vem null', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })
    const storageId = await storeFile(t, 42)

    await asAna.mutation(anyApi.messages.sendMessage, {
      channelId,
      content: 'tinha um anexo aqui',
      attachments: [{ storageId, name: 'sumiu.png' }]
    })

    // O arquivo some DEPOIS de a mensagem existir — o histórico continua legível.
    await t.run((ctx) => ctx.storage.delete(storageId))

    const view = await asAna.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: null }
    })

    expect(view.page).toHaveLength(1)
    expect(view.page[0].content).toBe('tinha um anexo aqui')
    expect(view.page[0].attachments[0].url).toBeNull()
    expect(view.page[0].attachments[0].name).toBe('sumiu.png')
  })
})
