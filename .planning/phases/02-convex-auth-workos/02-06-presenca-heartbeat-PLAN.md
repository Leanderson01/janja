---
phase: 02-convex-auth-workos
plan: 06
type: execute
wave: 3
depends_on: ["02-01", "02-04"]
files_modified:
  - convex/presence.ts
  - convex/presence.test.ts
autonomous: true

must_haves:
  truths:
    - "Uma sessão autenticada consegue registrar 'estou online agora' no Convex"
    - "Ninguém não-autenticado consegue escrever em presence"
    - "Heartbeats repetidos do mesmo usuário atualizam a mesma linha, nunca criam duplicatas"
  artifacts:
    - path: "convex/presence.ts"
      provides: "Mutation heartbeat() — upsert por userId derivado da identidade autenticada"
      contains: "getUserIdentity"
  key_links:
    - from: "convex/presence.ts"
      to: "convex/schema.ts (tabela presence, índice by_user)"
      via: "ctx.db.query('presence').withIndex('by_user', ...)"
      pattern: "by_user"
---

<objective>
Escrever a mutation de presença que a Fase 4 (lista de membros) e a Fase 6 (lista de amigos)
vão consumir para exibir online/offline — esta fase só entrega a escrita, nunca a exibição
(decisão já registrada no ROADMAP, seção "Ajustes em relação ao design aprovado").

Purpose: sem essa peça, F4/F6 não têm de onde ler presença quando chegar a vez delas, e
teriam que voltar para F2 depois — o ROADMAP já decidiu que a infraestrutura de presença
entra aqui, junto do resto do estado de auth.
Output: `convex/presence.ts` com a mutation `heartbeat`, testada.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/research/PITFALLS.md
@.planning/phases/02-convex-auth-workos/02-RESEARCH.md

# 02-RESEARCH.md §7: decisão desta fase é um heartbeat simples de ~45s disparado pelo
# renderer (implementado no plano 02-08), não o componente @convex-dev/presence (schema
# incompatível com o presence(userId, lastSeen) já fixado no design doc) e não um heartbeat
# a cada poucos segundos (armadilha de performance do PITFALLS.md — mutation cara demais
# para o volume de escrita gerado).
</context>

<tasks>

<task type="auto">
  <name>Task 1: Mutation heartbeat com upsert por identidade autenticada</name>
  <files>convex/presence.ts</files>
  <action>
    Criar `convex/presence.ts`:
    ```ts
    import { mutation } from './_generated/server'

    export const heartbeat = mutation({
      args: {},
      handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity()
        if (!identity) throw new Error('Não autenticado')

        const user = await ctx.db
          .query('users')
          .withIndex('by_workos_id', (q) => q.eq('workosId', identity.subject))
          .unique()
        if (!user) throw new Error('Usuário sem documento em users — ensureUser deveria ter rodado antes')

        const existing = await ctx.db
          .query('presence')
          .withIndex('by_user', (q) => q.eq('userId', user._id))
          .unique()

        if (existing) {
          await ctx.db.patch(existing._id, { lastSeen: Date.now() })
        } else {
          await ctx.db.insert('presence', { userId: user._id, lastSeen: Date.now() })
        }
      },
    })
    ```
    A dependência de `users` (via `ensureUser`, plano 02-05) é intencional: presença só faz
    sentido para um usuário que já tem documento — a mutation falha alto e claro em vez de
    criar uma linha de presença órfã sem `userId` válido. Quem chama esta mutation (plano
    02-08) chama `ensureUser` primeiro, uma única vez por sessão.
  </action>
  <verify>`npm run typecheck` reconhece `convex/presence.ts` (depende de `convex/_generated/server` já existir, do checkpoint 02-04); a mutation não aceita nenhum argumento vindo do cliente que decida "de quem" é o heartbeat — tudo vem de `ctx.auth`.</verify>
  <done>Mutation heartbeat pronta para ser chamada em intervalo pelo renderer autenticado.</done>
</task>

<task type="auto">
  <name>Task 2: Testes de autorização e upsert com convex-test</name>
  <files>convex/presence.test.ts</files>
  <action>
    Escrever `convex/presence.test.ts` usando `convex-test` (mesmo padrão do plano 02-05):
    1. Chamar `heartbeat` sem `withIdentity(...)` e confirmar que rejeita com erro.
    2. Popular um usuário via `t.run(ctx => ctx.db.insert('users', {...}))`, simular
       identidade com o mesmo `workosId`, chamar `heartbeat` duas vezes em sequência, e
       confirmar que `(await t.run(ctx => ctx.db.query('presence').collect())).length === 1`
       depois das duas chamadas (upsert, não duplicata) e que `lastSeen` da segunda chamada é
       maior que o da primeira.
    3. Chamar `heartbeat` com uma identidade cujo `workosId` não corresponde a nenhum
       usuário existente e confirmar que rejeita com erro claro, em vez de inserir uma linha
       de presença órfã.
  </action>
  <verify>Testes passam via `npx vitest run` (mesmo runner configurado no plano 02-05).</verify>
  <done>Regras de autorização e upsert de presença cobertas por teste automatizado, sem depender de UI nem de sessão real.</done>
</task>

</tasks>

<verification>
- Testes de `convex/presence.test.ts` passam.
- Nenhuma chamada não-autenticada consegue escrever em `presence`.
- Heartbeats repetidos nunca duplicam linha por usuário.
</verification>

<success_criteria>
Infraestrutura de escrita de presença pronta para F4/F6 consumirem por leitura, sem nenhuma
peça de exibição implementada aqui (fora de escopo desta fase).
</success_criteria>

<output>
After completion, create `.planning/phases/02-convex-auth-workos/02-06-SUMMARY.md`.
</output>
