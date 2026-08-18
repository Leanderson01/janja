---
phase: 04-servidores-e-canais
plan: 03
type: tdd
wave: 2
depends_on: ["04-01"]
files_modified:
  - convex/channels.ts
  - convex/channels.test.ts
autonomous: true

must_haves:
  truths:
    - "Membro de um servidor cria canais de texto e de voz dentro dele"
    - "Não-membro não consegue listar, ler nem criar canal em um servidor do qual não participa"
    - "Canais aparecem na ordem em que foram criados, sem depender da ordem de inserção no banco"
  artifacts:
    - path: "convex/channels.ts"
      provides: "createChannel, listChannels, getChannel — todos exigindo participação no servidor"
      exports: ["createChannel", "listChannels", "getChannel"]
  key_links:
    - from: "convex/channels.ts"
      to: "convex/lib/membership.ts (requireMembership)"
      via: "toda function desta tabela chama requireMembership antes de tocar em channels"
      pattern: "requireMembership"
    - from: "convex/channels.ts (listChannels)"
      to: "convex/schema.ts (channels.by_server)"
      via: "withIndex('by_server', ...) — nunca .filter() sobre a tabela inteira"
      pattern: "by_server"
---

<feature>
  <name>Canais de texto e voz dentro de um servidor (SRV-05, SRV-06)</name>
  <files>convex/channels.ts, convex/channels.test.ts</files>
  <behavior>
    **`createChannel({ serverId, name, type })`** (mutation), `type: 'text' | 'voice'`:
    - Exige `requireMembership(ctx, serverId)` de `convex/lib/membership.ts` (plano 04-01) —
      qualquer membro pode criar canal, não só o dono (SRV-05 diz "usuário... onde é membro",
      sem restringir a dono; não inventar uma regra de "só dono cria canal" que o requisito não
      pede). Caso de teste central de SRV-06: usuário que NÃO é membro do servidor chama e
      recebe rejeição — o canal não é criado.
    - Valida `name.trim()` entre 1 e 50 caracteres; nome vazio/só espaços rejeita.
    - `position`: calculada como a contagem atual de canais do servidor no momento da criação
      (`existing.length`), então o próximo canal sempre vai para o fim da lista. Não é preciso
      lógica de reordenação nesta fase — mover/reordenar canais não é requisito de SRV-05.
    - Retorna o `Id<'channels'>` criado.
    - Caso de teste: criar um canal `type: 'text'` e um `type: 'voice'` no mesmo servidor,
      confirmar que ambos existem com o `type` correto e `position` 0 e 1 respectivamente.

    **`listChannels({ serverId })`** (query):
    - Exige `requireMembership`. Caso de teste central de SRV-06: não-membro chama e recebe
      rejeição — a query não vaza nenhum dado de canal para quem não participa do servidor
      (nem nome, nem tipo, nem contagem).
    - Usa `withIndex('by_server', q => q.eq('serverId', serverId))`, nunca `.filter()` como
      substituto de índice (armadilha de performance do `PITFALLS.md`).
    - Retorna os canais ordenados por `position` crescente (ordenar em memória depois do
      `.collect()` — o volume por servidor é pequeno, não precisa de índice para o campo
      `position`).

    **`getChannel({ channelId })`** (query):
    - Busca o canal por `ctx.db.get(channelId)`; se não existir, retorna `null` (não lança —
      um `channelId` obsoleto/de outro contexto não deveria quebrar a UI que consulta o canal
      selecionado no momento). Se existir, exige `requireMembership(ctx, channel.serverId)`
      **antes** de retornar qualquer campo — não-membro não consegue descobrir nome/tipo de um
      canal nem sabendo o `channelId` de antemão. Caso de teste: não-membro chamando
      `getChannel` de um canal real (não um id inexistente) recebe rejeição, não `null` nem os
      dados do canal.
  </behavior>
  <implementation>
    Mesmo padrão de teste de `convex/presence.test.ts`/`convex/servers.test.ts`: `convexTest`,
    `anyApi`, `import.meta.glob('./**/*.ts')`, `t.withIdentity`, `t.run` para popular
    `users`/`servers`/`serverMembers` diretamente antes de exercitar `channels.ts`.

    `convex/channels.ts` importa só `requireMembership` de `./lib/membership` (plano 04-01) —
    criar canal e listar canal não têm restrição de "dono", então `requireOwnership` não é
    usado aqui.

    Sequência RED → GREEN → REFACTOR:
    1. RED: `convex/channels.test.ts` cobrindo os casos acima (incluindo os dois testes
       diretos de SRV-06: não-membro não lê, não-membro não escreve) contra implementação
       ainda inexistente.
    2. GREEN: implementar `convex/channels.ts`.
    3. REFACTOR: se `createChannel`/`listChannels`/`getChannel` repetirem lógica de validação
       de nome, extrair para uma função pequena testável — só se o REFACTOR revelar
       duplicação real, não antecipar.
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
@.planning/research/PITFALLS.md
@convex/presence.test.ts

# PITFALLS.md, "Performance Traps": query de listagem usando .filter() em vez de
# withIndex('by_channel'/'by_server', ...) é tratada como defeito, não nicety de performance —
# ver checklist de verificação deste plano.
#
# Depende do plano 04-01 já ter criado a tabela channels (índice by_server) e
# convex/lib/membership.ts — reler esses arquivos antes de codar.
#
# Escopo: só CRUD de canal (criar, listar, buscar um). Mensagens dentro do canal (F5) e estado
# de voz (voiceStates, F7) são fora de escopo — este plano não cria nem referencia essas
# tabelas.
</context>

<verification>
- `npx vitest run convex/channels.test.ts` passa.
- Todo teste de não-membro (`createChannel`, `listChannels`, `getChannel`) rejeita, sem exceção — é o teste direto de SRV-06 para o domínio de canais.
- Nenhuma query desta fase usa `.filter()` como substituto de índice para o campo `serverId`.
</verification>

<success_criteria>
SRV-05 satisfeito no nível de dados (membro cria canal de texto e de voz) e SRV-06 verificado
por teste automatizado especificamente para canais (não-membro não lê nem escreve), sem
depender de UI nem de mídia real.
</success_criteria>

<output>
After completion, create `.planning/phases/04-servidores-e-canais/04-03-SUMMARY.md`.
</output>
