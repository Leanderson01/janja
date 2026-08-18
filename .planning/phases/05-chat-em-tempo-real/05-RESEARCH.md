# Research: Fase 5 — Chat em tempo real

**Pesquisado em:** 2026-08-18
**Fontes:** documentação oficial (docs.convex.dev — Pagination, React Pagination,
Indexes and Query Performance), `.planning/research/PITFALLS.md` (Performance Traps),
`.planning/research/FEATURES.md`, código real já publicado no repo (`convex/schema.ts`,
`convex/channels.ts`, `convex/members.ts`, `convex/servers.ts`, `convex/presence.ts` e
seus testes, lidos diretamente do disco), e `.planning/phases/06-amigos-e-dms/06-RESEARCH.md`
(pesquisa de paginação já feita para `dmMessages`, reaproveitada aqui em vez de
re-derivada). Nível de confiança: ALTO para paginação/índices (verificado contra doc
oficial), MÉDIO-ALTO para o mecanismo de "não lidas"/"digitando" (síntese própria sobre
padrões já confirmados, não existe doc oficial específica para chat).

## 1. Estado real do código no momento do planejamento

`convex/schema.ts` já tem 8 tabelas: `users`, `presence` (Fase 2), `servers`,
`serverMembers`, `invites`, `channels` (Fase 4, completa), `friendRequests`,
`friendships`, `dmChannels`, `dmMembers`, `dmMessages` (Fase 6, em andamento em
paralelo). `convex/channels.ts`, `convex/servers.ts`, `convex/members.ts` já existem e
passam (`listChannels`, `getChannel`, `createChannel`, `listServerMembers`). Esta fase
trata isso como pré-condição real, não hipotética.

Padrões confirmados por leitura direta do código (não da memória):
- Toda function de domínio resolve "quem sou eu" via `ctx.auth.getUserIdentity()` →
  `users.by_workos_id` → nunca aceita id de usuário vindo do cliente
  (`convex/lib/membership.ts:requireIdentity`).
- Autorização por participação usa `requireMembership(ctx, serverId)`
  (`convex/lib/membership.ts`), já exportado publicamente e reaproveitado por
  `channels.ts`/`servers.ts`/`members.ts` — esta fase importa a mesma função, mas
  **não edita `membership.ts`** (arquivo de F4). Cada arquivo novo desta fase resolve
  "este canal pertence a um servidor do qual sou membro?" com um helper **local, não
  exportado** (`requireChannelMembership`), mesmo padrão que `convex/dms.ts` (F6, ver
  `06-RESEARCH.md §1/§4`) usa para `assertDmMember` — arquivos de domínio diferentes não
  compartilham função interna não-exportada entre si.
- Join server-side (mensagem + autor, membro + presença) é o padrão estabelecido:
  `convex/members.ts:listServerMembers` já faz exatamente isso
  (`Promise.all(memberships.map(async m => { ctx.db.get(...), ctx.db.query(...) }))`) —
  reaproveitado aqui para `listMessages` (mensagem + autor) e `getUnreadCounts`
  (canal + contagem).
- `isOnline(lastSeen, now)` em `convex/members.ts` é o precedente direto para o
  mecanismo de expiração de "digitando" desta fase: threshold = múltiplo do intervalo de
  heartbeat (lá, 2x 45s = 90s). Esta fase aplica o mesmo raciocínio com números muito
  menores (digitando precisa expirar em segundos, não minutos).

**Decisão deliberada de não tocar `convex/users.ts`:** cogitou-se adicionar uma query
`getCurrentUser` para o cliente saber "qual é o meu `Id<'users'>`" (necessário para
estilizar a própria mensagem/excluir a si mesmo da lista de "digitando"). Rejeitado:
`convex/users.ts` é um arquivo estável de F2 que F6 também pode estar prestes a tocar
(painel de amigos precisa expor `USER#123` do próprio usuário — comentário já presente em
`UserPanel.tsx`), e as duas fases rodam em paralelo sem se coordenar. Em vez disso,
`listMessages`/`listTyping` computam os campos derivados que dependem de "quem sou eu"
**inteiramente no servidor** (`isMine: message.authorId === user._id`, excluir a própria
linha de `listTyping`) — o `user` chamador já é resolvido de qualquer forma dentro de
`requireChannelMembership`, então isso não é uma consulta extra, só um campo a mais no
retorno. Nenhum arquivo de F2 é modificado por esta fase.

## 2. Paginação de mensagens — reaproveitando 06-RESEARCH.md §3, verificado de novo

Fonte: [docs.convex.dev/database/pagination](https://docs.convex.dev/database/pagination),
[docs.convex.dev — usePaginatedQuery em React](https://docs.convex.dev/client/react/pagination).
Mesmo padrão já confirmado por `06-RESEARCH.md §3` para `dmMessages` — reaproveitado aqui
literalmente, não re-derivado:

```ts
// convex/messages.ts
import { paginationOptsValidator } from 'convex/server'

export const listMessages = query({
  args: { channelId: v.id('channels'), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { channelId, paginationOpts }) => {
    // autorização primeiro — nunca paginar antes de confirmar participação
    return await ctx.db
      .query('messages')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .order('desc')
      .paginate(paginationOpts)
  },
})
```

Cliente: `usePaginatedQuery(api.messages.listMessages, { channelId }, { initialNumItems: 30 })`.
`order('desc')` antes de `.paginate()`, `status` com quatro valores
(`"LoadingFirstPage"`, `"CanLoadMore"`, `"LoadingMore"`, `"Exhausted"`, confirmado na doc
oficial de React — `06-RESEARCH.md` já citava só três, a doc de React lista quatro
incluindo o estado de carregamento inicial).

## 3. O mecanismo exato do "pulo" (CHAT-03/CHAT-04) — verificado contra doc oficial

Fonte: [docs.convex.dev/database/pagination](https://docs.convex.dev/database/pagination)
(texto oficial) + `stack.convex.dev` (blog técnico da equipe Convex sobre paginação
totalmente reativa — MÉDIA confiança, blog não é referência normativa, mas consistente
com o texto oficial).

**Confirmado na doc oficial:** "Page sizes in Convex may change! If you request a page
of 10 items and then one item is removed, this page may 'shrink' to only have 9 items."
— o inverso também vale: inserções fazem uma página **crescer** além do tamanho pedido.
Isso é exatamente a armadilha já registrada em `PITFALLS.md` ("Paginação reativa
assumindo tamanho de página fixo").

**Mecanismo interno (blog da equipe, consistente com a doc oficial):** cada página é
definida por dois cursores **fixados** (pinned) no momento em que a página é buscada —
início e fim. Ao recomputar, Convex ignora `numItems` e devolve **tudo que existe entre
os dois cursores fixados**, não um número fixo de itens. A primeira página (buscada com
`order('desc')`, cursor inicial = "início da lista" = a mensagem mais nova possível)
tem seu cursor de início **sempre aberto para o futuro** — qualquer mensagem nova cai
dentro do intervalo da primeira página e a faz crescer. Páginas mais antigas (buscadas via
`loadMore`) têm os dois cursores fixados num ponto do passado — mensagens novas nunca
caem dentro delas, então elas não crescem/mudam quando alguém manda mensagem agora.

**Consequência de design, específica desta fase:**
- `results` (a lista concatenada que `usePaginatedQuery` devolve) fica ordenado do mais
  novo (`results[0]`) para o mais antigo carregado (`results[last]`) — reflexo direto do
  `order('desc')`. A UI renderiza `[...results].reverse()` (mais antigo em cima, mais
  novo embaixo, leitura natural de chat).
- Mensagem nova chega **sempre em `results[0]`** (a primeira página cresce por cima do
  seu próprio intervalo, que começa no "agora"). Depois do `.reverse()`, isso vira o
  **fim** da lista renderizada — ou seja, mensagem nova nunca desloca visualmente nada
  que já estava acima na tela. Não precisa de nenhuma compensação de scroll para esse
  caso; só decidir se rola para baixo (usuário já estava no fim) ou mostra o aviso de
  "novas mensagens" (usuário está lendo histórico) — literalmente o que CHAT-04 pede.
- Histórico mais antigo, carregado via `loadMore`, é **anexado ao fim de `results`**
  (página nova depois das existentes). Depois do `.reverse()`, isso vira o **início** da
  lista renderizada — ou seja, sempre aparece **acima** do que já estava visível. Esse é
  o caso que precisa de compensação manual de scroll (técnica descrita no §4) — sem
  compensação, o navegador mantém `scrollTop` em pixels absolutos, então conteúdo
  inserido acima empurra tudo pra baixo e a mensagem que o usuário estava lendo sai da
  tela. Isso é o "pulo" que CHAT-03 proíbe, e é um problema de DOM/scroll genérico
  (não específico do Convex) — a reatividade do Convex só garante que os dados corretos
  chegam; manter a posição visual estável é responsabilidade explícita da UI (plano
  05-04).

## 4. Técnica de compensação de scroll (sem biblioteca de virtualização)

Decisão: não introduzir `react-virtual`/`react-window` nesta fase — o volume de
mensagens carregadas por vez (30/página) é pequeno o bastante para renderizar sem
virtualização, e adicionar uma lib de virtualização multiplicaria a superfície do "pulo"
(a própria doc de paginação já avisa que assumir tamanho de página fixo quebra
virtualização ingênua). Técnica usada, genérica de DOM, aplicável a qualquer scroll
container:

1. Antes de chamar `loadMore(n)`, ler `scrollHeightAntes = viewport.scrollHeight`.
2. Detectar que a página antiga terminou de chegar comparando o id do **último** item
   de `results` antes/depois (não o tamanho do array — ver `06-RESEARCH.md`/`PITFALLS.md`
   sobre tamanho de página variar; comparar por id é robusto mesmo se uma mensagem nova
   chegar no mesmo instante).
3. Em `useLayoutEffect` (roda depois do DOM atualizar, antes do browser pintar), ler
   `scrollHeightDepois = viewport.scrollHeight` e ajustar
   `viewport.scrollTop += (scrollHeightDepois - scrollHeightAntes)` — mantém exatamente o
   mesmo conteúdo visível, compensando a altura inserida acima.
4. Mensagem nova (detectada comparando o **primeiro** item de `results` antes/depois) não
   passa por essa compensação — só decide auto-scroll (se `isAtBottom`) ou incrementa o
   contador do aviso "novas mensagens" (se não).

`ScrollArea` (Radix, `src/renderer/src/components/ui/scroll-area.tsx`) não expõe uma ref
direta do viewport interno via prop — o elemento real com `overflow-y: auto` é
`ScrollAreaPrimitive.Viewport`, renderizado com `data-slot="scroll-area-viewport"`.
Técnica usada (sem editar o primitivo compartilhado, que também é usado por
`ChannelSidebar.tsx`): envolver `<ScrollArea>` num `<div ref={containerRef}>` e obter o
viewport real via `containerRef.current?.querySelector('[data-slot="scroll-area-viewport"]')`
depois do mount — padrão comunitário comum para Radix ScrollArea quando é preciso
`scrollTop`/eventos de `scroll` nativos.

## 5. "Não lidas" (CHAT-05/CHAT-06) — schema já aprovado, mecanismo novo

`channelReadState: channelId·, userId·, lastReadMessageId` já está no design aprovado
(§5). Decisão de índice: **um único índice** `by_channel_user` (`['channelId',
'userId']`) — usado tanto como busca pontual ("meu estado de leitura deste canal")
quanto, via prefixo (`eq('channelId', x)` sozinho), para "todo mundo que já leu este
canal" (não usado nesta fase, mas gratuito). Diferente de `friendships`/`dmMembers`
(`06-RESEARCH.md §2`), não é necessário um segundo índice `by_user`: o cálculo de
contagem de não-lidas por canal (`getUnreadCounts`) itera os canais de um servidor (já
obtidos via `channels.by_server`) e faz uma busca pontual em `by_channel_user` por canal
— nunca precisa "todos os estados de leitura de um usuário" de uma vez.

Mecanismo (sem campo `firstUnreadMessageId` armazenado — calculado sob demanda, sempre
correto mesmo que o usuário nunca tenha aberto o canal):
- **Marcar como lido** (`openChannel`, mutation): busca a mensagem mais recente do canal
  (`by_channel`, `order('desc')`, `.first()`) e faz upsert de
  `channelReadState.lastReadMessageId` apontando pra ela. Roda ao abrir o canal e de novo
  toda vez que uma mensagem nova chega **enquanto o usuário está com o scroll no fim**
  (mesmo `isAtBottom` do §4) — assim o badge do canal ativo fica sempre zerado enquanto o
  usuário realmente está acompanhando ao vivo, sem precisar de um evento "saiu do canal".
- **Divisor de não lidas**: a mesma mutation `openChannel`, **antes** de sobrescrever o
  ponteiro, lê o `lastReadMessageId` antigo e calcula a primeira mensagem não lida:
  - Nunca leu antes (`lastReadMessageId` ausente): primeira mensagem do canal (`order('asc').first()`),
    ou nenhum divisor se o canal não tem mensagem nenhuma.
  - Já leu antes: busca a mensagem antiga (`ctx.db.get(lastReadMessageId)`) para pegar seu
    `_creationTime`, e busca a primeira mensagem **depois** dela:
    `.withIndex('by_channel', q => q.eq('channelId', channelId).gt('_creationTime', antigo._creationTime)).order('asc').first()`.
    Confirmado contra a doc oficial de índices (ver §6 abaixo) que isso é uma consulta
    indexada válida, não um scan.
  - `openChannel` retorna esse id (`Id<'messages'> | null`) como valor da mutation — como
    mutation (não query), o valor devolvido é um snapshot único da chamada, sem risco de
    a reatividade "apagar" o divisor no meio da sessão quando o próprio `openChannel` roda
    de novo alguns segundos depois (o retorno das chamadas seguintes é ignorado pelo
    cliente, só a primeira, capturada no mount do componente do canal, que já é remontado
    por `key={channel._id}` — mesmo padrão que `ConversationArea.tsx` já usa desde a Fase
    3 para resetar o eco local ao trocar de canal).

## 6. `_creationTime` em range query após `.eq()` — verificado contra doc oficial

Fonte: [docs.convex.dev/database/reading-data/indexes](https://docs.convex.dev/database/reading-data/indexes/).
Confirmado, texto oficial: **"`_creationTime` field is automatically added to the end of
every index to ensure a stable ordering."** — todo índice do Convex tem `_creationTime`
como campo implícito final, disponível para range query mesmo sem declará-lo. Exemplo
oficial confirma a sintaxe usada no §5 acima:

```ts
.withIndex("by_channel", (q) =>
  q.eq("channel", channel)
   .gt("_creationTime", Date.now() - 2 * 60000)
   .lt("_creationTime", Date.now() - 60000)
)
```

Regra de quantos operadores de range: no máximo um limite inferior (`.gt`/`.gte`) e um
limite superior (`.lt`/`.lte`), sobre o campo imediatamente depois do prefixo de
igualdade — exatamente o uso feito em `getFirstUnread`/`openChannel` (só limite
inferior, sobre `_creationTime`, depois de `.eq('channelId', ...)`).

## 7. "Digitando" (CHAT-07) — mesma classe de problema do usuário-fantasma de voz, resolvida sem cron

`PITFALLS.md` (Performance Traps) recomenda não escrever no banco a cada tecla, e
`FEATURES.md` (linha do divisor de digitando) aponta a mesma classe de problema do
usuário-fantasma (cliente pode travar no meio de "digitando"). Diferença chave em
relação ao usuário-fantasma de voz (F7, resolvido por webhook do LiveKit): aqui não
existe uma fonte de verdade externa (LiveKit) para reconciliar — a UI de "digitando" não
precisa de reconciliação no servidor, só precisa de uma **regra de expiração aplicada
na leitura**, no cliente.

**Por que a expiração não pode confiar só na query reativa do servidor:** uma query
Convex só recomputa quando os documentos que ela leu mudam (escrita real no banco) — o
simples passar do tempo, sem nenhuma escrita nova, não dispara uma nova
avaliação da query no servidor. Se a filtragem por "só nos últimos N segundos" fosse
feita inteiramente dentro do handler da query, a lista "quem está digitando" ficaria
presa no valor da última escrita até *qualquer* documento de `typing` mudar de novo —
nem sempre acontece a tempo (é exatamente o cenário do cliente que trava no meio de
"digitando": ninguém mais escreve nada, a query nunca reavalia sozinha). Solução: o
servidor devolve as linhas cruas (`updatedAt`, sem fatiar por tempo), e o **cliente**
decide o que é "recente" comparando contra `Date.now()` local, recalculado a cada tick de
um `setInterval` (1s) — isso força um re-render independente de qualquer nova mensagem
do servidor, garantindo que o indicador some sozinho mesmo sem nenhum evento explícito de
"parei de digitar". É a mesma técnica, em espírito, que `isOnline(lastSeen, now)` já usa
em `convex/members.ts`, mas aplicada no cliente (não dá pra aplicar só no servidor pelo
motivo acima) — `now` ali também precisaria de um tick local para se manter correto
enquanto a tela fica parada, só que a folga de 90s de presença torna esse detalhe
irrelevante na prática; para "digitando" (janela de poucos segundos) o tick explícito é
obrigatório.

Números escolhidos (mesma lógica de folga 2x-3x que `ONLINE_THRESHOLD_MS` já usa):
throttle de escrita = 2000ms (no máximo 1 mutation a cada 2s por usuário digitando,
independente da velocidade de digitação), TTL de exibição = 6000ms (3x o throttle — folga
para tolerar uma chamada perdida por jitter de rede), tick do cliente = 1000ms.

Schema: **um único índice** (`by_channel_user`, mesmo truque de prefixo do §5) serve
tanto o upsert pontual (`eq('channelId', ...).eq('userId', ...)`) quanto a listagem de
quem está digitando num canal (`eq('channelId', ...)` sozinho, prefixo). Nenhuma limpeza
periódica/cron é necessária — a mesma linha por (canal, usuário) é sobrescrita para
sempre; não há crescimento de linhas por causa de digitação repetida.

## 8. CHAT-02 (< 500ms) — o que é mensurável e como medir

Arquitetura: Convex é reativo via WebSocket (sem polling) — o próprio mecanismo que já
faz `listServerMembers`/`listChannels` atualizarem instantaneamente na Fase 4 é o mesmo
que entrega mensagens novas. Não existe nenhum código adicional "para deixar rápido"; o
risco real é regressão por acidente (ex: sondagem manual por engano). O requisito não é
verificável por teste automatizado de unidade (é sobre latência de rede/servidor real,
não lógica pura) — fica para o checkpoint humano (plano 05-06), com método explícito de
medição: dois perfis de app rodando lado a lado (dois `--user-data-dir` diferentes,
contornando o lock de instância única da Fase 0 que é por perfil, não por máquina — ver
detalhe no plano 05-06), duas contas de teste diferentes, e um dos dois métodos:
(a) inspeção visual lado a lado (mensagem aparece "instantaneamente", sem atraso
perceptível — suficiente já que o alvo é sub-500ms, bem acima do limiar de percepção
humana de ~100-200ms para "instantâneo"), ou (b) gravação de tela (Xbox Game
Bar/`Win+G`, 30-60fps) contando quadros entre o clique de enviar e o aparecimento na
outra janela, para um número em ms caso se queira rigor adicional.

## 9. Componentes shadcn/ui necessários (novos)

Nenhum. Todos os primitivos já existem: `scroll-area`, `separator`, `avatar`, `badge`,
`button`, `textarea`. O aviso "novas mensagens ↓" e o divisor reaproveitam
`Button`/`Separator` já instalados, sem componente novo.

## 10. Decisões consolidadas para os planos

1. `messages`: um índice (`by_channel`), `createdAt` mantido como campo de exibição
   (mesma decisão de `dmMessages`, `06-RESEARCH.md §3` — não é chave de ordenação,
   `_creationTime` é); sem `editedAt` (campo do design doc §5, mas CHAT-08/editar é
   escopo v2 — mesmo tipo de corte que `06-RESEARCH.md` já fez ao remover `status` de
   `friendRequests`, dead field sem requisito v1 que o justifique).
2. `channelReadState`: um índice (`by_channel_user`), sem `firstUnreadMessageId`
   armazenado — calculado sob demanda pela mutation `openChannel` via range query em
   `_creationTime` (índice implícito, confirmado contra doc oficial).
3. `typing`: um índice (`by_channel_user`, mesmo truque de prefixo), sem mutation de
   "parei de digitar" — expiração é 100% client-side via tick de `setInterval`.
4. Nenhuma function desta fase toca `convex/users.ts` — campos que dependeriam de "quem
   sou eu" (`isMine`, exclusão da própria linha de "digitando") são computados dentro de
   `listMessages`/`listTyping`, reaproveitando o `user` já resolvido pela checagem de
   autorização.
5. `requireChannelMembership` é reimplementado como função local não-exportada em cada
   um dos três arquivos novos (`messages.ts`, `channelReadState.ts`, `typing.ts`) — mesmo
   padrão que `convex/dms.ts` (F6) já estabelece para `assertDmMember`, evita acoplar
   arquivos de domínio de fases diferentes entre si.
6. Scroll: técnica de compensação manual (`scrollHeight` antes/depois em
   `useLayoutEffect`) sobre o viewport real do Radix `ScrollArea`, obtido via
   `querySelector('[data-slot="scroll-area-viewport"]')` — sem lib de virtualização, sem
   editar `ui/scroll-area.tsx` (compartilhado com `ChannelSidebar.tsx`).
7. CHAT-02 não é testável por unidade — verificado no checkpoint humano (plano 05-06)
   com método de medição explícito (dois perfis de app + inspeção visual ou gravação de
   tela).

---
*Research para: Fase 5 — Chat em tempo real*
*Pesquisado em: 2026-08-18*
