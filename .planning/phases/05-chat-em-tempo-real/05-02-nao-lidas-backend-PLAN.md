---
phase: 05-chat-em-tempo-real
plan: 02
type: tdd
wave: 2
depends_on: ["05-01"]
files_modified:
  - convex/channelReadState.ts
  - convex/channelReadState.test.ts
autonomous: true

must_haves:
  truths:
    - "Ao abrir um canal, o usuário recebe o id exato da primeira mensagem não lida (ou null se já leu tudo, ou nunca leu e o canal está vazio)"
    - "Depois de abrir o canal, o estado de leitura avança para a mensagem mais recente — abrir de novo sem mensagem nova nenhuma não aponta mais nenhum divisor"
    - "A contagem de não lidas por canal de um servidor só é visível para quem é membro do servidor, e é 0 para um canal totalmente lido"
  artifacts:
    - path: "convex/channelReadState.ts"
      provides: "Mutation openChannel (marca lido + devolve o divisor), query getUnreadCounts (badge por canal de um servidor)"
      exports: ["openChannel", "getUnreadCounts"]
  key_links:
    - from: "convex/channelReadState.ts (openChannel)"
      to: "convex/schema.ts (messages.by_channel, _creationTime implícito)"
      via: "withIndex('by_channel', q => q.eq('channelId', channelId).gt('_creationTime', antigo._creationTime)).order('asc').first() — range query indexada, não scan"
      pattern: "gt('_creationTime'"
    - from: "convex/channelReadState.ts (getUnreadCounts)"
      to: "convex/lib/membership.ts (requireMembership)"
      via: "requireMembership(ctx, serverId) antes de tocar em qualquer canal do servidor"
      pattern: "requireMembership"
---

<feature>
  <name>Marcar canal como lido, divisor de não lidas e badge de contagem (CHAT-05, CHAT-06)</name>
  <files>convex/channelReadState.ts, convex/channelReadState.test.ts</files>
  <behavior>
    **`openChannel({ channelId })`** (mutation) — chamada pelo cliente ao abrir um canal
    (mount) e de novo, silenciosamente, sempre que uma mensagem nova chega enquanto o
    usuário está com o scroll no fim (plano 05-04 decide quando chamar; este plano só
    implementa o efeito):
    - Exige `requireChannelMembership` (helper local, mesmo padrão de
      `convex/messages.ts` — não importado de lá, reimplementado aqui; ver
      `05-RESEARCH.md §1`).
    - Lê o `channelReadState` atual (`by_channel_user`, busca pontual
      `eq('channelId', channelId).eq('userId', user._id)`, `.unique()`). Guarda
      `lastReadMessageIdAntigo` (pode ser `undefined` — nunca leu este canal antes).
    - Calcula o divisor **antes** de atualizar o ponteiro:
      - Se `lastReadMessageIdAntigo` é `undefined`: divisor = primeira mensagem do canal
        (`by_channel`, `order('asc')`, `.first()`), ou `null` se o canal não tem mensagem
        nenhuma ainda.
      - Se existe: busca a mensagem antiga (`ctx.db.get`) para obter seu `_creationTime`
        (se a mensagem antiga não existir mais — não deveria acontecer, não há delete de
        mensagem nesta fase — trata como "nunca leu", cai no caso acima), depois busca a
        primeira mensagem **depois** dela: `messages.by_channel`,
        `.eq('channelId', channelId).gt('_creationTime', mensagemAntiga._creationTime)`,
        `.order('asc').first()`. Se não houver nenhuma (já leu tudo), divisor = `null`.
    - Busca a mensagem mais recente do canal (`by_channel`, `order('desc')`, `.first()`).
      Se existir, faz upsert de `channelReadState` apontando `lastReadMessageId` para
      ela (`ctx.db.patch` se já existia linha, `ctx.db.insert` se não). Se o canal não
      tem mensagem nenhuma, não cria/atualiza linha nenhuma (nada para marcar como lido).
    - Retorna `{ firstUnreadMessageId: Id<'messages'> | null }`.
    - Caso de teste central: canal com mensagens A, B, C, D (nessa ordem de criação).
      Usuário nunca leu → `openChannel` retorna `firstUnreadMessageId === A`. Chamar de
      novo imediatamente (sem mensagem nova) → retorna `null` (já leu tudo até D).
      Inserir uma mensagem E depois → chamar `openChannel` de novo → retorna
      `firstUnreadMessageId === E`.
    - Caso de teste: canal sem nenhuma mensagem → `openChannel` retorna
      `{ firstUnreadMessageId: null }`, sem lançar, sem criar linha em
      `channelReadState`.
    - Caso de teste de autorização: não-membro do servidor chamando `openChannel` de um
      canal real é rejeitado.

    **`getUnreadCounts({ serverId })`** (query) — alimenta o badge de contagem por canal
    na sidebar (CHAT-06):
    - Exige `requireMembership(ctx, serverId)` (importado de `convex/lib/membership.ts`
      diretamente — aqui não precisa resolver via canal, o argumento já é `serverId`).
    - Lista os canais do servidor (`channels.by_server`, mesmo índice de
      `convex/channels.ts`), filtra só `type === 'text'` (canal de voz nunca tem
      mensagem).
    - Para cada canal de texto (`Promise.all`, mesmo padrão de `listServerMembers`):
      busca o `channelReadState` do chamador (`by_channel_user`, busca pontual). Se não
      existir (nunca abriu o canal): contagem = total de mensagens do canal
      (`by_channel`, `.collect().length` — aceitável, contagem de não lidas nunca escala
      além do volume real de mensagens de um canal, e é sempre lida por índice, nunca
      scan da tabela inteira). Se existir: busca a mensagem lida para pegar
      `_creationTime` e conta quantas vieram depois
      (`by_channel.eq('channelId',...).gt('_creationTime', lida._creationTime)`,
      `.collect().length`).
    - Retorna `{ channelId: Id<'channels'>, unreadCount: number }[]`.
    - Caso de teste: servidor com dois canais de texto — um com 3 mensagens não lidas
      (nunca aberto), outro totalmente lido (0) — confirma as duas contagens corretas na
      mesma chamada, e que um canal de voz do mesmo servidor não aparece no resultado.
    - Caso de teste de autorização: não-membro chamando com um `serverId` real é
      rejeitado, sem vazar nenhuma contagem.
  </behavior>
  <implementation>
    Mesmo padrão de `convex/messages.test.ts` (plano 05-01): `convexTest(schema,
    modules)`, `anyApi`, `t.withIdentity`, `t.run` para popular `users`/`servers`/
    `serverMembers`/`channels`/`messages` diretamente — não depender de
    `sendMessage`/`createChannel` reais dentro do teste (mais rápido e determinístico
    para controlar a ordem de criação das mensagens).

    `requireChannelMembership` é reimplementado localmente neste arquivo (idêntico ao de
    `convex/messages.ts`, não importado de lá — `05-RESEARCH.md §1`/§5 explica por quê).
    Só é usado por `openChannel` (que recebe `channelId`); `getUnreadCounts` recebe
    `serverId` diretamente e usa `requireMembership` puro, sem precisar resolver canal
    nenhum antes.

    Sequência RED → GREEN → REFACTOR:
    1. RED: `convex/channelReadState.test.ts` cobrindo os casos acima.
    2. GREEN: implementar `convex/channelReadState.ts`.
    3. REFACTOR: se o cálculo "mensagens depois de X" se repetir entre `openChannel` e
       `getUnreadCounts` de forma idêntica, extrair uma função pequena testável — só se
       o REFACTOR revelar duplicação real.
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
@convex/messages.ts
@convex/members.ts
@convex/lib/membership.ts

# Depende do plano 05-01 já ter criado as tabelas messages/channelReadState/typing no
# schema. Não depende do conteúdo de convex/messages.ts em si (não importa nada de lá),
# só precisa que as tabelas existam — pode rodar em paralelo ao plano 05-03
# (convex/typing.ts), que também só depende do schema.
#
# 05-RESEARCH.md §5/§6: por que não existe um campo firstUnreadMessageId armazenado, e
# como a range query sobre _creationTime implícito funciona (confirmado contra doc
# oficial do Convex, não é um chute).
#
# Escopo: só marcar-como-lido/divisor/badge. NÃO criar convex/typing.ts (plano 05-03) nem
# tocar em nenhum arquivo de UI (planos 05-04/05-05).
</context>

<verification>
- `npx vitest run convex/channelReadState.test.ts` passa.
- `npm run typecheck:convex` passa sem erro.
- Todo teste de não-membro (`openChannel`, `getUnreadCounts`) rejeita.
- Nenhuma query usa `.filter()` como substituto de índice; a única `.collect()` existente
  é sobre um range já restrito por índice (mensagens de UM canal, não a tabela inteira).
</verification>

<success_criteria>
CHAT-05 e CHAT-06 satisfeitos no nível de dados: divisor de não lidas correto ao reabrir
canal (incluindo o caso "nunca li" e "já li tudo"), e contagem de não lidas por canal
verificável por teste automatizado, sem depender de UI. Base pronta para os planos
05-04 (divisor na UI) e a sidebar (badge).
</success_criteria>

<output>
After completion, create `.planning/phases/05-chat-em-tempo-real/05-02-SUMMARY.md`.
</output>
