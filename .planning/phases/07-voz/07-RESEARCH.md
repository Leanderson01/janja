# Fase 7 — Pesquisa (Voz)

**Data:** 2026-08-18
**Nível de discovery:** 2/3 (múltiplas integrações novas: `livekit-client`,
`livekit-server-sdk` dentro de Convex actions, Convex HTTP actions/webhooks,
`uiohook-napi`). Verificado contra docs.livekit.io, docs.convex.dev, GitHub
oficial e npm — não contra memória.
**Confiança:** MEDIA-ALTA. Toda afirmação abaixo tem fonte citada; itens sem
fonte direta (docs 404 em alguns casos) estão marcados como tal e
recomendados como spike de 15-30min no início do plano correspondente, não
como bloqueio de planejamento.

> Este arquivo cobre só o que muda a forma dos planos. Comportamento de
> produto (semântica de mute/deafen, VAD vs PTT, sons) já está detalhado em
> `.planning/research/FEATURES.md` e não é repetido aqui. Armadilhas
> (ghost user, corpo bruto do webhook, `restrictOwnAudio`) já estão em
> `.planning/research/PITFALLS.md` e só são referenciadas.

## 1. `livekit-server-sdk` roda no runtime padrão do Convex — sem `"use node"`

**Achado que resolve uma incerteza aberta em `PITFALLS.md`** ("Integration
Gotchas": *"Assumir que a assinatura de JWT funciona no runtime padrão do
Convex sem testar"*).

Inspecionado o código-fonte de `AccessToken` em
[`livekit/node-sdks`](https://github.com/livekit/node-sdks/blob/main/packages/livekit-server-sdk/src/AccessToken.ts):
usa a lib **`jose`**, que assina o JWT via `jose.SignJWT` sobre **Web Crypto
SubtleCrypto** (`alg: 'HS256'`), não `jsonwebtoken` nem o módulo `crypto`
nativo do Node.

O runtime padrão do Convex expõe Web Crypto completo (`crypto`, `CryptoKey`,
`SubtleCrypto`) — confirmado em
[docs.convex.dev/functions/runtimes](https://docs.convex.dev/functions/runtimes).
`vitest.config.ts` já roda os testes em `environment: 'edge-runtime'`
(`@edge-runtime/vm`, já é devDependency do projeto), que é o mesmo tipo de
ambiente. Conclusão: **`joinVoiceChannel` pode ser uma `action` comum, sem
`"use node"`.**

**Ainda assim, validar com um teste de 5 minutos como primeira tarefa do
Plano 07-01** (assinar um `AccessToken` e chamar `toJwt()` dentro de
`convexTest`, sem mocks) antes de construir a lógica de autorização em cima —
é barato provar isso errado cedo.

**Consequência de design:** actions no Convex (padrão ou node) **não têm
acesso direto a `ctx.db`** — só `ctx.runQuery`/`ctx.runMutation`. Assinar o
token é uma etapa pura (sem DB); validar membership e inserir a linha em
`voiceStates` são duas chamadas separadas dentro da action (já sinalizado em
`PITFALLS.md`: não é uma transação única — se a assinatura do token suceder
mas a mutation de insert falhar, o cliente recebe um token válido para uma
sala sem uma linha correspondente em `voiceStates`; tratar esse caso
explicitamente, ver Plano 07-01).

## 2. `WebhookReceiver` — confirmado corpo bruto, e o mapeamento exato de eventos

[docs.livekit.io/home/server/webhooks](https://docs.livekit.io/home/server/webhooks/):

- `receiver.receive(body, authHeader)` — `body` precisa ser a **string bruta**
  do POST, nunca `request.json()` antes (`PITFALLS.md` Pitfall 3, já
  confirmado na doc oficial: *"WebhookReceiver must have access to the raw
  POSTed string"*).
- Em Convex HTTP actions isso é `await request.text()` — a API de
  `httpAction` do Convex já entrega um `Request` padrão da Fetch API, então
  `request.text()` funciona sem adaptação (diferente do exemplo Express da
  doc, que precisa de `express.raw()`).
- Eventos confirmados e sua semântica exata:
  - `participant_left` — "participant leaves a room and all cleanup
    processes are complete" → apagar a linha de `voiceStates` desse
    `identity` nesse `room`.
  - `participant_connection_aborted` — conexão de mídia falha depois da
    sinalização estabelecer (o caso "crash/perda de rede" do Pitfall 3) →
    mesmo tratamento.
  - `room_finished` — sala fecha (todos saíram e o timeout de sala vazia
    expirou, ou `room.close()`) → apagar **todas** as linhas de
    `voiceStates` daquele `channelId`, camada de segurança extra caso algum
    evento individual se perca.
- O evento `Authorization` chega como header HTTP — em Convex, `request.headers.get('Authorization')`.

## 3. Client SDK JS — nomes exatos de evento e enum (verificado, com uma lacuna)

Confirmado via código-fonte
([`livekit/client-sdk-js`](https://github.com/livekit/client-sdk-js/blob/main/src/room/Room.ts)):

```ts
enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
  SignalReconnecting = 'signalReconnecting',
}

room.connect(url: string, token: string, opts?: RoomConnectOptions): Promise<void>
room.switchActiveDevice(kind: MediaDeviceKind, deviceId: string): Promise<boolean>
```

Eventos confirmados (nomes usados como `RoomEvent.X` / `ParticipantEvent.X`,
`docs.livekit.io/home/client/events`):

| Evento | Onde | Callback |
|---|---|---|
| `ActiveSpeakersChanged` | `Room` | `(speakers: Participant[])` |
| `IsSpeakingChanged` | `Participant` | `(isSpeaking: boolean)` |
| `ConnectionQualityChanged` | `Room` e `Participant` | `(quality: ConnectionQuality, participant?: Participant)` |
| `ConnectionStateChanged` | `Room` | `(state: ConnectionState)` |
| `Reconnecting` / `Reconnected` | `Room` | sem args |
| `ParticipantConnected` / `ParticipantDisconnected` | `Room` | `(participant: RemoteParticipant)` |
| `TrackMuted` / `TrackUnmuted` | `Room`/`Participant` | `(publication, participant)` |

`ConnectionQuality` (enum, confirmado): `Excellent`, `Good`, `Poor`, `Lost`,
`Unknown` — usar como 4 níveis (Unknown tratado como "sem dado ainda", não
como um 5º nível visível).

**Lacuna não resolvida por doc**: `switchActiveDevice('audiooutput', id)`
depende de o SDK gerenciar os elementos `<audio>` internamente (attach
automático); a doc oficial e o código não deixam 100% claro se isso cobre
elementos criados manualmente pelo app fora do fluxo padrão de
`track.attach()`. Tratado como risco MEDIUM no Plano 07-05: garantir que
**todo** elemento de áudio remoto do app seja criado via `track.attach()` do
próprio SDK (nunca manualmente com `new Audio()`), e reaplicar
`switchActiveDevice`/`setSinkId` quando um novo participante entra depois da
troca de dispositivo — comportamento a confirmar em teste manual, não em
doc.

## 4. Convex HTTP Actions — roteamento

`convex/http.ts` exporta um `httpRouter()` (padrão Convex, doc oficial). A
URL pública é `https://<deployment>.convex.site/<path>` — **não**
`.convex.cloud` (esse é o endpoint de client SDK). O placeholder já deixado
em `infra/livekit/livekit.yaml` (`https://<convex-deployment>.convex.site/livekit/webhook`)
está correto nesse formato; falta preencher o deployment real, que só existe
depois que `02-04` (provisionamento do Convex) rodou — já rodou, conforme
`STATE.md`.

## 5. `uiohook-napi` — estado atual e risco de empacotamento

- **Repositório real**: `github.com/SnosMe/uiohook-napi` (não
  `wilix-team`, que não existe — corrigir qualquer referência anterior).
- **Versão publicada**: `1.5.5` (npm registry, verificado). Dependência
  única: `node-gyp-build`. `engines.node: >=16`.
  API confirmada (README):
  ```js
  import { uIOhook, UiohookKey } from 'uiohook-napi'
  uIOhook.on('keydown', (e) => { /* e.keycode */ })
  uIOhook.on('keyup', (e) => { /* e.keycode */ })
  uIOhook.start()
  ```
- **Binários prebuilt por plataforma**: não confirmado por fonte direta
  nesta pesquisa (GitHub retornou 404 em duas tentativas de leitura
  profunda do README). `node-gyp-build` é o mecanismo padrão de resolver
  binário prebuilt por `platform+arch+ABI` do Node/Electron (usado por
  outras libs nativas populares no ecossistema Electron) — **spike
  obrigatório no início do Plano 07-06**: `npm install uiohook-napi` dentro
  do projeto (Electron 43.4.0, Windows x64 é o alvo real; WSL2/Linux só
  para smoke-test de import, não de captura global) e confirmar que o
  binário resolve sem erro de `MODULE_NOT_FOUND`/ABI mismatch. Se
  necessário, `electron-rebuild`/`@electron/rebuild` entra como
  devDependency.
- **Risco cross-fase já sinalizado no roadmap** (nota de dependência
  cruzada, F7→F9): validar em `electron-vite dev` não prova que o binário
  sobrevive ao empacotamento (`electron-builder`) — F9 precisa reverificar
  no instalador final. Nada a fazer sobre isso em F7 além de não esconder o
  risco.
- **WSL2 não tem captura global de teclado confiável.** `uiohook-napi` no
  Linux depende de X11 (XRecord/XTest); WSLg roda um compositor Wayland
  (Weston) com uma camada de compatibilidade X11 que **não garante** que
  hooks globais de teclado funcionem como em um X server completo. Tratar
  qualquer teste de PTT no ambiente de desenvolvimento (WSL2) como
  "compila e não crasha", nunca como prova de que "funciona sem foco" — essa
  prova só existe na verificação final em Windows nativo (Plano 07-08).

## 6. Convex HTTP endpoint precisa de identidade explícita no payload do webhook

O webhook do LiveKit não carrega identidade WorkOS/Convex — carrega o
`identity` que a **action de join** atribuiu ao participante no momento de
assinar o token (`AccessToken({ identity })`). Decisão de design necessária
e registrada aqui para os planos: **usar o `_id` do documento `users` do
Convex como `identity` do LiveKit**, não o `workosId` nem o `username#tag`.
Isso torna `reconcileParticipantLeft({ room, identity })` uma operação
direta de `ctx.db.query('voiceStates').withIndex(...)` sem precisar resolver
identidade de novo — o `identity` do payload do webhook já É a chave
primária que `voiceStates.userId` usa.

## 7. Persistência de preferência de voz (VOICE-12) — decisão de onde mora

Preferência de transmissão (VAD vs PTT) e limiar do VAD são estado de
**máquina**, não de conta (o mesmo usuário pode ter um microfone diferente
em cada computador) — consistente com a decisão já registrada no design
(§8) e em `FEATURES.md`. `localStorage` do renderer é suficiente e mais
simples que um arquivo gerenciado pelo processo main: nenhuma dessas
preferências precisa ser lida pelo processo main. A tecla de push-to-talk em
si **não é configurável em v1** — nenhum requisito (`VOICE-09`..`VOICE-12`)
pede remapeamento de tecla, só a escolha entre os dois modos. Fixar uma
tecla física padrão (`Right Control`, tecla raramente usada por atalhos de
outros apps no Windows) documentada no código, e revisitar remapeamento como
v1.x se o grupo pedir. Isso remove qualquer necessidade de o processo main
persistir preferência própria: ele sempre escuta a mesma tecla fixa e
encaminha `keydown`/`keyup` por IPC continuamente; o renderer decide se age
sobre o evento com base no modo atual (lido do seu próprio `localStorage`).

## 8. Dependências novas por plano

| Pacote | Onde | Plano |
|---|---|---|
| `livekit-server-sdk` | `convex/` (runtime padrão, sem `"use node"`) | 07-01 |
| `livekit-client` | `src/renderer/` | 07-03 |
| `uiohook-napi` | `src/main/` | 07-06 |

Nenhum pacote paralelo à pesquisa de `PITFALLS.md`/`FEATURES.md` foi
necessário além destes três — o resto é Web Audio API (nativa do Chromium,
zero dependência) e Convex (já instalado).

## Fontes

- [livekit/node-sdks — AccessToken.ts](https://github.com/livekit/node-sdks/blob/main/packages/livekit-server-sdk/src/AccessToken.ts) — HIGH (código-fonte)
- [docs.livekit.io — Webhooks](https://docs.livekit.io/home/server/webhooks/) — HIGH (doc oficial)
- [docs.convex.dev — Runtimes](https://docs.convex.dev/functions/runtimes) — HIGH (doc oficial)
- [livekit/client-sdk-js — Room.ts](https://github.com/livekit/client-sdk-js/blob/main/src/room/Room.ts) — HIGH (código-fonte)
- [docs.livekit.io — Client events](https://docs.livekit.io/home/client/events/) — MEDIUM-HIGH (doc oficial, WebFetch não confirmou 100% dos argumentos de callback)
- [npm — uiohook-napi registry](https://registry.npmjs.org/uiohook-napi/latest) — HIGH (metadado direto do registry)
- [github.com/SnosMe/uiohook-napi](https://github.com/SnosMe/uiohook-napi) — MEDIUM (README não confirmou tabela de plataformas suportadas nesta consulta — spike recomendado)
- `.planning/research/PITFALLS.md` (Pitfall 3, Integration Gotchas) — referenciado, não duplicado
- `.planning/research/FEATURES.md` — referenciado, não duplicado
- `infra/livekit/livekit.yaml`, `infra/livekit/DEPLOY-RUNBOOK.md` — fonte primária do estado real da infra

---
*Pesquisa da Fase 7: 2026-08-18*
