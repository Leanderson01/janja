---
phase: 05-chat-em-tempo-real
plan: 01
subsystem: database
tags: [convex, chat, pagination, authorization, tdd]

# Dependency graph
requires:
  - phase: 04-servidores-e-canais
    provides: "convex/schema.ts (servers, serverMembers, channels), convex/lib/membership.ts (requireMembership/requireIdentity)"
  - phase: 06-amigos-e-dms
    provides: "convex/dms.ts como precedente do padrão de helper local não-exportado (assertDmMember) e de paginação (dmMessages)"
provides:
  - "Tabelas messages, channelReadState, typing em convex/schema.ts (13 tabelas no total)"
  - "convex/messages.ts: sendMessage (mutation) e listMessages (query paginada, enriquecida com autor e isMine)"
  - "Autorização de canal (requireChannelMembership local) reaproveitando requireMembership de F4, aplicada tanto a envio quanto a leitura de mensagens"
affects: [05-02-nao-lidas-backend, 05-03-digitando-backend, 05-04-mensagens-scroll-e-nao-lidas-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "requireChannelMembership: helper local não-exportado que resolve o canal e delega a autorização para requireMembership(ctx, channel.serverId) — mesmo padrão que assertDmMember em convex/dms.ts (F6), arquivos de domínio de fases diferentes não compartilham função interna entre si"
    - "listMessages usa withIndex('by_channel', ...).order('desc').paginate(paginationOpts) — nunca .filter()/.collect() do canal inteiro"
    - "Enriquecimento de página via Promise.all (mensagem + autor), mesmo padrão de members.ts:listServerMembers; isMine computado sem consulta extra a partir do user já resolvido pela checagem de autorização"

key-files:
  created:
    - convex/messages.ts
    - convex/messages.test.ts
  modified:
    - convex/schema.ts

key-decisions:
  - "Tabelas channelReadState e typing declaradas no schema desta fase (design aprovado), mas sem nenhuma function própria — só messages.ts (sendMessage/listMessages) foi implementado, conforme escopo do plano 05-01"
  - "sendMessage rejeita channel.type !== 'text' mesmo sendo validação defensiva redundante com a UI atual (F3/F4 nunca monta MessageInput numa view de canal de voz) — backend não confia só no cliente"
  - "Sem editedAt no schema de messages: CHAT-08 (editar mensagem) é escopo v2, mesmo corte que 06-RESEARCH.md aplicou a friendRequests.status"

patterns-established:
  - "Módulo de domínio novo importa só os helpers já publicamente exportados de lib/membership.ts (requireMembership), nunca requireIdentity diretamente — a checagem de identidade fica encapsulada dentro de requireMembership"

# Metrics
duration: ~20min
completed: 2026-08-19
---

# Phase 05 Plan 01: Schema de chat + envio e listagem paginada de mensagens Summary

**Tabela `messages` (índice `by_channel`) + `sendMessage`/`listMessages` em `convex/messages.ts`, com autorização por membership de servidor e paginação real via `paginate()`, mais as tabelas `channelReadState`/`typing` declaradas no schema para os planos 05-02/05-03**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-19T01:18:34Z
- **Tasks:** 1 ciclo TDD (RED → GREEN, sem REFACTOR — nenhuma duplicação óbvia surgiu)
- **Files modified:** 3 (1 modificado, 2 criados)

## Accomplishments

- `convex/schema.ts`: acrescentadas as 3 tabelas da Fase 5 (`messages`, `channelReadState`, `typing`) entre os blocos "Fase 4" e "Fase 6", preservando as 10 tabelas existentes intocadas — total agora 13 tabelas.
- `convex/messages.ts`: `sendMessage` (mutation) e `listMessages` (query paginada) implementados, ambos passando por `requireChannelMembership` (helper local, não exportado) antes de tocar em `messages`.
- `convex/messages.test.ts`: 10 testes cobrindo caminho feliz, ausência de identidade, não-membro (SRV-06 aplicado a chat), conteúdo vazio/excedente, canal de voz, `isMine` por chamador, autor sem `workosId`, e paginação real com cursor (35 mensagens: primeira página 30 itens/`isDone=false`, segunda página 5 itens/`isDone=true`).

## Commits

Conforme a restrição `NO_GIT` desta execução, **nenhum commit foi criado**. Os arquivos abaixo ficam intocados no working tree (não staged, não commitados) para o orquestrador consolidar em série junto com o trabalho do agente irmão em `src/renderer/` (plano 06-06):

- `convex/schema.ts` (modificado)
- `convex/messages.ts` (novo)
- `convex/messages.test.ts` (novo)

**Módulo a registrar pelo orquestrador:** `convex/messages.ts`, exports `sendMessage` (mutation), `listMessages` (query). Os testes usam `anyApi.messages.sendMessage`/`anyApi.messages.listMessages` (padrão estabelecido — não depende de `convex/_generated/api.ts` ser regenerado para os testes passarem).

## Files Created/Modified

- `convex/schema.ts` — acrescenta `messages` (`by_channel`), `channelReadState` (`by_channel_user`), `typing` (`by_channel_user`) entre os blocos "Fase 4" e "Fase 6"; nenhuma tabela existente alterada.
- `convex/messages.ts` — `requireChannelMembership` (helper local não exportado), `sendMessage` (mutation: autorização → `channel.type === 'text'` → `content.trim()` 1–2000 chars → insert), `listMessages` (query: autorização → `withIndex('by_channel').order('desc').paginate()` → enriquecimento com autor + `isMine`).
- `convex/messages.test.ts` — 10 casos de teste (`describe('messages.sendMessage')` com 6 testes, `describe('messages.listMessages')` com 4 testes), mesmo estilo de `convex/channels.test.ts`/`convex/dms.test.ts` (`convexTest(schema, modules)`, `anyApi`, `t.withIdentity`, `t.run` para popular dados diretamente).

## Decisions Made

- `requireChannelMembership` reimplementado localmente em `convex/messages.ts` (não exportado de `lib/membership.ts`) — segue explicitamente o padrão já estabelecido por `assertDmMember` em `convex/dms.ts` (Fase 6), conforme indicado no plano e no `05-RESEARCH.md §1/§5`.
- `channelReadState`/`typing` entraram no schema mas sem nenhuma function — escopo estritamente limitado ao que o plano 05-01 pede; planos 05-02/05-03 implementam as functions dessas tabelas.
- Nenhum campo `editedAt` em `messages` (CHAT-08/editar é v2, mesmo corte de `06-RESEARCH.md` para `friendRequests.status`).

## Deviations from Plan

None — plan executado exatamente como escrito. Único ponto de atenção: `npm run build` falhou numa primeira rodada por um erro de TypeScript em `src/renderer/src/components/shell/ServerRail.tsx` (variáveis `Home`/`Separator` não usadas) — arquivo pertence ao agente irmão da Fase 6 (plano 06-06), rodando em paralelo, fora do meu `file_ownership`. Não fiz nenhuma alteração em `src/`; ao rodar `npm run build` novamente logo em seguida, o erro já não estava mais presente (o agente irmão avançou seu próprio trabalho entretanto) e o build passou limpo. Nenhuma ação foi necessária do meu lado.

## Issues Encountered

None além do já descrito acima (falha transitória de build em arquivo de outro agente, resolvida sem intervenção).

## User Setup Required

None — nenhuma configuração de serviço externo.

## Verification Output (actual)

```
$ npx tsc --noEmit -p convex/tsconfig.json
(sem saída — sucesso)

$ npm run typecheck
> janja@1.0.0 typecheck
> npm run typecheck:node && npm run typecheck:web && npm run typecheck:convex
> tsc --noEmit -p tsconfig.node.json --composite false
> tsc --noEmit -p tsconfig.web.json --composite false
> tsc --noEmit -p tsconfig.convex.json
(todas as três etapas sem erro)

$ npx vitest run
 ✓ convex/channels.test.ts  (10 tests)
 ✓ convex/dms.test.ts  (15 tests)
 ✓ convex/messages.test.ts  (10 tests)
 ✓ convex/invites.test.ts  (13 tests)
 ✓ convex/friends.test.ts  (24 tests)
 ✓ convex/servers.test.ts  (9 tests)
 ✓ convex/lib/inviteCode.test.ts  (6 tests)
 ✓ convex/users.test.ts  (7 tests)
 ✓ convex/presence.test.ts  (3 tests)
 ✓ convex/members.test.ts  (9 tests)
 ✓ convex/lib/tag.test.ts  (5 tests)

 Test Files  11 passed (11)
      Tests  111 passed (111)

$ npm run build
> janja@1.0.0 build
> npm run typecheck && electron-vite build
(typecheck completo sem erro)
vite v7.3.6 building ssr environment for production...  ✓ built
vite v7.3.6 building ssr environment for production...  ✓ built (preload)
vite v7.3.6 building client environment for production... ✓ 2018 modules transformed, built in 1.80s
```

101 testes pré-existentes + 10 novos de `messages.test.ts` = 111 testes, todos passando. Nenhum teste quebrado.

## Next Phase Readiness

- `convex/schema.ts` tem as 13 tabelas esperadas; `messages` pronta para uso por `05-02` (leitura de `by_channel` para calcular divisor de não-lidas) e `05-04` (UI de mensagens/scroll).
- `channelReadState`/`typing` já existem no schema, prontas para os planos 05-02/05-03 adicionarem suas próprias functions sem nenhuma migração de schema adicional.
- Nenhum bloqueio conhecido. Arquivos deste plano ficam sem commit (restrição `NO_GIT`) — cabe ao orquestrador consolidar `convex/schema.ts`, `convex/messages.ts` e `convex/messages.test.ts` no commit em série.

---
*Phase: 05-chat-em-tempo-real*
*Completed: 2026-08-19*
