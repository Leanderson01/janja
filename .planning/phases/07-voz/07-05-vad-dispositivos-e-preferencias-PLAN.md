---
phase: 07-voz
plan: 05
type: execute
wave: 4
depends_on: ["07-03", "07-04"]
files_modified:
  - src/renderer/src/lib/voice-preferences.ts
  - src/renderer/src/lib/vad.ts
  - src/renderer/src/components/shell/VoiceSettingsPopover.tsx
  - src/renderer/src/components/shell/VoiceControlBar.tsx
  - src/renderer/src/state/voice-context.tsx
autonomous: true

must_haves:
  truths:
    - "Usuário escolhe entre detecção de voz (com limiar ajustável) e push-to-talk, e essa escolha sobrevive a reiniciar o app"
    - "Com detecção de voz ativa, o microfone liga sozinho ao detectar fala acima do limiar configurado"
    - "Usuário troca microfone e dispositivo de saída sem que a chamada caia ou reconecte"
  artifacts:
    - path: "src/renderer/src/lib/voice-preferences.ts"
      provides: "Leitura/escrita de preferências locais de voz (modo, limiar do VAD) via localStorage, com valores default"
      exports: ["loadVoicePreferences", "saveVoicePreferences"]
    - path: "src/renderer/src/lib/vad.ts"
      provides: "Motor de detecção de voz sobre Web Audio API (AnalyserNode), independente de React"
      exports: ["createVadMonitor"]
  key_links:
    - from: "src/renderer/src/state/voice-context.tsx"
      to: "src/renderer/src/lib/vad.ts"
      via: "quando o modo é 'vad', o VoiceProvider liga o AnalyserNode sobre a track local e chama setMicrophoneEnabled conforme o nível de áudio cruza o limiar"
      pattern: "createVadMonitor"
    - from: "src/renderer/src/components/shell/VoiceSettingsPopover.tsx"
      to: "livekit-client Room.switchActiveDevice"
      via: "troca de microfone/saída sem chamar room.disconnect()/room.connect() de novo"
      pattern: "switchActiveDevice"
---

<objective>
Dar ao usuário controle sobre como o microfone é transmitido (detecção de
voz com limiar ajustável, por padrão) e qual hardware de áudio usar — tudo
persistindo entre reinícios do app, sem exigir reconexão à sala para trocar
de dispositivo.

Purpose: fecha VOICE-09 (parte VAD), VOICE-10, VOICE-12 (persistência) e
VOICE-13. Push-to-talk em si (a outra metade de VOICE-09, e VOICE-11) é o
Plano 07-06 — depende do módulo de preferências que este plano cria, por
isso vem depois.
Output: painel de configurações de voz acessível a partir do rodapé de
controles; VAD funcional; troca de dispositivo funcional.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/07-voz/07-RESEARCH.md
@.planning/research/FEATURES.md
@src/renderer/src/state/voice-context.tsx
@src/renderer/src/components/shell/VoiceControlBar.tsx

# Preferência de transmissão e limiar são estado de MÁQUINA (localStorage),
# nunca do Convex — o mesmo usuário pode ter microfones diferentes em cada
# computador (07-RESEARCH.md §7). A tecla de push-to-talk em si não é
# configurável nesta versão — só o modo (VAD vs PTT) é uma escolha do
# usuário; o Plano 07-06 fixa uma tecla física padrão documentada no código.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Preferências locais + motor de VAD</name>
  <files>src/renderer/src/lib/voice-preferences.ts, src/renderer/src/lib/vad.ts</files>
  <action>
    `voice-preferences.ts`: definir
    `type VoicePreferences = { mode: 'vad' | 'ptt'; vadThreshold: number }`
    (limiar em escala 0–1, comparável diretamente contra o nível de áudio do
    `AnalyserNode`), com `DEFAULT_VOICE_PREFERENCES = { mode: 'vad',
    vadThreshold: 0.15 }` (valor inicial razoável — documentar que é um
    chute de partida, ajustável pelo usuário). `loadVoicePreferences()` lê
    de `localStorage.getItem('janja:voice-preferences')`, faz `JSON.parse`
    em `try/catch` (nunca lançar — `localStorage` corrompido ou ausente
    cai no default, mesmo padrão defensivo já usado em `session-store.ts`
    do processo main, mas aqui é só `localStorage` do renderer).
    `saveVoicePreferences(partial: Partial<VoicePreferences>)` faz merge
    com o valor atual e persiste.

    `vad.ts`: `createVadMonitor(track: MediaStreamTrack, opts: { threshold: number; onSpeakingChange: (speaking: boolean) => void; holdMs?: number })`
    — cria um `AudioContext`, um `MediaStreamAudioSourceNode` a partir de um
    `MediaStream` contendo só essa track, e um `AnalyserNode`; usa
    `requestAnimationFrame` (não `setInterval`, evita drift) para calcular o
    nível RMS do buffer de tempo e comparar contra `threshold`. Ao cruzar de
    abaixo para acima do limiar, chama `onSpeakingChange(true)`
    imediatamente; ao cruzar de acima para abaixo, aguarda `holdMs` (default
    ~300ms, mesmo padrão de hold do indicador de fala do Plano 07-04 — não
    precisa ser o mesmo código, mas a mesma ideia) antes de chamar
    `onSpeakingChange(false)`, para não cortar o mic no meio de uma pausa
    curta de fala. Retorna `{ stop(): void, setThreshold(v: number): void }`.
    `stop()` fecha o `AudioContext` e cancela o loop de animação — chamar
    sempre ao trocar de modo ou desconectar, para não vazar `AudioContext`s.
  </action>
  <verify>`npm run typecheck` passa. Teste manual isolado (fora do app, ex. um console rápido) confirma que `createVadMonitor` não lança com uma track de um `getUserMedia` real.</verify>
  <done>Os dois módulos existem, são puros o suficiente para não precisar de mocks de React, e `vad.ts` nunca corta a fala no meio de uma pausa curta.</done>
</task>

<task type="auto">
  <name>Task 2: Ligar VAD ao VoiceProvider quando o modo é 'vad'</name>
  <files>src/renderer/src/state/voice-context.tsx</files>
  <action>
    No `VoiceProvider`, ao publicar o microfone com sucesso (mesmo ponto do
    Plano 07-03 que chama `setMicrophoneEnabled(true, {...})`), ler
    `loadVoicePreferences()`. Se `mode === 'vad'`: chamar
    `setMicrophoneEnabled(false, {...})` (a track existe mas começa
    desabilitada — VAD é quem liga/desliga a partir daqui) e iniciar
    `createVadMonitor` sobre a `MediaStreamTrack` local, com
    `onSpeakingChange` chamando `room.localParticipant.setMicrophoneEnabled(speaking)`
    diretamente (sem passar pela mutation `setMuted` do Convex — VAD é
    transmissão automática, não é o usuário mutando/desmutando
    explicitamente; `voiceStates.muted` continua refletindo só o estado
    manual do botão de mute). Se `mode === 'ptt'`: não iniciar o VAD — o
    Plano 07-06 assume o controle da track nesse modo.

    Parar o monitor de VAD (`stop()`) ao desconectar do canal, e reiniciar
    do zero em cada nova conexão (nunca reaproveitar um monitor de uma
    sessão anterior sobre uma track nova).

    Expor em `useVoice()` uma forma de o Plano 07-06 (e o próprio Task 3
    deste plano) trocarem de modo em runtime sem precisar reconectar: um
    método `applyVoicePreferences()` que relê `loadVoicePreferences()` e
    reconfigura (para/inicia o VAD, ajusta o limiar do monitor ativo). Isso
    é o que o painel de configurações chama depois de o usuário mudar o
    modo ou arrastar o slider de limiar.
  </action>
  <verify>Com um cliente real conectado (Plano 07-08 confirma formalmente), falar perto do microfone com o modo VAD ativo liga a track sem clicar em nada; parar de falar por mais de ~300ms desliga.</verify>
  <done>VoiceProvider ativa/desativa o VAD conforme a preferência salva, e expõe `applyVoicePreferences()` para mudança em runtime.</done>
</task>

<task type="auto">
  <name>Task 3: Painel de configurações de voz</name>
  <files>src/renderer/src/components/shell/VoiceSettingsPopover.tsx, src/renderer/src/components/shell/VoiceControlBar.tsx</files>
  <action>
    Criar `VoiceSettingsPopover.tsx` (usar `Popover`/`Dialog` do shadcn, o
    que já estiver instalado e mais adequado ao espaço do rodapé de
    controles) com:
    - Toggle "Detecção de voz" / "Push-to-talk" (dois `radio`/segmented
      control) — ao mudar, `saveVoicePreferences({ mode })` seguido de
      `useVoice().applyVoicePreferences()`.
    - Slider de limiar do VAD (0–1, só habilitado quando `mode === 'vad'`),
      com algum feedback visual do nível de áudio atual (barra de volume
      simples usando o mesmo `AnalyserNode`, ou reaproveitando o
      `createVadMonitor` já ativo só para leitura, sem duplicar
      `AudioContext`) para o usuário calibrar o limiar vendo sua própria
      voz. `onChange` chama `saveVoicePreferences({ vadThreshold })` +
      `applyVoicePreferences()`.
    - Dois `Select` (mic e saída): popular com
      `await navigator.mediaDevices.enumerateDevices()` filtrando
      `kind === 'audioinput'`/`'audiooutput'` (ou o helper equivalente do
      `Room`, se o SDK expuser um — confirmar em `07-RESEARCH.md` antes de
      escolher). Ao selecionar, chamar
      `room.switchActiveDevice('audioinput' | 'audiooutput', deviceId)` —
      **nunca desconectar/reconectar a sala para isso** (VOICE-13 é
      explícito sobre não reconectar). Para o dispositivo de saída, garantir
      que todo elemento `<audio>` de participante remoto é criado via
      `track.attach()` do próprio SDK (não `new Audio()` manual) — é a
      única forma de `switchActiveDevice('audiooutput', ...)` alcançar
      esses elementos (lacuna de doc sinalizada em `07-RESEARCH.md` §3,
      testar manualmente com um segundo participante).

    Adicionar um botão de engrenagem no `VoiceControlBar.tsx` (rodapé de
    controles) que abre este popover — só visível/habilitado quando
    conectado a um canal (mesma regra dos outros controles do rodapé).
  </action>
  <verify>Verificação humana no Plano 07-08 confirma troca de dispositivo sem queda de chamada e persistência do modo/limiar após reiniciar o app; localmente, `localStorage.getItem('janja:voice-preferences')` reflete a última escolha depois de fechar e reabrir o app em dev.</verify>
  <done>Painel de configurações existe, acessível pelo rodapé, e todas as escolhas persistem e aplicam em runtime sem reconectar.</done>
</task>

</tasks>

<verification>
- `saveVoicePreferences`/`loadVoicePreferences` sobrevivem a um reload completo do renderer (F5 em dev) — prova mínima de persistência antes do teste formal de reiniciar o app inteiro no Plano 07-08.
- Nenhuma troca de dispositivo chama `room.disconnect()`/`room.connect()`.
- O slider de limiar só é interativo quando o modo é VAD.
</verification>

<success_criteria>
VOICE-09 (metade VAD), VOICE-10, VOICE-12 e VOICE-13 implementados e
persistentes.
</success_criteria>

<output>
After completion, create `.planning/phases/07-voz/07-05-SUMMARY.md`
</output>
