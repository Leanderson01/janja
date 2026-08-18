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
})
