---
phase: 07-voz
plan: 03
subsystem: voice
tags: [livekit, livekit-client, webrtc, react-context, convex, electron]

# Dependency graph
requires:
  - phase: 07-01
    provides: "setMuted/setDeafened/leaveVoiceChannel mutations e voiceStates com a semântica de mute/deafen já aplicada no servidor"
  - phase: 07-02
    provides: "joinVoiceChannel movido para convex/voiceToken.ts (runtime Node, `use node`) — descoberto e corrigido pelo trabalho concorrente da wave, não por este plano"
provides:
  - "VoiceProvider (src/renderer/src/state/voice-context.tsx): Room real do livekit-client, ciclo de vida comandado pela intenção em SelectionContext (joinedVoiceChannelId)"
  - "VoiceControlBar com mute/deafen/conexão reais, não mais mockados"
  - "AppShell com VoiceProvider montado dentro de SelectionProvider"
affects: ["07-04 (presença e participantes)", "07-05 (VAD, dispositivos, preferências)", "07-08 (verificação final)"]

# Tech tracking
tech-stack:
  added: ["livekit-client@2.22.0"]
  patterns:
    - "Intenção de UI (SelectionContext) separada de efeito colateral real (VoiceProvider) via useEffect observando a intenção, nunca o inverso"
    - "Fila de transições serializada por encadeamento de Promise (transitionChainRef) para garantir leave-antes-de-join mesmo em trocas rápidas de canal"
    - "Ajuste de estado local durante o render (não em useEffect) para resetar mute/deafen ao iniciar uma nova intenção de join — evita o commit extra de um efeito"

key-files:
  created:
    - "src/renderer/src/state/voice-context.tsx"
  modified:
    - "src/renderer/src/components/shell/VoiceControlBar.tsx"
    - "src/renderer/src/components/shell/AppShell.tsx"
    - "package.json"

key-decisions:
  - "joinVoiceChannel é chamado via api.voiceToken.joinVoiceChannel, não api.voice.joinVoiceChannel — durante a execução deste plano, o sibling 07-02 descobriu que livekit-server-sdk precisa do runtime Node do Convex (o spike do 07-01 validou no ambiente errado, vitest/edge-runtime, não no bundler real do Convex) e moveu a action para convex/voiceToken.ts com \"use node\". VoiceProvider foi ajustado para a nova localização assim que o typecheck expôs a referência quebrada."
  - "Deafen implementado silenciando localmente a reprodução de toda RemoteAudioTrack (setVolume(0)/setVolume(1)), com um listener em RoomEvent.TrackSubscribed que reaplica o valor atual — cobre participantes que entram depois do usuário já estar ensurdecido, não só o snapshot do momento."
  - "Reconciliação de mute/deafen ao (re)conectar é uma reconciliação mínima: uma NOVA intenção de join (transição de joinedVoiceChannelId) sempre reseta o estado local para destravado — mesma linha de base que upsertVoiceState usa para uma linha nova de voiceStates. Ler a linha real de voiceStates exigiria uma query pública em convex/voice.ts, fora da lista de arquivos deste plano (convex/ é do sibling 07-02 nesta wave). Documentado como lacuna conhecida para o Plano 07-04 fechar quando adicionar a query de participantes."
  - "Um único Room por vida do VoiceProvider (useState(() => new Room()), inicializador preguiçoso) — connect()/disconnect() são chamados repetidamente sobre o mesmo objeto em vez de recriar a instância a cada troca de canal."

patterns-established:
  - "AudioCaptureOptions (echoCancellation/noiseSuppression/autoGainControl) sempre explícitas em toda chamada a setMicrophoneEnabled(true, ...), incluindo o caminho de toggle de mute (que na prática só chama track.unmute() sobre a track já publicada, mas passa as opções de novo por defesa em profundidade e para satisfazer verificação por grep)"

# Metrics
duration: ~50min
completed: 2026-08-19
---

# Phase 07 Plan 03: Cliente LiveKit — Núcleo Summary

**VoiceProvider real com `livekit-client`: Room conectado via token assinado pelo Convex, microfone publicado com eco/ruído/ganho automático sempre explícitos, e VoiceControlBar refletindo conexão/mute/deafen reais em vez do mock da Fase 3.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 2/2
- **Files modified:** 4 (1 criado: `voice-context.tsx`; 3 modificados: `VoiceControlBar.tsx`, `AppShell.tsx`, `package.json`)

## Accomplishments

- `VoiceProvider`/`useVoice()` novo, ligando a intenção de `SelectionContext`
  (`joinedVoiceChannelId`) ao ciclo de vida real de um `Room` do
  `livekit-client`: assina token via `joinVoiceChannel` (Convex action),
  conecta, publica o microfone com `echoCancellation`/`noiseSuppression`/
  `autoGainControl` sempre explícitos (VOICE-16), e expõe `connectionState`
  usando exatamente os 5 valores do enum `ConnectionState` do SDK.
- Fila de transições serializada (encadeamento de `Promise`) garante que
  trocar de canal de voz diretamente (A → B, sem passar por `null`) sempre
  faz `leaveVoiceChannel` + `room.disconnect()` terminar antes do próximo
  `joinVoiceChannel` + `room.connect()` começar.
- `Room` que cai sozinho (sala fechada, expulsão, reconexão esgotada —
  `RoomEvent.Disconnected` não originado por uma chamada local) devolve
  `joinedVoiceChannelId` para `null`, para a UI não continuar mostrando
  "conectado" a um canal do qual o app já caiu.
- `VoiceControlBar` reescrita: `toggleMuted`/`toggleDeafened` chamam as
  mutations reais do Plano 07-01 (`setMuted`/`setDeafened`, que já aplicam a
  semântica "desmutar remove surdina"/"ensurdecer implica mutar" no
  servidor) e comandam a track real (`localParticipant.setMicrophoneEnabled`)
  e a reprodução real (volume das `RemoteAudioTrack`s). Texto de conexão
  passa a refletir `connectionState` (conectando/conectado/reconectando).
- Deafen implementado como silenciamento local de reprodução — a única forma
  correta no LiveKit, já que não existe "desabilitar playback por
  participante" nativo — com listener em `RoomEvent.TrackSubscribed` para
  cobrir participantes que entram depois do usuário já estar ensurdecido.
- `AppShell` envolve `ShellBody` com `<VoiceProvider>` logo dentro de
  `<SelectionProvider>`.

## Files Created/Modified

- `src/renderer/src/state/voice-context.tsx` - `VoiceProvider`/`useVoice()`: Room real do livekit-client, fila de transições, listeners de ConnectionStateChanged/Disconnected
- `src/renderer/src/components/shell/VoiceControlBar.tsx` - mute/deafen/conexão reais, deafen com reprodução local silenciada, texto de conexão dinâmico
- `src/renderer/src/components/shell/AppShell.tsx` - `VoiceProvider` montado dentro de `SelectionProvider`
- `package.json` - dependência `livekit-client@2.22.0`

## Decisions Made

Ver `key-decisions` no frontmatter. Resumo:

1. **`api.voiceToken.joinVoiceChannel`, não `api.voice.joinVoiceChannel`** — o
   sibling 07-02, rodando em paralelo nesta mesma wave, descobriu que
   `livekit-server-sdk` precisa do runtime Node do Convex (`Could not
   resolve "node:crypto"` no bundler real, apesar do spike do 07-01 ter
   validado só sob `vitest`/edge-runtime) e moveu `joinVoiceChannel` para um
   módulo próprio `convex/voiceToken.ts` com `"use node"`. Este plano não
   toca em `convex/` (fora da lista de arquivos), mas precisou apontar a
   chamada de `useAction` para o novo caminho assim que `npm run typecheck`
   expôs a referência quebrada — sem isso, `VoiceProvider` não compilaria.
2. **Reconciliação de mute/deafen ao reconectar é parcial, por design desta
   wave.** A especificação completa (ler a linha real de `voiceStates` do
   próprio usuário e aplicar sobre o `Room` recém-conectado) exigiria uma
   query pública em `convex/voice.ts`, que não existe hoje e está fora da
   lista de arquivos deste plano — `convex/` pertence ao Plano 07-02 nesta
   wave, não a este. A reconciliação implementada é a linha de base
   correta para o caso comum (nova intenção de join = nova linha de
   `voiceStates`, que nasce com `muted: false, deafened: false` via
   `upsertVoiceState`): ao completar uma NOVA transição de
   `joinedVoiceChannelId` (não em reconexões automáticas do próprio
   LiveKit), o estado local de UI é resetado para destravado. **Não cobre**
   o caso raro de reconectar a uma linha de `voiceStates` pré-existente que
   ainda não foi limpa pelo webhook do Plano 07-02 (ex.: o app crasha com o
   usuário mutado, o usuário reabre e reentra antes do webhook processar
   `participant_connection_aborted`) — nesse caso o novo `Room` nasce
   destravado mesmo que o servidor ainda tivesse `muted: true` da sessão
   anterior. Documentado aqui para o Plano 07-04 fechar quando adicionar a
   query de participantes (o mesmo plano que precisa ler `voiceStates` para
   listar quem está no canal).
3. **`AudioCaptureOptions` explícitas em TODO caminho que habilita o
   microfone**, incluindo o toggle de mute (que na prática só chama
   `track.unmute()` sobre a track já publicada no join, sem recriar a
   captura — confirmado lendo `setTrackEnabled` do SDK: `if (track) {
   track.unmute() } else { createTracks({ audio: options }) }`). Ainda
   assim, as três opções são passadas de novo em todo call-site, por defesa
   em profundidade e para que uma auditoria por `grep` não encontre nenhuma
   chamada de habilitação de microfone sem elas.
4. **Cor de aviso "Reconectando..." usa `text-amber-500`** (paleta padrão do
   Tailwind), não um token semântico `warning` — o design system deste
   projeto (`main.css`) não define um token `--warning`/`--color-warning`
   ainda, só `--destructive`. Reaproveitar `--destructive` pareceria "erro"
   em vez de "aviso transitório", então optei pela cor padrão do Tailwind em
   vez de inventar um novo token de tema fora do escopo deste plano.
5. **`Room` único por vida do provider**, criado com `useState(() => new
   Room())` (inicializador preguiçoso) em vez de um padrão baseado em
   `useRef` com atribuição condicional no corpo do componente — o padrão com
   ref viola a regra `react-hooks/refs` do ESLint deste projeto ("Cannot
   access refs during render"), que está habilitada e tratando isso como
   erro. Ajustado durante a execução (ver Issues Encountered).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Referência de `joinVoiceChannel` apontando para módulo errado**
- **Found during:** Task 1, ao rodar `npm run typecheck` pela primeira vez
- **Issue:** `useAction(api.voice.joinVoiceChannel)` não compilava — o sibling 07-02 já havia movido `joinVoiceChannel` para `convex/voiceToken.ts` (runtime Node) enquanto este plano estava em execução
- **Fix:** Trocado para `useAction(api.voiceToken.joinVoiceChannel)`
- **Files modified:** `src/renderer/src/state/voice-context.tsx`
- **Verification:** `npm run typecheck` limpo
- **Committed in:** não commitado (NO_GIT) — permanece como alteração não commitada em `voice-context.tsx`

**2. [Rule 1 - Bug] Violações de `react-hooks/refs` e `react-hooks/set-state-in-effect`**
- **Found during:** revisão de lint após a Task 2, rodando `npx eslint` sobre os arquivos deste plano (não é parte formal da verificação do plano, mas o projeto tem essas regras habilitadas como erro)
- **Issue:** (a) `Room` criado via `useRef` com leitura de `.current` no corpo do componente durante o render; (b) uma ref (`setJoinedVoiceChannelIdRef`) sendo escrita durante o render; (c) `setMutedState`/`setDeafenedState` chamados de forma síncrona dentro de um `useEffect` puro de sincronização (padrão que o React 19 recomenda evitar em favor de "ajustar estado durante o render")
- **Fix:** `Room` agora vem de `useState(() => new Room())` (inicializador preguiçoso, sem acesso a ref durante render); a ref de `setJoinedVoiceChannelId` foi removida (o setter de `useState` é estável por natureza, não precisa de indireção); o reset de mute/deafen ao iniciar uma nova intenção de join passou a ser um ajuste de estado durante o render (`if (joinedVoiceChannelId !== syncedChannelId) { ... }`), não mais um `useEffect`
- **Files modified:** `src/renderer/src/state/voice-context.tsx`, `src/renderer/src/components/shell/VoiceControlBar.tsx`
- **Verification:** `npx eslint` sobre os 3 arquivos deste plano não reporta mais essas 3 classes de erro (resta só `react-refresh/only-export-components`, que também existe em `selection-context.tsx` já commitado — convenção pré-existente do repo de exportar `Provider` + hook do mesmo arquivo, não uma regressão introduzida aqui)
- **Committed in:** não commitado (NO_GIT)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug/qualidade)
**Impact on plan:** Ambos necessários para o código compilar e para não introduzir dívida de lint nova. Nenhum scope creep — a lacuna de reconciliação completa via query (item 2 das Decisions) foi deliberadamente **não** fechada, por estar fora da lista de arquivos deste plano, e está documentada para o Plano 07-04.

## Issues Encountered

- **Trabalho concorrente real em `convex/` durante a execução:** o sibling
  07-02 (mesma wave) commitou, enquanto este plano rodava, a migração de
  `joinVoiceChannel` para `convex/voiceToken.ts` — visível em
  `git log` como `a895331 fix(07): assinatura de token vai para runtime Node,
  em arquivo próprio` e `36fd45b fix: aponta o cliente de voz para
  voiceToken.joinVoiceChannel`. O segundo desses commits já continha uma
  correção quase idêntica à que este plano precisou aplicar em
  `voice-context.tsx` — sinal de que outra execução (ou o mesmo agente em
  outra tentativa) chegou a rodar concorrentemente sobre o mesmo diretório
  de trabalho. Este plano **não fez nenhum commit** (`NO_GIT` respeitado
  integralmente — só `git status`/`diff`/`log` de leitura foram usados para
  diagnosticar) e as alterações finais em `voice-context.tsx` e
  `VoiceControlBar.tsx` permanecem como mudanças não commitadas no working
  tree, na forma exigida pelo plano.
- Nenhum bloqueio de autenticação (CLI/API) — `joinVoiceChannel` já estava
  configurado com credenciais reais desde o Plano 07-00.

## User Setup Required

None - nenhuma configuração externa nova. As credenciais do LiveKit já
foram configuradas no Convex pelo Plano 07-00.

## Next Phase Readiness

**Pronto para 07-04 (presença e participantes):**
- `useVoice()` expõe `room` e `connectionState` — superfície mínima
  suficiente para 07-04 listar participantes (`room.remoteParticipants`) e
  ligar indicador de fala (`RoomEvent.ActiveSpeakersChanged`) sem precisar
  reimplementar acesso ao `Room`.
- A lacuna de reconciliação de mute/deafen ao reconectar (Decisions #2) é o
  primeiro item que 07-04 deveria fechar ao adicionar a query pública de
  "participantes do canal" — a mesma query resolve os dois problemas.

**Não verificado neste plano (ambiente WSL2 sem dispositivo de áudio nem
janela):**
- Áudio real entre dois participantes — só uma verificação humana em
  Windows com dois clientes reais (Plano 07-08, conforme o próprio plano já
  antecipava) prova ponta a ponta: (a) que o microfone é capturado com
  cancelamento de eco/supressão de ruído/ganho automático de fato ativos
  (verificável via `chrome://webrtc-internals`, não via teste automatizado);
  (b) que mutar de fato para o áudio de saída para o outro participante;
  (c) que ensurdecer de fato silencia a entrada de todos os remotos,
  incluindo um participante que entra depois; (d) que uma queda de rede real
  aciona `reconnecting`/`signalReconnecting` e não só `disconnected`
  direto; (e) que `room.disconnect()` de fato dispara o webhook do Plano
  07-02 na VPS real dentro de segundos.
- `npm run dev` / a janela do Electron em si não foi aberta (sem display no
  WSL2) — a superfície validada aqui é `npm run typecheck`, `npm run build`
  e `npx vitest run` (151/151 testes), todos verdes.

---
*Phase: 07-voz*
*Completed: 2026-08-19*
