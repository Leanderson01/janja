---
phase: 08-compartilhamento-de-tela
plan: 05
type: execute
wave: 4
depends_on: ["08-01", "08-04"]
files_modified:
  - src/renderer/src/lib/screenshare-preferences.ts
  - src/renderer/src/state/voice-context.tsx
  - src/renderer/src/components/shell/VoiceControlBar.tsx
autonomous: true

must_haves:
  truths:
    - "Usuário escolhe entre 'Fluida' e 'Nítida' antes de compartilhar, e a escolha persiste entre reinícios do app"
    - "voiceStates.sharing do usuário vira true assim que a track de vídeo é publicada com sucesso, e false ao parar (botão) ou ao desconectar"
    - "Trocar de qualidade não afeta um compartilhamento já em andamento sem reiniciá-lo — a escolha vale para a próxima vez que compartilhar"
  artifacts:
    - path: "src/renderer/src/lib/screenshare-preferences.ts"
      provides: "Leitura/escrita de preferência de qualidade local (localStorage), mesmo padrão defensivo de voice-preferences.ts (07-05)"
      exports: ["loadScreenSharePreferences", "saveScreenSharePreferences"]
    - path: "src/renderer/src/state/voice-context.tsx"
      provides: "startScreenShare aplica o preset de ScreenSharePresets/contentHint conforme a preferência salva, e chama setSharing(true/false) do Convex nos momentos certos"
      contains: "ScreenSharePresets"
  key_links:
    - from: "src/renderer/src/state/voice-context.tsx"
      to: "convex/voice.ts setSharing"
      via: "useMutation(api.voice.setSharing) chamado a partir dos listeners de LocalTrackPublished/LocalTrackUnpublished já existentes (08-02), não de um novo local"
      pattern: "setSharing"
    - from: "src/renderer/src/state/voice-context.tsx"
      to: "livekit-client ScreenSharePresets"
      via: "publishOptions.screenShareEncoding = preset.encoding, contentHint conforme a tabela de 08-RESEARCH.md §5"
      pattern: "screenShareEncoding"
---

<objective>
Dar ao usuário controle sobre fluidez vs nitidez do próprio compartilhamento
(SHARE-08), e fechar o elo entre "a track está publicada de verdade no
LiveKit" e "o Convex sabe que este usuário está compartilhando" — a mesma
distinção entre dado efêmero (LiveKit) e dado durável (`voiceStates`) que a
Fase 7 já estabeleceu para fala/qualidade de conexão, aplicada agora ao
campo `sharing`.

Purpose: sem este plano, `voiceStates.sharing` (criado em 08-01) nunca é
escrito por ninguém — a extensão do webhook fica órfã, sem nada gerando o
estado que ela reconciliaria. Fecha SHARE-05 (parar) do lado do cliente e
SHARE-08 por completo.
Output: toggle de qualidade persistente; `voiceStates.sharing` reflete a
realidade sempre que o usuário compartilha/para pelo próprio botão.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-compartilhamento-de-tela/08-RESEARCH.md
@.planning/phases/07-voz/07-05-vad-dispositivos-e-preferencias-PLAN.md
@convex/voice.ts
@src/renderer/src/lib/voice-preferences.ts
@src/renderer/src/state/voice-context.tsx
@src/renderer/src/components/shell/VoiceControlBar.tsx

# Preferência de qualidade é estado de MÁQUINA (localStorage), mesmo
# raciocínio de voice-preferences.ts (07-05): o mesmo usuário pode ter
# upload doméstico diferente em cada computador. Não guardar no Convex.
#
# Este plano NÃO cria uma query de leitura para outras telas (sidebar,
# member list) verem quem está compartilhando — isso é o Plano 08-06, que
# só lê o campo `sharing` que este plano começa a escrever.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Preferência de qualidade + aplicação no publish</name>
  <files>src/renderer/src/lib/screenshare-preferences.ts, src/renderer/src/state/voice-context.tsx</files>
  <action>
    `screenshare-preferences.ts`: mesmo padrão defensivo de
    `voice-preferences.ts` (07-05) — `type ScreenShareQuality = 'fluida' | 'nitida'`,
    `DEFAULT_SCREEN_SHARE_PREFERENCES = { quality: 'fluida' }`,
    `loadScreenSharePreferences()` lê de
    `localStorage.getItem('janja:screenshare-preferences')` com `JSON.parse`
    em `try/catch` (nunca lança, cai no default), `saveScreenSharePreferences(partial)`
    faz merge e persiste.

    Em `voice-context.tsx`, importar `ScreenSharePresets` de
    `livekit-client` e mapear conforme `08-RESEARCH.md` §5:
    ```ts
    const QUALITY_PRESETS = {
      fluida: { preset: ScreenSharePresets.h720fps30, contentHint: 'motion' as const },
      nitida: { preset: ScreenSharePresets.h1080fps15, contentHint: 'detail' as const }
    }
    ```
    Em `startScreenShare()` (criado em 08-02), ler
    `loadScreenSharePreferences().quality`, escolher a entrada
    correspondente de `QUALITY_PRESETS`, e passar:
    ```ts
    await room.localParticipant.setScreenShareEnabled(true, {
      audio: { restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: true,
      contentHint: QUALITY_PRESETS[quality].contentHint
    }, {
      screenShareEncoding: QUALITY_PRESETS[quality].preset.encoding
    })
    ```
    (o terceiro argumento, `publishOptions`, não existia na chamada de
    08-02 — este plano o adiciona). Não é necessário setar `videoCodec`
    (default `vp8` é adequado, `08-RESEARCH.md` §5).
  </action>
  <verify>`npm run typecheck` passa. Grep confirma `screenShareEncoding` presente na chamada de `setScreenShareEnabled`.</verify>
  <done>A preferência de qualidade é lida a cada início de compartilhamento e aplicada como `screenShareEncoding`/`contentHint` corretos.</done>
</task>

<task type="auto">
  <name>Task 2: Sincronizar voiceStates.sharing + toggle de qualidade na UI</name>
  <files>src/renderer/src/state/voice-context.tsx, src/renderer/src/components/shell/VoiceControlBar.tsx</files>
  <action>
    Em `voice-context.tsx`, no mesmo listener de
    `RoomEvent.LocalTrackPublished`/`LocalTrackUnpublished` filtrado por
    `Track.Source.ScreenShare` que já atualiza `isSharing` (08-02): chamar
    também a mutation `setSharing` do Convex
    (`useMutation(api.voice.setSharing)`, de 08-01) —
    `setSharing({ sharing: true })` quando a track de tela é publicada,
    `setSharing({ sharing: false })` quando é despublicada (inclui o caso
    de parar pelo botão E qualquer despublicação que o próprio SDK dispare
    por conta própria, ex. se o Windows revogar a captura). Não chamar a
    mutation diretamente de `startScreenShare`/`stopScreenShare` — o
    listener de evento é a fonte única da verdade de "a track está
    publicada agora", evita os dois ficarem dessincronizados se
    `setScreenShareEnabled` falhar silenciosamente em algum caso não
    previsto.

    Ao desconectar do canal (mesmo tratamento de `ConnectionStateChanged`
    para `'disconnected'` já existente): **não** chamar `setSharing` aqui —
    a linha inteira de `voiceStates` já deixa de existir por
    `leaveVoiceChannel`/pelo webhook de 07-02, chamar `setSharing` nesse
    momento encontraria uma linha já apagada e lançaria erro
    desnecessariamente (ver a semântica de `setSharing` em 08-01: lança se
    não houver linha).

    Em `VoiceControlBar.tsx`: adicionar um controle pequeno (dois botões
    tipo toggle, ou um `Select` compacto — usar o que já existir de padrão
    similar no design system do projeto) "Fluida" / "Nítida" perto do botão
    de compartilhar, habilitado sempre (a escolha vale para a PRÓXIMA vez
    que compartilhar, mesmo com um compartilhamento em andamento — não
    reinicia a track atual). `onChange` chama `saveScreenSharePreferences({ quality })`
    diretamente — não precisa de nenhum método novo em `useVoice()`, a
    leitura já acontece dentro de `startScreenShare()` na próxima chamada.
  </action>
  <verify>`npm run typecheck` passa. Grep confirma que `setSharing` só é chamado dentro do listener de `LocalTrackPublished`/`LocalTrackUnpublished`, nunca diretamente de `startScreenShare`/`stopScreenShare`.</verify>
  <done>Toggle de qualidade visível e persistente; `voiceStates.sharing` reflete o estado real de publicação da track, escrito só pelo listener de evento do LiveKit.</done>
</task>

</tasks>

<verification>
- `localStorage.getItem('janja:screenshare-preferences')` reflete a última
  escolha depois de fechar e reabrir o app em dev (mesma prova mínima que
  07-05 já fez para `voice-preferences`).
- `setSharing` nunca é chamado a partir de um caminho que não seja o
  listener de evento de track local.
- Trocar a qualidade enquanto um compartilhamento está ativo não chama
  `setScreenShareEnabled` de novo (nenhuma interrupção do compartilhamento
  atual).
</verification>

<success_criteria>
SHARE-08 está completo e persistente. `voiceStates.sharing` passa a refletir
a realidade sempre que o próprio usuário inicia ou para o compartilhamento —
a base que o Plano 08-06 (indicador visível a outros) e a reconciliação de
08-01 (queda do apresentador) dependem para fazer sentido.
</success_criteria>

<output>
After completion, create `.planning/phases/08-compartilhamento-de-tela/08-05-SUMMARY.md`
</output>
