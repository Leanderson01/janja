import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({
    workosId: v.string(),
    username: v.string(),
    tag: v.string(),
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),
  })
    .index('by_workos_id', ['workosId'])
    .index('by_username_tag', ['username', 'tag']),

  presence: defineTable({
    userId: v.id('users'),
    lastSeen: v.number(),
  }).index('by_user', ['userId']),

  // --- Fase 4: servidores e canais ---

  servers: defineTable({
    name: v.string(),
    iconUrl: v.optional(v.string()),
    ownerId: v.id('users'),
  }),

  serverMembers: defineTable({
    serverId: v.id('servers'),
    userId: v.id('users'),
    nickname: v.optional(v.string()),
    joinedAt: v.number(),
  })
    .index('by_server_user', ['serverId', 'userId'])
    .index('by_user', ['userId']),

  invites: defineTable({
    code: v.string(),
    serverId: v.id('servers'),
    createdBy: v.id('users'),
    revoked: v.boolean(),
  })
    .index('by_code', ['code'])
    .index('by_server', ['serverId']),

  channels: defineTable({
    serverId: v.id('servers'),
    name: v.string(),
    type: v.union(v.literal('text'), v.literal('voice')),
    position: v.number(),
  }).index('by_server', ['serverId']),

  // --- Fase 5: chat em tempo real ---

  // `attachments` (Fase 8.5, decisão de 2026-08-19 que promoveu CHAT-10 ao v1)
  // é v.optional por obrigação, não por estilo: o Convex valida TODOS os
  // documentos já gravados contra o schema no momento do push, e um campo
  // obrigatório novo faria o push falhar em cima de cada mensagem existente.
  //
  // Os anexos moram dentro da própria mensagem, sem tabela própria: um anexo
  // não tem vida independente da mensagem, e uma tabela extra custaria mais
  // uma consulta por mensagem no histórico paginado — o caminho mais quente
  // do chat.
  //
  // `name`, `size` e `contentType` são copiados para cá porque o storage do
  // Convex NÃO guarda o nome original do arquivo (`_storage` só tem sha256,
  // size e contentType), e é o nome que a UI mostra. `size` é duplicado de
  // propósito, para a listagem não precisar de um `db.system.get` por anexo.
  // Ambos são escritos pelo servidor a partir de `_storage`, nunca copiados
  // do que o cliente afirma (ver sendMessage em messages.ts).
  messages: defineTable({
    channelId: v.id('channels'),
    authorId: v.id('users'),
    content: v.string(),
    createdAt: v.number(),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          name: v.string(),
          size: v.number(),
          contentType: v.optional(v.string()),
        })
      )
    ),
  }).index('by_channel', ['channelId']),

  channelReadState: defineTable({
    channelId: v.id('channels'),
    userId: v.id('users'),
    lastReadMessageId: v.optional(v.id('messages')),
  }).index('by_channel_user', ['channelId', 'userId']),

  typing: defineTable({
    channelId: v.id('channels'),
    userId: v.id('users'),
    updatedAt: v.number(),
  }).index('by_channel_user', ['channelId', 'userId']),

  // --- Fase 6: amigos e DMs ---

  friendRequests: defineTable({
    fromUserId: v.id('users'),
    toUserId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_from_to', ['fromUserId', 'toUserId'])
    .index('by_to', ['toUserId']),

  friendships: defineTable({
    userA: v.id('users'),
    userB: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_pair', ['userA', 'userB'])
    .index('by_userB', ['userB']),

  dmChannels: defineTable({
    createdAt: v.number(),
  }),

  dmMembers: defineTable({
    dmChannelId: v.id('dmChannels'),
    userId: v.id('users'),
  })
    .index('by_user', ['userId'])
    .index('by_channel_user', ['dmChannelId', 'userId']),

  dmMessages: defineTable({
    dmChannelId: v.id('dmChannels'),
    authorId: v.id('users'),
    content: v.string(),
    createdAt: v.number(),
  }).index('by_dm_channel', ['dmChannelId']),

  // --- Fase 7: voz ---
  //
  // Convex é a fonte da verdade de "quem está em qual canal de voz", nunca o
  // LiveKit — a linha aqui é criada só depois que joinVoiceChannel autoriza
  // membership e assina um token, e é removida por leaveVoiceChannel (saída
  // explícita) ou pelo webhook do LiveKit no Plano 07-02 (saída
  // involuntária: crash, perda de rede — Pitfall 3). `sharing` existe desde
  // já (design §5) mas só é escrito pela Fase 8; aqui sempre `false` na
  // criação da linha.
  voiceStates: defineTable({
    channelId: v.id('channels'),
    userId: v.id('users'),
    muted: v.boolean(),
    deafened: v.boolean(),
    sharing: v.boolean(),
  })
    .index('by_channel', ['channelId'])
    .index('by_user', ['userId'])
    .index('by_channel_and_user', ['channelId', 'userId']),

  // --- Fase 8.5: prévias de link ---
  //
  // Cache COMPARTILHADO da metadata de um link, e a razão de ele existir é
  // privacidade, não desempenho: quem busca a página de terceiro é a `action`
  // do Convex (ver linkPreviews.ts), nunca o computador de quem lê. Se cada
  // leitor buscasse, um link postado num canal de 10 pessoas entregaria o IP
  // das 10 ao dono daquele site a cada rolagem do histórico.
  //
  // `status: 'failed'` é gravado tanto quanto o sucesso, de propósito. Sem
  // gravar a falha, um site fora do ar (ou um link para uma URL privada
  // recusada) seria re-buscado a cada render de cada cliente — exatamente o
  // abuso que este cache existe para evitar. Uma linha `failed` significa
  // "já tentamos, não deu"; os campos de conteúdo ficam ausentes nela.
  //
  // Não há linha por mensagem: a chave é a URL. O segundo canal que postar o
  // mesmo link não dispara requisição nenhuma.
  linkPreviews: defineTable({
    url: v.string(),
    status: v.union(v.literal('ok'), v.literal('failed')),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    siteName: v.optional(v.string()),
    fetchedAt: v.number(),
  }).index('by_url', ['url']),
})
