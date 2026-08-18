---
phase: 07-voz
plan: 03
type: execute
wave: 2
depends_on: ["07-01"]
files_modified:
  - package.json
  - src/renderer/src/state/voice-context.tsx
  - src/renderer/src/components/shell/VoiceControlBar.tsx
  - src/renderer/src/components/shell/AppShell.tsx
autonomous: true

must_haves:
  truths:
    - "Usuário entra num canal de voz clicando nele na sidebar e passa a ouvir os outros participantes reais (não mockados)"
    - "Usuário vê o próprio estado de conexão (conectando/conectado/reconectando) refletido no rodapé de controles"
    - "Mutar, desmutar, ensurdecer e sair afetam a track real do LiveKit, não só um ícone"
    - "A captura de microfone sempre ativa cancelamento de eco, supressão de ruído e controle automático de ganho"
  artifacts:
    - path: "src/renderer/src/state/voice-context.tsx"
      provides: "Provider que observa a intenção de entrar/sair (SelectionContext) e comanda o ciclo de vida real do Room do LiveKit"
      min_lines: 60
  key_links:
    - from: "src/renderer/src/state/voice-context.tsx"
      to: "convex/voice.ts (joinVoiceChannel, leaveVoiceChannel, setMuted, setDeafened)"
      via: "useAction/useMutation do Convex, nunca assina token no cliente"
      pattern: "joinVoiceChannel"
    - from: "src/renderer/src/state/voice-context.tsx"
      to: "livekit-client Room"
      via: "room.connect(url, token, opts) com AudioCaptureOptions explícitas (echoCancellation, noiseSuppression, autoGainControl)"
      pattern: "echoCancellation"
    - from: "src/renderer/src/components/shell/VoiceControlBar.tsx"
      to: "src/renderer/src/state/voice-context.tsx"
      via: "useVoice() substitui o useState local de muted/deafened e o texto estático de conexão"
      pattern: "useVoice"
---

<objective>
Ligar o cliente Electron ao LiveKit de verdade: entrar num canal de voz passa
a assinar um token real via `joinVoiceChannel`, conectar ao
`wss://livekit.usesenju.com`, publicar o microfone com as opções de captura
corretas, e refletir o estado real de conexão e de mute/deafen no rodapé de
controles que a Fase 3 já deixou pronto.

Purpose: é o coração da fase — sem isto nada mais (indicador de fala,
qualidade de conexão, PTT/VAD) tem uma conexão real para observar. É
deliberadamente o primeiro plano de cliente a rodar, antes de qualquer
polimento de UI de participantes (Plano 07-04) ou de dispositivos (Plano
07-05).
Output: `VoiceProvider` funcional; `VoiceControlBar` mostra estado real, não
mais mock.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/07-voz/07-RESEARCH.md
@.planning/research/PITFALLS.md
@docs/superpowers/specs/2026-08-18-janja-discord-clone-design.md
@convex/voice.ts
@src/renderer/src/state/selection-context.tsx
@src/renderer/src/components/shell/VoiceControlBar.tsx
@src/renderer/src/components/shell/AppShell.tsx

# Pré-requisito: este plano assume que a Fase 2 já deixou um
# ConvexReactClient/ConvexProviderWithAuth montado em algum lugar acima de
# AppShell (useQuery/useMutation/useAction disponíveis no renderer). Se essa
# fiação ainda não existir quando este plano rodar, é bloqueio de F2, não
# algo a inventar aqui.
#
# Decisão de arquitetura deste plano: a INTENÇÃO de entrar/sair continua
# morando em SelectionContext (`joinedVoiceChannelId`/`setJoinedVoiceChannelId`,
# já usada por ChannelSidebar desde a Fase 3) — não duplicar esse estado.
# `VoiceProvider` observa essa intenção via `useEffect` e comanda os efeitos
# colaterais reais (assinar token, conectar, desconectar). Isso evita que
# este plano precise editar `ChannelSidebar.tsx` (que o Plano 07-04 edita
# depois, na wave seguinte) — nenhum conflito de arquivo entre os dois.
</context>

<tasks>

<task type="auto">
  <name>Task 1: VoiceProvider — ciclo de vida real do Room</name>
  <files>package.json, src/renderer/src/state/voice-context.tsx, src/renderer/src/components/shell/AppShell.tsx</files>
  <action>
    `npm install livekit-client`.

    Criar `src/renderer/src/state/voice-context.tsx` exportando
    `VoiceProvider` e um hook `useVoice()`. Internamente:
    - Um `Room` do `livekit-client` guardado em `useRef` (não em state — o
      próprio SDK gerencia seu estado interno; o React só precisa re-render
      quando eventos relevantes disparam, via `useState` derivado dos
      listeners).
    - `useEffect` observando `joinedVoiceChannelId` (de `useSelection()`):
      - transição `null → channelId`: chamar a action `joinVoiceChannel`
        (`useAction(api.voice.joinVoiceChannel)`) com o `channelId`; com o
        `{ token, url }` retornado, chamar `room.connect(url, token)`.
        Depois de conectado, chamar
        `room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true })`
        — **estas três opções nunca podem ficar implícitas** (VOICE-16;
        `07-RESEARCH.md` confirma que não vêm ligadas por padrão em todo
        contexto).
      - transição `channelId → null`: chamar a mutation `leaveVoiceChannel`
        e `room.disconnect()`.
      - transição `channelId → outroChannelId` (troca direta de canal de
        voz sem passar por null): tratar como leave do antigo seguido de
        join do novo, nessa ordem, aguardando o disconnect terminar antes de
        conectar de novo.
    - Listener em `room.on(RoomEvent.ConnectionStateChanged, ...)` mapeando
      para um `connectionState` exposto pelo hook
      (`'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'signalReconnecting'`
      — nomes exatos do enum `ConnectionState`, `07-RESEARCH.md` §3).
    - Se o `Room` desconectar sozinho (evento `Disconnected` não originado
      por uma chamada local a `leave`, ex.: sala fechada, expulsão) chamar
      `setJoinedVoiceChannelId(null)` de volta, para a UI não ficar
      mostrando "conectado" a um canal do qual o app já caiu.
    - Cleanup: `room.disconnect()` no unmount do provider (fechamento do
      app) — best-effort, não é o mecanismo principal de saída (isso é o
      webhook do Plano 07-02); é só higiene para não deixar um `Room`
      pendurado durante hot-reload em dev.
    - Expor via `useVoice()`: `connectionState`, `room` (ou uma superfície
      mínima sobre ele, o suficiente para os Planos 07-04/07-05 não
      precisarem reimplementar o acesso ao `Room`).

    Envolver `AppShell` com `<VoiceProvider>` logo dentro de
    `<SelectionProvider>` (precisa vir depois, já que lê `useSelection()`).
  </action>
  <verify>`npm run typecheck` (ou equivalente do projeto) passa; `VoiceProvider` compila sem depender de nenhum tipo de `mock-data.ts`.</verify>
  <done>VoiceProvider existe, monta sem erro, e reage a mudanças de `joinedVoiceChannelId` chamando as funções reais do Convex e do `Room`.</done>
</task>

<task type="auto">
  <name>Task 2: VoiceControlBar com estado real (mute, deafen, conexão)</name>
  <files>src/renderer/src/components/shell/VoiceControlBar.tsx</files>
  <action>
    Substituir os dois `useState` locais (`muted`, `deafened`) por leitura
    de `voiceStates` do canal conectado via `useQuery` — a query em si
    (`api.voice.get...`) é adicionada no Plano 07-04; até lá, ler
    diretamente do `Room`/`localParticipant` como fonte provisória
    (`localParticipant.isMicrophoneEnabled` para inferir `muted`) é
    aceitável, mas a chamada às mutations (`setMuted`/`setDeafened` do
    Plano 07-01) e a track real (`localParticipant.setMicrophoneEnabled`)
    já precisam estar corretas nesta task — **elas não esperam o Plano
    07-04**.

    `toggleMuted`: chama `setMuted({ muted: !current })` (mutation) e
    `room.localParticipant.setMicrophoneEnabled(current)` (nota: enabled é o
    inverso de muted). Mantém a regra já existente no componente ("desmutar
    enquanto ensurdecido também remove o ensurdecimento") — mas agora a
    fonte da verdade dessa regra é o Plano 07-01 (as mutations já aplicam a
    semântica sozinhas); o componente só precisa refletir o resultado, não
    reimplementar a regra localmente.

    `toggleDeafened`: chama `setDeafened({ deafened: !current })`. Deafen é
    puramente local/de reprodução — não existe "desabilitar track de
    playback" por participante individual no LiveKit nesta API; a forma
    correta de ensurdecer é silenciar a reprodução local de todas as tracks
    remotas (ex.: `room.remoteParticipants` iterando e ajustando o volume/
    `setVolume(0)` de cada `AudioTrack`, ou, mais simples e igualmente
    válido para v1, silenciar o elemento `<audio>` de cada participante
    remoto). Documentar a escolha feita no SUMMARY — os Planos 07-04/07-05
    herdam essa decisão para lidar com participantes que entram DEPOIS do
    usuário já estar ensurdecido (a implementação escolhida precisa cobrir
    isso, não só o snapshot do momento).

    **Reconciliação ao (re)conectar** (PITFALLS.md, UX Pitfalls): ao
    terminar `room.connect()`, ler a própria linha de `voiceStates` (via
    query, mesmo antes do Plano 07-04 formalizar a UI de participantes —
    pode ser uma query mínima só para o próprio usuário aqui) e aplicar
    `muted`/`deafened` dali sobre o `localParticipant` real, **não** assumir
    que o estado da track local sobrevive a uma reconexão do zero.

    Texto de conexão: trocar `"Conectado a {nome}"`/`"Não conectado..."`
    fixos por algo que reflita `connectionState` do `useVoice()`:
    conectando (`"Conectando a {nome}..."`), conectado (mantém o texto
    atual), reconectando (`"Reconectando..."`, com destaque visual, ex. cor
    de aviso).
  </action>
  <verify>Com dois clientes reais (checkpoint no Plano 07-08 prova isso formalmente) ou com um único cliente contra o servidor real: entrar no canal muda o texto para "Conectando..." e depois "Conectado a X"; mutar desabilita a track (confirmável em `chrome://webrtc-internals`, sem áudio de saída do participante); sair desconecta o `Room` (evento de disconnect visível no console/log).</verify>
  <done>VoiceControlBar reflete estado real de conexão, mute e deafen — nenhum `useState` mockado de F3 restante para esses três campos.</done>
</task>

</tasks>

<verification>
- `joinVoiceChannel`/`leaveVoiceChannel`/`setMuted`/`setDeafened` do Plano
  07-01 são chamados de verdade a partir da UI, não simulados.
- `AudioCaptureOptions` sempre inclui `echoCancellation: true,
  noiseSuppression: true, autoGainControl: true` — grep confirma que não há
  publicação de microfone sem essas três opções em nenhum caminho.
- `connectionState` exposto por `useVoice()` usa exatamente os 5 valores do
  enum `ConnectionState` do LiveKit, sem reinventar nomenclatura própria.
</verification>

<success_criteria>
VOICE-01, VOICE-03, VOICE-06, VOICE-07, VOICE-14 e VOICE-16 têm uma conexão
real de ponta a ponta (Convex assina, LiveKit transporta, UI reflete) —
ainda sem indicador de fala nem qualidade por participante (Plano 07-04).
</success_criteria>

<output>
After completion, create `.planning/phases/07-voz/07-03-SUMMARY.md`
</output>
