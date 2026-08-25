---
phase: 08-compartilhamento-de-tela
plan: FIX-eco-audio-sistema
subsystem: screenshare
tags: [pitfall-1, eco, loopback, wasapi, restrictOwnAudio, getDisplayMedia, diagnostico]

requires:
  - phase: 08-02
    provides: o handler de setDisplayMediaRequestHandler e as constraints de captura no renderer — os dois lados que decidiam sobre audio sem conversar
  - phase: 08-04
    provides: o seletor proprio e o IPC de escolha de fonte, que virou o transporte da decisao sobre o audio
  - phase: 08-05
    provides: screenshare-preferences.ts, o modulo de preferencia de maquina que foi estendido em vez de duplicado
provides:
  - "Audio de sistema como escolha explicita no seletor, DESLIGADA por padrao"
  - "Concessao de loopback condicionada a request.audioRequested E choice.systemAudio — eco zero por construcao quando desligado"
  - "src/renderer/src/lib/screenshare-diagnostics.ts: 4 linhas + VEREDITO no console, que fecham a causa raiz do Pitfall 1"
  - "ScreenShareChoice / ScreenSharePickRequest: o contrato de IPC que carrega a decisao junto da fonte"
affects:
  - 09-polimento-e-empacotamento

tech-stack:
  added: []
  patterns:
    - "PEDIR nao e CONCEDER: quando duas camadas podem decidir sobre um recurso de midia, a concessao e a unica que cria a captura — a defesa tem que morar la, e a outra ponta e defesa em profundidade, nao a defesa"
    - "Constraint fora do padrao e ignorada em silencio pelo Chromium: antes de construir uma fase sobre uma flag, instrumentar getSupportedConstraints() + getConstraints()/getSettings() da track publicada"
    - "Instrumentacao temporaria por operacao (envolve, usa, restaura no finally) em vez de monkey-patch permanente"

key-files:
  created:
    - src/renderer/src/lib/screenshare-diagnostics.ts
    - src/renderer/src/lib/screenshare-diagnostics.test.ts
    - src/renderer/src/components/shell/ScreenSharePicker.test.tsx
  modified:
    - src/main/screenshare.ts
    - src/main/screenshare-types.ts
    - src/main/screenshare.test.ts
    - src/preload/index.ts
    - src/preload/index.d.ts
    - src/renderer/src/components/shell/ScreenSharePicker.tsx
    - src/renderer/src/lib/screenshare-preferences.ts
    - src/renderer/src/lib/screenshare-preferences.test.ts
    - src/renderer/src/state/voice-context.tsx

key-decisions:
  - "A correcao real nao e uma constraint melhor: e nao abrir a captura. O handler do main so concede `audio: 'loopback'` quando request.audioRequested E choice.systemAudio; caso contrario `callback({ video })`. Sem concessao nao existe track de audio para ecoar, independente de o Chromium honrar constraint nenhuma."
  - "Default DESLIGADO. Tela muda e aborrecimento; call inutilizada por eco e defeito. Inverter e uma linha em DEFAULT_SCREEN_SHARE_PREFERENCES quando o diagnostico provar restrictOwnAudio."
  - "O renderer TAMBEM para de pedir (`audio: false`) quando a preferencia esta desligada, em vez de pedir sempre e deixar so o main decidir. Motivo: o caminho default tem que ser o mais banal possivel — `getDisplayMedia({video, audio:false})` + `callback({video})` e conhecido e seguro; 'pede audio e recebe so video' eu nao consigo testar em WSL2, e se rejeitasse quebraria o compartilhamento no caminho PADRAO."
  - "Consequencia aceita dessa escolha: ligar o toggle DENTRO do dialogo vale a partir do proximo compartilhamento (a constraint da chamada atual ja foi fechada). O main envia `audioAvailable` na ida justamente para o dialogo dizer isso na tela em vez de o som simplesmente nao sair. Desligar, ao contrario, vale IMEDIATAMENTE — a direcao segura nunca espera."
  - "restrictOwnAudio: true CONTINUA sendo passada quando o audio esta ligado. Deixou de ser a defesa e virou bonus: se funcionar em alguma configuracao, o beneficio e de graca."
  - "systemAudio malformado no IPC degrada para 'sem som', nunca para 'cancelou o compartilhamento' e nunca para 'ligou o loopback'. Mesma regra do sanitize de preferencias: so um `true` literal liga."
  - "O diagnostico envolve navigator.mediaDevices.getDisplayMedia por UMA captura e restaura no finally. E a unica forma de responder 'quantas tracks de audio vieram': o livekit-client fica com getAudioTracks()[0] e descarta o resto sem dizer nada (createScreenTracks, livekit-client.esm.mjs:29010)."

duration: ~50min
completed: 2026-08-25
---

# Fase 8 FIX: eco do audio da call no compartilhamento de tela

**O Pitfall 1 se confirmando em uso real (2026-08-20, 4 pessoas numa call): quem
compartilhava tela com audio fazia as outras 3 se ouvirem.** O criterio de sucesso
n2 da Fase 8 estava quebrado.

## A causa raiz, e por que ela nao estava onde parecia

A Fase 8 foi construida sobre uma premissa: `restrictOwnAudio: true` nas constraints
de `getDisplayMedia()` impede o loopback do WASAPI de capturar o audio que o proprio
app esta tocando. Estava verificado que a flag CHEGA (o `livekit-client` repassa
`options.audio` sem filtrar) e que o Electron e o 43.4.0 (a versao que a pesquisa
apontou como a que parou de descartar a flag). E o eco aconteceu assim mesmo.

O erro nao foi a flag. Foi ter tratado uma constraint como se fosse uma defesa,
quando ela e no maximo um pedido. **A captura de loopback nasce na CONCESSAO, nao no
pedido** — e a concessao era incondicional:

```
callback({ video: chosen, audio: 'loopback' })   // sempre, em 100% das escolhas
```

Enquanto essa linha existisse, o renderer nao tinha como desligar o audio de sistema
de verdade: no maximo pedia gentilmente que o Chromium filtrasse depois. A correcao e
um E logico explicito, com o lado restritivo sempre vencendo:

```
loopback concedido  <=>  request.audioRequested  E  choice.systemAudio
```

Com `systemAudio: false`, `getDisplayMedia` recebe `audio: false`, o handler devolve
`callback({ video })`, e **nao existe track de audio nenhuma na captura**. Eco zero
por construcao — sem depender de o Chromium honrar constraint alguma.

## O diagnostico (o que fecha a causa raiz de verdade)

Uma constraint fora do padrao que o Chromium nao reconhece e ignorada **em silencio**:
nenhum erro, nenhum aviso, a Promise resolve normalmente e a captura vem sem o filtro.
Olhando o codigo e impossivel distinguir "aplicada e insuficiente" de "descartada" —
as duas produzem exatamente o mesmo eco. So perguntando ao navegador.

`src/renderer/src/lib/screenshare-diagnostics.ts` imprime, a cada inicio de
compartilhamento, sem o usuario fazer nada alem de compartilhar:

| Linha | Responde |
|---|---|
| `1/4` | `getSupportedConstraints().restrictOwnAudio` + versao do Electron + se o audio esta ligado |
| `2/4` | as constraints realmente passadas ao `getDisplayMedia` |
| `3/4` | quantas tracks de video e de audio vieram, com `settings`/`constraints` de cada |
| `4/4` | `settings`/`constraints` da track de audio **de fato publicada** |
| `VEREDITO` | a conclusao por extenso: premissa falsa / se perdeu no caminho / aplicada e insuficiente |

**O que procurar no console (DevTools do app):** a palavra **`diagnóstico`**.

Se a linha `1/4` disser `false`, a premissa da Fase 8 era falsa e o eco era esperado.
Se disser `true` e o `VEREDITO` disser `INSUFICIENTE`, a flag esta sendo aplicada e
nao basta para loopback de dispositivo — e ai vale o plano B do Pitfall 1 (silenciar
a reproducao local do LiveKit e mixar as tracks a mao).

Contrato do instrumento: envolve `getDisplayMedia` por UMA captura, restaura no
`finally`, nunca engole rejeicao (cancelar precisa continuar rejeitando), nunca troca
o valor de retorno, e nenhuma funcao lanca. Um diagnostico que derruba o
compartilhamento que veio diagnosticar seria pior que a doenca — ha teste para cada
uma dessas promessas.

## A mitigacao: audio de sistema virou escolha

Toggle **"Compartilhar audio do sistema"** no `ScreenSharePicker`, persistido em
`screenshare-preferences.ts` (o modulo existente foi estendido, nao duplicado), junto
da preferencia de qualidade. **Padrao: DESLIGADO.**

O aviso embaixo do toggle nao e disclaimer defensivo — e o defeito que 4 pessoas
viveram, escrito em portugues de gente:

> O Windows captura tudo que sai pela saida de audio — inclusive a voz das outras
> pessoas da call, que o app esta tocando ai. Com isso ligado, elas vao se ouvir de
> volta. Fone de ouvido nao resolve.

E, quando o toggle e ligado com a captura ja aberta sem audio:

> Esta transmissao ja comecou sem audio. A escolha ficou salva e vale a partir do
> proximo compartilhamento.

Esse aviso existe por causa de uma ordem que nao da para mudar: a constraint do
`getDisplayMedia()` e fixada ANTES de o dialogo abrir. O main manda `audioAvailable`
na ida justamente para o dialogo poder ser honesto em vez de o som simplesmente nao
sair e ninguem entender por que. **Desligar vale imediatamente** — a direcao segura
nunca espera pela proxima vez.

## Verificacao — saida real

Baseline medida antes de qualquer edicao: **typecheck limpo nos tres projetos,
34 arquivos / 544 testes**.

```
$ npm run typecheck    (baseline) -> exit 0 (node, web, convex)
$ npx vitest run       (baseline) -> Test Files 34 passed (34) | Tests 544 passed (544)

$ npm run typecheck    (final)    -> exit 0 (node, web, convex)
$ npx vitest run       (final)    -> Test Files 36 passed (36) | Tests 588 passed (588)
$ npm run build        (final)    -> BUILD_EXIT=0, 2062 modules transformed
```

**+2 arquivos, +44 testes**, nenhum teste existente quebrado.

- `src/main/screenshare.test.ts`: 20 -> 27 (o caminho novo com/sem audio, cada um
  cobrando exatamente 1 `callback` — Pitfall 2 continua valendo nos 11 caminhos)
- `screenshare-preferences.test.ts`: 14 -> 20 (inclui o merge entre os dois campos,
  que o comentario do modulo prometia e nunca tinha sido exercido)
- `ScreenSharePicker.test.tsx`: **12, arquivo novo**
- `screenshare-diagnostics.test.ts`: **19, arquivo novo**

**ESLint:** os 9 arquivos tocados retornam 0 problemas, exceto `voice-context.tsx`,
que mantem o **1 erro pre-existente** de `react-refresh/only-export-components`
(o export de `useVoice`) — mesmo erro, mesma causa, so a linha mudou (1340 -> 1388).
Confirmado por `git stash` + eslint no HEAD.

**Prettier:** todos os arquivos tocados passam.

### Um defeito encontrado pelos proprios testes

`isRestrictOwnAudioSupported()` usava optional chaining ate um `{}`, entao um ambiente
sem `navigator.mediaDevices` era reportado como **`false`** ("a constraint nao e
suportada") em vez de **`'indisponível'`** ("nao deu para perguntar"). O VEREDITO
acusaria a flag pelo motivo errado — exatamente o tipo de conclusao falsa que este
modulo existe para impedir. Corrigido com checagem explicita antes da consulta.

## A prova do contrato de midia (MD5, nao leitura)

Mesmo metodo dos Planos 08.5-07 e 08.5-FIX-menu-na-faixa.

```
$ git diff --stat HEAD -- ScreenShareStage.tsx CallStage.tsx screenshare-tracks.ts
(vazio — nao tocados)

$ (bloco ScreenShareTile, antes de qualquer edicao vs. final)
$ diff tile-before.txt tile-after.txt   -> IDENTICO (56 linhas cada)
d9dba83e2134ad9cf9c1f7a1b07ba38e  tile-before.txt
d9dba83e2134ad9cf9c1f7a1b07ba38e  tile-after.txt
```

E **literalmente o mesmo numero** registrado no 08.5-07-SUMMARY e no
08.5-FIX-menu-na-faixa-SUMMARY, que por sua vez o provaram contra a Fase 8.

`voice-context.tsx` foi tocado (imports, opcoes de captura, `startScreenShare`), entao
o bloco do ciclo de vida de midia — os handlers de `RoomEvent` que amarram a remocao
do video ao React — foi provado separadamente:

```
$ git show HEAD:.../voice-context.tsx | sed -n '/A track de ÁUDIO do compartilhamento/,$p' > lifecycle-head.txt
$ sed -n '/A track de ÁUDIO do compartilhamento/,$p' .../voice-context.tsx          > lifecycle-now.txt
$ diff lifecycle-head.txt lifecycle-now.txt  -> IDENTICO (509 linhas cada)
45c81ca3558f4adbf60c61eabf8ce637  lifecycle-head.txt
45c81ca3558f4adbf60c61eabf8ce637  lifecycle-now.txt
```

Os 6 hunks do diff de `voice-context.tsx` terminam na linha 714; o bloco de ciclo de
vida comeca na 838.

## O QUE EU NAO PUDE VERIFICAR — e nao ha jeito de contornar

**Estou em WSL2: sem Windows, sem tela, sem placa de som, sem `desktopCapturer` real.
Eu nao ouvi eco nenhum, e nao poderia ter ouvido.** Nenhuma linha acima e evidencia de
que o eco acabou — sao evidencias de que o loopback nao e mais concedido e de que o
diagnostico vai imprimir a verdade quando alguem rodar isto numa maquina de verdade.

**So o Leo, no Windows, com 3+ pessoas na call, pode verificar:**

1. **Compartilhar com o audio DESLIGADO (padrao novo) e perguntar se alguem ouve eco.**
   E o teste que importa. A resposta esperada e "nenhum, e nao sai som da tela".
   Se ainda houver eco aqui, a causa nao e o screenshare — e outra coisa.
2. **Ler as 4 linhas de `diagnóstico` no console** (DevTools do app), especialmente a
   `1/4` e o `VEREDITO`. E o que decide se `restrictOwnAudio` algum dia foi aplicada
   nesta maquina, e portanto se o default pode ser invertido.
3. **Ligar o toggle e compartilhar de novo** (lembrando: ligar vale a partir do
   compartilhamento seguinte). Confirmar que o audio do sistema sai, que o video
   continua indo junto, e se as outras pessoas voltam a se ouvir.
4. **Que `callback({ video })` sem a chave `audio` de fato publica video normalmente**
   no Chromium do Electron 43.4.0. Os testes provam o que o handler manda, nao o que o
   Chromium faz com isso.
5. **Que compartilhar sem audio nao regride SHARE-07** (segunda tentativa na mesma
   sessao abre o seletor normalmente) — provado em teste, mas contra um
   `desktopCapturer` mockado.

## Proximo passo, dependente do item 2

Se o `VEREDITO` disser que `restrictOwnAudio` **e reconhecida e chegou a track
publicada** e mesmo assim houver eco: a flag e insuficiente para loopback de
dispositivo, e o caminho e o plano B do Pitfall 1 — silenciar a reproducao local do
LiveKit durante a captura e re-rotear a mixagem a mao.

Se disser que **nao e reconhecida**: a premissa da Fase 8 era falsa desde o inicio, o
default desligado e a mitigacao definitiva do MVP, e o `restrictOwnAudio` no codigo
passa a ser so uma aposta barata para uma versao futura do Electron.
