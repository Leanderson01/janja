---
phase: 04-servidores-e-canais
plan: 05
subsystem: ui
tags: [react, convex, radix-ui, dialog, state-management]

# Dependency graph
requires:
  - phase: 04-servidores-e-canais (04-01, 04-02)
    provides: convex/servers.ts (createServer, listMyServers, amIOwner), convex/invites.ts
      (generateInvite, revokeInvite, joinByCode, getActiveInvite), convex/channels.ts
      (createChannel, listChannels, getChannel)
  - phase: 03-shell-da-ui
    provides: layout/CSS do shell (ServerRail, ChannelSidebar, ConversationArea, MemberList),
      SelectionProvider original orientado a mock-data.ts
provides:
  - selection-context.tsx reescrito, derivando seleção de servidor/canal de
    useQuery(api.servers.listMyServers)/useQuery(api.channels.listChannels), sem useEffect
  - ServerRail.tsx mostrando servidores reais do usuário logado + botão "+" (visível mesmo com
    zero servidores)
  - CreateOrJoinServerDialog.tsx: fluxo de criar servidor (SRV-01) e entrar por código (SRV-03)
    ponta a ponta pela UI
  - Primitivos shadcn Dialog e Input (components/ui/dialog.tsx, components/ui/input.tsx)
    reaproveitáveis pelo resto da Fase 4
affects: [04-06 (canais reais), 04-07 (membros reais)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Estado derivado sem useEffect: selectedServerId/selectedChannelId são useMemo sobre
      (query result, escolha manual do usuário), nunca setState dentro de um effect que copia
      resultado de query"
    - "Dialog com abas simples via botões de texto + estado local, sem introduzir um primitivo
      de Tabs só para duas opções"

key-files:
  created:
    - src/renderer/src/components/ui/dialog.tsx
    - src/renderer/src/components/ui/input.tsx
    - src/renderer/src/components/shell/CreateOrJoinServerDialog.tsx
  modified:
    - src/renderer/src/state/selection-context.tsx
    - src/renderer/src/components/shell/ServerRail.tsx
    - src/renderer/src/components/shell/ChannelSidebar.tsx (fix de bloqueio, fora do
      files_modified original do plano — ver Deviations)

key-decisions:
  - "selectedServerId/selectedChannelId agora são Id<'servers'>|null / Id<'channels'>|null (não
    mais string), refletindo que podem ser null quando o usuário não tem nenhum servidor/canal"
  - "Import de api/Id usa caminho relativo exato até convex/_generated/** (nenhum alias
    @convex/* foi criado por 02-08 neste checkout) — 4 níveis a partir de state/, 5 a partir de
    components/shell/"
  - "ServerRail some do estado 'carregando spinner': enquanto servers === undefined só o botão
    + aparece; a lista de ícones surge assim que a subscription do Convex resolver"

patterns-established:
  - "CreateOrJoinServerDialog é controlado (open/onOpenChange vindos do pai) em vez de
    encapsular seu próprio DialogTrigger — ServerRail decide quando abrir via useState local"

# Metrics
duration: ~35min
completed: 2026-08-19
---

# Phase 04 Plan 05: Navegação real de servidores Summary

**Barra de servidores e contexto de seleção passam a ler `listMyServers`/`listChannels` do
Convex em vez de `mock-data.ts`, com criação/entrada em servidor operando ponta a ponta pela UI
via `createServer`/`joinByCode`.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-19T00:54:09Z
- **Tasks:** 3/3 completed
- **Files modified/created:** 6 (3 modified pelo plano, 1 modificado por deviation de
  bloqueio, 3 criados)

## Accomplishments

- `selection-context.tsx` reescrito do zero: `servers`/`selectedServerId`/`selectedChannelId`
  derivam de `useQuery(api.servers.listMyServers)` e `useQuery(api.channels.listChannels, ...)`
  via `useMemo`, sem nenhum `useEffect` copiando resultado de query para `useState` — só o
  "clique manual do usuário" é `useState`, o resto é recalculado a cada render.
- `ServerRail.tsx` trocou `mockServers`/`Server` por `Doc<'servers'>[]` real, tratando os três
  estados possíveis: carregando (`undefined`, só mostra o botão "+"), zero servidores (lista
  vazia, só o botão "+"), e lista real com o indicador de ativo já funcionando sobre `server._id`.
- `CreateOrJoinServerDialog.tsx` novo: duas abas (botões de texto, não um primitivo de Tabs),
  criar servidor (2-50 caracteres, mesma regra de `convex/servers.ts`) e entrar por código
  (maiúsculas, até 8 caracteres). Sucesso em qualquer aba chama `setSelectedServerId` com o id
  retornado pela mutation e fecha o dialog; erro mostra `err.message` sem fechar; qualquer
  fechamento (X, clique fora, Esc) reseta nome/código/erro/aba via `handleOpenChange`.
- Primitivos shadcn `Dialog` e `Input` adicionados em `components/ui/`, sem cair no bug do CLI
  que grava num diretório `@/` literal na raiz (escritos à mão, conforme a nota do plano) —
  confirmado que nenhum diretório órfão foi criado.

## Task Commits

Nenhum commit foi criado por este agente — a orquestração está rodando `06-02`/`06-04` em
paralelo sobre `convex/` e pediu explicitamente para **não rodar comandos git** aqui; o
orquestrador comita as mudanças em série. Todas as mudanças abaixo estão no working tree,
não commitadas:

1. **Task 1: Primitivos shadcn Dialog e Input** — não commitado (ver acima)
2. **Task 2: selection-context.tsx sobre dados reais** — não commitado
3. **Task 3: ServerRail real + fluxo de criar/entrar em servidor** — não commitado

**Plan metadata:** não commitado (`.planning/` não deve ser tocado por git aqui; STATE.md não
foi atualizado por este agente pelo mesmo motivo — cabe ao orquestrador depois de integrar os
commits em série)

## Files Created/Modified

- `src/renderer/src/components/ui/dialog.tsx` — primitivo Radix Dialog (Root/Trigger/Portal/
  Close/Overlay/Content/Header/Footer/Title/Description), mesmo padrão de import único
  `radix-ui` que `avatar.tsx` já usa
- `src/renderer/src/components/ui/input.tsx` — primitivo de input shadcn padrão
- `src/renderer/src/state/selection-context.tsx` — reescrito: `servers`, `selectedServerId`,
  `selectedChannelId` agora vêm de `useQuery`, tipados com `Doc<'servers'>`/`Id<'servers'>`/
  `Id<'channels'>` (todos possivelmente `null`/`undefined`), zero `mockServers`/`mockChannels`
- `src/renderer/src/components/shell/ServerRail.tsx` — consome `useSelection().servers`,
  compara por `server._id`, acrescenta `AddServerButton` (ícone `Plus`) que abre
  `CreateOrJoinServerDialog` controlado por `useState` local
- `src/renderer/src/components/shell/CreateOrJoinServerDialog.tsx` — novo, dialog de
  criar/entrar em servidor descrito acima
- `src/renderer/src/components/shell/ChannelSidebar.tsx` — **não estava no `files_modified` do
  plano**; ajuste mínimo de tipos (ver Deviations) para destravar `npm run typecheck` depois que
  `selection-context.tsx` passou a exigir `Id<'channels'>` em vez de `string`

## Decisions Made

- Caminho de import de `api`/`Id`/`Doc`: não existe alias `@convex/*` em `tsconfig.web.json`
  neste checkout (confirmado antes de escrever qualquer arquivo). Usado caminho relativo exato,
  mesmo padrão de `AuthGate.tsx`: `../../../../convex/_generated/api` a partir de `state/`
  (4 níveis) e `../../../../../convex/_generated/api` a partir de `components/shell/` (5
  níveis) — calculado com `path.relative` para não copiar a contagem errada.
- `CreateOrJoinServerDialog` é controlado (`open`/`onOpenChange` vindos de `ServerRail`) em vez
  de se auto-gerenciar com `DialogTrigger` interno — deixa `ServerRail` dono do `useState` que
  decide quando abrir, mais simples de testar/reusar depois.
- Árvore de providers confirmada intacta antes de começar: `main.tsx` já envolve `<App/>` com
  `ConvexProviderWithAuth` → `AuthGate` exatamente como 02-08 previa; nenhum bloqueio aqui.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `ChannelSidebar.tsx` parava de compilar depois da Task 2**

- **Found during:** Task 2 (verificação `npm run typecheck` depois de reescrever
  `selection-context.tsx`)
- **Issue:** `ChannelSidebar.tsx` (fora do escopo deste plano — pertence a 04-06) chama
  `setSelectedChannelId(channel.id)`/`setJoinedVoiceChannelId(channel.id)` com `channel.id`
  vindo de `mockChannels` (`string` solto). Como `selection-context.tsx` agora exige
  `Id<'channels'>` nesses setters, o build parava com 3 erros de tipo — bloqueando `npm run
  typecheck`/`npm run build`, ambos exigidos pela verificação deste plano.
- **Fix:** Cast local `channel.id as Id<'channels'>` nos dois handlers de clique
  (`handleTextChannelClick`/`handleVoiceChannelClick`), com comentário explicando que é
  temporário e será removido pelo plano 04-06 quando o componente passar a iterar sobre
  `Doc<'channels'>` real. Nenhuma mudança de CSS/layout — só a assinatura de tipo no ponto de
  chamada.
- **Files modified:** `src/renderer/src/components/shell/ChannelSidebar.tsx`
- **Verification:** `npm run typecheck` e `npm run build` voltaram a passar limpos
- **Committed in:** não commitado (ver nota em Task Commits)

## Authentication Gates

Nenhum — este plano não interage com nenhum provedor de auth externo (WorkOS já configurado
pela Fase 2).

## Next Phase Readiness / Notas para 04-06 e 04-07

- `ChannelSidebar.tsx`, `ConversationArea.tsx`, `MemberList.tsx`, `ChannelHeader.tsx` e
  `VoiceControlBar.tsx` continuam lendo de `mock-data.ts` (fora do escopo deste plano, por
  design — ver `<context>` do plano). Como `selectedServerId`/`selectedChannelId` agora são ids
  reais do Convex, esses filtros por id mockado (`chan-1-geral`, `srv-1`, etc.) nunca mais vão
  bater com nada real: **o efeito observável é que a sidebar de canais e a lista de membros
  aparecem vazias** (não crasham, não travam — só não mostram nada) até 04-06/04-07 trocarem a
  fonte de dados. Isso é esperado e consistente com o hard constraint de não redesenhar CSS já
  verificado; nenhum desses componentes foi tocado além do cast mínimo em `ChannelSidebar.tsx`
  descrito acima.
- `mock-data.ts` não foi apagado (ainda usado por `ConversationArea`/mensagens/voz até F5/F7,
  conforme o plano determinou).
- Verificação visual real (abrir o app, ver a barra de servidores vazia num usuário novo, criar
  um servidor pela UI, ver aparecer selecionado, entrar por código) **não foi possível neste
  ambiente** — WSL2 não renderiza a janela do Electron (mesma limitação documentada em
  `03-VERIFICACAO.md`). Precisa de confirmação em Windows antes de considerar SRV-01/SRV-03
  "observados por um humano" (critério de sucesso do plano). Tudo que pôde ser verificado sem
  janela (`npm run typecheck`, `npm run build`, `npx vitest run`) passou limpo.
