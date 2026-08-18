---
phase: 08-compartilhamento-de-tela
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/screenshare.ts
  - src/main/index.ts
  - src/renderer/src/state/voice-context.tsx
  - src/renderer/src/components/shell/VoiceControlBar.tsx
autonomous: true

must_haves:
  truths:
    - "Clicar em 'Compartilhar tela' publica vídeo da tela inteira e áudio do sistema como duas tracks no LiveKit, com restrictOwnAudio ativo"
    - "O handler de captura nunca deixa a Promise do renderer pendurada: todo caminho (nenhuma fonte disponível, exceção) chama callback()"
    - "Parar o compartilhamento remove as duas tracks (vídeo e áudio) publicadas, e o botão volta ao estado inicial"
  artifacts:
    - path: "src/main/screenshare.ts"
      provides: "registerScreenShareHandler(), chamado de src/main/index.ts dentro de app.whenReady(), envolvendo desktopCapturer.getSources + callback em try/catch com callback({}) em 100% dos caminhos de saída sem seleção"
      exports: ["registerScreenShareHandler"]
      contains: "callback({})"
    - path: "src/renderer/src/state/voice-context.tsx"
      provides: "startScreenShare()/stopScreenShare() em useVoice(), chamando room.localParticipant.setScreenShareEnabled com audio.restrictOwnAudio: true"
      min_lines: 20
  key_links:
    - from: "src/main/screenshare.ts"
      to: "electron desktopCapturer.getSources"
      via: "types: ['screen'] nesta versão mínima — picker de verdade com thumbnails/janelas é o Plano 08-04"
      pattern: "desktopCapturer.getSources"
    - from: "src/renderer/src/state/voice-context.tsx"
      to: "livekit-client room.localParticipant.setScreenShareEnabled"
      via: "audio: { restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false }"
      pattern: "restrictOwnAudio"
---

<objective>
Provar que o caminho mais arriscado da fase inteira funciona antes de
investir em qualquer UI: capturar a tela inteira com áudio de sistema via
`setDisplayMediaRequestHandler`, publicar as duas tracks no LiveKit dentro da
sala de voz já conectada, com `restrictOwnAudio` ativo para não ecoar a
própria voz da call — e nunca travar uma tentativa futura de compartilhar,
mesmo sem nenhuma UI de seleção de tela ainda.

Purpose: `08-RESEARCH.md` e `PITFALLS.md` (Pitfall 1 e 2) já mapearam a API;
o que só existe rodando de verdade em Windows é a resposta a "o áudio ecoa?"
e "o handler realmente nunca trava?". Este plano é deliberadamente o mínimo
de código necessário para essas duas perguntas terem uma resposta real no
Plano 08-03 (checkpoint), antes do Plano 08-04 construir o seletor
customizado por cima.
Output: botão funcional "Compartilhar tela" no rodapé de voz, publicando
tela inteira + áudio de sistema; nenhum seletor de fonte ainda (sempre pega
a primeira tela disponível) — isso é intencional, não uma lacuna.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-compartilhamento-de-tela/08-RESEARCH.md
@.planning/research/PITFALLS.md
@.planning/phases/07-voz/07-03-cliente-livekit-nucleo-PLAN.md
@src/main/index.ts
@src/renderer/src/state/voice-context.tsx
@src/renderer/src/components/shell/VoiceControlBar.tsx

# Pré-requisito de execução: assume que a Fase 7 já rodou — `voice-context.tsx`
# já expõe `useVoice()` com um `room` real conectado (Plano 07-03) e
# `VoiceControlBar.tsx` já lê estado real de conexão/mute/deafen (Plano
# 07-03/07-04/07-05/07-06/07-07). Se `voice-context.tsx` ainda não existir
# nesse formato, parar e reportar o bloqueio.
#
# Decisão deliberada deste plano: `desktopCapturer.getSources({ types:
# ['screen'] })` e pega a PRIMEIRA tela — sem UI de escolha, sem suporte a
# janela ainda. Construir o seletor customizado agora, antes de confirmar
# que o áudio não ecoa, seria investir na parte errada primeiro (ver
# <plan_shape> do orquestrador desta fase). O Plano 08-04 substitui essa
# lógica pelo picker de verdade — sem descartar nada, só estende o mesmo
# arquivo.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Handler de captura no processo main — defensivo em 100% dos caminhos</name>
  <files>src/main/screenshare.ts, src/main/index.ts</files>
  <action>
    Criar `src/main/screenshare.ts` exportando `registerScreenShareHandler(): void`,
    chamada de `src/main/index.ts` dentro de `app.whenReady().then(() => { ... })`
    (mesmo ponto onde `setupAuthIpcHandlers`/`createWindow` já rodam — ver
    `PITFALLS.md`: nunca chamar APIs de sessão/captura antes de `app.whenReady()`).

    Dentro de `registerScreenShareHandler`:
    ```ts
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] })
        if (sources.length === 0) {
          callback({}) // nunca callback({ video: undefined }) — ver PITFALLS.md Pitfall 2
          return
        }
        callback({ video: sources[0], audio: 'loopback' })
      } catch (err) {
        console.error('[screenshare] Falha ao capturar fontes de tela:', err)
        callback({}) // toda exceção termina em callback(), nunca escapa sem chamar
      }
    })
    ```
    **Não usar `{ useSystemPicker: true }`** como segundo argumento — é
    experimental e só existe no macOS 15+ (`08-RESEARCH.md` §1); o app roda
    só em Windows, onde o handler é sempre chamado.

    Este é o único lugar do app que registra
    `setDisplayMediaRequestHandler` — registrar duas vezes (em chamadas
    futuras) substitui silenciosamente o handler anterior; garantir que
    `registerScreenShareHandler()` só é chamada uma vez, no boot do app.
  </action>
  <verify>`npm run typecheck` passa. Revisão manual: todo `return`/fim de bloco dentro do handler passa por uma chamada a `callback(...)` antes — grep confirma que não existe nenhum `await`/`throw` depois do qual o fluxo poderia terminar sem `callback`.</verify>
  <done>`registerScreenShareHandler` existe, é chamada uma vez em `app.whenReady()`, e cobre lista vazia + exceção + sucesso, sempre terminando em `callback(...)`.</done>
</task>

<task type="auto">
  <name>Task 2: startScreenShare/stopScreenShare em useVoice() + botão no rodapé</name>
  <files>src/renderer/src/state/voice-context.tsx, src/renderer/src/components/shell/VoiceControlBar.tsx</files>
  <action>
    Em `voice-context.tsx`, estender `VoiceProvider`/`useVoice()` (já existe
    desde 07-03) com:
    - `isSharing: boolean` — estado derivado de um listener em
      `room.on(RoomEvent.LocalTrackPublished / LocalTrackUnpublished, ...)`
      filtrando `publication.source === Track.Source.ScreenShare` (importar
      `Track`, `RoomEvent` de `livekit-client`, já instalado desde 07-03 —
      nenhuma dependência nova).
    - `startScreenShare(): Promise<void>` — chama
      ```ts
      await room.localParticipant.setScreenShareEnabled(true, {
        audio: {
          restrictOwnAudio: true,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: true,
        contentHint: 'motion'
      })
      ```
      (ver `08-RESEARCH.md` §3 — este é o único ponto que precisa de
      `restrictOwnAudio`; sem ele, Pitfall 1 se manifesta). Nenhum
      `publishOptions` (terceiro argumento) ainda — qualidade configurável é
      o Plano 08-05. Envolver em `try/catch`: se o usuário cancelar (rejeição
      da Promise de `getDisplayMedia`, ou `callback({})` do Plano
      main) ou a captura falhar, não deixar exceção não tratada subir — log
      e mantém `isSharing: false`.
    - `stopScreenShare(): Promise<void>` — chama
      `room.localParticipant.setScreenShareEnabled(false)`. O SDK já
      despublica as duas tracks (vídeo + áudio) sozinho
      (`08-RESEARCH.md` §4) — não gerenciar isso manualmente.
    - Se `room` desconectar (mesmo listener de `ConnectionStateChanged` que
      07-03 já tem para `disconnected`), resetar `isSharing` para `false` —
      não deixar o botão preso em "compartilhando" depois de sair do canal.

    Em `VoiceControlBar.tsx`: adicionar um botão (ícone `MonitorUp` de
    `lucide-react`, mesmo ícone já usado no placeholder de `ConversationArea.tsx`
    desde a Fase 3) ao lado dos controles existentes, só visível/habilitado
    quando `isConnected`. Clique chama `startScreenShare()` se
    `!isSharing`, `stopScreenShare()` se `isSharing` — sem confirmação, sem
    seletor ainda (é o Plano 08-04). Estado visual simples: ícone/cor
    diferente quando `isSharing === true` (ex. mesmo padrão de
    `aria-pressed`/cor de destaque já usado em `toggleMuted`/`toggleDeafened`
    neste arquivo).
  </action>
  <verify>`npm run typecheck` passa. Grep confirma `restrictOwnAudio: true` presente em exatamente uma chamada a `setScreenShareEnabled` no arquivo.</verify>
  <done>Botão "Compartilhar tela" existe no rodapé, chama `startScreenShare`/`stopScreenShare` reais, e `isSharing` reflete o estado real de publicação da track de tela.</done>
</task>

</tasks>

<verification>
- `registerScreenShareHandler` chama `callback(...)` em 100% dos caminhos —
  revisão manual linha a linha, não só grep.
- `restrictOwnAudio: true` está presente na única chamada a
  `setScreenShareEnabled(true, ...)` do app.
- Nenhuma dependência nova em `package.json` (tudo já veio de
  `livekit-client`, instalado em 07-03).
</verification>

<success_criteria>
O caminho crítico de SHARE-01 (versão mínima, sem seletor), SHARE-02 e
SHARE-03/04 (áudio de sistema sem eco) está implementado e pronto para
verificação humana — a prova real (o áudio ecoa ou não) só existe no Plano
08-03, em máquina Windows nativa.
</success_criteria>

<output>
After completion, create `.planning/phases/08-compartilhamento-de-tela/08-02-SUMMARY.md`
</output>
