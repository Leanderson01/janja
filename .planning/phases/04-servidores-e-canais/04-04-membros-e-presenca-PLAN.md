---
phase: 04-servidores-e-canais
plan: 04
type: tdd
wave: 2
depends_on: ["04-01"]
files_modified:
  - convex/members.ts
  - convex/members.test.ts
autonomous: true

must_haves:
  truths:
    - "Usuário vê a lista de membros de um servidor do qual participa, cada um com status online/offline"
    - "Não-membro não consegue listar membros de um servidor do qual não participa"
    - "Status online é derivado do heartbeat de presença (Fase 2), nunca de um campo manual"
  artifacts:
    - path: "convex/members.ts"
      provides: "Query listServerMembers(serverId) — junta serverMembers + users + presence, retorna online: boolean por membro"
      exports: ["listServerMembers", "isOnline"]
  key_links:
    - from: "convex/members.ts"
      to: "convex/schema.ts (presence.by_user)"
      via: "withIndex('by_user', q => q.eq('userId', member.userId)) por membro, para derivar online/offline"
      pattern: "by_user"
    - from: "convex/members.ts"
      to: "convex/lib/membership.ts (requireMembership)"
      via: "listServerMembers exige participação no próprio servidor consultado"
      pattern: "requireMembership"
---

<feature>
  <name>Lista de membros do servidor com presença (SRV-07, APP-02)</name>
  <files>convex/members.ts, convex/members.test.ts</files>
  <behavior>
    **`isOnline(lastSeen, now)`** (função pura, exportada para teste isolado):
    - `lastSeen: number | undefined`, `now: number` → `boolean`.
    - `undefined` (usuário nunca deu heartbeat, ex: nunca fez login de verdade num teste)
      sempre retorna `false`.
    - Limiar: `now - lastSeen <= 90_000` (90s — o dobro do intervalo de heartbeat de 45s
      fixado em `02-RESEARCH.md §7`/plano 02-08, mais folga para variação de rede). Caso de
      teste: `lastSeen` exatamente no limiar (90000ms atrás) é `true`; 90001ms atrás é `false`;
      `lastSeen` no mesmo instante de `now` é `true`; `lastSeen` no futuro (relógio local
      adiantado) não deveria nunca dar `false` por conta disso — testar
      `isOnline(now + 5000, now)` retorna `true` (diferença negativa, sempre ≤ limiar).

    **`listServerMembers({ serverId })`** (query):
    - Exige `requireMembership(ctx, serverId)` de `convex/lib/membership.ts` (plano 04-01).
      Caso de teste central de SRV-06 aplicado a este domínio: não-membro chama e recebe
      rejeição, mesmo sabendo o `serverId` de um servidor real.
    - Busca `serverMembers` via `withIndex('by_server_user', q => q.eq('serverId', serverId))`
      (prefixo do índice composto — ver `04-RESEARCH.md §1`).
    - Para cada membro, busca o `users` correspondente (`ctx.db.get(m.userId)`) e a `presence`
      correspondente via `withIndex('by_user', q => q.eq('userId', m.userId))`; ignora
      silenciosamente (`filter` fora) qualquer `serverMembers` cujo `users` não exista mais
      (estado impossível no fluxo normal, mas não deveria derrubar a query inteira se
      acontecer).
    - Retorna um array de objetos `{ userId, username, tag, displayName, avatarUrl, nickname,
      online }` — nunca o documento `users` bruto (não expor `workosId`, que é detalhe de
      autenticação, não de perfil público).
    - Caso de teste: servidor com 3 membros, um com `presence.lastSeen` recente (online), um
      com `lastSeen` antigo (offline), um sem nenhuma linha de `presence` (offline) — confirma
      que os 3 aparecem na lista com o `online` correto para cada caso, e que a lista tem
      exatamente 3 itens (nenhum duplicado, nenhum de outro servidor).
    - Caso de teste: usuário membro de dois servidores só vê os membros do servidor pedido no
      argumento, nunca uma mistura dos dois.
  </behavior>
  <implementation>
    Mesmo padrão de teste dos planos anteriores (`convexTest`, `anyApi`, `import.meta.glob`,
    `t.withIdentity`, `t.run` para popular `users`/`servers`/`serverMembers`/`presence`
    diretamente). Ao popular `presence` para os casos de teste, usar `t.run(ctx =>
    ctx.db.insert('presence', { userId, lastSeen: Date.now() - N }))` variando `N` para simular
    online/offline — não depender de `convex/presence.ts:heartbeat` real dentro do teste (é
    outro domínio, já testado na Fase 2).

    Sequência RED → GREEN → REFACTOR:
    1. RED: `convex/members.test.ts` cobrindo `isOnline` isolada e `listServerMembers`
       (autorização + junção com presence) contra implementação ainda inexistente.
    2. GREEN: implementar `convex/members.ts`.
    3. REFACTOR: se a junção membro→users→presence ficar repetitiva, extrair uma função
       auxiliar privada (não exportada) só se o REFACTOR revelar duplicação real.
  </implementation>
</feature>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/04-servidores-e-canais/04-RESEARCH.md
@.planning/phases/04-servidores-e-canais/04-01-schema-e-fundacao-de-servidores-PLAN.md
@.planning/phases/02-convex-auth-workos/02-06-presenca-heartbeat-PLAN.md
@convex/presence.ts
@convex/presence.test.ts

# convex/presence.ts (Fase 2) já escreve a tabela presence via heartbeat — este plano só LÊ.
# Não reimplementar heartbeat nem escrever em presence.
#
# 02-RESEARCH.md §7 (referenciado pelo plano 02-06): heartbeat roda a cada 45s enquanto a
# sessão estiver ativa. O limiar de 90s (2x) deste plano é a decisão de "quanto tempo sem
# heartbeat até considerar offline" — folga deliberada para não piscar online/offline entre
# heartbeats normais.
#
# Depende do plano 04-01 já ter criado convex/lib/membership.ts e as tabelas
# servers/serverMembers/channels — reler antes de codar.
</context>

<verification>
- `npx vitest run convex/members.test.ts` passa.
- Não-membro chamando `listServerMembers` de um servidor real rejeita.
- `isOnline` coberto por teste de limiar (exatamente no corte, um ms depois, sem presença nenhuma, com relógio local adiantado).
- Membro de dois servidores nunca vê membros do servidor errado na mesma consulta.
</verification>

<success_criteria>
SRV-07 e APP-02 satisfeitos no nível de dados: lista de membros com status online/offline
derivado de presença real (não campo manual), com autorização verificada por teste, pronta
para o renderer (plano 04-07) consumir.
</success_criteria>

<output>
After completion, create `.planning/phases/04-servidores-e-canais/04-04-SUMMARY.md`.
</output>
