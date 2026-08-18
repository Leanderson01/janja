---
phase: 05-chat-em-tempo-real
plan: 03
type: tdd
wave: 2
depends_on: ["05-01"]
files_modified:
  - convex/typing.ts
  - convex/typing.test.ts
autonomous: true

must_haves:
  truths:
    - "Membro de um canal registra 'estou digitando' com uma única mutation barata, sem gerar uma linha nova a cada tecla"
    - "A lista de quem está digitando num canal nunca inclui o próprio chamador"
    - "Não-membro do servidor não consegue registrar nem consultar quem está digitando em nenhum canal dele"
  artifacts:
    - path: "convex/typing.ts"
      provides: "Mutation setTyping (upsert por canal+usuário), query listTyping (linhas cruas com updatedAt, expiração é responsabilidade do cliente — ver 05-05)"
      exports: ["setTyping", "listTyping"]
  key_links:
    - from: "convex/typing.ts"
      to: "convex/schema.ts (typing.by_channel_user)"
      via: "upsert via busca pontual eq('channelId',...).eq('userId',...); listagem via prefixo eq('channelId',...) do mesmo índice"
      pattern: "by_channel_user"
    - from: "convex/typing.ts"
      to: "convex/lib/membership.ts (requireMembership)"
      via: "requireChannelMembership local resolve channel.serverId e chama requireMembership antes de tocar em typing"
      pattern: "requireMembership"
---

<feature>
  <name>Registro e listagem de "está digitando" (CHAT-07, metade de backend)</name>
  <files>convex/typing.ts, convex/typing.test.ts</files>
  <behavior>
    **`setTyping({ channelId })`** (mutation) — chamada pelo cliente com throttle (no
    máximo 1x a cada ~2s enquanto o usuário digita; o throttle é responsabilidade do
    cliente, plano 05-05 — este plano só garante que a mutation em si é barata e
    idempotente):
    - Exige `requireChannelMembership` (helper local, mesmo padrão de
      `convex/messages.ts`/`convex/channelReadState.ts` — reimplementado aqui, não
      importado; `05-RESEARCH.md §1`).
    - Upsert por `(channelId, userId)` via busca pontual no índice `by_channel_user`:
      se já existe uma linha, `ctx.db.patch(existing._id, { updatedAt: Date.now() })`; se
      não, `ctx.db.insert('typing', { channelId, userId: user._id, updatedAt: Date.now()
      })`. Nunca insere uma segunda linha para o mesmo par canal+usuário — mesmo
      raciocínio de "upsert nunca duplica" já testado em `convex/presence.test.ts`.
    - Caso de teste: chamar `setTyping` duas vezes seguidas para o mesmo canal continua
      com exatamente uma linha em `typing` para aquele usuário, e a segunda chamada
      produz `updatedAt` estritamente maior que a primeira.
    - Caso de teste de autorização: não-membro do servidor chamando `setTyping` de um
      canal real é rejeitado; nenhuma linha é criada.
    - Nenhuma mutation de "parar de digitar" existe neste arquivo — expiração é 100%
      responsabilidade do cliente (ver `05-RESEARCH.md §7`: uma query Convex não
      reavalia sozinha só porque o tempo passou, sem escrita nova; tentar expirar no
      servidor exigiria um cron/scheduled function que este design deliberadamente evita).

    **`listTyping({ channelId })`** (query):
    - Mesma checagem de `requireChannelMembership`. Caso de teste: não-membro chamando um
      canal real é rejeitado.
    - `ctx.db.query('typing').withIndex('by_channel_user', q =>
      q.eq('channelId', channelId)).collect()` — prefixo do mesmo índice usado pelo
      upsert (`05-RESEARCH.md §7`: um único índice serve os dois usos, nenhum índice
      extra `by_channel` separado é necessário).
    - Exclui a própria linha do chamador (`row.userId !== user._id`) — ninguém precisa
      ver "você está digitando" sobre si mesmo. Caso de teste: Ana e Bruno chamam
      `setTyping` no mesmo canal; `listTyping` chamado como Ana retorna só a linha de
      Bruno (e vice-versa).
    - Junta `username`/`displayName` do autor (`ctx.db.get(row.userId)`, mesmo padrão de
      join server-side de `listServerMembers`/`listMessages`). Retorna
      `{ userId, username, displayName, updatedAt }[]` — **sem filtrar por idade aqui**;
      devolve todas as linhas cruas, incluindo potencialmente antigas. A decisão de "isso
      ainda conta como digitando?" é do cliente (05-05), comparando `updatedAt` contra
      `Date.now()` local recalculado a cada segundo — ver `05-RESEARCH.md §7` para o
      motivo exato de a expiração não poder viver só no servidor.
    - Caso de teste: `updatedAt` de uma linha antiga (inserida via `t.run` simulando
      minutos atrás) ainda aparece no retorno de `listTyping` sem filtro — confirma que
      este arquivo não faz filtragem por idade (é comportamento esperado, não bug; o
      filtro é do plano 05-05).
  </behavior>
  <implementation>
    Mesmo padrão de teste de `convex/messages.test.ts`/`convex/channelReadState.test.ts`:
    `convexTest(schema, modules)`, `anyApi`, `t.withIdentity`, `t.run` para popular
    `users`/`servers`/`serverMembers`/`channels` diretamente, e para simular linhas de
    `typing` "antigas" com `updatedAt: Date.now() - N` quando o teste precisar (caso de
    teste da linha antiga acima).

    `requireChannelMembership` é reimplementado localmente neste arquivo (terceira cópia
    idêntica — em `messages.ts` e `channelReadState.ts` também — deliberado, não é
    duplicação acidental: `05-RESEARCH.md §1`/§5 explica que arquivos de domínio
    diferentes não compartilham função interna não-exportada entre si neste código-base).

    Sequência RED → GREEN → REFACTOR:
    1. RED: `convex/typing.test.ts` cobrindo os casos acima.
    2. GREEN: implementar `convex/typing.ts`.
    3. REFACTOR: só se o REFACTOR revelar duplicação real dentro deste mesmo arquivo (não
       entre arquivos — essa duplicação é intencional, ver acima).
  </implementation>
</feature>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/05-chat-em-tempo-real/05-RESEARCH.md
@.planning/phases/05-chat-em-tempo-real/05-01-schema-e-mensagens-PLAN.md
@convex/schema.ts
@convex/members.ts
@convex/presence.ts
@convex/presence.test.ts
@convex/lib/membership.ts

# Depende do plano 05-01 só pelo schema (tabela typing já criada lá). Não importa nada de
# convex/messages.ts nem convex/channelReadState.ts — pode rodar em paralelo ao plano
# 05-02, arquivos diferentes, sem conflito.
#
# 05-RESEARCH.md §7: por que a expiração de "digitando" não pode viver inteiramente no
# servidor (uma query Convex não reavalia sozinha só porque o tempo passou) — é a
# justificativa central de por que listTyping devolve linhas cruas sem filtrar por idade,
# e por que não existe (nem deveria existir) uma mutation "pararDeDigitar" nem um cron de
# limpeza.
#
# Escopo: só registro/listagem crua de "digitando". A filtragem por TTL/tick de 1s e a UI
# do indicador são do plano 05-05 — não implementar nada disso aqui.
</context>

<verification>
- `npx vitest run convex/typing.test.ts` passa.
- `npm run typecheck:convex` passa sem erro.
- Todo teste de não-membro (`setTyping`, `listTyping`) rejeita.
- `setTyping` chamado 2x para o mesmo par canal+usuário nunca produz mais de uma linha em
  `typing` (teste de upsert, mesmo padrão de `presence.test.ts`).
- Nenhuma query usa `.filter()` como substituto de índice.
</verification>

<success_criteria>
Metade de backend de CHAT-07 satisfeita e testada: registrar presença de digitação é
barato e idempotente, a listagem exclui o próprio chamador e nunca filtra por idade no
servidor (decisão deliberada, não lacuna) — pronto para o plano 05-05 aplicar TTL e
renderizar o indicador.
</success_criteria>

<output>
After completion, create `.planning/phases/05-chat-em-tempo-real/05-03-SUMMARY.md`.
</output>
