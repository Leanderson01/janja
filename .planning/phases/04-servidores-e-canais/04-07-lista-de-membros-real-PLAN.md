---
phase: 04-servidores-e-canais
plan: 07
type: execute
wave: 4
depends_on: ["04-05", "04-04"]
files_modified:
  - src/renderer/src/components/shell/MemberList.tsx
autonomous: true

must_haves:
  truths:
    - "Usuário vê a lista de membros reais do servidor selecionado, agrupada por online/offline"
    - "O status online/offline exibido vem de presença real (heartbeat da Fase 2), não de um valor fixo"
    - "Lista de membros fica vazia (sem crash) quando não há servidor selecionado"
  artifacts:
    - path: "src/renderer/src/components/shell/MemberList.tsx"
      provides: "Lista de membros do servidor selecionado, orientada por convex/members.ts:listServerMembers"
      contains: "listServerMembers"
  key_links:
    - from: "src/renderer/src/components/shell/MemberList.tsx"
      to: "convex/members.ts (listServerMembers)"
      via: "useQuery(api.members.listServerMembers, { serverId: selectedServerId })"
      pattern: "listServerMembers"
---

<objective>
Trocar a fonte de dados da lista de membros — hoje `mockMembers`/`mockVoiceParticipants` da
Fase 3 — pela query real `convex/members.ts:listServerMembers` (plano 04-04), que já entrega
presença online/offline derivada de heartbeat real.

Purpose: é o último requisito de leitura pendente da fase (SRV-07/APP-02) — sem este plano, a
lista de membros continuaria mostrando "ana#0231, bruno#4410..." fixos independente de quem
realmente está no servidor selecionado.
Output: `MemberList.tsx` mostrando membros e presença reais.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/04-servidores-e-canais/04-RESEARCH.md
@.planning/phases/04-servidores-e-canais/04-04-membros-e-presenca-PLAN.md
@.planning/phases/04-servidores-e-canais/04-05-navegacao-real-de-servidores-PLAN.md
@.planning/phases/03-shell-da-ui/03-VERIFICACAO.md
@src/renderer/src/components/shell/MemberList.tsx
@src/renderer/src/state/selection-context.tsx

# Este plano roda em paralelo ao 04-06 (mesma wave, arquivos diferentes — MemberList.tsx não é
# tocado por 04-06). Depende só do 04-05 (selection-context real) e do 04-04 (listServerMembers).
#
# 03-VERIFICACAO.md marca "avatares de participantes de voz aninhados"/"anel de fala e ícone
# de mute" como slots de F7, não desta fase. O overlay de voz (`voiceStateFor`) do componente
# da Fase 3 usava `mockVoiceParticipants` — sem voiceStates real, esse overlay não tem de onde
# vir. Não apagar a capacidade visual (o anel/ícone continuam existindo no JSX, prontos para
# F7 plugar dado real), só parar de tentar lê-la de mock: hardcode `{ speaking: false, muted:
# false }` para todo membro nesta fase, com um comentário explicando que é o placeholder até F7.
#
# O status online/offline (AvatarBadge verde/cinza) É desta fase — isso vem de
# listServerMembers, não é hardcoded.
</context>

<tasks>

<task type="auto">
  <name>Task 1: MemberList sobre dado real de membros + presença</name>
  <files>src/renderer/src/components/shell/MemberList.tsx</files>
  <action>
    Reescrever `src/renderer/src/components/shell/MemberList.tsx`:
    - Se `selectedServerId === null` (zero servidores): renderizar a `ScrollArea` vazia (sem
      grupos), sem chamar `listServerMembers`.
    - Caso contrário: `const members = useQuery(api.members.listServerMembers, { serverId: selectedServerId })`.
      Enquanto `members === undefined`, renderizar a `ScrollArea` vazia (carregamento rápido,
      sem spinner dedicado — mesmo critério já usado nos outros componentes desta fase).
    - Cada item de `members` tem o formato `{ userId, username, tag, displayName, avatarUrl,
      nickname, online }` (retorno de `listServerMembers`, plano 04-04) — trocar todo uso de
      `member.id`/`member.status === 'online'` (formato mockado da Fase 3) por `member.userId`
      e `member.online` (já é `boolean`, não precisa mais de comparação de string).
    - Agrupamento "ONLINE — N"/"OFFLINE — N" continua igual, só trocando a fonte do filtro para
      `member.online`.
    - `voiceStateFor(memberId)`: substituir a busca em `mockVoiceParticipants` por um valor
      fixo `{ speaking: false, muted: false }` para todo membro — comentário no código
      explicando que é o placeholder até F7 trazer `voiceStates` real (ver nota de contexto
      acima). Não remover `MemberAvatar`/a lógica de exibir o anel/ícone — só a fonte do dado
      muda para "sempre falso" nesta fase.
    - `AvatarFallback`: usar `member.username.slice(0, 2).toUpperCase()` como antes — o
      `username` real (Fase 2) segue o mesmo formato do mock, então a função `initialsFor` não
      muda.
  </action>
  <verify>`npm run typecheck:web` passa; `MemberList.tsx` não importa mais `mockMembers`/`mockChannels`/`mockVoiceParticipants`/`Member` de `@/data/mock-data`; abrir o app com um servidor de 2+ membros (um logado agora, outro sem heartbeat recente) mostra os grupos ONLINE/OFFLINE corretamente, sem erro no console.</verify>
  <done>Lista de membros mostra dado real de participação e presença, com o overlay de voz (fora de escopo desta fase) neutralizado de forma explícita, não removido.</done>
</task>

</tasks>

<verification>
- `npm run typecheck` (node + web) passa.
- `npm run build` passa.
- `MemberList.tsx` não importa nada de `@/data/mock-data`.
- Servidor com zero servidores selecionados não quebra a renderização de `MemberList`.
</verification>

<success_criteria>
SRV-07 e APP-02 observáveis por um humano usando o app: lista de membros do servidor real,
com status online/offline derivado de presença real, sem depender de dado mockado.
</success_criteria>

<output>
After completion, create `.planning/phases/04-servidores-e-canais/04-07-SUMMARY.md`.
</output>
