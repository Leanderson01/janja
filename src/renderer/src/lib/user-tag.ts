export type ParsedUserTag = { username: string; tag: string }

// Espelha a normalização de username em convex/users.ts
// (baseUsernameFromEmail): minúsculo, sem espaços nas bordas. A tag é
// sempre 4 dígitos — mesmo formato de convex/lib/tag.ts.
export function parseUserTag(input: string): ParsedUserTag | null {
  const trimmed = input.trim()
  const match = /^(.+)#(\d{4})$/.exec(trimmed)
  if (!match) return null
  const username = match[1].trim().toLowerCase()
  if (username.length === 0) return null
  return { username, tag: match[2] }
}
