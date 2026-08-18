# Fase 8 — Pesquisa: compartilhamento de tela com áudio

**Pesquisado em:** 2026-08-18
**Fontes:** electronjs.org (doc oficial), código-fonte de `livekit-client` no GitHub
(`livekit/client-sdk-js`, branch `main`), docs.livekit.io, cruzado com
`.planning/research/PITFALLS.md` e `.planning/research/FEATURES.md` (já
pesquisados nesta base para este projeto).

> Este arquivo cobre só o que muda em relação ao que `PITFALLS.md`/`FEATURES.md`
> já documentaram — não duplica, aprofunda os pontos que os planos desta fase
> precisam para não adivinhar assinatura de API.

## 1. `session.setDisplayMediaRequestHandler` — forma exata

Confirmado em electronjs.org/docs/latest/api/session:

```ts
ses.setDisplayMediaRequestHandler(handler, opts?)
```

**`handler(request, callback)`** — `request` tem:
- `frame: WebFrameMain | null`
- `securityOrigin: string`
- `videoRequested: boolean`
- `audioRequested: boolean`
- `userGesture: boolean`

**`callback(streams)`** — `streams` aceita:
- `video?: { id: string; name: string } | WebFrameMain` — normalmente um item
  de `desktopCapturer.getSources()` (que já tem `id`/`name`), passado direto.
- `audio?: 'loopback' | 'loopbackWithMute' | WebFrameMain`
- `enableLocalEcho?: boolean` — só relevante quando `audio` é um
  `WebFrameMain`; não se aplica ao caso deste projeto (`'loopback'`).

**`opts?: { useSystemPicker?: boolean }`** — experimental, só macOS 15+; no
Windows o handler sempre é chamado, não há como pular a UI própria. Não usar
essa opção (ou deixar `false`) — o app roda só em Windows.

**Cancelamento explícito**: `callback({})` — objeto vazio, nunca
`callback({ video: undefined })`. Confirmado no próprio exemplo de
`PITFALLS.md` Pitfall 2 e consistente com a doc oficial (que não documenta
nenhum outro formato de "sem seleção").

## 2. `desktopCapturer.getSources()` — forma exata

```ts
desktopCapturer.getSources(options): Promise<DesktopCapturerSource[]>
```

`options`:
- `types: ('screen' | 'window')[]` — obrigatório.
- `thumbnailSize?: { width: number; height: number }` — default 150×150;
  `{ width: 0, height: 0 }` desliga a geração de thumbnail (mais rápido se
  não for exibir).
- `fetchWindowIcons?: boolean` — default `false`.

`DesktopCapturerSource`:
- `id: string` (formato `"screen:0:0"` ou `"window:1234:0"` — é o valor que
  vira `video.id` no callback)
- `name: string`
- `thumbnail: NativeImage` — chamar `.toDataURL()` no processo main antes de
  mandar por IPC (não é serializável direto; `NativeImage` não atravessa
  `ipcRenderer`/`ipcMain` como objeto).
- `display_id: string`
- `appIcon: NativeImage | null` (só se `fetchWindowIcons: true` e for janela)

Electron **não** expõe um picker nativo — a doc confirma explicitamente que a
UI de escolha é responsabilidade do app.

## 3. Onde `restrictOwnAudio` realmente entra

Ponto que `PITFALLS.md` já cobre com confiança HIGH (issue #37293, corrigida
no Electron 43.4.0) — o que esta pesquisa acrescenta é **onde no código o
campo aparece**, porque `PITFALLS.md` cita o requisito mas não a forma exata
de passá-lo pelo `livekit-client`.

Confirmado no código-fonte de `livekit-client`
(`src/room/track/options.ts`, branch `main`):

```ts
export interface AudioCaptureOptions {
  autoGainControl?: ConstrainBoolean
  channelCount?: ConstrainULong
  deviceId?: ConstrainDOMString
  echoCancellation?: ConstrainBoolean
  latency?: ConstrainDouble
  noiseSuppression?: ConstrainBoolean
  voiceIsolation?: ConstrainBoolean
  restrictOwnAudio?: ConstrainBoolean   // <- aqui
  sampleRate?: ConstrainULong
  sampleSize?: ConstrainULong
  processor?: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
}

export interface ScreenShareCaptureOptions {
  audio?: boolean | AudioCaptureOptions
  video?: true | { displaySurface?: 'window' | 'browser' | 'monitor' }
  resolution?: VideoResolution
  selfBrowserSurface?: 'include' | 'exclude'
  surfaceSwitching?: 'include' | 'exclude'
  systemAudio?: 'include' | 'exclude'
  contentHint?: 'detail' | 'text' | 'motion'
  suppressLocalAudioPlayback?: boolean
  preferCurrentTab?: boolean
}
```

**Conclusão prática**: `room.localParticipant.setScreenShareEnabled()` (o
método de conveniência do SDK) já aceita `restrictOwnAudio` nativamente —
**não é preciso contornar o SDK chamando `getDisplayMedia` manualmente**. A
chamada correta é:

```ts
await room.localParticipant.setScreenShareEnabled(true, {
  audio: {
    restrictOwnAudio: true,   // filtra a própria voz da call do loopback (Pitfall 1)
    echoCancellation: false,  // é áudio de sistema, não microfone — não processar como voz
    noiseSuppression: false,
    autoGainControl: false
  },
  video: true,
  contentHint: 'motion' // ou 'detail', conforme o toggle de qualidade (SHARE-08)
}, publishOptions)
```

`echoCancellation`/`noiseSuppression`/`autoGainControl: false` no áudio de
sistema é deliberado — essas opções foram desenhadas para voz de microfone
(WebRTC as aplica sobre entrada de mic, VOICE-16); aplicá-las ao loopback de
sistema (música, notificação, jogo) degrada a fidelidade sem necessidade.

**Import**: `Track`, `ScreenSharePresets`, `RoomEvent` vêm todos do pacote
`livekit-client` (já instalado no Plano 07-03, `npm install livekit-client` —
nenhuma dependência nova para F8).

## 4. `setScreenShareEnabled` — assinatura completa e o que ela publica

Confirmado no código-fonte (`src/room/participant/LocalParticipant.ts`):

```ts
setScreenShareEnabled(
  enabled: boolean,
  options?: ScreenShareCaptureOptions,
  publishOptions?: TrackPublishOptions
): Promise<LocalTrackPublication | undefined>
```

Internamente, quando `audio` está presente nas opções, o SDK captura vídeo
**e** áudio na mesma chamada de `getDisplayMedia` (que é o que
`setDisplayMediaRequestHandler` intercepta) e publica **duas tracks
separadas** — uma de vídeo (`Track.Source.ScreenShare`) e uma de áudio
(`Track.Source.ScreenShareAudio`) — cada uma com seu próprio
`publishTrack()` internamente. Ao desabilitar (`enabled: false`), o SDK
despublica as duas automaticamente; não é preciso gerenciar isso à mão.

Detalhe útil de `TrackPublishOptions` (`stream?: string`): por padrão, tracks
de `screen_share` e `screen_share_audio` já são agrupadas na mesma
`MediaStream` para sincronização — não é necessário setar `stream` deste
lado, o SDK já faz isso.

## 5. `TrackPublishOptions`/`TrackPublishDefaults` — campos de qualidade

Confirmado no código-fonte (mesma origem do item 3):

```ts
interface TrackPublishDefaults {
  videoEncoding?: VideoEncoding        // aplica à câmera
  screenShareEncoding?: VideoEncoding  // aplica ao compartilhamento — campo separado
  videoCodec?: VideoCodec              // default 'vp8'
  simulcast?: boolean                  // default true
  videoSimulcastLayers?: VideoPreset[]
  screenShareSimulcastLayers?: VideoPreset[]
  backupCodec?: boolean | { codec: BackupVideoCodec; encoding?: VideoEncoding }
  red?: boolean
  dtx?: boolean
  degradationPreference?: RTCDegradationPreference
}
interface TrackPublishOptions extends TrackPublishDefaults {
  name?: string
  source?: Track.Source
  stream?: string
}
```

`ScreenSharePresets` (mesmo arquivo), usado para preencher
`screenShareEncoding`:

```ts
export const ScreenSharePresets = {
  h360fps3:   new VideoPreset(640, 360, 200_000, 3, 'medium'),
  h360fps15:  new VideoPreset(640, 360, 400_000, 15, 'medium'),
  h720fps5:   new VideoPreset(1280, 720, 800_000, 5, 'medium'),
  h720fps15:  new VideoPreset(1280, 720, 1_500_000, 15, 'medium'),
  h720fps30:  new VideoPreset(1280, 720, 2_000_000, 30, 'medium'),
  h1080fps15: new VideoPreset(1920, 1080, 2_500_000, 15, 'medium'),
  h1080fps30: new VideoPreset(1920, 1080, 5_000_000, 30, 'medium'),
  original:   new VideoPreset(0, 0, 7_000_000, 30, 'medium'),
} as const
```

**Mapeamento recomendado para o toggle de qualidade (SHARE-08)** — 2 níveis,
não sliders crus (já decidido em `FEATURES.md`):

| Opção exibida | Preset | `contentHint` |
|---|---|---|
| "Fluida" (prioriza fps, upload caseiro instável) | `ScreenSharePresets.h720fps30` | `'motion'` |
| "Nítida" (prioriza resolução/texto legível) | `ScreenSharePresets.h1080fps15` | `'detail'` |

Cada `VideoPreset` expõe `.encoding` (o formato que
`screenShareEncoding` espera). Setar `publishOptions.videoCodec` explicitamente
não é necessário — o default `vp8` é adequado e amplamente suportado; não há
motivo para desviar do default nesta fase.

## 6. Eventos relevantes para consumo remoto e reconciliação (SHARE-06)

Confirmado em `src/room/events.ts` (código-fonte, não só a doc renderizada):

```ts
enum RoomEvent {
  TrackPublished = 'trackPublished',
  TrackUnpublished = 'trackUnpublished',
  TrackSubscribed = 'trackSubscribed',
  TrackUnsubscribed = 'trackUnsubscribed',
  ParticipantDisconnected = 'participantDisconnected',
  LocalTrackUnpublished = 'localTrackUnpublished',
  ConnectionStateChanged = 'connectionStateChanged',
  Disconnected = 'disconnected',
}
```

Para renderizar/remover o vídeo remoto em tempo real (sem esperar o Convex):

```ts
room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  if (track.source === Track.Source.ScreenShare) {
    const el = track.attach() // cria/reaproveita <video>, devolve o elemento
    // anexar `el` ao container do participante correspondente
  }
})
room.on(RoomEvent.TrackUnsubscribed, (track) => {
  track.detach().forEach((el) => el.remove())
})
```

Isso cobre a parte "sem frame congelado" de SHARE-06 **de graça**, no
cliente, sem round-trip a lugar nenhum — o mesmo padrão já usado no Plano
07-04 para distinguir dado efêmero do LiveKit (fala, qualidade) de dado
durável do Convex (`voiceStates`). O reflexo em `voiceStates.sharing` (para
quem NÃO está conectado à sala e não recebe eventos do `Room`) é o que o
webhook cobre — ver item 7.

## 7. Webhook — extensão do padrão já criado em 07-02

`docs.livekit.io/home/server/webhooks/` confirma os eventos de track:
`track_published`/`track_unpublished`, com payload `{ id, createdAt, event,
room, participant, track }` — `room`/`participant` no payload de eventos de
track só trazem `sid`/`name`/`identity` (suficiente, é o mesmo padrão que
07-02 já usa: `event.room.name` é o `channelId`, `event.participant.identity`
é o `user._id`).

O campo `track.source` distingue a origem (câmera/mic/tela) — é um enum do
protocolo LiveKit (`TrackSource`, de `@livekit/protocol`, reexportado por
`livekit-server-sdk`). **Não craquei a string exata serializada no JSON do
webhook com uma fonte de alta confiança** (a doc pública não lista o valor
literal) — em vez de arriscar comparar contra uma string hardcoded errada
(`'SCREEN_SHARE'` vs `'screen_share'`), o Plano 08-01 deve importar o enum
`TrackSource` de `@livekit/protocol` (dependência transitiva de
`livekit-server-sdk`, já usada em 07-02) e comparar
`event.track?.source === TrackSource.SCREEN_SHARE` — deixa o SDK resolver a
string certa, e evita reintroduzir o mesmo tipo de bug de casing/parse que o
Pitfall 3 já documentou para o corpo bruto do webhook. Se o import não existir
nesse caminho exato, o teste automatizado do plano (que constrói o payload
assinado manualmente, como 07-02 já faz) revela isso imediatamente — falha
determinística em `npx vitest`, não em produção.

**Reaproveitamento explícito**: nenhuma rota nova, nenhum mecanismo novo de
verificação de assinatura — é um `case` a mais no mesmo `switch` que
`convex/http.ts` já tem desde 07-02, chamando uma nova `internalMutation`
(`reconcileScreenShareStopped`) com o mesmo formato de idempotência
(`reconcileParticipantLeft`: não lança se a linha já não existir/já estiver
`sharing: false`).

## 8. O que isso NÃO cobre (fora do escopo desta pesquisa, já coberto alhures)

- Eco / `restrictOwnAudio` funcionar de fato no Windows 43.4.0 — só
  verificável na máquina real (Plano 08-03, primeiro checkpoint da fase).
  `PITFALLS.md` Pitfall 1 já é a autoridade sobre o *porquê*; este arquivo só
  resolve o *como* chamar a API corretamente.
- `WDA_EXCLUDEFROMCAPTURE` (janela preta) — comportamento do SO, documentar
  na UI, não corrigir (`PITFALLS.md` Integration Gotchas).
- Permissão de captura de tela no Windows: diferente do macOS, o Windows não
  tem um diálogo de permissão do SO para captura de tela por padrão (a
  permissão "existe" apenas através da UI própria do app, que É o picker
  desta fase) — nenhuma chamada adicional a
  `systemPreferences.getMediaAccessStatus` é necessária (essa API é
  documentada como específica de macOS). Se o Plano 08-03 encontrar um
  bloqueio de permissão inesperado no Windows, é um achado novo a registrar
  no SUMMARY, não algo previsto por esta pesquisa.

## Fontes

- [Electron — session (setDisplayMediaRequestHandler)](https://www.electronjs.org/docs/latest/api/session) — HIGH (doc oficial)
- [Electron — desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) — HIGH (doc oficial)
- [livekit/client-sdk-js — src/room/track/options.ts](https://github.com/livekit/client-sdk-js/blob/main/src/room/track/options.ts) — HIGH (código-fonte)
- [livekit/client-sdk-js — src/room/participant/LocalParticipant.ts](https://github.com/livekit/client-sdk-js/blob/main/src/room/participant/LocalParticipant.ts) — HIGH (código-fonte)
- [livekit/client-sdk-js — src/room/events.ts](https://github.com/livekit/client-sdk-js/blob/main/src/room/events.ts) — HIGH (código-fonte)
- [LiveKit — Webhooks](https://docs.livekit.io/home/server/webhooks/) — HIGH (doc oficial, mas payload de `track.source` não detalhado — MEDIUM nesse ponto específico, mitigado importando o enum em vez de hardcodar string)
- `.planning/research/PITFALLS.md` (Pitfall 1, Pitfall 2) — já HIGH confidence nesta base, não re-verificado, só referenciado
- `.planning/research/FEATURES.md` (picker, toggle de qualidade, presenter-drops) — já pesquisado nesta base, referenciado para as decisões de UX (2 níveis de qualidade, não slider)

---
*Pesquisa para: Fase 8 — Compartilhamento de tela (janja)*
