---
phase: 04-servidores-e-canais
plan: 07
subsystem: ui
tags: [convex, react, presence, members, discord-clone]

# Dependency graph
requires:
  - phase: 04-servidores-e-canais (04-04)
    provides: "convex/members.ts:listServerMembers query com participação + presença real"
  - phase: 04-servidores-e-canais (04-05)
    provides: "selection-context.tsx derivando selectedServerId de dado real (listMyServers)"
provides:
  - "MemberList.tsx consumindo listServerMembers em vez de mockMembers/mockChannels/mockVoiceParticipants"
  - "Agrupamento ONLINE/OFFLINE orientado a member.online (booleano vindo da query, derivado de heartbeat real)"
  - "Overlay de fala/mute neutralizado explicitamente (placeholder até F7), JSX/CSS preservados"
affects: [07-voz-em-tempo-real]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FunctionReturnType<typeof api.x.y>[number] para tipar itens de lista sem duplicar shape manualmente"

key-files:
  created: []
  modified:
    - src/renderer/src/components/shell/MemberList.tsx

key-decisions:
  - "Tipo ServerMember derivado via FunctionReturnType<typeof api.members.listServerMembers>[number] (convex/server) em vez de tipo local duplicado — shape sempre acompanha a query."
  - "voiceStateFor virou neutralVoiceState() fixo — sem voiceStates real nesta fase, comentário explícito aponta para F7 (VOICE-06/VOICE-08)."
  - "useQuery com padrão 'skip' quando selectedServerId é null, em vez de early-return condicional — consistente com o resto do shell (ChannelSidebar/ConversationArea)."

patterns-established: []

# Metrics
duration: ~15min
completed: 2026-08-19
---

# Phase 04 Plan 07: Lista de Membros Real Summary

**MemberList.tsx trocado de `mockMembers`/`mockVoiceParticipants` para `convex/members.ts:listServerMembers`, com status online/offline vindo de presença real e overlay de voz neutralizado como placeholder de F7**

## Performance

- **Duration:** ~15min
- **Completed:** 2026-08-19T00:59:02Z
- **Tasks:** 1/1
- **Files modified:** 1

## Accomplishments
- `MemberList.tsx` consome `useQuery(api.members.listServerMembers, selectedServerId ? { serverId: selectedServerId } : 'skip')` em vez de filtrar arrays mockados.
- Agrupamento ONLINE/OFFILINE usa `member.online` (booleano já calculado por `listServerMembers`/`isOnline`, plano 04-04/04-05) — nenhum recálculo de threshold na UI.
- Zero servidores selecionados (`selectedServerId === null`) usa o padrão `'skip'` do Convex: `useQuery` não dispara a query e `members` fica `undefined`, renderizando a `ScrollArea` vazia sem crash.
- Overlay de fala/mute (anel verde + ícone de mute) preservado no JSX/CSS, mas alimentado por `neutralVoiceState()` fixo (`{ speaking: false, muted: false }`) com comentário apontando para F7 (VOICE-06/VOICE-08) — não é mais lido de `mockVoiceParticipants`.

## Task Commits

**NO_GIT constraint ativa nesta execução** (três agentes irmãos rodando em paralelo: 04-06 em ChannelSidebar/ChannelHeader/ConversationArea, 06-03/06-05 em `convex/`). Nenhum commit foi criado — a mudança está uncommitted em `src/renderer/src/components/shell/MemberList.tsx`, pronta para o orquestrador consolidar.

1. **Task 1: MemberList sobre dado real de membros + presença** — sem commit (NO_GIT), arquivo modificado e verificado localmente.

## Files Created/Modified
- `src/renderer/src/components/shell/MemberList.tsx` - Reescrito para consumir `listServerMembers`; removidos imports de `@/data/mock-data` (`mockMembers`, `mockChannels`, `mockVoiceParticipants`, `Member`); tipo `ServerMember` derivado via `FunctionReturnType`; `voiceStateFor` substituído por `neutralVoiceState()`.

## Decisions Made
- Usei `FunctionReturnType<typeof api.members.listServerMembers>[number]` (de `convex/server`) para tipar `ServerMember` em vez de escrever um tipo local — evita duplicar o shape da query e quebra em tempo de compilação se `listServerMembers` mudar de formato.
- Mantive o padrão `'skip'` do `useQuery` (igual ao usado em `selection-context.tsx` para `listChannels`) em vez de pular a chamada com `if`/early-return — consistente com o resto do shell e evita hooks condicionais.
- `initialsFor` continua idêntica (`username.slice(0, 2).toUpperCase()`) — plano confirmou que o formato de `username` real segue o do mock, então a função não precisou mudar.

## Deviations from Plan

None - plano executado como escrito. O único ajuste fora do texto literal do plano foi técnico, não de escopo: o import relativo para `convex/_generated/api` precisou de 5 níveis (`../../../../../convex/...`), não 4, porque `MemberList.tsx` está um nível mais fundo (`components/shell/`) que `selection-context.tsx` (`state/`) usado como referência no plano. Corrigido durante a Task 1, coberto pela Rule 3 (blocking — sem isso o TypeScript não resolve o módulo).

## Issues Encountered
- `npm run build` encadeia `typecheck:convex`, que hoje falha em `convex/dms.test.ts` e `convex/friends.test.ts` (erros de tipo implícito `any` e um teste de `dms.listDmMessages` falhando em `npx vitest run`). Esses arquivos pertencem ao escopo dos agentes irmãos 06-03/06-05 (trabalho concorrente em `convex/`), não foram tocados por este plano e não foram "corrigidos" aqui — reportando como está, conforme instrução de não mexer em falhas que claramente são de outro agente.
- `npm run typecheck:web` e `npm run typecheck:node` passam limpos. `npx vitest run` tem 100/101 testes passando; a única falha é `convex/dms.test.ts` (fora do meu arquivo).
- Renderização real na janela (Electron/Windows) não pôde ser verificada neste ambiente (sem display) — a verificação humana do agrupamento ONLINE/OFFILINE com heartbeat real precisa rodar no Windows, como o `03-VERIFICACAO.md` já fez para a Fase 3.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `MemberList.tsx` está pronto para F7 (voz em tempo real): o slot de overlay (anel de fala + ícone de mute) continua no JSX/CSS, só precisa trocar `neutralVoiceState()` por leitura de `voiceStates` real — sem retrabalho visual, como o plano pedia.
- Bloqueio conhecido para consolidação: mudanças estão uncommitted por instrução explícita (NO_GIT) devido a agentes irmãos concorrentes em `convex/` e nos outros componentes do shell (04-06). O orquestrador precisa integrar/commitar depois que todos os plans paralelos da wave terminarem.
- Falhas de `convex/dms.test.ts`/`convex/friends.test.ts` (typecheck + 1 teste) são de responsabilidade de 06-03/06-05, não bloqueiam este plano, mas bloqueiam `npm run build` limpo até serem resolvidas por quem as introduziu.

---
*Phase: 04-servidores-e-canais*
*Completed: 2026-08-19*
