export type FriendsTab = 'online' | 'todos' | 'pendente' | 'adicionar'

/** Amigos mostrados nas abas Online e Todos. */
export function friendsForTab<T extends { online: boolean }>(
  friends: T[],
  tab: 'online' | 'todos'
): T[] {
  return tab === 'online' ? friends.filter((f) => f.online) : friends
}
