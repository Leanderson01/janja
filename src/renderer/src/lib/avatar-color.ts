export type AvatarColorIndex = 1 | 2 | 3 | 4 | 5

/** FNV-1a de 32 bits: espalha ids parecidos (`k57abc`, `k57abd`) pelas 5 cores. */
export function avatarColorIndex(userId: string): AvatarColorIndex {
  let hash = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return ((((hash >>> 0) % 5) + 1) as AvatarColorIndex)
}

// Literais completos, porque o Tailwind só gera classe que aparece inteira no código.
export const AVATAR_BG: Record<AvatarColorIndex, string> = {
  1: 'bg-avatar-1',
  2: 'bg-avatar-2',
  3: 'bg-avatar-3',
  4: 'bg-avatar-4',
  5: 'bg-avatar-5'
}

/** Fundo translúcido do tile da call. */
export const AVATAR_TILE_BG: Record<AvatarColorIndex, string> = {
  1: 'bg-avatar-1/25',
  2: 'bg-avatar-2/25',
  3: 'bg-avatar-3/25',
  4: 'bg-avatar-4/25',
  5: 'bg-avatar-5/25'
}
