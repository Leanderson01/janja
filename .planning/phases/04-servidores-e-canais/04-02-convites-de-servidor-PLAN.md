---
phase: 04-servidores-e-canais
plan: 02
type: tdd
wave: 2
depends_on: ["04-01"]
files_modified:
  - convex/lib/inviteCode.ts
  - convex/lib/inviteCode.test.ts
  - convex/invites.ts
  - convex/invites.test.ts
autonomous: true

must_haves:
  truths:
    - "Dono de um servidor gera um código de convite reutilizável, sem expiração nem limite de usos"
    - "Outro usuário entra no servidor usando esse código"
    - "Dono revoga o código, e o código revogado nunca mais permite ingresso — quem já entrou continua dentro"
    - "Não-dono não consegue gerar nem revogar convite, mesmo sendo membro"
  artifacts:
    - path: "convex/lib/inviteCode.ts"
      provides: "Função pura generateInviteCode() — 8 caracteres, alfabeto sem ambiguidade visual, testável sem Convex"
      exports: ["generateInviteCode"]
    - path: "convex/invites.ts"
      provides: "generateInvite (idempotente, dono), revokeInvite (dono), joinByCode (qualquer autenticado), getActiveInvite (membro)"
      exports: ["generateInvite", "revokeInvite", "joinByCode", "getActiveInvite"]
  key_links:
    - from: "convex/invites.ts (joinByCode)"
      to: "convex/schema.ts (serverMembers)"
      via: "insert em serverMembers só depois de validar invite.revoked === false"
      pattern: "revoked"
    - from: "convex/invites.ts"
      to: "convex/lib/membership.ts (requireOwnership)"
      via: "generateInvite e revokeInvite exigem dono; joinByCode exige só requireIdentity"
      pattern: "requireOwnership"
---

<feature>
  <name>Convite de servidor — gerar, revogar, entrar (SRV-02, SRV-03, SRV-04)</name>
  <files>convex/lib/inviteCode.ts, convex/lib/inviteCode.test.ts, convex/invites.ts, convex/invites.test.ts</files>
  <behavior>
    **`generateInviteCode()`** (função pura, sem Convex): retorna uma string de 8 caracteres do
    alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sem `0/O`, `1/I/L` — ambíguos ao ler em voz
    alta ou digitar). Caso de teste: rodar 1000 vezes e confirmar que todo resultado casa com
    `/^[A-HJ-NP-Z2-9]{8}$/` (ou expressão equivalente que exclua exatamente os caracteres
    banidos — não usar uma regex frouxa que aceite `0`/`1`/`I`/`L`/`O`).

    **`generateInvite({ serverId })`** (mutation):
    - Exige que o chamador seja **dono** do servidor (`requireOwnership`, de
      `convex/lib/membership.ts`, plano 04-01). Caso de teste: membro não-dono chama e recebe
      rejeição; servidor de outro dono também rejeita.
    - **Idempotente**: se já existe um convite não-revogado (`revoked: false`) para este
      servidor, retorna o `code` desse convite existente em vez de criar um segundo. Caso de
      teste: chamar duas vezes seguidas como dono e confirmar que
      `(await ctx.db.query('invites').collect()).length === 1` e que o código retornado nas
      duas chamadas é idêntico.
    - Se não houver convite ativo (nenhum ainda, ou o único existente foi revogado): gera um
      candidato com `generateInviteCode()`, checa colisão via `withIndex('by_code', ...)`,
      insere se livre; tenta de novo até 10x se colidir (colisão real é extremamente rara no
      espaço de 32^8 combinações — o teste do limite de tentativas usa o mesmo padrão do plano
      02-05: extrair a lógica de "tentar N vezes" para uma função testável com um `existsFn`
      injetado que sempre retorna `true`, confirmando que lança depois de exatamente
      `MAX_ATTEMPTS` tentativas, sem pré-popular 4 bilhões de combinações reais).
    - Depois de uma revogação (ver abaixo), uma nova chamada a `generateInvite` cria um código
      **diferente** do revogado (não reaproveita o código antigo). Caso de teste: gerar,
      revogar, gerar de novo — os dois códigos são distintos.

    **`revokeInvite({ serverId })`** (mutation):
    - Exige dono (`requireOwnership`). Caso de teste: não-dono rejeita.
    - Marca `revoked: true` no convite ativo do servidor (se houver — se não houver nenhum
      ativo, é um no-op silencioso, não um erro: revogar um convite que já não existe não deve
      quebrar a UI que chama isso sem checar estado antes).
    - Caso de teste central (critério de sucesso #3 do ROADMAP): depois de revogar, o código
      antigo passado para `joinByCode` rejeita — e um usuário que **já tinha entrado antes da
      revogação continua sendo membro** (revogar não remove `serverMembers` existentes, só
      bloqueia novos ingressos).

    **`joinByCode({ code })`** (mutation):
    - Exige só `requireIdentity` (qualquer usuário autenticado, não precisa já ser membro de
      nada). Busca o convite por `withIndex('by_code', ...)`. Caso de teste: código inexistente
      rejeita com erro claro; código existente mas `revoked: true` rejeita.
    - Se válido: insere `serverMembers` para `(invite.serverId, user._id)` e retorna
      `invite.serverId`. **Idempotente**: se o usuário já é membro (checar via
      `by_server_user`), retorna o `serverId` sem inserir uma segunda linha — entrar de novo
      com o mesmo código não deve duplicar `serverMembers`. Caso de teste: chamar `joinByCode`
      duas vezes seguidas com o mesmo usuário e código, confirmar
      `(await ctx.db.query('serverMembers').collect()).length` não cresce na segunda chamada.

    **`getActiveInvite({ serverId })`** (query):
    - Exige `requireMembership` (não precisa ser dono — qualquer membro pode ver o código
      ativo do próprio servidor, mas gerar/revogar continua exclusivo do dono). Retorna o
      convite não-revogado do servidor, ou `null` se não houver nenhum. Caso de teste:
      não-membro rejeita; membro comum (não-dono) consegue ler.
  </behavior>
  <implementation>
    Usar `convexTest`/`anyApi`/`import.meta.glob` exatamente como `convex/presence.test.ts`
    (Fase 2) e `convex/servers.test.ts` (plano 04-01) — não inventar variação de setup.
    `t.withIdentity({ subject: '...' })` simula cada usuário; `t.run(ctx => ...)` popula
    `users`/`servers`/`serverMembers` diretamente quando o teste precisa de um estado que não é
    o objeto sob teste (ex: pré-criar um servidor e seu dono antes de testar convite).

    `convex/invites.ts` importa `requireIdentity`, `requireMembership`, `requireOwnership` de
    `./lib/membership` (criado no plano 04-01 — não duplicar a lógica de autorização aqui) e
    `generateInviteCode` de `./lib/inviteCode`.

    Sequência RED → GREEN → REFACTOR:
    1. RED: escrever `convex/lib/inviteCode.test.ts` e `convex/invites.test.ts` cobrindo todos
       os casos acima contra implementação ainda inexistente; confirmar que falham.
    2. GREEN: implementar `convex/lib/inviteCode.ts` e `convex/invites.ts` até os testes
       passarem.
    3. REFACTOR: extrair a lógica de "tentar N vezes até achar um código livre" para uma
       função nomeada e testável isoladamente (mesmo padrão do plano 02-05), se ainda não
       estiver assim depois do GREEN.
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
@.planning/phases/02-convex-auth-workos/02-05-identidade-username-tag-PLAN.md
@convex/presence.test.ts

# 04-RESEARCH.md §4-5: Math.random() é seguro dentro de mutations do Convex (gerador seeded,
# determinístico entre retries de OCC) — não é necessário usar Web Crypto para o código de
# convite. A garantia de unicidade é 100% responsabilidade desta mutation (retry contra o
# índice by_code), o Convex não tem constraint nativa.
#
# Decisão já tomada no ROADMAP/hard_constraints do orquestrador: UM código reutilizável e
# revogável por servidor — sem expiração, sem limite de usos. Não implementar múltiplos
# convites ativos simultâneos por servidor nem TTL — generateInvite é deliberadamente
# idempotente para impor essa regra (nunca dois convites não-revogados para o mesmo servidor).
#
# Depende do plano 04-01 já ter criado convex/lib/membership.ts e a tabela invites em
# convex/schema.ts — reler esses arquivos antes de codar, não assumir a forma exata sem
# conferir.
</context>

<verification>
- `npx vitest run convex/lib/inviteCode.test.ts convex/invites.test.ts` passa.
- Revogar um convite nunca remove `serverMembers` de quem já entrou.
- `generateInvite` chamado duas vezes sem revogação no meio nunca cria um segundo convite ativo.
- Não-dono (mesmo sendo membro) não consegue gerar nem revogar convite; não-membro consegue ler `getActiveInvite`? Não — `getActiveInvite` também exige `requireMembership`, então não-membro rejeita também.
</verification>

<success_criteria>
SRV-02, SRV-03 e SRV-04 satisfeitos no nível de dados: gerar, revogar e entrar por código
funcionam de ponta a ponta, com os limites de autorização (dono vs. membro vs. não-membro)
verificáveis por teste automatizado, sem depender de UI.
</success_criteria>

<output>
After completion, create `.planning/phases/04-servidores-e-canais/04-02-SUMMARY.md`.
</output>
