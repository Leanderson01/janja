---
phase: 03-shell-da-ui
plan: 04
type: execute
wave: 2
depends_on: ["03-01"]
files_modified:
  - src/renderer/src/components/shell/MemberList.tsx
autonomous: true

must_haves:
  truths:
    - "Lista de membros do servidor selecionado aparece agrupada em seções ONLINE e OFFLINE, cada uma com a contagem no título"
    - "Cada membro mostra avatar com indicador de status (bolinha online/offline) e username#tag"
    - "Membro que está em algum canal de voz do servidor (segundo mockVoiceParticipants) exibe anel de 'falando' quando speaking=true e ícone de mute quando muted=true, mesmo estando na lista de membros (não só na sidebar)"
  artifacts:
    - path: "src/renderer/src/components/shell/MemberList.tsx"
      provides: "Lista de membros do servidor selecionado, agrupada por status, com overlay de estado de voz"
      min_lines: 30
  key_links:
    - from: "src/renderer/src/components/shell/MemberList.tsx"
      to: "src/renderer/src/state/selection-context.tsx"
      via: "useSelection().selectedServerId filtra quais membros aparecem"
      pattern: "selectedServerId"
    - from: "src/renderer/src/components/shell/MemberList.tsx"
      to: "src/renderer/src/data/mock-data.ts"
      via: "cruza member.id com mockVoiceParticipants.memberId para decidir anel de falando / ícone de mute"
      pattern: "mockVoiceParticipants"
---

<objective>
Implementar a lista de membros completa — a região mais à direita do shell —
substituindo o stub do Plano 01: membros do servidor selecionado agrupados
por status online/offline (antecipa APP-02/SRV-07), com overlay de estado de
voz (fala/mute) para quem estiver mockadamente em um canal de voz do
servidor.

Purpose: Fecha a quarta e última região do shell (APP-01). O overlay de voz
aqui é redundante com o da sidebar por design — no Discord real, quem está
falando é destacado tanto na lista de canais quanto na lista de membros, e
replicar isso agora evita que F7 precise adicionar essa lógica numa região
que já deveria têla.
Output: `MemberList` funcional, reagindo à troca de servidor feita na barra
de servidores (Plano 01).
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/03-shell-da-ui/03-RESEARCH.md
@.planning/phases/03-shell-da-ui/03-01-SUMMARY.md
@src/renderer/src/data/mock-data.ts
@src/renderer/src/state/selection-context.tsx
@src/renderer/src/components/shell/AppShell.tsx

# Este plano roda em paralelo aos Planos 02 (sidebar de canais) e 03 (área de
# conversa) — todos dependem só do Plano 01. Não edite AppShell.tsx,
# mock-data.ts, selection-context.tsx nem os arquivos dos outros dois planos;
# este plano só cria/reescreve MemberList.tsx.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Lista de membros agrupada por status</name>
  <files>src/renderer/src/components/shell/MemberList.tsx</files>
  <action>
    Garantir componentes shadcn necessários (`scroll-area`, `avatar`,
    `separator`) instalados.

    Reescrever `MemberList.tsx` (substituindo o stub do Plano 01) como
    `<div className="h-full">` contendo uma `ScrollArea` (`h-full`). Usar
    `useSelection()` para ler `selectedServerId`, filtrar `mockMembers` (de
    `mock-data.ts`) por esse `serverId`, e separar em dois grupos:
    `status === 'online'` e `status === 'offline'`. Renderizar cada grupo com
    um título de seção (`ONLINE — {n}`, `OFFLINE — {n}`, estilo pequeno/
    maiúsculo `text-muted-foreground`) seguido da lista de membros daquele
    grupo; grupo offline pode ter opacidade reduzida (`opacity-60`) para
    reforçar visualmente o status, prática comum em clientes de chat.

    Cada linha de membro: `Avatar` (`AvatarFallback` com iniciais do
    `username` já que `avatarUrl` é mockado como ausente na maioria) +
    `username#tag`. Status representado por um indicador pequeno (bolinha
    verde para online, cinza para offline) sobreposto ao avatar — se o
    `AvatarBadge` do shadcn estiver disponível na versão instalada, use-o;
    caso contrário, um `<span>` posicionado absolutamente no canto inferior
    direito do avatar resolve o mesmo efeito.
  </action>
  <verify>No app rodando, a lista de membros mostra os membros do servidor atualmente selecionado, agrupados corretamente em ONLINE/OFFLINE com as contagens certas no título de cada grupo, e o indicador de status bate com o campo `status` de cada `Member` mockado.</verify>
  <done>MemberList agrupa e exibe membros do servidor selecionado com indicador visual de status online/offline.</done>
</task>

<task type="auto">
  <name>Task 2: Overlay de estado de voz (falando / mutado)</name>
  <files>src/renderer/src/components/shell/MemberList.tsx</files>
  <action>
    Na mesma lista da Task 1, para cada membro renderizado, cruzar
    `member.id` com `mockVoiceParticipants` (de `mock-data.ts`) — se existir
    um `VoiceParticipant` com `memberId === member.id` em QUALQUER canal de
    voz do servidor selecionado (não precisa ser o canal atualmente
    selecionado): quando `speaking === true`, aplicar o mesmo estilo de anel
    de destaque usado no Plano 02 (`ring-2 ring-green-500` ou equivalente) ao
    redor do avatar do membro; quando `muted === true`, sobrepor um pequeno
    ícone de mic-cortado (`MicOff` do `lucide-react`) no avatar, mesmo padrão
    visual usado na sidebar de canais. Um membro pode ter os dois indicadores
    simultaneamente (falando enquanto ainda não mutado é o caso comum; mutado
    nunca deveria mostrar o anel de falando ao mesmo tempo — se os dados
    mockados tiverem essa combinação inconsistente, priorize mostrar o ícone
    de mute e omitir o anel de falando, já que mic mutado não deveria falar).
  </action>
  <verify>O(s) membro(s) cujo `id` aparece em `mockVoiceParticipants` com `speaking: true` mostra o anel de destaque na lista de membros (não só na sidebar); o(s) membro(s) com `muted: true` mostra o ícone de mic-cortado sobreposto.</verify>
  <done>Overlay de voz (falando/mutado) aparece corretamente na lista de membros, consistente com o mesmo estado mockado usado na sidebar de canais (Plano 02).</done>
</task>

</tasks>

<verification>
- Trocar de servidor (barra de servidores) atualiza a lista de membros
  exibida.
- Grupos ONLINE/OFFLINE corretos, com contagens certas.
- Membro mockado como falando exibe anel de destaque; membro mockado como
  mutado exibe ícone de mic-cortado — ambos consistentes com os mesmos dados
  usados na sidebar (Plano 02), mesmo que os dois componentes não
  compartilhem código entre si.
</verification>

<success_criteria>
- Quarta e última região do shell (APP-01) implementada por completo.
- Slot para presença (APP-02, antecipado em F4) e overlay de voz (VOICE-06/
  VOICE-08, antecipado em F7) já existem visual e estruturalmente.
</success_criteria>

<output>
After completion, create `.planning/phases/03-shell-da-ui/03-04-SUMMARY.md`.
</output>
