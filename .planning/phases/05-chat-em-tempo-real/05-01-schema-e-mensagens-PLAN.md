---
phase: 05-chat-em-tempo-real
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - convex/schema.ts
  - convex/messages.ts
  - convex/messages.test.ts
autonomous: true

must_haves:
  truths:
    - "Membro de um canal de texto envia mensagem e ela aparece imediatamente para os outros membros do mesmo canal (base de CHAT-01/CHAT-02: a entrega é responsabilidade da reatividade do Convex, não de código extra)"
    - "Não-membro do servidor não consegue ler nem enviar mensagem em nenhum canal dele, mesmo sabendo o channelId"
    - "Histórico de mensagens é paginado (nunca um .collect() de um canal inteiro) e vem ordenado da mais nova para a mais antiga, com a mensagem mais recente sempre na primeira página"
  artifacts:
    - path: "convex/schema.ts"
      provides: "Tabelas messages, channelReadState, typing somadas às 10 tabelas já existentes (Fases 2/4/6)"
      contains: "messages: defineTable"
    - path: "convex/messages.ts"
      provides: "Mutation sendMessage, query listMessages (paginada, enriquecida com autor e isMine)"
      exports: ["sendMessage", "listMessages"]
  key_links:
    - from: "convex/messages.ts"
      to: "convex/lib/membership.ts (requireMembership)"
      via: "requireChannelMembership local resolve channel.serverId e chama requireMembership antes de tocar em messages"
      pattern: "requireMembership"
    - from: "convex/messages.ts (listMessages)"
      to: "convex/schema.ts (messages.by_channel)"
      via: "withIndex('by_channel', ...).order('desc').paginate(paginationOpts) — nunca .filter() nem .collect() do canal inteiro"
      pattern: "paginate"
---

<feature>
  <name>Schema de chat + envio e listagem paginada de mensagens (CHAT-01, CHAT-02, CHAT-03 no nível de dados)</name>
  <files>convex/schema.ts, convex/messages.ts, convex/messages.test.ts</files>
  <behavior>
    **Schema** (`convex/schema.ts`): acrescentar, entre o bloco "Fase 4: servidores e
    canais" e o bloco "Fase 6: amigos e DMs" (preservar as duas seções exatamente como
    estão — só inserir entre elas), uma nova seção "Fase 5: chat em tempo real":
    ```ts
    messages: defineTable({
      channelId: v.id('channels'),
      authorId: v.id('users'),
      content: v.string(),
      createdAt: v.number(),
    }).index('by_channel', ['channelId']),

    channelReadState: defineTable({
      channelId: v.id('channels'),
      userId: v.id('users'),
      lastReadMessageId: v.optional(v.id('messages')),
    }).index('by_channel_user', ['channelId', 'userId']),

    typing: defineTable({
      channelId: v.id('channels'),
      userId: v.id('users'),
      updatedAt: v.number(),
    }).index('by_channel_user', ['channelId', 'userId']),
    ```
    Um único índice por tabela nova (05-RESEARCH.md §5/§7: `by_channel_user` serve tanto
    busca pontual quanto listagem por prefixo em `channelId`; `by_channel` em `messages`
    é o único índice que a paginação precisa). `channelReadState`/`typing` são criadas
    aqui (schema) mas só ganham `query`/`mutation` própria nos planos 05-02/05-03 — este
    plano só declara as tabelas, não escreve function nenhuma para elas.

    Sem `editedAt` (campo do design doc §5): CHAT-08 (editar mensagem) é escopo v2,
    mesmo corte que `06-RESEARCH.md` já aplicou a `friendRequests.status` — não criar
    campo morto sem requisito v1 que o use.

    **`sendMessage({ channelId, content })`** (mutation):
    - Resolve o canal (`ctx.db.get(channelId)`); se não existir, lança. Se existir, exige
      `requireMembership(ctx, channel.serverId)` (de `convex/lib/membership.ts`, Fase 4 —
      importado, nunca editado) via um helper local `requireChannelMembership` (não
      exportado — mesmo padrão de `assertDmMember` em `convex/dms.ts`, Fase 6:
      arquivos de domínio de fases diferentes não compartilham função interna entre si,
      só os helpers já publicamente exportados de `lib/membership.ts`).
    - Rejeita se `channel.type !== 'text'` (não dá pra mandar mensagem em canal de voz —
      validação defensiva; a UI atual (Fase 3/4) nunca monta `MessageInput` numa view de
      canal de voz, mas o backend não deve confiar só nisso).
    - Valida `content.trim()` entre 1 e 2000 caracteres (limite arbitrário mas
      documentado — mesma ordem de grandeza de apps de chat reais); vazio/só espaço ou
      acima do limite lança, nenhuma linha é inserida.
    - Caminho feliz: insere `{ channelId, authorId: user._id, content: trimmed,
      createdAt: Date.now() }` em `messages`. Caso de teste: membro válido envia, a
      mensagem aparece em `t.run(ctx => ctx.db.query('messages').collect())` com
      `authorId` correto.
    - Caso de teste central (equivalente a SRV-06 para chat): usuário que não é membro do
      servidor do canal chama `sendMessage` e é rejeitado; `messages` continua vazia.
    - Caso de teste: chamar com um `channelId` de um canal `type: 'voice'` real (inserido
      via `t.run`) é rejeitado, mesmo sendo membro.

    **`listMessages({ channelId, paginationOpts })`** (query, `paginationOptsValidator`
    de `convex/server`):
    - Mesma checagem de `requireChannelMembership` antes de tocar em `messages`. Caso de
      teste: não-membro chamando um canal real (não um id inexistente) é rejeitado — a
      query não vaza nem uma mensagem, nem a contagem, para quem não participa do
      servidor.
    - `ctx.db.query('messages').withIndex('by_channel', q => q.eq('channelId',
      channelId)).order('desc').paginate(paginationOpts)` — nunca `.filter()` como
      substituto de índice (armadilha de performance documentada em `PITFALLS.md` e nas
      hard constraints desta fase).
    - Enriquece cada mensagem da página com o autor (`ctx.db.get(message.authorId)`,
      mesmo padrão de `Promise.all(...)` que `convex/members.ts:listServerMembers` já usa
      para juntar `serverMembers`+`users`+`presence`) e com `isMine: message.authorId ===
      user._id` — computado aqui porque `user` (o chamador) já foi resolvido pela
      checagem de autorização, sem nenhuma consulta extra. Retorna
      `{ ...paginationResult, page: enriched }`, preservando `isDone`/`continueCursor`
      originais do resultado de `.paginate()`.
    - Caso de teste de paginação: inserir 35 mensagens num canal (via `t.run`, variando
      `createdAt` para ordem determinística), chamar `listMessages` com
      `paginationOpts: { numItems: 30, cursor: null }` → `page.length === 30`,
      `isDone === false`, primeira mensagem da página é a mais recente (`createdAt`
      maior), última é a 6ª mais recente. Chamar de novo com o `continueCursor` recebido
      → as 5 mensagens restantes, `isDone === true`.
    - Caso de teste: mensagem enviada por Ana aparece com `isMine: true` quando Ana lista,
      e `isMine: false` quando Bruno (outro membro) lista o mesmo canal.
    - Caso de teste: `author` de uma mensagem cujo autor ainda existe tem
      `username`/`tag`/`displayName` corretos (não expõe `workosId`, mesmo cuidado de
      `listServerMembers`).
  </behavior>
  <implementation>
    Mesmo padrão de teste de `convex/channels.test.ts`/`convex/members.test.ts`:
    `convexTest(schema, modules)` com `modules = import.meta.glob('./**/*.ts')`,
    `anyApi` de `convex/server` (nunca `api` gerado), `t.withIdentity({ subject: '...' })`
    por usuário simulado, `t.run(ctx => ...)` para popular `users`/`servers`/
    `serverMembers`/`channels`/`messages` diretamente antes de exercitar
    `convex/messages.ts` — não depender de `createServer`/`createChannel` reais dentro do
    teste (mais rápido, e este arquivo não testa criação de servidor/canal, isso já é
    coberto em `servers.test.ts`/`channels.test.ts`).

    `convex/messages.ts` importa só `requireMembership` de `./lib/membership` — não
    importa `requireIdentity` nem `requireOwnership` diretamente (o helper local
    `requireChannelMembership` já delega para `requireMembership`, que por sua vez chama
    `requireIdentity` internamente).

    Sequência RED → GREEN → REFACTOR:
    1. RED: `convex/messages.test.ts` cobrindo todos os casos acima (autorização,
       validação, tipo de canal, join de autor, `isMine`, paginação com cursor) contra
       implementação ainda inexistente.
    2. GREEN: implementar `convex/schema.ts` (as 3 tabelas) e `convex/messages.ts`
       (`sendMessage`, `listMessages`, `requireChannelMembership` local).
    3. REFACTOR: se validação de conteúdo/checagem de canal se repetir de forma óbvia,
       extrair — só se o REFACTOR revelar duplicação real, não antecipar.
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
@.planning/research/PITFALLS.md
@convex/schema.ts
@convex/channels.ts
@convex/channels.test.ts
@convex/members.ts
@convex/lib/membership.ts

# convex/schema.ts, no momento em que este plano foi escrito, já tem 10 tabelas (Fases 2,
# 4 e 6 — 4 e 6 rodando em paralelo). Releia o arquivo antes de editar: se mais alguma
# tabela tiver sido acrescentada nesse meio tempo por qualquer uma das duas fases,
# preserve tudo e só insira o bloco "Fase 5" na posição indicada (entre o bloco Fase 4 e
# o bloco Fase 6, se ambos existirem; se só o bloco Fase 4 existir, insira depois dele).
#
# 05-RESEARCH.md §1 e §6: por que `requireChannelMembership` é local a este arquivo (não
# exportado, não vai para convex/lib/membership.ts) e por que a checagem de _creationTime
# em range query funciona mesmo sem declarar o campo no índice (usado pelos planos 05-02/
# 05-03, não por este, mas a mesma explicação vale para o padrão de índice usado aqui).
#
# Escopo: só schema (messages/channelReadState/typing) + convex/messages.ts (enviar,
# listar paginado). NÃO criar convex/channelReadState.ts nem convex/typing.ts — são os
# planos 05-02/05-03, que dependem deste só pelo schema, não pelo conteúdo deste arquivo.
</context>

<verification>
- `npx vitest run convex/messages.test.ts` passa.
- `npm run typecheck:convex` passa sem erro.
- Todo teste de não-membro (`sendMessage`, `listMessages`) rejeita, sem exceção.
- Nenhuma query desta fase usa `.filter()` como substituto de índice, nem `.collect()`
  sobre `messages` de um canal inteiro (só a paginação real do teste, que usa
  `paginationOpts` explícito).
- `convex/schema.ts` tem 13 tabelas: as 10 já existentes (intocadas) + `messages`,
  `channelReadState`, `typing`.
</verification>

<success_criteria>
CHAT-01 satisfeito no nível de dados (membro envia mensagem, ela existe no canal
correto). CHAT-02 satisfeito estruturalmente (entrega via reatividade nativa do Convex,
sem polling nem código extra que introduza latência — a medição fim-a-fim fica para o
checkpoint humano, plano 05-06). Base de dados de CHAT-03 pronta: paginação real,
indexada, ordenada, testada com cursor. Fundação para os planos 05-02 a 05-05.
</success_criteria>

<output>
After completion, create `.planning/phases/05-chat-em-tempo-real/05-01-SUMMARY.md`.
</output>
