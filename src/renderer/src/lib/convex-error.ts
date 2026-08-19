// As mutations do Convex lançam mensagens escritas para o usuário, em português
// ("Usuário não encontrado", "Você não pode adicionar a si mesmo"). O cliente do
// Convex embrulha isso num texto de várias linhas antes de chegar no `catch` do
// renderer:
//
//   [CONVEX M(friends:sendFriendRequest)] [Request ID: abc123] Server Error
//   Uncaught Error: Usuário não encontrado
//     at handler (../convex/friends.ts:42:11)
//
// Mostrar o embrulho inteiro num toast enterra justamente a frase que interessa
// no meio de ruído de infraestrutura — o usuário lê um ID de request antes de ler
// o que aconteceu. Extraímos a linha `Uncaught Error: <mensagem>`.
//
// Sem casamento, devolve o texto cru: melhor um toast feio do que um toast vazio.
// Erro que não veio do Convex (rede caindo, TypeError) não tem esse formato e
// passa direto, que é o comportamento certo.
//
// Vive em `lib/` porque nasceu duplicado: o Plano 08.5-04 escreveu esta função
// dentro de `MemberList.tsx` enquanto o 08.5-06 mostrava o erro cru no painel de
// amigos — dois executores paralelos, o mesmo problema, um só resolvido.
export function readableConvexError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const match = /Uncaught Error:\s*([^\n]+)/.exec(raw)
  return (match?.[1] ?? raw).trim()
}
