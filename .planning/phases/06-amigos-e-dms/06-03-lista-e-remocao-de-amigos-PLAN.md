---
phase: 06-amigos-e-dms
plan: 03
type: execute
wave: 3
depends_on: ["06-02"]
files_modified:
  - convex/friends.ts
  - convex/friends.test.ts
autonomous: true

must_haves:
  truths:
    - "Usuário vê sua lista de amigos com status online/offline de cada um"
    - "Usuário vê seus pedidos de amizade recebidos, pendentes de resposta"
    - "Usuário remove uma amizade existente, e a remoção é bidirecional (nenhum dos dois continua vendo o outro como amigo)"
  artifacts:
    - path: "convex/friends.ts"
      provides: "Query listFriends (com presença), query listIncomingFriendRequests, mutation removeFriendship"
      exports: ["listFriends", "listIncomingFriendRequests", "removeFriendship"]
  key_links:
    - from: "convex/friends.ts (listFriends)"
      to: "convex/schema.ts (presence.by_user)"
      via: "leitura de presence por userId de cada amigo, sem escrever nada"
      pattern: "presence"
    - from: "convex/friends.ts (listFriends)"
      to: "convex/schema.ts (friendships.by_pair + by_userB)"
      via: "união de duas queries indexadas (X como userA, X como userB), nunca .filter()"
      pattern: "by_userB"
---

<objective>
Completar o backend de amigos: exibição (lista de amigos com presença, lista de
pedidos recebidos) e remoção — as três peças que faltam depois que o plano
06-02 resolveu envio/aceite/recusa.

Purpose: sem isto, a UI do plano 06-06 não tem de onde ler "meus amigos" nem
"meus pedidos pendentes", e SOCIAL-04/SOCIAL-06 ficam sem base de dados.
Output: `convex/friends.ts` completo (todas as 6 funções da Fase 6 relativas a
amizade), testado.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-amigos-e-dms/06-RESEARCH.md
@.planning/research/PITFALLS.md

# 06-RESEARCH.md §2: união de duas queries indexadas (by_pair prefixo + by_userB)
# para "todas as amizades de X" — nunca usar .filter() como substituto, é a
# armadilha de performance #1 do PITFALLS.md.
#
# 02-06-presenca-heartbeat-PLAN.md (Fase 2) já publicou `presence.by_user` — só
# ler, não escrever. Cadência do heartbeat é ~45s (02-RESEARCH.md §7); usar
# 90s (2x) como limiar de "online" para tolerar um heartbeat perdido sem
# piscar o status para offline.
</context>

<tasks>

<task type="auto">
  <name>Task 1: listFriends com presença + listIncomingFriendRequests</name>
  <files>convex/friends.ts, convex/friends.test.ts</files>
  <action>
    Adicionar a `convex/friends.ts` (reaproveitar `getCallerUser` já extraído
    no plano 06-02, não duplicar):

    ```ts
    const ONLINE_THRESHOLD_MS = 90_000 // 2x a cadência do heartbeat (~45s)

    export const listFriends = query({
      args: {},
      handler: async (ctx) => {
        const me = await getCallerUser(ctx)

        const asUserA = await ctx.db
          .query('friendships')
          .withIndex('by_pair', (q) => q.eq('userA', me._id))
          .collect()
        const asUserB = await ctx.db
          .query('friendships')
          .withIndex('by_userB', (q) => q.eq('userB', me._id))
          .collect()

        const friendIds = [
          ...asUserA.map((f) => f.userB),
          ...asUserB.map((f) => f.userA)
        ]

        const now = Date.now()
        return await Promise.all(
          friendIds.map(async (friendId) => {
            const friend = await ctx.db.get(friendId)
            const presence = await ctx.db
              .query('presence')
              .withIndex('by_user', (q) => q.eq('userId', friendId))
              .unique()
            const online = presence !== null && now - presence.lastSeen < ONLINE_THRESHOLD_MS
            return {
              userId: friendId,
              username: friend?.username ?? '???',
              tag: friend?.tag ?? '????',
              displayName: friend?.displayName ?? '???',
              avatarUrl: friend?.avatarUrl,
              online
            }
          })
        )
      }
    })

    export const listIncomingFriendRequests = query({
      args: {},
      handler: async (ctx) => {
        const me = await getCallerUser(ctx)
        const requests = await ctx.db
          .query('friendRequests')
          .withIndex('by_to', (q) => q.eq('toUserId', me._id))
          .collect()

        return await Promise.all(
          requests.map(async (request) => {
            const fromUser = await ctx.db.get(request.fromUserId)
            return {
              requestId: request._id,
              fromUserId: request.fromUserId,
              username: fromUser?.username ?? '???',
              tag: fromUser?.tag ?? '????',
              displayName: fromUser?.displayName ?? '???',
              avatarUrl: fromUser?.avatarUrl
            }
          })
        )
      }
    })
    ```

    Casos de teste (`convex/friends.test.ts`, acrescentar aos describes
    existentes):
    - `listFriends` rejeita sem identidade.
    - Dois usuários que viraram amigos (seed via `t.run` inserindo
      `friendships` diretamente, em ordem canônica) aparecem um na lista do
      outro, **independente de qual dos dois é `userA`** — testar os dois
      sentidos.
    - Amigo com `presence.lastSeen` recente (`Date.now()`) aparece
      `online: true`; amigo sem linha em `presence`, ou com `lastSeen` antigo
      (`Date.now() - 200_000`), aparece `online: false`.
    - `listIncomingFriendRequests` retorna só os pedidos onde eu sou
      `toUserId`, nunca os que eu enviei (seed um pedido meu→outro e um
      outro→eu, confirmar que só o segundo aparece).
  </action>
  <verify>`npx vitest run convex/friends.test.ts` passa, incluindo os casos de presença online/offline nos dois sentidos do par canônico.</verify>
  <done>Lista de amigos com presença e lista de pedidos recebidos prontas para a UI consumir.</done>
</task>

<task type="auto">
  <name>Task 2: removeFriendship</name>
  <files>convex/friends.ts, convex/friends.test.ts</files>
  <action>
    Adicionar:
    ```ts
    export const removeFriendship = mutation({
      args: { friendUserId: v.id('users') },
      handler: async (ctx, args) => {
        const me = await getCallerUser(ctx)
        const [userA, userB] = canonicalPair(me._id, args.friendUserId)

        const friendship = await ctx.db
          .query('friendships')
          .withIndex('by_pair', (q) => q.eq('userA', userA).eq('userB', userB))
          .unique()
        if (!friendship) {
          throw new Error('Vocês não são amigos')
        }

        await ctx.db.delete(friendship._id)
      }
    })
    ```
    Não apagar `dmChannels`/`dmMembers`/`dmMessages` associados — histórico de
    conversa permanece mesmo depois de desfazer a amizade (decisão registrada
    em `06-RESEARCH.md`, sem contradição com nenhum SOCIAL-0x: nenhum
    requisito pede apagar histórico).

    Casos de teste:
    - Rejeita sem identidade.
    - Chamar com um `friendUserId` que não é amigo → lança erro, nenhuma
      escrita acontece.
    - Amizade existente (qualquer um dos dois lados chamando) é removida:
      depois da chamada, `friendships` não tem mais o documento, e
      `listFriends` de ambos os usuários não inclui mais o outro.
  </action>
  <verify>`npx vitest run convex/friends.test.ts` passa, incluindo o teste de que a remoção funciona chamada por qualquer um dos dois lados da amizade.</verify>
  <done>Amizade removível por qualquer um dos dois lados; DM associada preservada.</done>
</task>

</tasks>

<verification>
- `npx vitest run convex/friends.test.ts` passa por completo (todos os casos dos planos 06-02 e 06-03 juntos no mesmo arquivo).
- Nenhuma query nova usa `.filter()` como substituto de índice.
</verification>

<success_criteria>
SOCIAL-04 (lista de amigos com presença) e SOCIAL-06 (remover amizade)
resolvidos no nível de dados; `convex/friends.ts` completo e pronto para a UI
do plano 06-06.
</success_criteria>

<output>
After completion, create `.planning/phases/06-amigos-e-dms/06-03-SUMMARY.md`.
</output>
