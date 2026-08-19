---
phase: 08-compartilhamento-de-tela
plan: 06
subsystem: media
tags: [livekit, screenshare, react, video, reconciliação, share-02, share-06]

# Dependency graph
requires:
  - phase: 07-04
    provides: "o padrão de separar dado efêmero do LiveKit (speakingUserIds, connectionQualities) de dado durável do Convex (voiceStates), e as duas queries voiceParticipantsByChannel/ByServer já consumidas por sidebar e lista de membros"
  - phase: 07-05
    provides: "o efeito de áudio remoto em voice-context.tsx (track.attach() num container invisível) — o modelo que este plano espelha para vídeo, e o caminho por onde a track de ScreenShareAudio já toca sem UI própria"
  - phase: 08-01
    provides: "reconcileScreenShareStopped + case track_unpublished no webhook — o lado do Convex de SHARE-06, para quem NÃO está conectado à sala"
  - phase: 08-05
    provides: "voiceStates.sharing efetivamente ESCRITO pelo cliente (a partir de LocalTrackPublished/Unpublished) — sem isso o indicador desta fase leria um campo sempre false"
provides:
  - "useVoice().screenShareTracks — lista das telas no ar no Room conectado (própria + remotas), reconciliada por 5 eventos do LiveKit"
  - "src/renderer/src/lib/screenshare-tracks.ts — reconciliação PURA da lista, genérica sobre o tipo da track, testada (12 testes)"
  - "ConversationArea: ScreenShareStage (grid flex-wrap) + ScreenShareTile (attach/detach no ciclo de vida do React)"
  - "Ícone de 'compartilhando' na sidebar (VoiceChannelRow) e na lista de membros (MemberAvatar), visível para quem NÃO está no canal"
affects:
  - "08-07 (checkpoint humano final: praticamente tudo o que este plano faz só é provável em Windows com 2+ máquinas)"
  - "08-03 (checkpoint de áudio, ainda não executado — o áudio de sistema chega pelo caminho já existente do efeito de áudio remoto)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reconciliação de lista de mídia extraída para módulo PURO e genérico sobre o tipo da track: torna testável no edge-runtime (o ambiente do vitest do projeto, sem DOM) justamente a regra que mais importa da fase — 'o vídeo some em todos os caminhos'"
    - "Elemento de mídia anexado/desanexado por efeito do React (dep = identidade da TRACK), não por handler de evento do SDK: o cleanup passa a ser garantido pelo React em 100% dos desmontes, inclusive troca de canal e unmount do provider"
    - "Redundância deliberada de eventos de remoção (TrackUnsubscribed + TrackUnpublished + ParticipantDisconnected + LocalTrackUnpublished + Disconnected), viabilizada por remoção idempotente por trackSid"

key-files:
  created:
    - src/renderer/src/lib/screenshare-tracks.ts
    - src/renderer/src/lib/screenshare-tracks.test.ts
  modified:
    - src/renderer/src/state/voice-context.tsx
    - src/renderer/src/components/shell/ConversationArea.tsx
    - src/renderer/src/components/shell/ChannelSidebar.tsx
    - src/renderer/src/components/shell/MemberList.tsx

key-decisions:
  - "O frame congelado foi CONFIRMADO como comportamento padrão do SDK, não hipótese: no bundle instalado do livekit-client 2.22, RemoteParticipant.unpublishTrack chama track.stop(), que só faz `super.disable()` — e detachTrack() (quando chega a rodar) apenas zera srcObject, nunca remove o elemento do DOM. Quem não remove o <video> por conta própria fica com ele na tela."
  - "A lista vive em voice-context.tsx (como speakingUserIds/connectionQualities de 07-04), mas a REGRA de reconciliação vive num módulo puro separado. Sem essa separação, o critério nº 4 da fase não teria nenhum teste automatizado possível neste ambiente."
  - "Remoção por trackSid deliberadamente SEM filtro por Track.Source: remover um sid ausente é no-op, então despublicação de microfone/câmera passa reto de graça. Uma condição a menos para errar no caminho que precisa ser infalível."
  - "Cinco eventos cobrindo cinco cenários de saída, aceitando sobreposição entre eles. ParticipantDisconnected é o único que cobre o cenário do HANDOFF (app fechado à força) sem depender de o SFU emitir evento por track."
  - "ScreenShareTile anexa via useEffect com dep [entry.track] (identidade da track), não via ref callback: o projeto não depende do cleanup de ref callback do React 19, e o efeito re-anexa corretamente se o mesmo trackSid voltar com um objeto de track novo (re-inscrição após reconexão)."
  - "Nunca tocar em element.muted após attach(): o SDK já seta muted quando a stream não tem track de áudio, e sobrescrever isso quebraria o autoplay do vídeo REMOTO (ver Deviations)."
  - "Auto-visualização (isLocal) renderizada na mesma grade dos outros, com rótulo 'Sua tela' — a Fase 3 não distingue presenter de espectador nesta região, e o plano pede explicitamente cobrir a track local."
  - "Múltiplas telas simultâneas: grid flex-wrap simples, sem UI de destacar/focar um stream. MVP explícito do plano."
  - "Ícone de compartilhamento NÃO depende de isJoined (ao contrário do anel de fala): o ponto do indicador é ser visto por quem está fora do canal. Isso só é possível porque a fonte é voiceStates.sharing (Convex), não o Room."
  - "Na MemberList o badge foi para o canto superior ESQUERDO do avatar: superior direito já é do mute e inferior direito é do AvatarBadge de presença. Três cantos, três estados, nenhum empilhamento ilegível em avatar de 32px."

patterns-established:
  - "Rótulo de tela remota resolvido por lookup identity→username sobre a MESMA query que VoiceParticipantGrid já assina (o cliente Convex compartilha subscrição por query+args), com 'skip' quando não há vídeo possível — nome de gente nunca sai do LiveKit, que só conhece users._id"

# Metrics
duration: ~35min
completed: 2026-08-19
---

# Fase 8 Plano 06: Consumo remoto e indicadores — Summary

**A área de conversa mostra vídeo de verdade — a própria tela e as dos outros,
sempre nascidas de `track.attach()` — e some sozinha por cinco caminhos
distintos, incluindo aquele em que o apresentador fecha o app à força; sidebar
e lista de membros ganharam o ícone de "compartilhando" que funciona para quem
nem entrou no canal, lendo um campo que já vinha na query desde 07-04 e que
ninguém consumia.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2/2 (+1 commit de correção de defeito próprio)
- **Files:** 2 criados, 4 modificados
- **Testes:** 223 → 235 (os 12 novos são de `screenshare-tracks.test.ts`)

## Task Commits

1. **Task 1 — renderização real na área de conversa** — `d78c18e` (feat)
2. **Task 2 — indicador na sidebar e na lista de membros** — `0403bce` (feat)
3. **Correção de defeito introduzido na Task 1** — `55c8347` (fix)

## Accomplishments

### Task 1 — o vídeo que aparece, e principalmente o que some (`d78c18e`)

Três peças:

**`src/renderer/src/lib/screenshare-tracks.ts`** — reconciliação pura da lista
de telas em exibição: `addScreenShareEntry`, `removeScreenShareEntryBySid`,
`removeScreenShareEntriesOfParticipant`, `clearScreenShareEntries`. Genérica
sobre o tipo da track, sem importar `livekit-client` e sem tocar em DOM.

Essa separação não é estética. O ambiente de teste do projeto é `edge-runtime`
(sem DOM, sem `HTMLVideoElement`), e o critério de sucesso nº 4 da fase — "os
outros voltam ao layout normal sem frame congelado" — é, no fundo, lógica de
lista. Extraída, ela tem 12 testes; embutida no provider, só seria verificável
com Electron real em Windows. Toda função devolve o **mesmo array** quando nada
muda, para que eventos irrelevantes do `Room` não re-renderizem a região de
vídeo.

**`voice-context.tsx`** — `screenShareTracks` no contexto, alimentado por um
efeito próprio (separado do efeito de áudio remoto de 07-05, que também escuta
`TrackSubscribed`/`TrackUnsubscribed` mas resolve o problema oposto: lá o
provider ANEXA o `<audio>` ele mesmo, porque som não tem UI; aqui ele não toca
em DOM nenhum, só mantém a lista — quem anexa o `<video>` é o componente, que é
quem sabe onde na tela o vídeo cabe).

Cinco eventos, nenhum redundante em termos de cenário:

| Evento | Cenário coberto |
|---|---|
| `TrackUnsubscribed` | apresentador clicou em "parar" (caminho limpo) |
| `TrackUnpublished` | despublicação sem passar por desinscrição |
| `ParticipantDisconnected` | **apresentador fechou o app / caiu da rede** |
| `LocalTrackUnpublished` | fui eu que parei de compartilhar |
| `Disconnected` | fui eu que caí/saí do canal |

Sobreposição entre eles é aceita de propósito: remover um `trackSid` que já saiu
é no-op.

**`ConversationArea.tsx`** — `ScreenShareStage` (grid `flex-wrap`, placeholder
"Ninguém está compartilhando a tela" quando conectado sem ninguém no ar, "Entre
no canal para ver a tela compartilhada" quando só visualizando) e
`ScreenShareTile` (o efeito que faz `attach` no mount e `detach` + `remove` no
cleanup). O placeholder "chega em F8" não existe mais em lugar nenhum do
projeto.

#### O frame congelado é o comportamento PADRÃO, não uma hipótese

Achado que vale registrar, porque muda o peso do requisito. Lendo o bundle
instalado (`node_modules/livekit-client/dist/livekit-client.esm.mjs`, 2.22.0):

```js
unpublishTrack(sid, sendUnpublish) {
  const track = publication.track;
  if (track) {
    track.stop();                    // RemoteTrack.stop() → só super.disable()
    publication.setTrack(undefined); // → prevTrack.detach()
  }
  ...
}
```

E `detachTrack(track, element)` faz `element.srcObject = null` — **e nada mais**.
O elemento `<video>` continua no DOM, no layout, ocupando espaço. O SDK nunca
remove elemento nenhum da página; ele não sabe onde a aplicação os colocou.

Ou seja: o sintoma que o HANDOFF descreve não é um bug a evitar, é o que
acontece com quem não faz nada. A remoção tinha que ser da aplicação, e o ponto
de a fazer pelo ciclo de vida do React (track sai da lista → componente desmonta
→ cleanup) é que ela passa a valer em 100% dos desmontes — incluindo os que
nenhum evento do LiveKit anuncia: trocar de canal selecionado, navegar para um
canal de texto, desmontar o provider.

### Task 2 — o ícone para quem está de fora (`0403bce`)

`ChannelSidebar.tsx` (`VoiceChannelRow`): `MonitorUp` verde ao lado do badge de
mute, para todo participante com `sharing === true`. Deliberadamente **sem**
guarda por `isJoined` — o oposto do anel de fala logo acima, e a diferença é
exatamente o ponto: fala é dado do `Room` local (não existe para quem está
fora), `sharing` é dado do Convex (existe para todo mundo). É o indicador que
avisa "tem coisa acontecendo naquele canal" para quem ainda não entrou.

`MemberList.tsx`: o tipo local `VoiceState` passou de `{ speaking, muted }` para
`{ speaking, muted, sharing }`, populado em `voiceStateFor` a partir do mesmo
`participant` já resolvido. Badge no canto superior **esquerdo** do avatar —
superior direito é do mute, inferior direito é do `AvatarBadge` de presença do
design system.

**Nenhuma query nova nos dois arquivos**, conforme a verificação do plano:
`sharing` já vinha na linha devolvida por `enrichVoiceStates` (`convex/voice.ts`)
desde 07-04. O `git diff` dos dois arquivos não tem uma única linha com
`useQuery` (contagem inalterada: 3 em `ChannelSidebar.tsx`, 2 em
`MemberList.tsx`).

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — Bug] `element.muted` desarmava o autoplay do vídeo remoto**
(commit `55c8347`)

- **Encontrado durante:** revisão do próprio código da Task 1, lendo
  `attachToElement` no bundle do SDK para confirmar que `attach()` não precisava
  de ajuda.
- **Defeito:** a primeira versão do `ScreenShareTile` fazia
  `element.muted = entry.isLocal` depois do `attach()`, com a intenção de evitar
  realimentação na auto-visualização. Mas o SDK já faz
  `element.muted = mediaStream.getAudioTracks().length === 0`, e uma track de
  tela é só vídeo — o elemento já nasce mudo em todos os casos. O efeito real da
  linha era o inverso do pretendido: `muted = false` nas telas **remotas**, isto
  é, elemento de mídia com som habilitado tentando tocar sem gesto do usuário.
  Na política de autoplay do Chromium isso é `NotAllowedError`, e o sintoma
  ("o vídeo do outro não aparece") apareceria a milhas da causa.
- **Correção:** a linha saiu, e no lugar ficou o comentário explicando por que
  não se mexe em `muted` ali. Dep do efeito voltou a ser só `[entry.track]`.
- **Arquivo:** `src/renderer/src/components/shell/ConversationArea.tsx`

**2. [Extensão, não desvio] Módulo puro + 12 testes onde o plano não pedia
teste nenhum**

O plano não previa arquivo novo nem teste. `screenshare-tracks.ts` foi criado
porque a regra central da fase, embutida no provider, ficaria 100% não-testável
neste ambiente. Nenhuma decisão arquitetural foi alterada: a lista continua
morando no `voice-context.tsx` (mesma convenção de 07-04 que o plano manda
seguir), só a função de reconciliação é que mora fora.

### Não desviado, mas vale registrar

- **A track de áudio do compartilhamento não ganhou tratamento novo.** O plano
  já previa que `Track.Source.ScreenShareAudio` se resolve sozinha; confirmado
  no código: o efeito de áudio remoto de 07-05 filtra por `isAudioTrack(track)`,
  sem olhar `source`, então a track de áudio de sistema do apresentador já é
  anexada ao container invisível e tocada pelo mesmo caminho do microfone dos
  outros. Zero linhas novas.
- **Rótulo com o nome de quem compartilha** (não pedido pelo plano, mas
  necessário para a grade fazer sentido com duas telas): o LiveKit só conhece
  `identity` = `users._id`, que não se mostra a ninguém, então o nome vem de um
  lookup sobre a query `voiceParticipantsByChannel` que a `VoiceParticipantGrid`
  do mesmo arquivo já assina — o cliente Convex compartilha a subscrição por
  query+args, e o `'skip'` cobre o caso de não haver vídeo para rotular.

## Verification

Saída real, colada:

```
$ npm run typecheck
> janja@1.0.0 typecheck
> npm run typecheck:node && npm run typecheck:web && npm run typecheck:convex

> janja@1.0.0 typecheck:node
> tsc --noEmit -p tsconfig.node.json --composite false

> janja@1.0.0 typecheck:web
> tsc --noEmit -p tsconfig.web.json --composite false

> janja@1.0.0 typecheck:convex
> tsc --noEmit -p tsconfig.convex.json

(EXIT=0, nenhuma saída de erro)
```

```
$ npx vitest run
 ✓ convex/dms.test.ts  (15 tests) 323ms
 ✓ convex/messages.test.ts  (10 tests) 325ms
 ✓ convex/invites.test.ts  (13 tests) 426ms
 ✓ convex/friends.test.ts  (24 tests) 455ms
 ✓ convex/voice.test.ts  (57 tests) 1177ms
 ✓ convex/channels.test.ts  (10 tests) 248ms
 ✓ convex/members.test.ts  (9 tests) 156ms
 ✓ convex/channelReadState.test.ts  (7 tests) 267ms
 ✓ convex/typing.test.ts  (8 tests) 266ms
 ✓ src/renderer/src/lib/screenshare-tracks.test.ts  (12 tests) 26ms
 ✓ convex/servers.test.ts  (9 tests) 160ms
 ✓ src/renderer/src/lib/screenshare-preferences.test.ts  (14 tests) 50ms
 ✓ convex/lib/inviteCode.test.ts  (6 tests) 230ms
 ✓ convex/users.test.ts  (7 tests) 196ms
 ✓ convex/lib/tag.test.ts  (5 tests) 57ms
 ✓ convex/presence.test.ts  (3 tests) 110ms
 ✓ src/renderer/src/lib/user-tag.test.ts  (6 tests) 13ms
 ✓ src/main/screenshare.test.ts  (20 tests) 781ms

 Test Files  18 passed (18)
      Tests  235 passed (235)
```

Baseline era 17 arquivos / 223 testes; nada regrediu, +1 arquivo / +12 testes.

```
$ npm run build
out/main/index.js  15.40 kB
out/preload/index.js  3.76 kB
../../out/renderer/assets/index-DwSunbhY.js   2,393.29 kB
✓ built in 9.21s
```

Verificações específicas do plano:

```
$ grep -rn "chega em F8" src/ convex/
(nada — placeholder desatualizado removido do projeto inteiro)

$ git diff -U0 ChannelSidebar.tsx MemberList.tsx | grep -E "^[+-].*useQuery"
(nada — nenhuma query adicionada nem removida)

$ npx eslint <os 5 arquivos tocados>
0 achados novos (o único erro que aparece em voice-context.tsx é o
react-refresh/only-export-components pré-existente, do export de useVoice)
```

## O que NÃO foi provado (WSL2: sem Windows, sem tela, sem áudio)

Este ambiente não renderiza janela Electron, não tem dispositivo de captura de
tela e não tem saída de áudio. **Nenhum pixel de vídeo foi visto por ninguém.**
O que existe é: typecheck limpo, 235 testes passando, build de produção
completo, leitura linha a linha do bundle do SDK para confirmar o
comportamento de `unpublishTrack`/`attachToElement`, e 12 testes cobrindo a
regra de reconciliação da lista.

Isso prova a LÓGICA de quando a track entra e sai da lista. Não prova que a
imagem aparece, que ela é legível, que o áudio de sistema acompanha, nem que a
região some de fato na tela de quem assiste.

### Roteiro para o checkpoint humano (08-07) — 2+ máquinas Windows

1. **Ver a tela do outro.** A compartilha; B, no mesmo canal, vê o vídeo
   aparecer na área de conversa. Verificar se a imagem é legível no preset
   "Fluida" e no "Nítida" (o toggle de 08-05).
2. **Auto-visualização.** A vê a própria tela na mesma grade, rotulada "Sua
   tela". Compartilhar a tela inteira gera o efeito túnel (janela dentro da
   janela) — confirmar se isso incomoda a ponto de valer esconder a
   auto-visualização num plano futuro.
3. **Parada limpa.** A clica em "parar". O vídeo some da tela de B
   imediatamente, e o layout volta ao placeholder "Ninguém está compartilhando
   a tela" — **sem quadro preto e sem último frame preso**.
4. **CRITÉRIO Nº 4 DA FASE — queda suja.** A mata o app pelo Gerenciador de
   Tarefas (não fecha pela janela; matar o processo). Na tela de B o vídeo tem
   que sumir sozinho, e o avatar de A tem que sair da sidebar. Repetir com
   cabo de rede arrancado / Wi-Fi desligado, que é o caminho mais lento (o SFU
   demora para declarar a queda).
5. **Ícone para quem está fora.** C, sem entrar no canal, vê o `MonitorUp`
   verde ao lado de A na sidebar e no avatar de A na lista de membros. Some
   quando A para. Some também quando A morre (aí é o webhook `track_unpublished`
   de 08-01 — **cuidado: esse caminho depende do push do Convex que ainda não
   foi feito**, ver blocker abaixo).
6. **Áudio de sistema.** B ouve o áudio da tela de A (SHARE-03) sem eco da voz
   da própria call (`restrictOwnAudio`) — este é o objeto do Plano **08-03**,
   ainda não executado.
7. **Duas telas ao mesmo tempo.** A e B compartilham juntos; C vê as duas lado
   a lado no grid. Verificar se o layout aguenta (o MVP não tem foco/destaque).
8. **Vazamento de elemento.** Compartilhar, parar, trocar de canal, entrar de
   novo — várias vezes. Com o DevTools aberto, conferir que não sobram nós
   `<video>` órfãos no DOM (`document.querySelectorAll('video').length` deve
   voltar a zero) e que a CPU/GPU não sobe a cada ciclo. É a mesma classe de
   vazamento da quick task 001.
9. **Reconexão.** Derrubar a rede de B por ~10s durante um compartilhamento. Ao
   voltar, o vídeo tem que reaparecer (re-inscrição) — e não ficar preso no
   frame de antes da queda.

### Bloqueadores herdados que afetam a verificação acima

- **O push do Convex desta fase nunca foi feito** (blocker registrado em
  `STATE.md` desde 08-01): `convex/http.ts` passou a importar
  `@livekit/protocol` e o bundler do Convex nunca rodou sobre esse import. Até
  esse push acontecer, o passo 5 do roteiro (ícone sumindo depois de queda
  suja) não pode ser avaliado — e uma falha ali pode ser do deploy, não deste
  plano.
- **O Plano 08-03 (checkpoint humano de áudio sem eco) não foi executado** —
  decisão explícita do usuário de seguir com os planos autônomos. Nada aqui o
  simula ou o substitui: o passo 6 do roteiro continua sendo dele.

## Next Phase Readiness

Do lado do código, SHARE-02 está completo e a parte "sem frame congelado" de
SHARE-06 está implementada nos dois lados (LiveKit para quem está na sala,
Convex para quem está fora). A Fase 8 tem agora **um único plano restante,
08-07**, e ele é integralmente humano.

Concern honesto para quem for conduzir o 08-07: dos 9 passos do roteiro acima,
**nenhum** é verificável sem Windows nativo e uma segunda pessoa. Este é o
plano da fase com a maior distância entre "o código está escrito" e "o
comportamento está provado".
