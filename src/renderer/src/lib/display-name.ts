/** Nome mostrado na interface: apelido, depois nome de exibição, depois usuário. Nunca `#tag`. */
export function displayNameOf(p: {
  nickname?: string | null
  displayName?: string | null
  username: string
}): string {
  return p.nickname?.trim() || p.displayName?.trim() || p.username
}
