---
phase: 04-servidores-e-canais
plan: 06
subsystem: ui
tags: [react, convex, radix-ui, dialog, channels, invites]

# Dependency graph
requires:
  - phase: 04-servidores-e-canais (04-01, 04-02, 04-03, 04-05)
    provides: convex/channels.ts (createChannel, listChannels, getChannel), convex/invites.ts
      (generateInvite, revokeInvite, getActiveInvite), convex/servers.ts (amIOwner),
      selection-context.tsx já derivando servidor/canal reais do Convex
provides:
  - ChannelSidebar.tsx, ChannelHeader.tsx, ConversationArea.tsx, VoiceControlBar.tsx lendo
    canais reais via convex/channels.ts em vez de mock-data.ts
  - CreateChannelDialog.tsx: criação de canal de texto/voz pela UI (SRV-05)
  - InviteDialog.tsx: ver/copiar/gerar/revogar convite pela UI, gated por amIOwner (SRV-02,
    SRV-04)
affects: [04-07 (membros reais), F5 (mensagens/unread reais), F7 (voz real)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Query duplicada e barata: ChannelHeader e ConversationArea chamam
      useQuery(api.channels.getChannel, ...) de forma independente em vez de propagar o
      resultado via prop — mesmo padrão de 'servers' em 04-05"
    - "Dialogs de ação (CreateChannelDialog, InviteDialog) recebem serverId como prop do
      chamador em vez de ler useSelection() diretamente — deixa explícito, pela assinatura,
      que não funcionam sem servidor selecionado"
    - "amIOwner só controla exibição condicional de botões; autorização real sempre imposta
      no backend (requireOwnership) — UI nunca duplica a checagem"

key-files:
  created:
    - src/renderer/src/components/shell/CreateChannelDialog.tsx
    - src/renderer/src/components/shell/InviteDialog.tsx
  modified:
    - src/renderer/src/components/shell/ChannelSidebar.tsx
    - src/renderer/src/components/shell/ChannelHeader.tsx
    - src/renderer/src/components/shell/ConversationArea.tsx
    - src/renderer/src/components/shell/VoiceControlBar.tsx

key-decisions:
  - "ChannelSidebar ganhou um cabeçalho fixo (h-12, mesma altura de ChannelHeader) com nome
    do servidor + botões Convidar/Criar canal, controlando dois useState locais (inviteOpen,
    createChannelOpen) que abrem InviteDialog/CreateChannelDialog controlados — mesmo padrão
    de AddServerButton/CreateOrJoinServerDialog do plano 04-05"
  - "VoiceControlBar usa getChannel (não listChannels) para o canal de voz conectado,
    deliberadamente independente de selectedServerId — o usuário pode navegar para outro
    servidor sem sair da chamada de voz (mesmo comportamento do Discord real)"
  - "Badge de não lidas (F5) e lista de participantes de voz aninhada (F7) foram removidos da
    renderização, não apagados de design — comentários no código apontam explicitamente para
    a fase que os reintroduz com dado real"
  - "mockMessages/mockVoiceParticipants continuam em uso dentro de ConversationArea
    (VoiceParticipantGrid, TextChannelView) como estava documentado no plano — filtros por id
    mockado nunca batem com Id<'channels'> real, resultando em 'lista vazia'/'nenhum
    participante', que já é o estado tratado graciosamente pela UI"

# Metrics
duration: ~30min
completed: 2026-08-19
---

# Phase 04 Plan 06: Canais reais e convite Summary

**Sidebar/cabeçalho/área de conversa de canal passam a ler `convex/channels.ts` em vez de
`mock-data.ts`, e SRV-02/SRV-04/SRV-05 (convite e criação de canal) ganham UI ponta a ponta via
`CreateChannelDialog`/`InviteDialog`.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-08-19
- **Tasks:** 3/3 completed
- **Files modified/created:** 6 (4 modificados, 2 criados)

## Accomplishments

- `ChannelSidebar.tsx` reescrito: `useQuery(api.channels.listChannels, { serverId })`
  substitui `mockChannels`; agrupamento fixo em duas seções "TEXTO"/"VOZ" (o modelo real de
  canal não tem `category`), cada seção omitida quando vazia. Estado `selectedServerId ===
  null` (zero servidores) renderiza um vazio simples sem sequer chamar `listChannels`.
  Cabeçalho fixo no topo (`h-12`, mesma altura de `ChannelHeader`) com o nome do servidor
  selecionado e dois botões (`UserPlus`/`Plus`, `icon-sm`) que abrem `InviteDialog`/
  `CreateChannelDialog` controlados por `useState` local. Removidos os dois casts `channel.id
  as Id<'channels'>` que 04-05 deixou como ponte temporária — os handlers agora recebem
  `Doc<'channels'>` real e usam `channel._id` diretamente.
- `TextChannelRow` parou de renderizar `Badge`/`unreadCount` (campo do mock, não existe no
  canal real desta fase — comentário no código aponta para F5). `VoiceChannelRow` parou de
  buscar/renderizar `mockVoiceParticipants` (comentário aponta para F7); o canal de voz
  continua clicável, só sem avatares aninhados abaixo.
- `VoiceControlBar.tsx`: `mockChannels.find(...)` trocado por
  `useQuery(api.channels.getChannel, joinedVoiceChannelId ? {...} : 'skip')`, deliberadamente
  independente de `selectedServerId` (canal de voz conectado pode ser de um servidor diferente
  do selecionado no momento).
- `ChannelHeader.tsx` e `ConversationArea.tsx` trocaram `mockChannels.find(...)` pela mesma
  query `useQuery(api.channels.getChannel, ...)` (subscrição duplicada e barata, mesmo padrão
  de `servers` em 04-05). Os três estados possíveis (`selectedChannelId === null`, `channel
  === undefined` carregando, `channel === null` inexistente) colapsam no mesmo fallback
  "Nenhum canal selecionado". `TextChannelView` parou de receber `firstUnreadMessageId`
  (campo não existe no canal real desta fase) — parâmetro continua opcional no componente, só
  não é mais fornecido.
- `CreateChannelDialog.tsx` novo: `Input` de nome (1-50 caracteres) + dois `Button` alternando
  tipo texto/voz (`variant={type === X ? 'default' : 'outline'}`), chama
  `useMutation(api.channels.createChannel)` com `serverId` recebido como prop. Erro exibido
  como `text-destructive`, mesmo padrão de `CreateOrJoinServerDialog`. Sucesso fecha e reseta
  o form; a sidebar reflete o canal novo via subscription reativa, sem navegação automática.
- `InviteDialog.tsx` novo: `isOwner = useQuery(api.servers.amIOwner, { serverId })` controla só
  a exibição dos botões de dono; `invite = useQuery(api.invites.getActiveInvite, { serverId })`
  determina o conteúdo (código + copiar / botão gerar / mensagem "peça ao dono"). Dono com
  convite ativo também vê "Gerar novo código"/"Revogar convite" (`generateInvite`/
  `revokeInvite`). Copiar usa `navigator.clipboard.writeText` com feedback "Copiado!" por 2s.

## Task Commits

Nenhum commit foi criado por este agente — a orquestração pediu explicitamente para **não
rodar comandos git** aqui (três agentes irmãos rodando em paralelo: 04-07 sobre
`MemberList.tsx`, 06-03/06-05 sobre `convex/`). Todas as mudanças abaixo estão no working
tree, não commitadas:

1. **Task 1: ChannelSidebar e VoiceControlBar sobre dado real** — não commitado
2. **Task 2: ChannelHeader e ConversationArea sobre dado real** — não commitado
3. **Task 3: CreateChannelDialog e InviteDialog** — não commitado

**Plan metadata:** não commitado (`.planning/` não deve ser tocado por git aqui; STATE.md não
foi atualizado por este agente pelo mesmo motivo — cabe ao orquestrador depois de integrar os
commits em série)

## Files Created/Modified

- `src/renderer/src/components/shell/ChannelSidebar.tsx` — reescrito: `listChannels` real,
  agrupamento TEXTO/VOZ, cabeçalho com nome do servidor + botões Convidar/Criar canal, remoção
  dos casts temporários de 04-05, sem `Badge`/participantes de voz mockados
- `src/renderer/src/components/shell/ChannelHeader.tsx` — `getChannel` real substitui
  `mockChannels.find`
- `src/renderer/src/components/shell/ConversationArea.tsx` — `getChannel` real substitui
  `mockChannels.find`; `mockMessages`/`mockVoiceParticipants` seguem como stub documentado
  para F5/F7
- `src/renderer/src/components/shell/VoiceControlBar.tsx` — `getChannel` real substitui
  `mockChannels.find`, independente de `selectedServerId`
- `src/renderer/src/components/shell/CreateChannelDialog.tsx` — novo, dialog de criar canal
  descrito acima
- `src/renderer/src/components/shell/InviteDialog.tsx` — novo, dialog de gestão de convite
  descrito acima

## Decisions Made

- Caminho de import de `api`/`Id`/`Doc`: mesmo padrão relativo de 04-05,
  `../../../../../convex/_generated/api` (5 níveis) a partir de todos os arquivos deste plano
  — todos vivem na mesma profundidade `src/renderer/src/components/shell/`.
- `CreateChannelDialog`/`InviteDialog` são controlados (`open`/`onOpenChange` vindos do
  chamador) e recebem `serverId` como prop explícita, em vez de ler `useSelection()`
  diretamente — mesma razão de design que `CreateOrJoinServerDialog` (04-05): a assinatura do
  componente já deixa claro que ele não funciona sem servidor selecionado, e quem decide
  quando abrir é sempre `ChannelSidebar`.
- `InviteDialog` distingue explicitamente `invite === undefined` (carregando, não renderiza
  conteúdo principal ainda) de `invite === null` (sem convite ativo) — evita mostrar
  brevemente "peça ao dono" para o próprio dono antes da subscription resolver.

## Deviations from Plan

Nenhuma — plano executado como escrito. Os dois casts `channel.id as Id<'channels'>` que
04-05 deixou como ponte temporária em `ChannelSidebar.tsx` foram removidos conforme o
comentário deixado por aquele plano previa.

## Authentication Gates

Nenhum — este plano não interage com nenhum provedor de auth externo.

## Verification

- `npm run typecheck:web` (a camada deste plano) passa limpo.
- `npm run typecheck:node` passa limpo.
- `npm run typecheck:convex` **falha**, mas por um erro pré-existente em
  `convex/friends.test.ts` (dois `TS7006: implicit any` em `.filter((f) => ...)`) — arquivo
  fora do escopo deste plano (`convex/` é propriedade dos agentes irmãos 06-03/06-05, cujas
  edições já estavam em andamento no working tree antes deste agente começar; confirmado via
  `git status --short convex/` mostrando `dms.ts`/`dms.test.ts`/`friends.ts`/`friends.test.ts`
  modificados por eles, não por mim). Como consequência, `npm run build` (que roda
  `typecheck:convex` antes do bundle) também não completa neste momento. Para confirmar que a
  parte deste plano de fato builda, rodei `npx electron-vite build` diretamente (bypassando o
  typecheck de `convex/`) — bundle do renderer, main e preload completou sem erro
  (`out/renderer/assets/index-*.js` gerado, 2017 módulos transformados).
- `npx vitest run`: 100/101 testes passam. A única falha é em `convex/dms.test.ts`
  (`listDmMessages` paginação, `Target cannot be null or undefined`) — também dentro de
  `convex/`, fora do escopo/propriedade deste plano, não relacionado a nenhum dos 6 arquivos
  deste plano (nenhum teste novo/existente cobre `ChannelSidebar`/`ChannelHeader`/
  `ConversationArea`/`VoiceControlBar`/`CreateChannelDialog`/`InviteDialog`).
- Confirmado por `grep`: `ChannelSidebar.tsx`, `ChannelHeader.tsx`, `VoiceControlBar.tsx` não
  têm nenhuma referência a `mock-data`. `ConversationArea.tsx` só referencia `mockMembers`/
  `mockMessages`/`mockVoiceParticipants` (uso intencional documentado, stub F5/F7) — nenhum
  dos 6 arquivos importa `Channel`/`mockChannels`.
- Nenhum diretório `@/` órfão na raiz do repo (todos os componentes deste plano foram escritos
  à mão, não via `npx shadcn add`).

## Next Phase Readiness / Notas para 04-07 e F5/F7

- Verificação visual real (abrir o app, criar canal de texto/voz pela UI e ver aparecer na
  sidebar, abrir o dialog de convite como dono e copiar/gerar/revogar o código) **não foi
  possível neste ambiente** — WSL2 não renderiza a janela do Electron (mesma limitação
  documentada em `03-VERIFICACAO.md` e no Summary de 04-05). Precisa de confirmação em
  Windows antes de considerar SRV-02/SRV-04/SRV-05 "observados por um humano" (critério de
  sucesso do plano). Tudo que pôde ser verificado sem janela (`npm run typecheck:web`,
  `npm run typecheck:node`, `npx electron-vite build`, `npx vitest run`) passou limpo na parte
  que este plano possui.
- `MemberList.tsx` não foi tocado (propriedade do agente irmão 04-07); segue lendo
  `mock-data.ts` até aquele plano trocar a fonte de dados.
- `convex/` tem edições em andamento de agentes irmãos (06-03/06-05) não commitadas — dois
  erros de typecheck e um teste falhando em `dms.ts`/`friends.ts` no momento em que este plano
  terminou, ambos fora do escopo/arquivos deste plano. O orquestrador deve confirmar que esses
  agentes resolvem isso antes do commit em série final.
