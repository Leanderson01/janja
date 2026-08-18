---
phase: 03-shell-da-ui
plan: 02
subsystem: ui
tags: [react, typescript, tailwind, shadcn, radix-ui, lucide-react, mock-data]

# Dependency graph
requires:
  - phase: 03-shell-da-ui (Plano 01)
    provides: mock-data.ts (Channel/Member/VoiceParticipant), selection-context.tsx (SelectionProvider/useSelection), AppShell.tsx, stub de ChannelSidebar
provides:
  - ChannelSidebar completo — canais de texto/voz agrupados por categoria, badge de não lidas, avatares aninhados de participantes de voz (anel de falando, ícone de mute)
  - VoiceControlBar — rodapé fixo com mute/deafen local e estado de conexão de voz derivado de joinedVoiceChannelId
  - Navegação de canal de texto (setSelectedChannelId) e join/leave de canal de voz (toggle de joinedVoiceChannelId) via clique
affects: [03-03-area-de-conversa, 03-04-lista-de-membros, 03-05-verificacao-e-janela-minima]

# Tech tracking
tech-stack:
  added: [shadcn badge, shadcn separator (radix-ui, sem pacote npm novo), lucide-react (pacote npm novo — não estava instalado apesar do RESEARCH.md assumir que viria como transitiva do shadcn)]
  patterns:
    - "Agrupamento de canais por categoria via array de categorias únicas na ordem de primeira ocorrência em mockChannels, não uma lista fixa hardcoded — sobrevive a novas categorias sem editar o componente"
    - "Toggle de join/leave de canal de voz: comparação direta channel.id === joinedVoiceChannelId decide entre setJoinedVoiceChannelId(channel.id) e (null)"
    - "Estado de mute/deafen local (useState) fora do SelectionContext — cosmético nesta fase, não é dado que outros componentes do shell precisam ler"

key-files:
  created:
    - src/renderer/src/components/shell/VoiceControlBar.tsx
    - src/renderer/src/components/ui/badge.tsx
    - src/renderer/src/components/ui/separator.tsx
  modified:
    - src/renderer/src/components/shell/ChannelSidebar.tsx (reescrito por completo, substituindo o stub do Plano 01)
    - package.json (dependência lucide-react adicionada)
    - package-lock.json (lockfile atualizado pela instalação acima)

key-decisions:
  - "lucide-react não estava instalado (RESEARCH.md §4 assumia que viria como dependência transitiva do shadcn — não veio). Instalado via `npm install lucide-react` (versão 1.32.0 resolvida pelo npm), sem flags de força."
  - "Ícone de 'sair do canal de voz' no rodapé: usei PhoneOff (existe no lucide-react instalado, confirmado via require() antes de usar), conforme a opção preferencial do plano — não precisei do fallback LogOut."
  - "Ícone de deafen ativo: usei VolumeX (não HeadphoneOff) para diferenciar visualmente de MicOff — ambos os ícones existem no pacote, escolha estética, sem impacto funcional."
  - "Realce de canal de voz: uso isSelected (bg-accent) quando é o canal ativo na área de conversa, e um estilo mais sutil (text-foreground, sem fundo) quando apenas isJoined mas não é o canal selecionado no momento (ex.: usuário navegou para um canal de texto depois de entrar na voz) — o rodapé de voz já cobre a confirmação principal desse estado, o realce na lista é um reforço secundário."

patterns-established:
  - "Composição de linha de canal como dois componentes internos (TextChannelRow/VoiceChannelRow) dentro do mesmo arquivo do container, já que nenhum outro plano precisa importá-los isoladamente"

# Metrics
duration: ~35min
completed: 2026-08-18
---

# Phase 03 Plan 02: Sidebar de Canais Summary

**ChannelSidebar com canais agrupados por categoria, badge de não lidas, avatares de voz aninhados (anel de falando/ícone de mute) e VoiceControlBar sincronizado com join/leave via SelectionContext.**

## Performance

- **Duration:** ~35 min de execução ativa
- **Completed:** 2026-08-18
- **Tasks:** 2/2
- **Files modified:** 6 (3 criados, 3 modificados — ver detalhamento abaixo)

## Accomplishments

- `VoiceControlBar.tsx`: rodapé fixo (`h-14`) que lê `joinedVoiceChannelId` do
  `useSelection()`; mostra "Não conectado a nenhum canal de voz" (botões
  desabilitados) ou "Conectado a {nome}" + botão de desconectar; mute/deafen
  locais com a semântica do design (deafen força mute; desmutar enquanto
  ensurdecido também desensurdece)
- `ChannelSidebar.tsx` reescrito: `ScrollArea` com canais de `mockChannels`
  filtrados por `selectedServerId`, agrupados por categoria (ordem de
  primeira ocorrência, com `Separator` entre grupos e label em
  `text-muted-foreground` maiúsculo)
- Canal de texto: ícone `Hash`, `Badge` de contagem quando `unreadCount > 0`,
  peso de fonte mais forte para canais não lidos, realce de fundo quando
  selecionado, clique chama só `setSelectedChannelId` (não afeta voz)
- Canal de voz: ícone `Volume2`, clique alterna join/leave
  (`setJoinedVoiceChannelId`) além de selecionar o canal; avatares (~24px,
  `size="sm"`) de `mockVoiceParticipants` resolvidos contra `mockMembers`,
  com `ring-2 ring-green-500` quando `speaking` e `AvatarBadge` com `MicOff`
  quando `muted`
- Dependência `lucide-react` instalada (estava faltando — ver Deviations)
- Componentes shadcn `badge` e `separator` adicionados; o bug conhecido do
  CLI (escreve em `@/` na raiz em vez do alias) se repetiu e foi corrigido
  movendo os arquivos manualmente para `src/renderer/src/components/ui/` e
  removendo o diretório espúrio `@/`

## Task Commits

**Nenhum commit foi feito por este agente** — instrução explícita do
orquestrador (`<NO_GIT>`) era não rodar nenhum comando git; o orquestrador
faz o staging e commit deste plano separadamente, em série, após os três
agentes paralelos (03-02/03-03/03-04) terminarem. Os arquivos abaixo estão
no working tree, não commitados.

## Files Created/Modified

- `src/renderer/src/components/shell/VoiceControlBar.tsx` - rodapé de
  controles de voz (novo, conforme `files_modified` do plano)
- `src/renderer/src/components/shell/ChannelSidebar.tsx` - sidebar completa
  de canais (reescrita completa do stub do Plano 01, conforme
  `files_modified` do plano)
- `src/renderer/src/components/ui/badge.tsx` - gerado via shadcn CLI
  (dependência da Task 2)
- `src/renderer/src/components/ui/separator.tsx` - gerado via shadcn CLI
  (dependência da Task 2)
- `package.json` - adicionada dependência `lucide-react` (^1.32.0 resolvido)
- `package-lock.json` - lockfile atualizado pela instalação acima

## Decisions Made

Ver `key-decisions` no frontmatter. Resumo: `lucide-react` precisou ser
instalado (não veio como transitiva, contrariando a suposição do
RESEARCH.md §4); ícones escolhidos dentro das opções que o plano já previa
(`PhoneOff`, `VolumeX`); realce visual de canal de voz distingue
"selecionado agora" de "apenas conectado mas navegou para outro canal".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `lucide-react` não estava instalado**

- **Found during:** Task 1 (antes de escrever `VoiceControlBar.tsx`)
- **Issue:** O plano e o RESEARCH.md §4 assumiam que `lucide-react` viria
  como dependência transitiva dos componentes shadcn já instalados no
  bootstrap. Verificação (`ls node_modules/lucide-react`, depois
  `node -e "require('lucide-react')"`) confirmou que não estava presente —
  sem ele nenhum dos dois arquivos deste plano compila.
- **Fix:** `npm install lucide-react` (sem flags de força/yes). Confirmado
  depois que todos os ícones necessários (`Mic`, `MicOff`, `Headphones`,
  `PhoneOff`, `LogOut`, `Hash`, `Volume2`) existem no pacote instalado antes
  de usá-los no código.
- **Files modified:** `package.json`, `package-lock.json`
- **Verification:** `npm run typecheck` e `npm run build` passam limpos
  depois da instalação.
- **Commit:** nenhum (ver seção Task Commits — instrução de não commitar).

**2. [Rule 3 - Blocking] shadcn CLI voltou a escrever em `@/` na raiz do
repo (mesmo bug do Plano 01)**

- **Found during:** Task 2 (`npx shadcn@latest add badge separator`)
- **Issue:** Idêntico ao desvio documentado no 03-01-SUMMARY.md — o CLI
  criou `./@/components/ui/badge.tsx` e `./@/components/ui/separator.tsx`
  na raiz do repositório em vez de resolver o alias `@` configurado em
  `components.json`.
- **Fix:** Movidos os 2 arquivos para
  `src/renderer/src/components/ui/` e removido o diretório espúrio `@/`
  (confirmado vazio antes de `rmdir` recursivo — sem `rm -rf`).
- **Files modified:** `src/renderer/src/components/ui/badge.tsx`,
  `src/renderer/src/components/ui/separator.tsx` (conteúdo idêntico ao
  gerado, só o caminho final mudou)
- **Verification:** `find . -maxdepth 1 -name "@"` confirmado vazio após a
  correção; `npm run typecheck`/`npm run build` passam limpos.
- **Commit:** nenhum (ver seção Task Commits).

---

**Total deviations:** 2 auto-fixed (ambas Rule 3 - blocking), nenhuma
decisão arquitetural (Rule 4) foi necessária.
**Impact on plan:** Nenhum impacto no escopo ou nos artefatos entregues.

## Issues Encountered

- **Erro de typecheck fora do meu escopo:** durante a verificação final,
  `npm run typecheck` reportou
  `src/renderer/src/components/shell/ConversationArea.tsx(2,10): error TS6133: 'useEffect' is declared but its value is never read.`
  Este arquivo pertence ao Plano 03-03 (sibling em execução concorrente no
  mesmo working tree, fora do meu ownership). Confirmei isoladamente que
  `tsc --noEmit -p tsconfig.web.json` não reporta nenhum erro relacionado a
  `ChannelSidebar.tsx` ou `VoiceControlBar.tsx` (filtrando a saída, só a
  linha de `ConversationArea.tsx` aparece). Não editei esse arquivo — não é
  meu para corrigir, e é provável que seja um estado transitório de edição
  em andamento pelo agente do Plano 03-03, não um erro final.
- Nenhum ambiente de GUI real disponível para verificação visual (mesma
  limitação já documentada no 03-01-SUMMARY.md — Electron sob Xvfb falha no
  processo de GPU). A verificação desta plano foi feita por `npm run
  typecheck` + `npm run build` + `eslint` direcionado aos meus dois
  arquivos, e por leitura cuidadosa da lógica contra os critérios do plano.

## Verificação real (o que rodei vs. o que só escrevi)

**Rodei e confirmei:**
- `npm run typecheck` — 0 erros nos meus arquivos (o único erro reportado
  é em `ConversationArea.tsx`, de outro plano, ver "Issues Encountered").
- `npm run build` — passou limpo (`electron-vite build` completo) antes de
  o sibling introduzir a alteração não finalizada em `ConversationArea.tsx`;
  rodado novamente depois só com `tsc` isolado nos meus arquivos, que
  seguem limpos.
- `npx eslint src/renderer/src/components/shell/ChannelSidebar.tsx
  src/renderer/src/components/shell/VoiceControlBar.tsx` — 0 erros, 0
  warnings (após um `--fix` automático de formatação em
  `VoiceControlBar.tsx`).
- `node -e "require('lucide-react')"` — confirmado que todos os ícones
  usados (`Mic`, `MicOff`, `Headphones`, `PhoneOff`, `VolumeX`, `Hash`,
  `Volume2`) existem no pacote antes de usá-los.
- `find . -maxdepth 1 -name "@"` — confirmado que não sobrou diretório
  espúrio depois de mover `badge.tsx`/`separator.tsx`.
- `git status --short` — usado só para observar o estado do working tree
  compartilhado (nenhum comando git de escrita foi executado, conforme
  `<NO_GIT>`).

**Só escrevi/inferi, não verifiquei visualmente (falta GUI funcional):**
- Que a sidebar renderiza visualmente as categorias, badges, avatares
  aninhados e anéis de "falando" como esperado.
- Que trocar de servidor na barra (Plano 01) realmente atualiza a lista de
  canais em tempo real na tela.
- Que clicar num canal de voz realmente faz o `VoiceControlBar` mudar de
  texto em tempo real (a lógica foi revisada por leitura de código — ambos
  os componentes leem o mesmo `joinedVoiceChannelId` do contexto
  compartilhado — mas sem confirmação de renderização real).
- Tooltips de mute/deafen/desconectar aparecendo visualmente ao hover.

Estes pontos exigem uma máquina com GUI funcional (Windows nativo ou WSLg
operante) para confirmação visual — mesma limitação de ambiente já
registrada no 03-01-SUMMARY.md.

## User Setup Required

None - nenhuma configuração de serviço externo necessária (F3 é
puramente estática/mockada). A única mudança de dependência foi
`npm install lucide-react`, já aplicada.

## Next Phase Readiness

- `ChannelSidebar.tsx` e `VoiceControlBar.tsx` estão prontos para
  verificação visual conjunta com os Planos 03-03 e 03-04 (que devem estar
  concluindo em paralelo) — recomendo que a primeira verificação visual
  real do shell completo (Plano 03-05) aconteça só depois que os três
  planos convergirem, numa máquina com GUI funcional.
- Atenção: `package.json`/`package-lock.json` foram modificados por este
  plano (`lucide-react`). Se algum sibling também precisar da mesma
  dependência, o orquestrador deve conferir que não há conflito duplo ao
  fazer merge/stage dos três planos — na dúvida, `npm install` de novo
  depois de todos os stages resolve qualquer divergência de lockfile.
- O erro de typecheck em `ConversationArea.tsx` (`useEffect` não usado)
  observado durante minha verificação é do Plano 03-03, não deste plano —
  deve ser resolvido antes do gate final de build da fase, mas não bloqueia
  a entrega deste plano.

---
*Phase: 03-shell-da-ui*
*Completed: 2026-08-18*
