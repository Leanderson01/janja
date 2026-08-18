---
phase: 07-voz
plan: 04
type: execute
wave: 3
depends_on: ["07-01", "07-02", "07-03"]
files_modified:
  - convex/voice.ts
  - src/renderer/src/state/voice-context.tsx
  - src/renderer/src/components/shell/ChannelSidebar.tsx
  - src/renderer/src/components/shell/MemberList.tsx
  - src/renderer/src/components/shell/ConversationArea.tsx
autonomous: true

must_haves:
  truths:
    - "Sidebar mostra quem está em cada canal de voz mesmo para quem não entrou, com dados reais do Convex"
    - "Ícones de mute/deafen de cada participante são visíveis aos outros, refletindo voiceStates real"
    - "Avatar de quem fala é destacado sem piscar em micropausas, mas só dentro do canal em que o próprio usuário está conectado"
    - "Cada participante do canal conectado mostra um indicador de qualidade de conexão de 4 níveis"
  artifacts:
    - path: "convex/voice.ts"
      provides: "Queries voiceParticipantsByChannel e voiceParticipantsByServer, com o mesmo controle de membership das mutations do Plano 07-01"
      exports: ["voiceParticipantsByChannel", "voiceParticipantsByServer"]
  key_links:
    - from: "src/renderer/src/components/shell/ChannelSidebar.tsx"
      to: "convex/voice.ts voiceParticipantsByChannel"
      via: "useQuery substitui o filtro sobre mockVoiceParticipants"
      pattern: "voiceParticipantsByChannel"
    - from: "src/renderer/src/state/voice-context.tsx"
      to: "livekit-client RoomEvent.ActiveSpeakersChanged / ConnectionQualityChanged"
      via: "só emitem dado para participantes do Room ao qual o usuário está conectado — sidebar/memberlist para canais não conectados usam só o dado estático do Convex"
      pattern: "ActiveSpeakersChanged"
---

<objective>
Trocar `mockVoiceParticipants` por dados reais em toda a UI que a Fase 3
reservou para isso: sidebar de canais, lista de membros e grade de
participantes da área de conversa — com indicador de fala com debounce e
qualidade de conexão por participante, mas só onde há dado real disponível
(dentro do canal em que o próprio usuário está conectado).

Purpose: fecha VOICE-05, VOICE-06 (visibilidade pros outros), VOICE-08 e
VOICE-15 — a parte de "presença" da fase, distinta da parte de "conexão"
que o Plano 07-03 já resolveu.
Output: as três regiões de UI reagindo a `voiceStates` real; nenhum
componente do shell lendo `mockVoiceParticipants` depois deste plano.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/07-voz/07-RESEARCH.md
@.planning/research/PITFALLS.md
@convex/voice.ts
@src/renderer/src/state/voice-context.tsx
@src/renderer/src/components/shell/ChannelSidebar.tsx
@src/renderer/src/components/shell/MemberList.tsx
@src/renderer/src/components/shell/ConversationArea.tsx
@src/renderer/src/data/mock-data.ts

# Distinção importante que orienta as três telas: "quem está no canal" e
# "quem está mutado/ensurdecido" vêm sempre do Convex (voiceStates), estejam
# vocês conectados juntos ou não — é dado de aplicação. "Quem está falando
# agora" e "qualidade de conexão" só existem para participantes do MESMO
# Room ao qual o usuário local está conectado (dado efêmero do LiveKit,
# nunca escrito no Convex, ver design §6). Um canal de voz que o usuário não
# entrou mostra participantes e ícone de mute normalmente, mas nunca anel de
# fala nem barra de qualidade — não há como saber essas duas coisas sem
# estar conectado àquela sala.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Queries de leitura de voiceStates</name>
  <files>convex/voice.ts</files>
  <action>
    Adicionar duas queries a `convex/voice.ts`, reaproveitando o mesmo
    padrão de checagem de membership já usado em `joinVoiceChannel` (Plano
    07-01) — não duplicar a lógica, extrair um helper se ainda não existir:

    `voiceParticipantsByChannel({ channelId: v.id('channels') })`: confirma
    que o usuário autenticado é membro do servidor dono do canal, depois
    retorna todas as linhas de `voiceStates` daquele `channelId` (índice
    `by_channel`) enriquecidas com `username`/`tag`/`avatarUrl` do documento
    `users` correspondente (um `ctx.db.get(userId)` por linha — o número de
    participantes por canal é pequeno, não precisa de otimização).

    `voiceParticipantsByServer({ serverId: v.id('servers') })`: confirma
    membership no servidor, depois retorna todas as linhas de `voiceStates`
    cujo `channelId` pertence a um canal daquele servidor (buscar os canais
    do servidor primeiro, depois `voiceStates` por `by_channel` para cada
    um — ou, se o volume justificar, avaliar se vale um índice adicional;
    com ~10 pessoas e poucos canais de voz por servidor, a busca em loop é
    suficiente), enriquecidas do mesmo jeito.
  </action>
  <verify>`npx vitest run convex/voice.test.ts` continua passando (nenhuma regressão); um teste novo confirma que não-membro recebe erro ao chamar qualquer uma das duas queries.</verify>
  <done>As duas queries existem, checam membership, e devolvem dados já enriquecidos com identidade legível.</done>
</task>

<task type="auto">
  <name>Task 2: Fala com debounce e qualidade de conexão no VoiceProvider</name>
  <files>src/renderer/src/state/voice-context.tsx</files>
  <action>
    Estender `useVoice()` (Plano 07-03) com dois novos pedaços de estado,
    populados só quando `room` está conectado:

    - `speakingUserIds: Set<string>` — escutar
      `room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => ...)`. Ao
      remover um participante do conjunto de quem fala, **não remover na
      hora**: agendar a remoção com um `setTimeout` de ~300ms por
      `participant.identity`, cancelando o timeout se a pessoa voltar a
      falar antes dele disparar (um `Map<string, ReturnType<typeof setTimeout>>`
      guardando os timeouts pendentes resolve isso sem re-render
      desnecessário). Isso é o requisito de "sem piscar em micropausas"
      (VOICE-08) — sem esse hold, o anel de fala liga/desliga a cada
      pausa curta de respiração na fala.
    - `connectionQualities: Map<string, ConnectionQuality>` — escutar
      `room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => ...)`,
      atualizando a entrada daquele `participant.identity`. Incluir a
      própria conexão (`room.localParticipant`) no mapa, já que o usuário
      também quer ver a própria qualidade.

    Limpar os dois `Map`/`Set` ao desconectar (`ConnectionStateChanged` para
    `disconnected`) — não deixar dado de uma sessão de call anterior
    vazando pra próxima.
  </action>
  <verify>`npm run typecheck` passa; inspeção manual confirma que nenhum timeout fica órfão após desconexão (todos cancelados no cleanup).</verify>
  <done>`useVoice()` expõe `speakingUserIds` e `connectionQualities`, ambos vazios quando desconectado, ambos atualizados em tempo real quando conectado.</done>
</task>

<task type="auto">
  <name>Task 3: Substituir mockVoiceParticipants nas três telas</name>
  <files>
    src/renderer/src/components/shell/ChannelSidebar.tsx,
    src/renderer/src/components/shell/MemberList.tsx,
    src/renderer/src/components/shell/ConversationArea.tsx
  </files>
  <action>
    Em `ChannelSidebar.tsx` (`VoiceChannelRow`): trocar o filtro sobre
    `mockVoiceParticipants` por `useQuery(api.voice.voiceParticipantsByChannel, { channelId: channel.id })`.
    Anel de fala e badge de mute continuam no mesmo lugar visual do Plano
    03-02, mas agora: badge de mute vem sempre do dado do Convex
    (`participant.muted`); anel de fala só aparece se
    `channel.id === joinedVoiceChannelId` **e**
    `useVoice().speakingUserIds.has(participant.userId)` — combinar as duas
    condições explicitamente, não assumir que basta uma.

    Em `MemberList.tsx`: trocar a consulta pontual em `mockVoiceParticipants`
    por `useQuery(api.voice.voiceParticipantsByServer, { serverId: selectedServerId })`,
    e cruzar por `userId` como antes. Mesma regra de anel de fala restrita
    ao canal conectado.

    Em `ConversationArea.tsx` (`VoiceParticipantGrid`, dentro de
    `VoiceChannelView`): trocar `mockVoiceParticipants` por
    `useQuery(api.voice.voiceParticipantsByChannel, { channelId })` — esta
    tela só é renderizada quando `channel.id === selectedChannelId`, mas
    pode ser um canal diferente do `joinedVoiceChannelId` (usuário
    navegando para ver quem está lá sem entrar) — o anel de fala e a
    qualidade de conexão só aparecem se `channelId === joinedVoiceChannelId`
    (mesma regra das outras duas telas); caso contrário a grade mostra só
    avatar + nome + ícone de mute, exatamente como o Plano 03-03 já fazia
    para o caso mockado de "canal visualizado mas não conectado" — a
    diferença agora é que os dados são reais. Adicionar a barra/indicador de
    qualidade (4 níveis: Excellent/Good/Poor/Lost, mapeados para um ícone ou
    conjunto de barrinhas — reaproveitar algum ícone de sinal já disponível
    em `lucide-react`, ex. `SignalHigh`/`SignalLow`/`SignalZero`) só quando
    aplicável.

    Remover a importação de `mockVoiceParticipants` dos três arquivos —
    nenhum deles deve mais referenciá-lo depois desta task.
  </action>
  <verify>`grep -r mockVoiceParticipants src/renderer/src/components/shell` não retorna nada. No app rodando (ou verificação humana no Plano 07-08), participantes reais aparecem nas três telas com mute/deafen corretos, e o anel de fala/qualidade só aparece no canal em que o usuário está de fato conectado.</verify>
  <done>As três telas leem `voiceStates` real via as queries da Task 1, com anel de fala debounced e qualidade de conexão restritos ao canal conectado.</done>
</task>

</tasks>

<verification>
- Nenhum arquivo em `src/renderer/src/components/shell` importa
  `mockVoiceParticipants` depois deste plano.
- O anel de fala nunca aparece para um canal diferente de
  `joinedVoiceChannelId` — checar isso é fácil de errar (usar o dado errado
  de `speakingUserIds` fora de contexto), então vale grep manual das três
  condições (`channel.id === joinedVoiceChannelId` /
  `channelId === joinedVoiceChannelId`) nos três arquivos.
</verification>

<success_criteria>
VOICE-05, VOICE-06 (visibilidade), VOICE-08 e VOICE-15 implementados e
consistentes nas três regiões de UI que a Fase 3 reservou para isso.
</success_criteria>

<output>
After completion, create `.planning/phases/07-voz/07-04-SUMMARY.md`
</output>
