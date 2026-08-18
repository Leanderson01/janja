---
phase: 06-amigos-e-dms
plan: 02
type: tdd
wave: 2
depends_on: ["06-01"]
files_modified:
  - convex/friends.ts
  - convex/friends.test.ts
autonomous: true

must_haves:
  truths:
    - "Usuário autenticado envia um pedido de amizade a outro usuário por USER#123"
    - "Destinatário de um pedido consegue aceitá-lo, criando uma amizade em ordem canônica (userA < userB)"
    - "Destinatário de um pedido consegue recusá-lo"
    - "Ninguém além do destinatário consegue aceitar ou recusar um pedido, mesmo conhecendo o requestId"
  artifacts:
    - path: "convex/friends.ts"
      provides: "Mutations sendFriendRequest, acceptFriendRequest, rejectFriendRequest"
      exports: ["sendFriendRequest", "acceptFriendRequest", "rejectFriendRequest"]
  key_links:
    - from: "convex/friends.ts (sendFriendRequest)"
      to: "convex/users.ts (findUserByUsernameTag)"
      via: "resolução do destinatário por índice by_username_tag, mesma lógica inline (sem reimplementar geração/colisão de tag)"
      pattern: "by_username_tag"
    - from: "convex/friends.ts (acceptFriendRequest)"
      to: "convex/schema.ts (friendships.by_pair)"
      via: "insert em ordem canônica userA < userB"
      pattern: "by_pair"
---

<feature>
  <name>Ciclo de vida do pedido de amizade (SOCIAL-01, SOCIAL-02, SOCIAL-03)</name>
  <files>convex/friends.ts, convex/friends.test.ts</files>
  <behavior>
    Três mutations, todas exigindo `ctx.auth.getUserIdentity()` — sem identidade,
    lançam erro (mesmo padrão de `ensureUser`/`heartbeat`, já em produção).

    **`sendFriendRequest({ username, tag })`** — args já vêm parseados do
    formulário (`"leo#0001"` → `{username: "leo", tag: "0001"}`, a UI faz esse
    split, não esta mutation):
    - Resolve o usuário chamador ("eu") via `users.by_workos_id`.
    - Resolve o alvo via `users.by_username_tag` (mesmo índice de
      `findUserByUsernameTag`, consultado inline — não chamar a query via
      `ctx.runQuery`, é overhead desnecessário dentro da mesma transação).
      Caso de teste: alvo inexistente → lança erro claro ("Usuário não
      encontrado"), nunca cria nada.
    - Caso de teste: `username`/`tag` resolvem para o próprio chamador → lança
      erro ("Você não pode adicionar a si mesmo").
    - Calcula o par canônico (`fromId < toId ? [fromId, toId] : [toId, fromId]`)
      e verifica `friendships.by_pair` — caso de teste: já são amigos → lança
      erro ("Vocês já são amigos"), não cria pedido duplicado.
    - Verifica pedido já existente na mesma direção via
      `friendRequests.by_from_to` (eu→alvo) — caso de teste: pedido duplicado
      → lança erro ("Pedido já enviado").
    - Verifica pedido existente na direção reversa via `by_from_to`
      (alvo→eu) — caso de teste: o alvo já me enviou um pedido → lança erro
      distinto orientando a aceitar o pedido existente em vez de duplicar
      ("Esse usuário já te enviou um pedido — aceite-o em vez de enviar um
      novo").
    - Caminho feliz: insere `friendRequests { fromUserId: eu, toUserId: alvo,
      createdAt: Date.now() }`. Caso de teste: dois usuários existentes, sem
      relação prévia, `sendFriendRequest` cria exatamente um documento em
      `friendRequests` com os campos corretos.

    **`acceptFriendRequest({ requestId })`**:
    - `ctx.db.get(requestId)` — caso de teste: id inexistente → lança erro
      ("Pedido não encontrado").
    - **Autorização crítica (hard constraint da tarefa)**: só
      `request.toUserId === eu._id` pode aceitar. Caso de teste central deste
      plano: usuário A envia pedido a B; usuário C (nem remetente nem
      destinatário) tenta aceitar → rejeita com erro claro, e nem
      `friendships` nem a remoção do pedido acontecem (confirmar via `t.run`
      que o pedido ainda existe depois da tentativa rejeitada). Testar também
      que o próprio remetente A não pode "auto-aceitar" o pedido que ele
      mesmo enviou.
    - Caminho feliz (chamado pelo destinatário real): calcula par canônico
      entre `fromUserId` e `toUserId`, insere `friendships { userA, userB,
      createdAt }` com `userA < userB` **independente de quem é o remetente
      ou quem aceitou** — caso de teste explícito comparando os dois cenários
      (A envia a B e aceita B; depois, em outro teste, B envia a A e A
      aceita) e confirmando que `userA`/`userB` batem pela ordem dos ids, não
      pela ordem do fluxo. Deleta o `friendRequests` correspondente. Caso de
      teste: depois de aceitar, `friendRequests` não tem mais nenhum
      documento para aquele par, e `friendships` tem exatamente um.

    **`rejectFriendRequest({ requestId })`**:
    - Mesma checagem de autorização do accept (só o destinatário recusa) —
      caso de teste espelhado: terceiro usuário tentando recusar é rejeitado.
    - Caminho feliz: deleta o `friendRequests`. Caso de teste: depois de
      recusar, nenhuma linha em `friendships` foi criada e o pedido sumiu de
      `friendRequests`.
  </behavior>
  <implementation>
    Seguir exatamente o padrão de autorização já em produção em
    `convex/presence.ts`/`convex/users.ts` (ler `06-RESEARCH.md §1`): resolver
    o usuário chamador uma vez no início do handler via
    `ctx.db.query('users').withIndex('by_workos_id', ...)`, nunca aceitar um
    id de usuário vindo de argumento para decidir "quem sou eu".

    Extrair uma função interna `getCallerUser(ctx)` no topo de
    `convex/friends.ts` (não em `convex/lib/`, é específica deste arquivo) que
    faz exatamente essa resolução e lança se não autenticado ou sem documento
    em `users` — evita repetir as mesmas 6 linhas nas 3 mutations.

    Extrair também uma função pura `canonicalPair(a: Id<'users'>, b:
    Id<'users'>): [Id<'users'>, Id<'users'>]` que compara os dois ids como
    string (`a < b ? [a, b] : [b, a]`) — Convex Ids são strings, comparação
    lexicográfica é suficiente e determinística para o propósito de "ordem
    canônica" (não precisa ter significado além de "sempre a mesma ordem para
    o mesmo par").

    Sequência RED → GREEN → REFACTOR:
    1. RED: escrever `convex/friends.test.ts` cobrindo todos os casos acima
       contra um `convex/friends.ts` ainda vazio/inexistente; confirmar que
       falham.
    2. GREEN: implementar `convex/friends.ts` até todos os testes passarem.
    3. REFACTOR: extrair `getCallerUser`/`canonicalPair` se ainda não
       estiverem assim depois do GREEN; confirmar que os testes continuam
       passando.

    Usar `convexTest(schema, modules)` com `const modules =
    import.meta.glob('./**/*.ts')` e `anyApi.friends.<nome>` para chamar as
    mutations nos testes — mesmo padrão de `convex/users.test.ts` (ver
    `06-RESEARCH.md §5`). Simular identidade com
    `t.withIdentity({ subject: 'workos_x', email: 'x@example.com' })` e seed
    de usuários via `t.run(ctx => ctx.db.insert('users', {...}))` quando o
    teste não precisar passar por `ensureUser`.
  </implementation>
</feature>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-amigos-e-dms/06-RESEARCH.md
@.planning/research/PITFALLS.md
@docs/superpowers/specs/2026-08-18-janja-discord-clone-design.md

# 06-RESEARCH.md §5 tem o padrão exato de convex-test já em uso no repo
# (t.withIdentity com `subject`, anyApi, modules via import.meta.glob) — copiar
# esse padrão, não o exemplo genérico da doc oficial (que usa `name` em vez de
# `subject`).
</context>

<verification>
- `npx vitest run convex/friends.test.ts` passa, cobrindo todos os casos de
  autorização e ciclo de vida listados acima.
- Teste específico confirma que um terceiro usuário (nem remetente nem
  destinatário) não consegue aceitar nem recusar um pedido alheio.
- Teste específico confirma que `friendships.userA < friendships.userB`
  sempre, independente de quem enviou ou aceitou o pedido.
</verification>

<success_criteria>
SOCIAL-02 (enviar pedido) e SOCIAL-03 (aceitar/recusar pedido recebido)
resolvidos no nível de dados, com o hard constraint de "só o destinatário
aceita" coberto por teste automatizado, não só por revisão de código.
</success_criteria>

<output>
After completion, create `.planning/phases/06-amigos-e-dms/06-02-SUMMARY.md`.
</output>
