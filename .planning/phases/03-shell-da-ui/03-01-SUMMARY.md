---
phase: 03-shell-da-ui
plan: 01
subsystem: ui
tags: [react, typescript, tailwind, shadcn, radix-ui, electron, context-api, mock-data]

# Dependency graph
requires:
  - phase: 00-bootstrap
    provides: electron-vite + React + TS scaffold, Tailwind v4 + shadcn/ui configured (components.json, `@` alias, main.css theme tokens), button.tsx
provides:
  - Modelo de dados mockado (Server/Channel/Member/VoiceParticipant/Message) usado por todos os planos de F3
  - Contexto de seleção compartilhado (SelectionProvider/useSelection) com servidor/canal ativo e canal de voz conectado
  - AppShell com layout de 4 regiões (rail 72px, sidebar 240px, conversa elástica, membros 240px)
  - ServerRail funcional (clique, tooltip, indicador de servidor ativo)
  - Stubs tipados de ChannelSidebar, ConversationArea, MemberList prontos para os Planos 02-04 substituírem
affects: [03-02-sidebar-de-canais, 03-03-area-de-conversa, 03-04-lista-de-membros, 03-05-verificacao-e-janela-minima]

# Tech tracking
tech-stack:
  added: [shadcn avatar, shadcn tooltip, shadcn scroll-area (todos sobre radix-ui, já uma dependência existente — nenhum pacote npm novo)]
  patterns:
    - "Layout flex de 4 colunas com `flex-none w-[Npx]` para colunas fixas e `flex-1 min-w-0` para a área elástica (RESEARCH.md §3)"
    - "Contexto de seleção único (`selection-context.tsx`) com todos os campos futuros declarados de uma vez, para evitar colisão de planos paralelos editando o mesmo arquivo"
    - "mock-data.ts como única fonte de dados do shell; componentes só leem, nunca duplicam fixtures"

key-files:
  created:
    - src/renderer/src/data/mock-data.ts
    - src/renderer/src/state/selection-context.tsx
    - src/renderer/src/components/shell/AppShell.tsx
    - src/renderer/src/components/shell/ServerRail.tsx
    - src/renderer/src/components/shell/ChannelSidebar.tsx
    - src/renderer/src/components/shell/ConversationArea.tsx
    - src/renderer/src/components/shell/MemberList.tsx
    - src/renderer/src/components/ui/avatar.tsx
    - src/renderer/src/components/ui/tooltip.tsx
    - src/renderer/src/components/ui/scroll-area.tsx
  modified:
    - src/renderer/src/App.tsx

key-decisions:
  - "SelectionProvider expõe exatamente: selectedServerId/setSelectedServerId, selectedChannelId/setSelectedChannelId, joinedVoiceChannelId/setJoinedVoiceChannelId — todos os campos futuros declarados já nesta task, mesmo que só ChannelSidebar os consuma agora"
  - "shadcn CLI (`npx shadcn@latest add`) escreveu os 3 componentes num diretório literal `@/` na raiz do repo em vez de resolver o alias — corrigido movendo os arquivos manualmente para src/renderer/src/components/ui/ e removendo o diretório espúrio"

patterns-established:
  - "Indicador de servidor ativo: barra vertical `absolute left-0` + `ring-2` condicional no Avatar, sem componente shadcn dedicado (RESEARCH.md §2 já previa que isso seria custom)"

# Metrics
duration: ~8min (commits entre 16:38:50 e 16:42:58 -03; leitura/investigação prévia não cronometrada)
completed: 2026-08-18
---

# Phase 03 Plan 01: Fundação — Layout e Dados Mock Summary

**AppShell de 4 regiões (rail/sidebar/conversa/membros) com ServerRail clicável, contexto de seleção compartilhado e mock-data.ts tipado cobrindo servers/channels/members/voiceParticipants/messages para os Planos 02-04.**

## Performance

- **Duration:** ~8 min de execução ativa (janela dos commits); investigação e verificação adicional não cronometradas separadamente
- **Completed:** 2026-08-18
- **Tasks:** 3/3
- **Files modified:** 11 (10 criados, 1 modificado)

## Accomplishments

- `mock-data.ts` com 5 tipos explícitos (sem `any`) e fixtures: 2 servidores,
  5 canais por servidor (3 texto + 2 voz), 5 membros por servidor
  (online/offline misturados), participantes de voz com falando/mutado/
  ensurdecido, 10 mensagens em pt-BR com 2 divisores de não lidas
- `selection-context.tsx` com `SelectionProvider`/`useSelection()` expondo
  os 3 pares de estado que F3 inteira vai precisar
- `AppShell.tsx` implementando o padrão de layout resiliente a
  redimensionamento do RESEARCH.md §3 (`flex-none` fixo + `flex-1 min-w-0`
  elástico), envolto por `SelectionProvider` + `TooltipProvider`
- `ServerRail.tsx` funcional: lista `mockServers` num `ScrollArea`, cada
  ícone é um `Avatar` com iniciais dentro de `Tooltip`, clicável, com
  indicador visual (barra + anel) de servidor ativo
- Stubs tipados de `ChannelSidebar`/`ConversationArea`/`MemberList`;
  `ChannelSidebar` já lê `useSelection()` e prova a propagação ponta a
  ponta do contexto

## Task Commits

1. **Task 1: Modelo de dados mockado** - `2db6d8b` (feat)
2. **Task 2: Contexto de seleção + esqueleto de layout de 4 regiões** - `a03a775` (feat)
3. **Task 3: Barra de servidores funcional** - `39e03f7` (feat)

_Nenhuma task era TDD; cada uma resultou em um único commit `feat`._

## Files Created/Modified

- `src/renderer/src/data/mock-data.ts` - tipos + fixtures de Server/Channel/Member/VoiceParticipant/Message
- `src/renderer/src/state/selection-context.tsx` - SelectionProvider + useSelection()
- `src/renderer/src/components/shell/AppShell.tsx` - layout de 4 regiões, envolve SelectionProvider + TooltipProvider
- `src/renderer/src/components/shell/ServerRail.tsx` - barra de servidores clicável com tooltip e indicador ativo
- `src/renderer/src/components/shell/ChannelSidebar.tsx` - stub que consome useSelection()
- `src/renderer/src/components/shell/ConversationArea.tsx` - stub de placeholder
- `src/renderer/src/components/shell/MemberList.tsx` - stub de placeholder
- `src/renderer/src/components/ui/avatar.tsx` - gerado via shadcn CLI
- `src/renderer/src/components/ui/tooltip.tsx` - gerado via shadcn CLI
- `src/renderer/src/components/ui/scroll-area.tsx` - gerado via shadcn CLI
- `src/renderer/src/App.tsx` - raiz agora renderiza só `<AppShell />`

## Decisions Made

- **Forma final de `selection-context.tsx`** (relevante para Planos 02-04):
  exporta `SelectionProvider` (componente) e `useSelection()` (hook). O hook
  retorna um objeto com exatamente estes 6 campos:
  - `selectedServerId: string`
  - `setSelectedServerId: (id: string) => void`
  - `selectedChannelId: string`
  - `setSelectedChannelId: (id: string) => void`
  - `joinedVoiceChannelId: string | null`
  - `setJoinedVoiceChannelId: (id: string | null) => void`

  `useSelection()` lança erro se chamado fora de `SelectionProvider` (guarda
  de `undefined` no contexto). `selectedServerId` inicializa com
  `mockServers[0].id`; `selectedChannelId` inicializa com o primeiro canal
  `type: 'text'` desse mesmo servidor (calculado via helper interno
  `firstTextChannelId`); `joinedVoiceChannelId` inicializa `null`.

- **Layout AppShell**: `h-screen w-screen overflow-hidden flex` na raiz;
  rail `flex-none w-[72px]`, sidebar `flex-none w-60`, conversa
  `flex-1 min-w-0 flex flex-col`, membros `flex-none w-60` — exatamente o
  padrão do RESEARCH.md §3, sem `Resizable`.

- **Indicador de servidor ativo**: implementado como composição custom
  (barra `absolute` + `ring-2` condicional), não como variante de um
  componente shadcn — consistente com o que o RESEARCH.md §2 já previa
  como necessidade de customização.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] shadcn CLI escreveu componentes fora do diretório esperado**

- **Found during:** Task 3 (adicionar avatar/tooltip/scroll-area)
- **Issue:** `npx shadcn@latest add avatar tooltip scroll-area` criou um
  diretório literal `@/components/ui/*.tsx` na raiz do repositório em vez
  de resolver o alias `@` para `src/renderer/src/components/ui/` (apesar
  de `components.json` estar corretamente configurado com esse alias). O
  conteúdo interno dos arquivos gerados usava `@/lib/utils` corretamente —
  só a resolução do caminho de escrita falhou.
- **Fix:** Movidos os 3 arquivos manualmente para
  `src/renderer/src/components/ui/` e removido o diretório espúrio `@/`
  (`rm -rf "@"`, confirmado vazio antes da remoção).
- **Files modified:** `src/renderer/src/components/ui/avatar.tsx`,
  `tooltip.tsx`, `scroll-area.tsx` (conteúdo idêntico ao gerado, só o
  caminho final mudou)
- **Verification:** `npm run typecheck` e `npm run build` passam limpos
  após a correção; `git status --porcelain` confirmado sem diretório `@/`
  residual.
- **Committed in:** `39e03f7` (Task 3 commit) — o desvio foi corrigido
  antes de qualquer commit, então não aparece como um commit separado.

### Risco observado (não é um bug de código, é do ambiente de execução compartilhado)

Este worktree é compartilhado com outro agente executando a Fase 1
(LiveKit/infra) em paralelo. Em um momento durante a Task 1, um
`git add` meu e um `git commit` do outro agente colidiram no mesmo índice
Git compartilhado: meu `mock-data.ts` (já staged por mim) foi
temporariamente incluído no commit `feat(01-01)` dele. O outro agente
percebeu e corrigiu via `git commit --amend` antes que eu commitasse
qualquer coisa — verificado comparando `git show --stat` do commit antes e
depois do amend. Nenhuma perda de conteúdo ocorreu; `mock-data.ts`
permaneceu intacto no disco (untracked) e foi commitado corretamente por
mim em seguida, sozinho, em `2db6d8b`. Para os commits seguintes (Task 2 e
Task 3), reduzi a janela de risco fazendo `git add` imediatamente seguido
de `git commit` no mesmo comando, e conferi `git show --stat HEAD` logo
após cada commit para confirmar que só os arquivos esperados entraram.
Nenhum arquivo de `infra/` foi tocado por mim em nenhum momento.

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking), 1 risco de ambiente compartilhado observado e mitigado (não uma falha de código deste plano).
**Impact on plan:** Nenhum impacto no escopo ou nos artefatos entregues. O desvio do shadcn CLI foi puramente mecânico (caminho de escrita) e a colisão de índice Git foi neutralizada pelo outro agente antes de qualquer commit meu.

## Issues Encountered

- `npm run dev` foi executado sob Xvfb (`DISPLAY=:0` disponível neste
  ambiente) e o processo Electron completo chegou a subir (main, gpu,
  utility, renderer), mas o processo de GPU falhou com
  `GPU process isn't usable. Goodbye.` — falha conhecida de Electron/Chromium
  sob WSL2/Xvfb sem aceleração de hardware real, não relacionada ao código
  deste plano. Não foi feita nenhuma alteração de configuração para forçar
  o GUI a rodar (nenhum `--disable-gpu` ou flag equivalente foi adicionado
  ao código do projeto). A confirmação visual completa (4 regiões lado a
  lado, redimensionamento, tooltip ao hover, clique mudando o servidor
  ativo) precisa ser feita numa máquina Windows real ou WSLg funcional —
  isto NÃO foi verificado visualmente por mim, apenas via análise estática.

## Verificação real (o que rodei vs. o que só escrevi)

**Rodei e confirmei:**
- `npm run typecheck` — passa limpo (0 erros) após cada task e no final.
- `npm run build` — passa limpo (`electron-vite build` completo, 143
  módulos do renderer transformados sem erro) após a Task 3.
- `npm run lint` — roda; só produz os warnings de prettier pré-existentes
  do bootstrap (`button.tsx`, `utils.ts`) e um erro
  `react-refresh/only-export-components` em `selection-context.tsx`, do
  mesmo tipo que já existe em `button.tsx` desde o bootstrap (padrão
  aceito no projeto: contexto + hook + provider co-localizados). `lint`
  não faz parte do gate de `build`/`typecheck`, então isto não bloqueia.
- `npm run dev` sob Xvfb — processo Electron sobe até o ponto de tentar
  criar a janela (main/gpu/utility/renderer process todos spawnados), mas
  falha por limitação de GPU do ambiente (ver "Issues Encountered"), não
  por erro de JS/import — o build de produção com os mesmos módulos já
  havia passado limpo.
- `git status --porcelain` após cada commit — confirmado sem arquivos `D`
  (deletados) e sem arquivos de `infra/` na minha árvore de commits.

**Só escrevi/inferi, não verifiquei visualmente:**
- Que as 4 regiões realmente aparecem lado a lado com as larguras corretas
  na tela.
- Que redimensionar a janela mantém as colunas fixas e só a área central
  muda.
- Que o tooltip aparece visualmente ao hover e que o indicador de servidor
  ativo é visualmente claro.
- Que clicar em cada ícone de servidor realmente atualiza o texto do stub
  em tempo real na tela (a lógica foi revisada por leitura de código —
  `setSelectedServerId` é chamado no `onClick`, `useSelection()` é
  consumido por `ChannelSidebar` — mas não há confirmação de renderização
  real).

Estes 4 pontos exigem uma máquina com GUI funcional (Windows nativo, ou
WSLg operante) para confirmação visual.

## User Setup Required

None - nenhuma configuração de serviço externo necessária nesta fase (F3 é
puramente estática/mockada).

## Next Phase Readiness

- Planos 03-02 (sidebar de canais), 03-03 (área de conversa) e 03-04 (lista
  de membros) podem começar em paralelo: cada um só precisa ler
  `mock-data.ts` e `useSelection()` (ambos já com a forma final) e
  substituir seu próprio stub em `src/renderer/src/components/shell/`.
  Nenhum dos três precisa editar `mock-data.ts` ou
  `selection-context.tsx`.
- Bloqueio/atenção para o Plano 03-05 (verificação e janela mínima): a
  confirmação visual completa deste plano (03-01) ainda está pendente —
  recomendo que a primeira verificação visual real do shell completo
  aconteça já com os Planos 02-04 aplicados, numa máquina com GUI
  funcional, para não repetir a etapa de "abrir e olhar" fase por fase.
- `minWidth`/`minHeight` da `BrowserWindow` (recomendado 900x600 pelo
  RESEARCH.md §3) ainda não foi aplicado em `src/main/index.ts` — está fora
  do escopo deste plano (não estava nos `files_modified` do 03-01) e é
  mencionado no RESEARCH.md como guarda-corpo; verificar se o Plano 03-05
  cobre isso.

---
*Phase: 03-shell-da-ui*
*Completed: 2026-08-18*
