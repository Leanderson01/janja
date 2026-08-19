---
phase: 08-compartilhamento-de-tela
plan: 05
subsystem: media
tags: [livekit, screenshare, convex, localStorage, preferences, share-08, share-05]

# Dependency graph
requires:
  - phase: 08-01
    provides: "mutation voice.setSharing (escreve voiceStates.sharing da própria linha, lança se não houver linha) e o case track_unpublished do webhook, que só faz sentido se alguém escrever sharing: true"
  - phase: 08-02
    provides: "startScreenShare/stopScreenShare em useVoice(), SCREEN_SHARE_CAPTURE_OPTIONS e os listeners de LocalTrackPublished/LocalTrackUnpublished filtrados por Track.Source.ScreenShare"
  - phase: 08-04
    provides: "seletor de fonte no processo main (a captura já espera a escolha do usuário antes de publicar)"
  - phase: 07-05
    provides: "voice-preferences.ts — o padrão defensivo de preferência de MÁQUINA em localStorage, e o toggle de dois botões do VoiceSettingsPopover"
provides:
  - "src/renderer/src/lib/screenshare-preferences.ts — loadScreenSharePreferences/saveScreenSharePreferences ('fluida' | 'nitida'), nunca lança"
  - "startScreenShare() aplica screenShareEncoding (ScreenSharePresets) + contentHint conforme a preferência salva, relida a cada início"
  - "voiceStates.sharing passa a ser ESCRITO pelo cliente — só do listener de track local, nunca do clique"
  - "Toggle Fluida/Nítida persistente na UI (popover de configurações de voz)"
affects:
  - "08-06 (indicador de quem está compartilhando: passa a ter um campo `sharing` com dado real para ler)"
  - "08-07 / verificação humana em Windows"

tech-stack:
  added: []
  patterns:
    - "Preferência de qualidade lida NO MOMENTO DA AÇÃO (dentro de startScreenShare), nunca capturada em estado de React no mount — é o que faz 'vale para o próximo compartilhamento' ser consequência da implementação, não uma promessa de comentário"
    - "Escrita no Convex derivada de evento do SDK (LocalTrackPublished/Unpublished), nunca do clique — mesma regra que 08-02 já aplicava para o estado de UI, agora estendida ao dado durável"
    - "Guarda por activeChannelRef antes de qualquer mutation disparada por evento de track: a saída deliberada do canal apaga a linha inteira antes de as tracks caírem, e sem a guarda todo leave com tela no ar logaria um erro que não é defeito"

key-files:
  created:
    - src/renderer/src/lib/screenshare-preferences.ts
    - src/renderer/src/lib/screenshare-preferences.test.ts
  modified:
    - src/renderer/src/state/voice-context.tsx
    - src/renderer/src/components/shell/VoiceSettingsPopover.tsx
    - src/renderer/src/components/shell/VoiceControlBar.tsx

key-decisions:
  - "O toggle Fluida/Nítida foi para VoiceSettingsPopover.tsx (botão de engrenagem), não para o corpo do VoiceControlBar como o plano dizia. Motivo físico: a coluna do ChannelSidebar é fixa em 240px (decisão registrada em STATE.md/03-RESEARCH.md) e o rodapé já carrega cinco botões de ícone-sm (32px cada) mais o nome do canal conectado; dois botões de TEXTO precisam de ~120px, que não existem. O popover já é o lar das outras preferências de máquina e seu gatilho é o botão imediatamente vizinho ao de compartilhar. VoiceControlBar.tsx continua no changeset, com o comentário que diz onde o controle mora e por quê."
  - "setSharing é chamado por um helper único (syncSharingToConvex) definido DENTRO do efeito de listeners, e guardado por activeChannelRef.current !== null. Sem a guarda, sair do canal compartilhando logaria 'Você não está em nenhum canal de voz' toda vez: a fila de transições zera activeChannelRef de forma síncrona, chama leaveVoiceChannel (apaga a linha) e só depois room.disconnect() — e o cleanup de desconexão do livekit-client despublica cada track local, disparando LocalTrackUnpublished DEPOIS de a linha já não existir."
  - "handleDisconnected continua deliberadamente sem setSharing (o plano manda, e a leitura do SDK confirma o porquê): nesse ponto a linha de voiceStates já foi apagada por leaveVoiceChannel (saída nossa) ou será apagada pelo webhook participant_left de 07-02 (queda). O caso 'app morreu com a tela no ar' é do webhook track_unpublished de 08-01."
  - "contentHint saiu de SCREEN_SHARE_CAPTURE_OPTIONS (onde era fixo em 'motion' desde 08-02) e passou a ser montado por chamada, junto com o preset. Andar junto é o ponto: 'motion' com h1080fps15 pediria ao encoder o contrário do que o preset promete."
  - "Default 'fluida' (720p30). O modo de falha de 'nítida' em upload doméstico ruim (slideshow) é bem pior que o de 'fluida' em conexão boa (texto menos nítido), e o público do projeto é um grupo de amigos em upload brasileiro."
  - "screenshare-preferences.ts não importa livekit-client — só persiste a string. A tradução para ScreenSharePresets mora em voice-context.tsx, onde o SDK já é dependência."

patterns-established:
  - "Teste de preferência em localStorage sob edge-runtime (o ambiente do vitest do projeto, que NÃO tem localStorage): o caminho 'storage indisponível' é o estado nativo do ambiente e o caminho feliz é que precisa de stub — o inverso do intuitivo, e mais barato de provar"

# Metrics
duration: ~35min
completed: 2026-08-19
---

# Fase 8 Plano 05: Qualidade e sincronização com o Convex — Summary

**`voiceStates.sharing` deixou de ser um campo que ninguém escrevia: o cliente
agora o espelha a partir da publicação REAL da track de tela (nunca do clique),
e o usuário escolhe entre "Fluida" (720p30, `contentHint: 'motion'`) e "Nítida"
(1080p15, `'detail'`) numa preferência de máquina que é relida a cada início de
compartilhamento — então trocar o toggle nunca derruba a imagem de quem já está
assistindo.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2/2
- **Files:** 2 criados, 3 modificados
- **Testes:** 209 → 223 (os 14 novos são todos de `screenshare-preferences.test.ts`)

## Task Commits

1. **Task 1 — preferência de qualidade + aplicação no publish** — `07b307d` (feat)
2. **Task 2 — sincronizar `voiceStates.sharing` + toggle na UI** — `648100c` (feat)

## Accomplishments

### Task 1 — qualidade (`07b307d`)

`src/renderer/src/lib/screenshare-preferences.ts`, clone estrutural de
`voice-preferences.ts` (07-05) com chave própria
(`janja:screenshare-preferences`): `sanitize()` que nunca confia no que leu,
`load` que cai no default em qualquer falha, `save` que faz merge com o
persistido (não com o default) e engole erro de quota. Chave separada de
propósito — qualidade de vídeo não é preferência de voz, e uma migração futura
de uma não pode resetar a outra.

`voice-context.tsx` ganhou `QUALITY_PRESETS`, o mapeamento de `08-RESEARCH.md §5`:

| Escolha | Preset | `contentHint` | Encoding real (lido do pacote instalado) |
|---|---|---|---|
| Fluida | `ScreenSharePresets.h720fps30` | `'motion'` | 1280x720, `{"maxBitrate":2000000,"maxFramerate":30,"priority":"medium"}` |
| Nítida | `ScreenSharePresets.h1080fps15` | `'detail'` | 1920x1080, `{"maxBitrate":2500000,"maxFramerate":15,"priority":"medium"}` |

`contentHint` **saiu** de `SCREEN_SHARE_CAPTURE_OPTIONS` (onde 08-02 o deixou
fixo em `'motion'`) e passou a ser montado por chamada junto com o preset: os
dois descrevem a mesma decisão para o encoder, e separá-los permitiria a
combinação incoerente (`h1080fps15` + `'motion'` = pedir ao encoder que
sacrifique justamente a nitidez que o preset existe para entregar).

`startScreenShare()` agora usa o **terceiro** argumento de
`setScreenShareEnabled`, ausente de propósito em 08-02:

```ts
await room.localParticipant.setScreenShareEnabled(
  true,
  { ...SCREEN_SHARE_CAPTURE_OPTIONS, contentHint },
  { screenShareEncoding: preset.encoding }
)
```

`screenShareEncoding` é campo **separado** de `videoEncoding` em
`TrackPublishDefaults` (confirmado no `.d.ts` instalado, não só na pesquisa):
escrever no segundo publicaria normalmente, só que na qualidade default —
falha silenciosa clássica.

`videoCodec` fica no default `vp8`, conforme `08-RESEARCH.md §5`.

### Task 2 — sincronização com o Convex (`648100c`)

`setSharing` (08-01) é chamado de **um único lugar**: um helper
`syncSharingToConvex(sharing)` definido dentro do efeito de listeners e usado
só pelos dois handlers de track local já existentes.

| Caminho que muda o compartilhamento | Como chega no Convex |
|---|---|
| Usuário clica em compartilhar e escolhe uma fonte | `LocalTrackPublished` → `setSharing(true)` |
| Usuário clica em parar | `setScreenShareEnabled(false)` → `LocalTrackUnpublished` → `setSharing(false)` |
| Usuário cancela o seletor (08-04) / captura falha | nada foi publicado, `sharing` nunca virou `true` |
| Windows/Chromium encerra a captura por fora | `TrackEvent.Ended` → o SDK despublica sozinho → `LocalTrackUnpublished` → `setSharing(false)` |
| Sair do canal / trocar de canal | a linha inteira de `voiceStates` é apagada por `leaveVoiceChannel` — nada de `sharing` órfão, e a mutation **não** é chamada (guarda por `activeChannelRef`) |
| App morre com a tela no ar (crash, Alt+F4) | fora do alcance do cliente: webhook `track_unpublished` (08-01) / `participant_left` (07-02) |

Duas propriedades sustentam a tabela:

**1. A escrita nasce do evento, não do clique.** Escrever a partir de
`startScreenShare()` deixaria `sharing: true` no Convex se
`setScreenShareEnabled` falhasse ou se o usuário cancelasse o seletor. E um
`sharing: true` órfão é o pior tipo de defeito desta fase: nenhum erro, nenhum
log, só um indicador que nunca some para as outras nove pessoas.

**2. A guarda por `activeChannelRef` não é cosmética.** Lendo o
`livekit-client` instalado, o cleanup de desconexão itera
`localParticipant.trackPublications` e chama `unpublishTrack` em cada uma
**antes** de remover os listeners do Room — ou seja, sair de um canal
compartilhando **dispara** `LocalTrackUnpublished`. Como a fila de transições
(`voice-context.tsx`) zera `activeChannelRef` de forma síncrona, depois chama
`leaveVoiceChannel` (que apaga a linha) e só então `room.disconnect()`, sem a
guarda todo `leave` com tela no ar terminaria num `setSharing(false)` contra
uma linha inexistente — que `setSharing` trata lançando (08-01). Erro no
console sem defeito real, exatamente o ruído que o plano manda evitar.

`handleDisconnected` continua deliberadamente **sem** `setSharing`, com o
porquê escrito no código.

**UI:** seção "Qualidade do compartilhamento de tela" no popover de
configurações de voz — dois botões (`variant` `default`/`outline` +
`aria-pressed`), exatamente o padrão do toggle "Detecção de voz / Push-to-talk"
de 07-05, com uma linha explicando o que cada opção significa e outra dizendo
"Vale a partir do próximo compartilhamento". Sempre visível e sempre
habilitado, fora do gate de `hasVoiceIntention` (mesmo tratamento do toggle de
sons de canal). `onChange` chama só `saveScreenSharePreferences({ quality })`:
nenhum método novo em `useVoice()`, nenhuma chamada a `setScreenShareEnabled`,
nenhuma interrupção do que está no ar.

## Verificação — saída real

Ambiente: **WSL2, sem Windows, sem tela, sem dispositivo de áudio e sem janela
do Electron renderizada.**

### `npm run typecheck`

```
> janja@1.0.0 typecheck
> npm run typecheck:node && npm run typecheck:web && npm run typecheck:convex

> janja@1.0.0 typecheck:node
> tsc --noEmit -p tsconfig.node.json --composite false

> janja@1.0.0 typecheck:web
> tsc --noEmit -p tsconfig.web.json --composite false

> janja@1.0.0 typecheck:convex
> tsc --noEmit -p tsconfig.convex.json

EXIT=0
```

Limpo nos três projetos.

### `npx vitest run`

```
 ✓ convex/messages.test.ts  (10 tests) 125ms
 ✓ convex/dms.test.ts  (15 tests) 134ms
 ✓ convex/friends.test.ts  (24 tests) 167ms
 ✓ convex/invites.test.ts  (13 tests) 173ms
 ✓ convex/voice.test.ts  (57 tests) 552ms
 ✓ convex/channels.test.ts  (10 tests) 106ms
 ✓ convex/members.test.ts  (9 tests) 87ms
 ✓ convex/typing.test.ts  (8 tests) 140ms
 ✓ convex/channelReadState.test.ts  (7 tests) 145ms
 ✓ src/renderer/src/lib/screenshare-preferences.test.ts  (14 tests) 9ms
 ✓ convex/servers.test.ts  (9 tests) 87ms
 ✓ convex/lib/inviteCode.test.ts  (6 tests) 57ms
 ✓ convex/users.test.ts  (7 tests) 60ms
 ✓ convex/presence.test.ts  (3 tests) 39ms
 ✓ convex/lib/tag.test.ts  (5 tests) 27ms
 ✓ src/renderer/src/lib/user-tag.test.ts  (6 tests) 3ms
 ✓ src/main/screenshare.test.ts  (20 tests) 636ms

 Test Files  17 passed (17)
      Tests  223 passed (223)
```

Baseline era 16 arquivos / 209 testes. Os 14 novos são todos de
`screenshare-preferences.test.ts`; **nenhum arquivo de teste existente foi
tocado** e nenhum teste anterior mudou de resultado.

### Verificação por mutação — os testes novos não são vácuos

`isScreenShareQuality` foi afrouxado de propósito (`return typeof value ===
'string'`, aceitando qualquer string como qualidade válida) e a suíte rodou:

```
 Test Files  1 failed (1)
      Tests  1 failed | 13 passed (14)
```

O que falhou foi o `it.each` de entradas corrompidas, no caso
`valor de qualidade desconhecido` (`{"quality":"ultra"}`) — exatamente o teste
que existe para isso. Arquivo restaurado, 14/14 verdes de novo.

### Verificações do `<verification>` do plano

**`setSharing` só é chamado do listener de track local:**

```
$ grep -rn "setSharingMutation\|api.voice.setSharing" src/
src/renderer/src/state/voice-context.tsx:220:  const setSharingMutation = useMutation(api.voice.setSharing)
src/renderer/src/state/voice-context.tsx:667:      void setSharingMutation({ sharing }).catch((err) => {

$ grep -rn "syncSharingToConvex" src/
src/renderer/src/state/voice-context.tsx:657:    function syncSharingToConvex(sharing: boolean): void {
src/renderer/src/state/voice-context.tsx:684:      syncSharingToConvex(true)   # handleLocalTrackPublished
src/renderer/src/state/voice-context.tsx:690:      syncSharingToConvex(false)  # handleLocalTrackUnpublished

$ sed -n '/async function startScreenShare/,/^  function setManualMute/p' \
    src/renderer/src/state/voice-context.tsx | grep -n "setSharing\|syncSharing"
(nenhuma saída — nenhuma chamada dentro de start/stopScreenShare)
```

Um único call-site da mutation, alcançado por exatamente dois handlers, os dois
filtrados por `Track.Source.ScreenShare`.

**`screenShareEncoding` presente na chamada:**

```
$ grep -n "screenShareEncoding" src/renderer/src/state/voice-context.tsx
552:        { screenShareEncoding: preset.encoding }
```

**Trocar a qualidade não chama `setScreenShareEnabled`:** o `onClick` do toggle
chama `handleScreenShareQualityChange`, cujo corpo inteiro é
`saveScreenSharePreferences` + `setScreenSharePrefs`. `VoiceSettingsPopover.tsx`
não alcança `setScreenShareEnabled` em nenhum caminho: o grep encontra 2
ocorrências no arquivo e **as duas são comentários** explicando por que nada
disso é chamado (linhas 70 e 198). O componente também não consome
`startScreenShare`/`stopScreenShare` do contexto — só `room`,
`applyVoicePreferences` e `getVadAnalysisTrack`, como antes deste plano.

**Os presets são o que a pesquisa diz que são** (lido do pacote instalado, não
da documentação):

```
$ node -e "const {ScreenSharePresets:p}=require('livekit-client'); ..."
h720fps30  {"maxBitrate":2000000,"maxFramerate":30,"priority":"medium"}  1280x720
h1080fps15 {"maxBitrate":2500000,"maxFramerate":15,"priority":"medium"}  1920x1080
```

### `npx electron-vite build`

```
out/preload/index.js  3.76 kB
✓ built in 33ms
../../out/renderer/assets/index-CcJZDlpb.css     53.84 kB
../../out/renderer/assets/index-DOoiuAoJ.js   2,386.35 kB
✓ built in 5.33s

$ grep -c "janja:screenshare-preferences" out/renderer/assets/index-DOoiuAoJ.js
1
$ grep -o "h720fps30\|h1080fps15" out/renderer/assets/index-DOoiuAoJ.js | sort -u
h1080fps15
h720fps30
```

A chave de `localStorage` e os dois presets sobrevivem ao bundle de produção
(lição nº1 do HANDOFF: typecheck não é bundler).

### Lint

```
$ npx eslint src/renderer/src/lib/screenshare-preferences.ts \
    src/renderer/src/lib/screenshare-preferences.test.ts \
    src/renderer/src/state/voice-context.tsx \
    src/renderer/src/components/shell/VoiceSettingsPopover.tsx \
    src/renderer/src/components/shell/VoiceControlBar.tsx

/home/leo/workspace/janja/src/renderer/src/state/voice-context.tsx
  990:17  error  Fast refresh only works when a file only exports components...
                 react-refresh/only-export-components

✖ 1 problem (1 error, 0 warnings)
```

O único achado é o `export function useVoice` que existe desde 07-03 e já
constava como pré-existente no summary de 08-02. Zero achados novos.

## Deviations from Plan

### 1. [Desvio de UI, documentado] O toggle foi para `VoiceSettingsPopover.tsx`, não para o corpo do `VoiceControlBar`

- **Encontrado em:** Task 2
- **Problema:** o plano manda "dois botões tipo toggle, ou um `Select` compacto"
  no `VoiceControlBar`, "perto do botão de compartilhar". Não cabe: a coluna do
  `ChannelSidebar` é **fixa em 240px** (decisão de 03-RESEARCH.md, registrada em
  STATE.md) e o rodapé já tem `px-2` + cinco botões `icon-sm` (32px cada, com
  `gap-2`) + o nome do canal conectado no espaço restante — ~208px dos 240 já
  estão comprometidos quando há canal. Dois botões de TEXTO ("Fluida"/"Nítida")
  pedem ~120px; um `Select` compacto, ~100px. Qualquer um dos dois come o nome
  do canal por inteiro.
- **Feito:** a seção foi para o popover da engrenagem, que (a) é o botão
  **imediatamente vizinho** ao de compartilhar no mesmo rodapé, (b) já é o lar
  das outras preferências de máquina (modo de transmissão, limiar, sons,
  dispositivos), e (c) já tem o padrão de dois botões `default`/`outline` +
  `aria-pressed` que o plano pede que seja reaproveitado. Fica fora do gate de
  `hasVoiceIntention`, como o toggle de sons — visível e utilizável sem canal
  nenhum conectado.
- **`VoiceControlBar.tsx` continua no changeset**, e não por formalidade: ganhou
  o comentário que diz onde o controle de qualidade mora, por quê, e que
  `voiceStates.sharing` não é escrito dali. É a pergunta que a próxima pessoa a
  abrir esse arquivo vai fazer.
- **Não é mudança arquitetural:** nenhum contrato, dado ou fluxo muda — só o
  lugar do clique.
- **Consequência honesta:** o controle está a um clique de distância (abrir o
  popover) em vez de zero. Se a repaginação da UI (Fase 8.5) alargar ou
  reorganizar o rodapé, mover a seção de volta é recortar um bloco de JSX.
  **Fica registrado como ponto de avaliação para o checkpoint humano:** se ao
  usar de verdade o toggle parecer escondido demais, o conserto é barato.

### 2. [Rule 2 — lacuna crítica de verificação] Testes do módulo de preferências

- **Encontrado em:** Task 1
- **Problema:** a verificação prevista pelo plano para a persistência é
  "`localStorage.getItem(...)` reflete a última escolha depois de fechar e
  reabrir o app em dev" — o que exige a janela do Electron, que **não existe
  neste ambiente**. Sem teste, a Task 1 inteira sairia daqui com zero evidência
  além de typecheck.
- **Feito:** `screenshare-preferences.test.ts`, 14 testes. Provam o contrato de
  persistência (o que foi salvo é o que volta a ser lido — a parte de "sobrevive
  ao reinício" que é observável aqui), o merge com o valor persistido, e o
  contrato defensivo contra 7 formas de entrada corrompida (JSON quebrado, valor
  desconhecido, tipo errado, JSON válido não-objeto, `null`, array, string
  vazia), mais `getItem`/`setItem` que lançam.
- **Detalhe do ambiente que virou vantagem:** o vitest do projeto roda em
  `edge-runtime`, que **não tem `localStorage`**. Então o caminho "storage
  indisponível" (o que o módulo promete nunca deixar explodir) é o estado
  **nativo** do ambiente, e é o caminho feliz que precisa de stub — o inverso do
  intuitivo, e mais barato de provar.
- **Verificado por mutação** (ver acima): a suíte detecta o afrouxamento da
  sanitização.
- **Commit:** `648100c`

### 3. [Rule 1 — modo de falha] Guarda por `activeChannelRef` antes do `setSharing`

- **Encontrado em:** Task 2
- **Problema:** o plano previu o problema para o handler de `Disconnected`
  ("chamar `setSharing` nesse momento encontraria uma linha já apagada"), mas
  não para o `LocalTrackUnpublished` que a **mesma desconexão** dispara. Lendo o
  `livekit-client` instalado: o cleanup de desconexão chama
  `localParticipant.unpublishTrack(pub.track, ...)` para cada publicação
  **antes** de remover os listeners do `Room`. Ou seja, sair do canal com a tela
  no ar emite `LocalTrackUnpublished` — e a linha de `voiceStates` já foi
  apagada por `leaveVoiceChannel` alguns `await` antes.
- **Feito:** `syncSharingToConvex` retorna cedo quando
  `activeChannelRef.current === null` (zerado de forma **síncrona** pela fila de
  transições, antes de qualquer `await` da saída). Nenhum `sharing` órfão nesse
  caminho: a linha inteira deixou de existir.
- **Sem isto:** um `console.error("Você não está em nenhum canal de voz")` em
  **toda** saída de canal com compartilhamento ativo. Não quebraria nada, mas
  treinaria quem depura a ignorar erro no console — que é como defeitos de
  verdade passam batido.
- **Commit:** `648100c`

### 4. [Desvio menor] `contentHint` saiu da constante de captura

`SCREEN_SHARE_CAPTURE_OPTIONS` virou `Omit<ScreenShareCaptureOptions,
'contentHint'>` e o hint passou a ser montado por chamada. O plano pede o hint
por qualidade sem dizer como; deixá-lo na constante e sobrescrever depois
permitiria o par incoerente descrito acima.

### 5. [Desvio menor] Comentário desatualizado corrigido

O JSDoc de `startScreenShare` ainda dizia "Nesta versão não existe seleção de
fonte: o processo main sempre concede a primeira tela. O seletor é o Plano
08-04" — falso desde que 08-04 foi executado. Atualizado, junto com o comentário
equivalente no `VoiceControlBar`.

**Total:** 1 desvio de UI documentado + 2 auto-fixed (1× Rule 2, 1× Rule 1) + 2
desvios menores. Nenhuma mudança arquitetural, nenhuma dependência nova
(`package.json` intocado), nenhum arquivo de `convex/` tocado.

## Suposição sobre o Plano 08-03 (checkpoint humano NÃO executado)

O 08-03 (prova de áudio de sistema sem eco, Windows nativo, 3+ máquinas) **não
foi executado** e continua na fila do usuário. Por decisão explícita dele, este
plano seguiu assim.

**A suposição, dita com todas as letras:** este plano assume que a captura de
tela + áudio de sistema funciona, e **não gera nenhuma evidência a favor nem
contra isso.** O que 08-05 mexe é *com que parâmetros de vídeo* a track é
publicada e *quem no Convex sabe* que ela existe — nada no caminho de áudio.
`restrictOwnAudio` e as três flags invertidas de VOICE-16 estão intocadas
(`git diff` sobre `SCREEN_SHARE_CAPTURE_OPTIONS` mostra só a extração do
`contentHint`).

**Se o 08-03 revelar eco**, a correção é a de 08-02 (plano B do Pitfall 1) e não
invalida nada daqui. O único ponto de contato concebível: `contentHint` e
`screenShareEncoding` afetam **vídeo**, não a mixagem de áudio — mas isso é
raciocínio sobre a API, não observação.

## O que este ambiente NÃO consegue provar

WSL2 não tem Windows, não tem tela, não tem áudio e não renderiza a janela do
Electron. Nenhuma track de tela foi publicada, nenhum `localStorage` real foi
escrito, nenhuma mutation do Convex foi chamada de verdade (o deployment deste
worktree é inacessível — ver o blocker de 08-01 em STATE.md). O que existe é
typecheck limpo, build limpo, 223 testes, uma verificação por mutação, greps de
call-site e leitura do código-fonte do `livekit-client` instalado.

**Fica inteiramente para Windows nativo (08-06/08-07):**

1. **A escolha de qualidade tem efeito observável.** Ninguém viu 720p30 nem
   1080p15 saindo do encoder. O que está provado é que os presets existem, que
   `screenShareEncoding` é o campo certo do `TrackPublishDefaults`, e que o
   valor chega ao bundle. Se o SFU/encoder ignorar o encoding por qualquer razão
   (limite de banda do publisher, degradação automática, simulcast de
   screenshare), o sintoma é **silencioso**: publica igual, na qualidade errada.
   Verificação sugerida: compartilhar em "Nítida", abrir texto pequeno na tela
   compartilhada, conferir legibilidade do outro lado; depois "Fluida" com vídeo
   em movimento e conferir fluidez. Comparativo, não absoluto.
2. **A preferência sobrevive a fechar e reabrir o app.** Os testes provam o
   contrato do módulo com `localStorage` simulado. Não provam que o
   `localStorage` do renderer do Electron persiste entre execuções no perfil
   real do usuário (persiste, por design, mas ninguém observou aqui).
3. **Trocar a qualidade no meio de um compartilhamento não interrompe nada.**
   Por leitura, é impossível interromper: o handler não toca no `Room`. Por
   observação, ninguém confirmou que a imagem do outro lado não pisca.
4. **`voiceStates.sharing` de fato vira `true` no Convex.** O caminho
   `LocalTrackPublished` → `setSharing` nunca rodou contra um deployment real.
   Verificação: compartilhar e olhar a linha em `voiceStates` no dashboard do
   Convex (o indicador visível a outros é o Plano 08-06, que ainda não existe).
5. **`sharing` volta a `false` ao parar pelo botão** — e, principalmente, quando
   o **Windows** encerra a captura (botão "Parar compartilhamento" da barra
   nativa do Chromium/Electron). Pelo código do SDK, `TrackEvent.Ended` faz o
   `unpublishTrack` sozinho para `Track.Source.ScreenShare`, o que aciona nosso
   listener; observação real, nenhuma.
6. **Sair do canal compartilhando não polui o console.** A guarda por
   `activeChannelRef` depende de uma ordem de execução (`activeChannelRef = null`
   → `leaveVoiceChannel` → `room.disconnect()` → `LocalTrackUnpublished`) lida no
   código, não cronometrada. Se aparecer `[screenshare] setSharing(false) falhou`
   ao sair do canal, a guarda não pegou o caso — é log, não defeito, mas vale
   capturar.
7. **Fechar o app compartilhando (Alt+F4 / crash).** Aqui o cliente
   deliberadamente não faz nada: a limpeza é do webhook `track_unpublished`
   (08-01), que **nunca foi visto chegando do LiveKit real** — é o item nº1 da
   lista de pendências daquele plano, e continua aberto. Este plano é quem passa
   a gerar o `sharing: true` que aquela reconciliação existe para desfazer, então
   os dois só podem ser verificados juntos.
8. **O toggle é encontrável.** Ver o desvio nº1: o controle está dentro do
   popover da engrenagem. Se na prática ninguém achar, é ajuste de UI barato.

## User Setup Required

Nenhum. Sem dependência nova, sem variável de ambiente, sem configuração de
serviço externo. O campo `sharing` já existe no schema desde 07-01 e a mutation
desde 08-01 — nenhuma migração.

## Next Phase Readiness

- **08-06 (indicador de quem está compartilhando)** está desbloqueado no sentido
  que importa: `voiceStates.sharing` agora tem quem o escreva, e
  `voiceParticipantsByChannel`/`ByServer` (07-04) já devolvem o campo no payload
  enriquecido — nenhuma query nova é necessária.
- **A reconciliação de 08-01 passa a ter o que reconciliar.** Antes deste plano,
  `sharing` era sempre `false` e o `case track_unpublished` do webhook era
  código morto por falta de produtor.
- **08-03 continua sendo o pré-requisito de verdade da fase** — nada aqui
  substitui a prova de áudio sem eco.

---
*Phase: 08-compartilhamento-de-tela*
*Completed: 2026-08-19*
