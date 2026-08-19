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

  messages: defineTable({
    channelId: v.id('channels'),
    authorId: v.id('users'),
    content: v.string(),
    createdAt: v.number(),
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
})
