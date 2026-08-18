# Research: Fase 6 — Amigos e DMs

**Pesquisado em:** 2026-08-18
**Fontes:** documentação oficial (docs.convex.dev — Pagination, Indexes and Query
Performance, Testing/convex-test), código real já publicado no repo
(`convex/users.ts`, `convex/presence.ts`, `convex/lib/tag.ts`, `convex/users.test.ts`
do plano 02-05/02-06, lidos diretamente do disco — não da memória), e
`.planning/research/PITFALLS.md`. Nível de confiança: ALTO para os três tópicos
pedidos pela tarefa (índice de par canônico, paginação de mensagens de DM, padrões
de `convex-test`) — verificados contra doc oficial, não assumidos.

## 1. Estado real do código no momento do planejamento

`convex/schema.ts` só tem `users` e `presence` (confirmado por leitura direta).
Mas **o código de `convex/users.ts`, `convex/presence.ts`, `convex/lib/tag.ts` e
seus três arquivos de teste já existem no disco e passam** (`npx vitest run convex`
→ 3 arquivos, 12 testes, todos verdes), mesmo a Fase 2 estando registrada como
"2/9 planos" no ROADMAP/STATE. Isso confirma o que a tarefa já avisava: F2 está
executando em paralelo e adiantada em relação ao tracking. Os planos abaixo tratam
como pré-condição real (não hipotética) que:

- `convex/users.ts` exporta `ensureUser` (mutation sem args, upsert por
  `identity.subject` via índice `by_workos_id`, gera `username#tag` só no primeiro
  login via `findAvailableTag`/`generateFourDigitTag` de `convex/lib/tag.ts`).
- O padrão de autorização em toda mutation existente é idêntico:
  `ctx.auth.getUserIdentity()` → `throw` se `null` → resolve o documento `users`
  correspondente via `by_workos_id` → nunca aceita um `userId`/`workosId` vindo de
  argumento do cliente.
- `convex/presence.ts` exporta `heartbeat` (upsert por usuário autenticado,
  índice `by_user`).
- Testes usam `convexTest(schema, modules)` com
  `const modules = import.meta.glob('./**/*.ts')` e chamam funções via
  `anyApi.<arquivo>.<export>` (de `convex/server`), não `api` gerado — evita
  depender de `convex/_generated/api.ts` (que só existe depois de `npx convex dev`
  rodar com o schema atualizado).

Os planos desta fase **reaproveitam** esse padrão de autorização (resolver o
usuário chamador uma vez, no início do handler) em vez de reimplementá-lo, e
**estendem** `convex/users.ts` com uma nova query pública (`findUserByUsernameTag`),
sem tocar em `ensureUser` nem em `convex/lib/tag.ts`.

## 2. Índice de par canônico (`friendships`) — verificado contra docs.convex.dev

Fonte: [Indexes and Query Performance](https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf).

Regras confirmadas:
- Índices compostos exigem `.eq()` nos campos **na ordem em que foram declarados**
  no `.index(name, [...])`. Não dá para pular o primeiro campo para filtrar só
  pelo segundo.
- Índices compostos suportam consulta por **prefixo**: um índice `['userA',
  'userB']` responde eficientemente tanto a `q.eq('userA', x).eq('userB', y)`
  (ponto exato) quanto a `q.eq('userA', x)` sozinho (todos os documentos com
  aquele `userA`, sem tocar em `userB`) — a doc mostra exatamente esse padrão com
  `['author', 'title']`.
- A doc não cobre lookup bidirecional (par simétrico) diretamente — não existe
  guidance oficial para "A e B são amigos, não importa quem é A e quem é B". A
  resolução fica por conta da decisão de schema já travada no hard constraint:
  guardar o par em **ordem canônica** (`userA < userB`), o que transforma a
  pergunta simétrica em uma consulta de ponto determinística.

Decisão de índice para `friendships` (2 índices, não 3 — reaproveitando prefixo):

```ts
friendships: defineTable({
  userA: v.id('users'),
  userB: v.id('users'),
  createdAt: v.number(),
})
  .index('by_pair', ['userA', 'userB'])
  .index('by_userB', ['userB'])
```

- **"Somos amigos?"** (canônico já calculado antes da query, `a < b`):
  `.withIndex('by_pair', q => q.eq('userA', a).eq('userB', b)).unique()` — ponto
  exato, nunca mais de um documento por design (garantido pela ordem canônica, não
  pelo Convex, que não tem unique constraint nativa — mesma ressalva já registrada
  em `02-RESEARCH.md §5` para `users.by_username_tag`).
- **"Todas as amizades do usuário X"** (X pode estar em qualquer posição do par):
  união de duas queries indexadas, nunca um `.filter()`:
  `by_pair` com `q.eq('userA', x)` (prefixo — pega tudo onde X é `userA`) **+**
  `by_userB` com `q.eq('userB', x)` (pega tudo onde X é `userB`). `by_pair` faz
  dupla função (ponto exato E prefixo), por isso só 2 índices bastam, não 3.

Mesmo padrão de prefixo aplicado a `friendRequests` (checar pedido em ambas as
direções com um único índice composto) e a `dmMembers` (checar "X é membro do
canal Y" e "listar membros do canal Y" com o mesmo índice):

```ts
friendRequests: defineTable({
  fromUserId: v.id('users'),
  toUserId: v.id('users'),
  createdAt: v.number(),
})
  .index('by_from_to', ['fromUserId', 'toUserId']) // ponto: pedido A→B existe?
  .index('by_to', ['toUserId'])                     // listar pedidos recebidos

dmMembers: defineTable({
  dmChannelId: v.id('dmChannels'),
  userId: v.id('users'),
})
  .index('by_user', ['userId'])                        // listar minhas DMs
  .index('by_channel_user', ['dmChannelId', 'userId'])  // prefixo: membros do canal
                                                          // ponto: X é membro do canal?
```

Sem `status` em `friendRequests`: a existência do documento **é** o estado
"pendente" — aceitar apaga o pedido e insere `friendships`; recusar só apaga.
Decisão deliberada (diverge do §5 do design doc, que lista `status` como campo):
evita um segundo lugar para "amizade aceita" viver depois que `friendships` já é
a fonte de verdade, e elimina o índice extra que filtrar por `status` exigiria.
Sem custo de requisito — nenhum SOCIAL-0x pede histórico de pedidos recusados.

## 3. Paginação de mensagens de DM — verificado contra docs.convex.dev

Fonte: [Pagination](https://docs.convex.dev/database/pagination).

Padrão oficial confirmado:

```ts
// convex/dms.ts
import { paginationOptsValidator } from 'convex/server'

export const listDmMessages = query({
  args: { dmChannelId: v.id('dmChannels'), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    // autorização primeiro (ver §4) — nunca paginar antes de confirmar
    // que o chamador é membro do canal
    return await ctx.db
      .query('dmMessages')
      .withIndex('by_dm_channel', (q) => q.eq('dmChannelId', args.dmChannelId))
      .order('desc')
      .paginate(args.paginationOpts)
  },
})
```

Cliente (React):
```ts
const { results, status, loadMore } = usePaginatedQuery(
  api.dms.listDmMessages,
  { dmChannelId },
  { initialNumItems: 30 }
)
```

Pontos confirmados que afetam a implementação:
- `order('desc')` deve vir **antes** de `.paginate()`, encadeado na mesma query.
- O tamanho de página **pode variar** entre chamadas — mensagens sendo inseridas
  concorrentemente crescem a página atual (mesma armadilha de performance já
  registrada em `PITFALLS.md`: "Paginação reativa assumindo tamanho de página
  fixo"). A UI de DM não deve assumir `results.length === initialNumItems`.
- `status` do hook tem três valores (`"CanLoadMore"`, `"LoadingMore"`,
  `"Exhausted"`) — controla o botão/gatilho de "carregar mais histórico".
- A query inteira continua reativa: mensagens novas aparecem sem novo `loadMore`.

Sem campo `createdAt` redundante para ordenação: o índice `by_dm_channel` já
ordena por `_creationTime` como desempate implícito dentro do mesmo valor de
`dmChannelId` (comportamento documentado dos índices Convex). O campo `createdAt`
do design doc (§5) é mantido no schema por paridade com o schema aprovado e para
exibição na UI (formatar hora da mensagem, mesmo padrão de
`src/renderer/src/components/shell/MessageList.tsx`), não como chave de
ordenação.

## 4. Autorização de leitura de DM — regra e onde ela vive

Hard constraint: "um usuário não deve conseguir ler uma DM da qual não é membro".
Verificado que Convex não tem RLS automático — toda checagem é código explícito no
início do handler, mesmo padrão já usado em `ensureUser`/`heartbeat`:

```ts
async function assertDmMember(ctx, dmChannelId, userId) {
  const membership = await ctx.db
    .query('dmMembers')
    .withIndex('by_channel_user', (q) => q.eq('dmChannelId', dmChannelId).eq('userId', userId))
    .unique()
  if (!membership) throw new Error('Você não é membro desta conversa')
}
```

Chamado no início de `listDmMessages`, `sendDmMessage` e `getOrCreateDmChannel`
(neste último, implicitamente — quem chama sempre vira membro do canal que
encontra ou cria, nunca lê um canal alheio). Mesma checagem de autorização
"só o destinatário aceita/recusa" para `friendRequests`: comparar
`request.toUserId === callerUserId` antes de qualquer mutação, com teste
dedicado (padrão RED confirmado no §5 abaixo).

## 5. `convex-test` — padrões confirmados (oficial + já em uso no repo)

Fonte: [Testing](https://docs.convex.dev/testing/convex-test) + `convex/users.test.ts`
real (lido do disco).

- `convexTest(schema, modules)` — o segundo argumento (`modules =
  import.meta.glob('./**/*.ts')`) já é usado no repo e deve ser reaproveitado
  exatamente igual nos novos arquivos de teste (`convex/friends.test.ts`,
  `convex/dms.test.ts`), senão `convexTest` não encontra os handlers.
- `t.withIdentity({ subject: '...', email: '...' })` — **usar sempre `subject`**
  (não `name`, que aparece no exemplo genérico da doc oficial mas não é o campo
  que `ensureUser`/`heartbeat` leem). `identity.subject` é o campo que
  `by_workos_id` indexa.
- `t.run(ctx => ...)` — bypassa funções para seed direto no banco (ex.: inserir
  dois `users` de teste sem depender de `ensureUser`).
- Chamar funções via `anyApi.<arquivo>.<exportName>` (não `api` gerado) — mesmo
  padrão já em uso, evita depender de `convex/_generated/api.ts` desatualizado
  durante o desenvolvimento do schema desta fase.
- Padrão de teste de autorização (confirmado pela doc oficial e pelo próprio
  `users.test.ts`): criar o recurso como usuário A (`t.withIdentity({subject:
  'a'}).mutation(...)`), tentar agir como usuário B (`t.withIdentity({subject:
  'b'}).mutation(...)`), `.rejects.toThrow()`.

## 6. Componentes shadcn/ui necessários (novos)

`components.json` já existe e funciona (`00-02-SUMMARY.md`: pipeline provada com
`button`). Faltam para esta fase:
- `input` — campo de busca `USER#123` no formulário de adicionar amigo.

Não são necessários `dialog` nem `tabs`: seguindo o padrão já estabelecido em
`VoiceControlBar.tsx` (alternância de estado com botões simples, sem componente
de biblioteca), o painel de amigos alterna entre "Amigos" / "Pendentes" /
"Adicionar" com um toggle de botões local, e o formulário de adicionar amigo é
inline (sem modal) — reduz a superfície nova de UI a instalar/testar.

## 7. UI: extensão do shell existente (não um sistema paralelo)

`src/renderer/src/state/selection-context.tsx` é o único lugar de estado de
navegação do shell (Fase 3). Fase 6 estende esse mesmo contexto em vez de criar
um segundo — adiciona `view: 'server' | 'home'`, `selectedDmChannelId`,
`setSelectedDmChannelId` e `goHome()`. `setSelectedServerId` passa a também
setar `view: 'server'` como efeito colateral (clicar em qualquer servidor sai do
modo Home), meio mínimo de manter os dois modos consistentes sem introduzir uma
segunda fonte de verdade.

`AppShell.tsx` passa a decidir, com base em `view`:
- `ServerRail` sempre visível (ganha um botão "Início" fixo, Fase 6).
- `view === 'server'`: `ChannelSidebar` + `ConversationArea` + `MemberList`
  (inalterado, Fase 3).
- `view === 'home'`: `DmSidebar` (nova) no lugar de `ChannelSidebar`,
  `FriendsPanel`/`DmConversationView` (novos) no lugar de `ConversationArea`, sem
  `MemberList` (Discord real também não mostra lista de membros na Home — não é
  corte de escopo, é o layout correto).

`MessageList`/`MessageInput` (Fase 3) são reaproveitados como estão na conversa
de DM — já são genéricos por `Message[]`/`onSend`, não amarrados a canal de
servidor.

## 8. Decisões consolidadas para os planos

1. `friendships`: 2 índices (`by_pair`, `by_userB`), par canônico calculado no
   servidor antes de qualquer leitura/escrita (nunca confiar em ordem vinda do
   cliente).
2. `friendRequests`: sem campo `status` — existência do documento é "pendente";
   2 índices (`by_from_to`, `by_to`).
3. `dmMembers`: 2 índices (`by_user`, `by_channel_user`), sem índice
   `by_dm_channel` separado (prefixo de `by_channel_user` já cobre "listar
   membros do canal").
4. `dmMessages`: 1 índice (`by_dm_channel`), paginado com
   `paginationOptsValidator` + `usePaginatedQuery`, ordenado `desc`.
5. `dmChannels`: sem campos de par — a relação vive inteiramente em
   `dmMembers` (hard constraint: join table, não array), inclusive para
   deduplicar "já existe uma DM entre mim e X" (~9 lookups indexados no máximo,
   escala de 10 usuários).
6. Nova query pública `findUserByUsernameTag` entra em `convex/users.ts`
   (arquivo existente, índice `by_username_tag` já publicado) — não reimplementa
   `ensureUser`/geração de tag, só adiciona um lookup.
7. Toda autorização (quem pode aceitar pedido, quem pode ler/escrever DM) é
   checagem explícita no início do handler, mesmo padrão de
   `ensureUser`/`heartbeat` já em produção — testada com `convex-test` seguindo
   o padrão confirmado no §5.
8. UI estende `selection-context.tsx`/`AppShell.tsx` existentes (Fase 3), não
   cria layout paralelo. Único componente shadcn novo: `input`.

---
*Research para: Fase 6 — Amigos e DMs*
*Pesquisado em: 2026-08-18*
