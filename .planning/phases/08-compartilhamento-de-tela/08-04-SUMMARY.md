---
phase: 08-compartilhamento-de-tela
plan: 04
subsystem: media
tags: [electron, desktop-capturer, ipc, picker, react, pitfall-2, screenshare]

# Dependency graph
requires:
  - phase: 08-02
    provides: "src/main/screenshare.ts (registerScreenShareHandler, único setDisplayMediaRequestHandler do app), src/main/screenshare.test.ts (6 testes de contrato), useVoice().startScreenShare/stopScreenShare e o botão no VoiceControlBar"
  - phase: 03-shell-da-ui
    provides: "componente ui/dialog (Radix) e o padrão de diálogo controlado já usado em CreateChannelDialog/InviteDialog"
provides:
  - "Seleção explícita de fonte pelo usuário: telas E janelas, com miniatura real (320x180) e ícone do app"
  - "src/main/screenshare-types.ts: SCREENSHARE_CHANNELS, ScreenShareSource, THUMBNAIL_SIZE, PICKER_TIMEOUT_MS — fonte única dos três lados (main, preload, renderer)"
  - "window.screenshare no preload (onPickRequested/chooseSource/cancelPicker), sem expor ipcRenderer cru"
  - "src/renderer/src/components/shell/ScreenSharePicker.tsx, montado uma vez em AppShell"
  - "Cancelamento (botão, Esc, clique fora, X) e timeout de 60s como caminhos que SEMPRE terminam em callback({}) no processo main"
affects: ["08-05 (qualidade de captura: entra pelo 3º argumento de setScreenShareEnabled, não por aqui)", "08-06/08-07 (verificação humana em Windows: multi-monitor, cancelamento real, tentativas sucessivas)"]

tech-stack:
  added: []
  patterns:
    - "Nomes de canal de IPC como fonte ÚNICA num arquivo sem imports (src/main/screenshare-types.ts), importado por main e preload — divergência entre os dois lados não gera erro, gera travamento silencioso"
    - "NativeImage nunca atravessa IPC: thumbnail/appIcon viram data URL no processo main antes do send"
    - "Diálogo Radix controlado onde onOpenChange(false) é o ÚNICO caminho de desistência (cobre Esc, clique fora e X de uma vez), e fechar por sucesso muda a prop `open` sem passar por ele"
    - "Espera pela decisão do usuário no processo main com timeout, resolução idempotente e cancelamento do pedido anterior — nunca dois pendentes"

key-files:
  created:
    - src/main/screenshare-types.ts
    - src/renderer/src/components/shell/ScreenSharePicker.tsx
  modified:
    - src/main/screenshare.ts
    - src/main/screenshare.test.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/preload/index.d.ts
    - src/renderer/src/components/shell/AppShell.tsx

key-decisions:
  - "registerScreenShareHandler passou a receber um GETTER de janela (() => BrowserWindow | null), não a janela. O registro acontece dentro de app.whenReady() e ANTES de createWindow() (session.defaultSession só existe depois do ready), então a janela não existe no momento do registro — e volta a ser null se a janela for fechada. Resolver no momento do pedido é a única forma correta."
  - "Canais de IPC importados de um módulo compartilhado, contrariando o padrão de AUTH_CHANNELS/VOICE_CHANNELS (que são duplicados como literal no preload). O motivo é específico desta superfície: um nome divergente aqui não gera erro nenhum — gera um send que cai no vazio e uma captura que só destrava no timeout de 60s. É exatamente o Pitfall 2 com um disfarce novo."
  - "ScreenShareSource é definida uma vez em src/main/screenshare-types.ts e exposta ao renderer como alias GLOBAL em src/preload/index.d.ts (que está no include das duas tsconfigs). O renderer não importa de src/main (fronteira documentada em useAuth.ts), mas também não ganha uma segunda cópia da interface para sair de sincronia."
  - "Timeout de 60s é a ÚLTIMA linha de defesa, não a primeira. A UI cobre desistência por 4 caminhos; o timeout existe para renderer travado, recarregado (F5/HMR) ou nunca montado — cenários em que nenhum evento chegaria."
  - "Id desconhecido em choose-source é tratado como cancelamento (callback({})), não como erro ignorado: ignorar deixaria a Promise pendurada, que é o defeito que a fase inteira tenta evitar."
  - "Nenhuma chamada a callback mora dentro de um try (decisão herdada do 08-02 e mantida sob mais caminhos): cada try envolve só o await que pode lançar. Custo: cinco callback({}) literais. Ganho: callback duplo é estruturalmente impossível."
  - "voice-context.tsx NÃO foi modificado, apesar de constar em files_modified do plano. O seletor é autocontido entre processo main e um componente próprio; startScreenShare() já trata a rejeição de getDisplayMedia como caminho esperado desde 08-02."

patterns-established:
  - "Verificação por mutação: quebrar de propósito o listener de cancelamento e confirmar que 4 testes falham por TIMEOUT (não por asserção) — a falha do teste tem a mesma forma do defeito real (Promise que nunca resolve), o que prova que a rede de segurança não é vácua"

duration: ~30min
completed: 2026-08-19
---

# Fase 8 Plano 04: Seletor customizado de tela — Summary

**O `sources[0]` do Plano 08-02 virou uma ida e volta ao renderer: o processo main enumera telas E janelas com miniaturas reais, manda a lista serializada em data URL e espera a decisão do usuário — com cinco camadas de defesa para que "o usuário fechou o diálogo sem escolher" termine em `callback({})` em vez de pendurar para sempre o `getDisplayMedia()` do renderer.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2/2
- **Files:** 2 criados, 6 modificados
- **Testes:** 195 → 209 (os 14 novos são todos de `src/main/screenshare.test.ts`, que foi de 6 para 20)

## Task Commits

1. **Task 1 — handler do main aguarda a escolha, com timeout defensivo** — `9a446a1` (feat)
2. **Task 2 — ScreenSharePicker, diálogo de miniaturas** — `bec3022` (feat)

## Accomplishments

### Task 1 — processo main (`9a446a1`)

`desktopCapturer.getSources` voltou a pedir o que o Plano 08-02 tinha desligado de
propósito:

| Argumento | 08-02 | 08-04 | Por quê |
|---|---|---|---|
| `types` | `['screen']` | `['screen', 'window']` | Sem `window` o usuário só compartilha tela inteira |
| `thumbnailSize` | `{ 0, 0 }` | `{ 320, 180 }` | Sem bitmap o seletor mostra cards vazios |
| `fetchWindowIcons` | ausente | `true` | Ícone do app ao lado do título da janela |

A lista atravessa o IPC **serializada**: `thumbnail`/`appIcon` são `NativeImage`, que não
sobrevive à clonagem estruturada do IPC do Electron — chegaria como `{}` do outro lado,
sem erro nenhum. `toDataURL()` roda no main, e o renderer só vê string.

O ponto duro do plano — **`callback` em 100% dos caminhos, agora que existe um caminho em
que ninguém responde nunca** — foi implementado em camadas:

| Camada | Caminho coberto | Termina em |
|---|---|---|
| 1 | `getSources()` rejeita | `callback({})` |
| 2 | Lista vazia (sem depender do renderer) | `callback({})` |
| 3 | Sem janela / janela destruída | `callback({})` |
| 4 | Falha ao serializar ou enviar a lista | `callback({})` |
| 5 | Usuário cancela (`cancel-picker`) | `callback({})` |
| 6 | Id escolhido não existe na lista, ou não é string | `callback({})` |
| 7 | Ninguém responde em 60s (`PICKER_TIMEOUT_MS`) | `callback({})` |
| 8 | Um pedido novo chega com um anterior pendente | o anterior → `callback({})` |
| 9 | Escolha válida | `callback({ video, audio: 'loopback' })` |

Duas propriedades sustentam a tabela:

- **`settlePending` limpa `pending` ANTES de resolver.** Cancelar depois de escolher, dois
  cliques, um timeout correndo contra o clique — tudo vira no-op. Resolução única por
  construção, não por sorte de timing.
- **Nenhuma chamada a `callback` mora dentro de um `try`.** Cada `try` envolve só o `await`
  que pode lançar (decisão herdada do 08-02, mantida sob mais caminhos). Custo: cinco
  `callback({})` literais. Ganho: `callback` duplo é estruturalmente impossível.

Os dois `ipcMain.on` são registrados **uma vez**, fora do handler de captura — dentro dele
empilhariam um par novo a cada pedido, e dois listeners resolveriam a mesma escolha. A
guarda de registro único de 08-02 agora protege os três registros juntos.

### Task 2 — renderer (`bec3022`)

`ScreenSharePicker.tsx`: `Dialog` do shadcn/Radix já instalado, grid de cards com a
miniatura, seções separadas "Telas" e "Janelas" (seção vazia não é renderizada), ícone do
app quando existe, título truncado com `title` no hover — título de janela é texto
arbitrário e longo (caminho de arquivo, título de aba).

**A regra que governa o componente:** enquanto o diálogo está aberto, o processo main está
segurando o `callback`. Então existe **um único caminho de desistência**, `cancel()`,
ligado ao `onOpenChange` do Radix — que cobre **Esc, clique fora e o X do canto de uma vez
só**, além do botão "Cancelar" explícito (redundante de propósito: é o caminho descoberto
sem tentativa e erro). O plano previa documentar como lacuna o caso de o `Dialog` não
expor esses caminhos; **não é lacuna** — o `DialogPrimitive.Close`, o `Esc` e o clique no
overlay do Radix passam todos por `onOpenChange(false)`.

Escolher fecha o diálogo mudando a prop `open` (`setSources(null)`), que **não** dispara
`onOpenChange` — então escolher nunca manda também um `cancelPicker`. E o IPC é sempre
enviado **antes** do `setState`: destravar o processo main é o que não pode falhar; fechar
o diálogo é cosmético em comparação.

Montado uma única vez em `AppShell`, dentro do `VoiceProvider` (sem consumir o contexto de
voz): quem dispara o seletor é o processo main, que não sabe nem precisa saber qual canal
está ativo.

## Verificação — saída real

Ambiente: **WSL2, sem Windows, sem tela, sem áudio e sem janela do Electron renderizada.**

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
```

Exit 0, nenhum erro nos três projetos.

### `npx vitest run`

```
 ✓ convex/dms.test.ts  (15 tests) 84ms
 ✓ convex/messages.test.ts  (10 tests) 86ms
 ✓ convex/invites.test.ts  (13 tests) 90ms
 ✓ convex/friends.test.ts  (24 tests) 111ms
 ✓ convex/voice.test.ts  (57 tests) 243ms
 ✓ convex/channels.test.ts  (10 tests) 75ms
 ✓ convex/channelReadState.test.ts  (7 tests) 50ms
 ✓ convex/members.test.ts  (9 tests) 39ms
 ✓ convex/typing.test.ts  (8 tests) 53ms
 ✓ convex/servers.test.ts  (9 tests) 48ms
 ✓ convex/lib/inviteCode.test.ts  (6 tests) 35ms
 ✓ convex/lib/tag.test.ts  (5 tests) 19ms
 ✓ convex/users.test.ts  (7 tests) 42ms
 ✓ convex/presence.test.ts  (3 tests) 32ms
 ✓ src/renderer/src/lib/user-tag.test.ts  (6 tests) 3ms
 ✓ src/main/screenshare.test.ts  (20 tests) 599ms

 Test Files  16 passed (16)
      Tests  209 passed (209)
```

Baseline era 16 arquivos / 195 testes. Os 14 novos são todos de
`src/main/screenshare.test.ts` (6 → 20); nenhum arquivo de teste existente foi alterado.

### Verificação por MUTAÇÃO — a rede de segurança não é vácua

Um teste que passa não prova que ele detectaria a falha. Como o defeito temido aqui é
"o handler esquece de resolver", o listener de cancelamento foi quebrado de propósito
(corpo esvaziado), a suíte rodou, e o arquivo foi restaurado:

```
 ❯ ... > envio da lista ao renderer > serializa thumbnail e ícone como data URL...
   → Test timed out in 5000ms.
 ❯ ... > resposta do usuário > chama callback({}) exatamente uma vez quando o usuário cancela
   → Test timed out in 5000ms.
 ❯ ... > tentativas sucessivas (base de SHARE-07) > a tentativa seguinte a um cancelamento funciona normalmente
   → Test timed out in 5000ms.

 Test Files  1 failed (1)
      Tests  4 failed | 16 passed (20)
```

O detalhe que importa: as falhas são por **timeout**, não por asserção. A forma da falha
do teste é a mesma forma do defeito real — uma Promise que nunca resolve. Depois da
restauração, 20/20 verdes de novo.

### Verificações do `<verification>` do plano

```
$ grep -rn "sources\[0\]" src/main/screenshare.ts
(nenhuma saída, exit 1)
```

Escolha automática removida — confirmado.

```
$ npx eslint src/main/screenshare.ts src/main/screenshare-types.ts \
    src/main/screenshare.test.ts src/preload/index.ts src/preload/index.d.ts \
    src/main/index.ts src/renderer/src/components/shell/ScreenSharePicker.tsx \
    src/renderer/src/components/shell/AppShell.tsx
(nenhuma saída — zero achados, nem pré-existentes)
```

### `npx electron-vite build` + os canais nos dois bundles

```
out/preload/index.js  3.76 kB
✓ built in 14ms
../../out/renderer/assets/index--UyIeuUY.js   2,382.22 kB
✓ built in 2.58s

$ grep -o "screenshare:[a-z-]*" out/preload/index.js | sort -u
screenshare:cancel-picker
screenshare:choose-source
screenshare:pick-requested

$ grep -o "screenshare:[a-z-]*" out/main/index.js | sort -u
screenshare:cancel-picker
screenshare:choose-source
screenshare:pick-requested
```

Isto responde à lição nº1 do HANDOFF (verificar no ambiente errado não é verificar): o
módulo compartilhado de canais é uma aposta de **bundler**, não de tipo, e a prova é o
bundle real dos dois processos contendo as mesmas três strings. Não prova que a mensagem
trafega — prova que os dois lados falam o mesmo nome.

## Revisão manual exigida pelo plano

"Todo caminho termina em exatamente uma chamada a `callback`" — as 9 linhas da tabela
acima foram percorridas por leitura **e** cada uma tem teste correspondente. `callback(`
aparece 6 vezes em `src/main/screenshare.ts`, todas em caminhos mutuamente exclusivos
terminados por `return` (ou última instrução), nenhuma dentro de um `try`.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — Blocking] `registerScreenShareHandler` não tinha acesso à janela**

- **Encontrado em:** Task 1
- **Problema:** o plano manda `mainWindow.webContents.send(...)` de dentro do handler, mas
  `registerScreenShareHandler()` é chamada em `src/main/index.ts` **antes** de
  `createWindow()` — obrigatoriamente, porque `session.defaultSession` só existe depois de
  `app.whenReady()`. Capturar `mainWindow` no registro capturaria `null` para sempre, e
  todo pedido de captura cairia no caminho "sem janela" → `callback({})`: o
  compartilhamento simplesmente nunca funcionaria, sem erro visível.
- **Correção:** assinatura passou a ser `registerScreenShareHandler(getMainWindow: () => BrowserWindow | null)`,
  resolvida no momento do pedido. `src/main/index.ts` passa `() => mainWindow` (a variável
  de módulo que já existia, e que volta a `null` quando a janela fecha).
- **Arquivos:** `src/main/screenshare.ts`, `src/main/index.ts`
- **Commit:** `9a446a1`

**2. [Rule 2 — lacuna crítica] Caminhos "sem janela" e "envio falhou" não estavam no plano**

- **Encontrado em:** Task 1
- **Problema:** o plano lista lista-vazia, escolha, cancelamento, timeout e exceção. Faltam
  dois caminhos que a implementação real cria: a janela não existir/estar destruída, e o
  `webContents.send` lançar (janela fechando no meio do pedido). Ambos terminariam em zero
  `callback` — o defeito exato do Pitfall 2.
- **Correção:** os dois viraram caminhos explícitos com `callback({})` e teste próprio.
- **Commit:** `9a446a1`

**3. [Rule 2 — lacuna crítica] Fonte única para os nomes de canal**

- **Encontrado em:** Task 1
- **Problema:** o plano manda escrever os nomes de canal como literais no preload (padrão
  de `AUTH_CHANNELS`/`VOICE_CHANNELS`). Nessas duas superfícies um typo é barulhento
  (login não acontece, PTT não responde). Aqui é silencioso e caro: o `send` do renderer
  cai no vazio, e a captura só destrava no timeout de 60s — com o usuário achando que o
  app travou.
- **Correção:** `src/main/screenshare-types.ts` (sem nenhum import, seguro de bundlar no
  preload) é a fonte única de `SCREENSHARE_CHANNELS`, `ScreenShareSource`, `THUMBNAIL_SIZE`
  e `PICKER_TIMEOUT_MS`. Provado nos dois bundles (acima).
- **Commit:** `9a446a1`

### Desvios menores, documentados

**4. `src/renderer/src/state/voice-context.tsx` não foi modificado** — consta em
`files_modified` do plano, mas nenhuma mudança se mostrou necessária: o seletor é
autocontido entre o processo main e o componente novo, e `startScreenShare()` já trata a
rejeição de `getDisplayMedia` (que é o que `callback({})` provoca) como caminho esperado
desde 08-02. Editar por editar seria pior.

**5. A "lacuna" prevista pelo plano no `Dialog` não existe** — o plano manda documentar se
o `Dialog` do shadcn não expusesse Esc/clique fora via `onOpenChange`. Ele expõe: Radix
roteia `Escape`, clique no overlay e `DialogPrimitive.Close` (o X) todos por
`onOpenChange(false)`. Os quatro caminhos de desistência convergem em `cancel()`.

**6. `ScreenShareSource` mora em `src/main/screenshare-types.ts`, não em `index.d.ts`** — o
plano manda defini-la em `index.d.ts` "exportada para o componente importar". Importar de
`src/preload/index.d.ts` no renderer não resolve (o TS acha `src/preload/index.ts`
primeiro, que importa `electron`). A definição ficou no módulo compartilhado e
`index.d.ts` a expõe como **alias global** — o componente usa `ScreenShareSource` sem
import, com uma única definição no repositório.

**Total:** 3 auto-fixed (1× Rule 3, 2× Rule 2) + 3 desvios menores documentados. Nenhuma
mudança arquitetural, nenhuma dependência nova (`package.json` intocado).

## Suposição sobre o Plano 08-03 (checkpoint humano NÃO executado)

O plano 08-04 declara `depends_on: ["08-02", "08-03"]`, e **08-03 não foi executado** —
depende de Windows nativo com 3+ máquinas e continua na fila do usuário. Por decisão
explícita dele, este plano seguiu assim.

**A suposição assumida, dita com todas as letras:** este plano assume que o caminho de
mídia por baixo (captura + áudio de sistema sem eco) funciona, **e não gera nenhuma
evidência a favor nem contra isso.** O que 08-04 mexe é *qual fonte* é concedida e *quando*
o `callback` acontece — não *como* a mídia é publicada. `restrictOwnAudio`,
`setScreenShareEnabled` e `SCREEN_SHARE_CAPTURE_OPTIONS` não foram tocados.

**Se 08-03 revelar eco**, a correção continua sendo a de 08-02 (plano B do Pitfall 1:
mixagem manual ou limitação documentada) e **não invalida nada deste plano** — o seletor
segue válido, porque o que ele entrega é a fonte, não a mistura de áudio. O único cenário
em que este plano precisaria voltar é o áudio de sistema não funcionar para captura de
*janela* (o `types: ['window']` é novidade daqui); `audio: 'loopback'` é do dispositivo de
saída, não da fonte de vídeo, então não há razão para diferir — mas isso é raciocínio,
não observação.

## O que este ambiente NÃO consegue provar

WSL2 não tem Windows, não tem tela, não tem áudio e não renderiza a janela do Electron.
`desktopCapturer` real nunca rodou aqui, o diálogo nunca foi pintado, e nenhuma miniatura
foi gerada. O que existe é typecheck limpo, build limpo, 20 testes de contrato com
`electron` mockado, uma verificação por mutação, e revisão por leitura.

**Fica inteiramente para Windows nativo (08-06/08-07):**

1. **As miniaturas aparecem e são reconhecíveis.** `thumbnail.toDataURL()` nunca rodou
   sobre um `NativeImage` real. Se vier vazio ou preto (acontece com janelas minimizadas e
   com apps que bloqueiam captura), o seletor mostra cards em branco — o app funciona, mas
   a escolha fica às cegas. Nenhum teste aqui pode pegar isso.
2. **Cancelar não trava a próxima tentativa (SHARE-07, o motivo do plano).** Os testes
   provam o contrato do handler do processo main. Eles **não** provam o comportamento do
   `getDisplayMedia` do Chromium do outro lado dele. Roteiro: abrir o seletor e cancelar
   pelos 4 caminhos (botão, Esc, clique fora, X), e depois de **cada um** compartilhar de
   verdade. Se algum travar, o sintoma é o botão preso carregando.
3. **Multi-monitor.** O ganho central sobre o 08-02 (que pegava sempre a primeira tela) só
   é observável com dois monitores: as duas telas precisam aparecer, distinguíveis, e a
   escolhida ser a transmitida.
4. **Compartilhar JANELA, não tela.** `types: ['window']` é novo. Falta confirmar que a
   janela escolhida é a capturada, que janela minimizada se comporta de forma aceitável, e
   que o áudio de sistema (`loopback`) continua saindo nesse modo.
5. **Quantidade de janelas.** `getSources` com `['screen','window']` numa máquina real
   devolve dezenas de itens, incluindo a própria janela do janja. O grid nunca foi
   renderizado com mais de 2 fontes; se ficar impraticável, o ajuste é de UI (filtro,
   busca) — não do contrato do main.
6. **Latência de `getSources`.** Com `fetchWindowIcons: true` e miniaturas de todas as
   janelas, a enumeração custa. Entre o clique e o diálogo há uma janela de tempo não
   medida, em que a UI não dá nenhum feedback.
7. **O timeout de 60s nunca disparou de verdade.** Só sob fake timers.
8. **`ScreenSharePicker` só existe depois do login** (fica dentro do `AuthGate`). Hoje
   nada dispara captura fora dali, e se disparasse o timeout do main resolveria em 60s —
   mas isso não foi exercitado.

## User Setup Required

Nenhum. Sem dependência nova, sem variável de ambiente, sem configuração de serviço
externo.

## Next Phase Readiness

- **08-05 (qualidade da captura)** não conflita: entra pelo terceiro argumento de
  `setScreenShareEnabled` em `voice-context.tsx`, arquivo que este plano não tocou.
- **08-06/08-07 (verificação humana)** ganham os 8 itens acima, além dos que 08-02 e 08-01
  já deixaram.
- **Se o seletor precisar de busca/filtro** (item 5), é mudança local em
  `ScreenSharePicker.tsx` — o contrato de IPC já entrega a lista inteira.

---
*Phase: 08-compartilhamento-de-tela*
*Completed: 2026-08-19*
