---
phase: 08-compartilhamento-de-tela
plan: 01
subsystem: voice
tags: [convex, livekit, webhooks, screen-share, protobuf, tdd]

# Dependency graph
requires:
  - phase: 07-01
    provides: "voiceStates (campo sharing já no schema, índices by_user/by_channel_and_user), requireOwnVoiceState, requireIdentity em lib/membership.ts"
  - phase: 07-02
    provides: "rota POST /livekit/webhook em convex/http.ts com switch de eventos, internalAction verifyLiveKitWebhook (runtime Node) e o utilitário de teste que assina o header Authorization do webhook"
provides:
  - "mutation voice.setSharing — escreve voiceStates.sharing da própria linha do usuário autenticado, base de SHARE-05"
  - "internalMutation voice.reconcileScreenShareStopped — zera sharing por webhook sem apagar a linha, base de SHARE-06"
  - "case track_unpublished no switch de convex/http.ts, filtrado por TrackSource.SCREEN_SHARE"
  - "verifyLiveKitWebhook passa a devolver trackSource (valor numérico do enum TrackSource)"
affects: ["08-02 (main process: quem para a captura de verdade)", "08-04/08-05 (UI que chama setSharing a partir do cliente)", "08-06 (verificação humana em Windows)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "convex/http.ts pode importar @livekit/protocol (enum TrackSource) mesmo sendo forçado ao runtime isolate — o veto de 07-02 é a livekit-server-sdk especificamente, por causa de node:crypto, não à família de pacotes do LiveKit"
    - "Reconciliação por webhook com dois formatos distintos por natureza do evento: delete da linha quando a PESSOA sai (reconcileParticipantLeft/RoomFinished), patch de campo quando só a TRACK sai (reconcileScreenShareStopped)"
    - "Enum do protocolo comparado pelo enum importado, nunca por string literal — o webhook serializa o NOME ('SCREEN_SHARE') e o WebhookReceiver decodifica para o NÚMERO (3); hardcodar qualquer um dos dois lados é bug silencioso"

key-files:
  created: []
  modified:
    - "convex/voice.ts"
    - "convex/voice.test.ts"
    - "convex/http.ts"
    - "convex/voiceToken.ts"

key-decisions:
  - "verifyLiveKitWebhook (convex/voiceToken.ts) precisou entrar no escopo, apesar de não estar em files_modified do plano. O plano assumia que convex/http.ts leria event.track?.source direto do payload; a implementação real de 07-02 não faz isso — http.ts nunca vê o WebhookEvent, porque a classe de protobuf não atravessa ctx.runAction. A action devolve um objeto simples, e o campo trackSource teve que ser acrescentado a esse objeto. Sem essa extensão o case novo é impossível de escrever. Ver 'Deviations from Plan'."
  - "trackSource atravessa runAction como number (o valor do enum, SCREEN_SHARE = 3), não como string. É o que WebhookReceiver.receive entrega depois de decodificar o JSON do webhook, verificado rodando a lib de verdade contra um payload assinado; converter para string dos dois lados só criaria uma segunda representação para errar."
  - "convex/http.ts importa TrackSource de @livekit/protocol, contrariando a leitura ingênua de 'http.ts não pode importar coisa do LiveKit'. A regra real de 07-02 é mais estreita: livekit-server-sdk arrasta crypto/digest.js (await import('node:crypto')), que o bundler isolate não resolve. @livekit/protocol depende só de @bufbuild/protobuf, e nenhum dos dois referencia builtin do Node (grep em node_modules dos dois). Confirmado localmente com esbuild --platform=browser: convex/http.ts bundla limpo em 83.3kb, enquanto um arquivo de controle importando livekit-server-sdk falha na mesma invocação. Ver 'Issues Encountered' para o limite dessa prova."
  - "setSharing reaproveita requireOwnVoiceState (o helper que setMuted/setDeafened já usavam) em vez de repetir a busca por by_user. Consequência: a mensagem de erro fora de canal é a que já existia ('Você não está em nenhum canal de voz'), não a string literal sugerida pelo plano ('Não é possível compartilhar tela fora de um canal de voz') — mesma semântica, um call-site só."
  - "reconcileScreenShareStopped faz patch, nunca delete. É a diferença de fundo entre este evento e os de 07-02: track_unpublished significa que a captura parou, não que a pessoa saiu — apagar a linha faria alguém sumir da lista de participantes de um canal de voz em que continua conectado."
  - "O teste 'evento desconhecido responde 200' de 07-02 usava track_unpublished como exemplo de evento fora do switch. A partir deste plano ele É tratado, e o teste deixaria de cobrir o que diz cobrir. Migrado para egress_started, que é evento real do LiveKit e continua fora do switch."

patterns-established:
  - "Filtro de evento de track provado dos dois lados: um teste confirma que SCREEN_SHARE age, e um test.each confirma que CAMERA/MICROPHONE/SCREEN_SHARE_AUDIO não agem. Sem o segundo, um catch-all de track_unpublished passaria no primeiro."
  - "Idempotência de reconciliação testada como propriedade explícita (chamar duas vezes; chamar sem linha correspondente), não como efeito colateral de um teste de caminho feliz — o LiveKit reenvia até receber 2xx."

# Metrics
duration: ~25min
completed: 2026-08-19
---

# Fase 8 Plano 01: Backend de compartilhamento e webhook — Summary

**`voiceStates.sharing` deixou de ser um campo sempre-`false` e passou a ter dono dos dois lados: `setSharing` para o cliente marcar, e um `case track_unpublished` no webhook do LiveKit — filtrado pelo enum `TrackSource.SCREEN_SHARE`, não por string — para o servidor desmarcar quando a captura morre sem o cliente avisar.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 6 (3 ciclos RED→GREEN) + 1 refactor
- **Files modified:** 4

## Accomplishments

- `voice.setSharing` (mutation autenticada): escreve `sharing` só na própria linha, resolvida por `by_user`. Nunca aceita `userId` do cliente, então nenhum membro pode marcar outro como compartilhando.
- `voice.reconcileScreenShareStopped` (internalMutation): `patch({ sharing: false })` por `by_channel_and_user`, idempotente, e comprovadamente sem apagar a linha — a pessoa continua na call.
- `case 'track_unpublished'` no mesmo switch, na mesma rota, com a mesma verificação de assinatura de 07-02. Nenhuma rota nova, nenhum segundo mecanismo de reconciliação.
- 16 testes novos em `convex/voice.test.ts` (41 → 57), incluindo a prova negativa de que câmera/microfone/`screen_share_audio` NÃO tocam em `sharing`.

## Task Commits

1. **RED — setSharing** — `442b34a` (test)
2. **GREEN — setSharing** — `e82de45` (feat)
3. **RED — reconcileScreenShareStopped** — `da33314` (test)
4. **GREEN — reconcileScreenShareStopped** — `7b9a12e` (feat)
5. **RED — roteamento de track_unpublished** — `4009a1f` (test)
6. **GREEN — case no switch de http.ts + trackSource na action** — `78b872b` (feat)
7. **REFACTOR — tipos de retorno nos helpers de teste novos** — `dd2da93` (refactor)

Commits de outro executor (Plano 08-02) estão intercalados no `git log` desta janela — este plano não tocou em nenhum arquivo de `src/`.

## Files Created/Modified

- `convex/voice.ts` — `setSharing` (mutation) e `reconcileScreenShareStopped` (internalMutation). Nenhuma function existente foi alterada.
- `convex/voice.test.ts` — 16 testes novos; `webhookBody` aceita `track`; o teste de "evento desconhecido" migrou de `track_unpublished` para `egress_started`.
- `convex/http.ts` — import de `TrackSource`, referência para a nova internalMutation, `case 'track_unpublished'`. Os três cases de 07-02 estão intactos.
- `convex/voiceToken.ts` — `verifyLiveKitWebhook` devolve `trackSource: number | null` além dos campos que já devolvia.

## Verificação — saída real

`npx vitest run` (suíte inteira, inclui os testes que o executor de 08-02 escreveu em paralelo):

```
 ✓ convex/messages.test.ts  (10 tests) 226ms
 ✓ convex/dms.test.ts  (15 tests) 234ms
 ✓ convex/invites.test.ts  (13 tests) 254ms
 ✓ convex/friends.test.ts  (24 tests) 285ms
 ✓ convex/voice.test.ts  (57 tests) 914ms
 ✓ convex/members.test.ts  (9 tests) 94ms
 ✓ convex/channels.test.ts  (10 tests) 212ms
 ✓ convex/typing.test.ts  (8 tests) 204ms
 ✓ convex/channelReadState.test.ts  (7 tests) 205ms
 ✓ convex/servers.test.ts  (9 tests) 184ms
 ✓ convex/lib/inviteCode.test.ts  (6 tests) 79ms
 ✓ convex/lib/tag.test.ts  (5 tests) 43ms
 ✓ convex/users.test.ts  (7 tests) 119ms
 ✓ convex/presence.test.ts  (3 tests) 92ms
 ✓ src/renderer/src/lib/user-tag.test.ts  (6 tests) 10ms
 ✓ src/main/screenshare.test.ts  (6 tests) 46ms

 Test Files  16 passed (16)
      Tests  195 passed (195)
```

`convex/voice.test.ts` saiu de 41 (baseline antes deste plano) para 57 testes. Nenhuma regressão em `joinVoiceChannel`, `leaveVoiceChannel`, `setMuted`, `setDeafened`, `reconcileParticipantLeft`, `reconcileRoomFinished`.

`npm run typecheck`:

```
> janja@1.0.0 typecheck:node
> tsc --noEmit -p tsconfig.node.json --composite false

> janja@1.0.0 typecheck:web
> tsc --noEmit -p tsconfig.web.json --composite false

> janja@1.0.0 typecheck:convex
> tsc --noEmit -p tsconfig.convex.json
```

Limpo nos três projetos, sem nenhuma saída de erro.

Cada ciclo TDD viu o vermelho antes do verde:

- setSharing: `Tests 4 failed | 42 passed (46)` — `Expected a Convex function exported from module "voice" as 'setSharing', but there is no such export.`
- reconcileScreenShareStopped: `Tests 4 failed | 46 passed (50)` — mesma mensagem para `reconcileScreenShareStopped`.
- track_unpublished: `Tests 1 failed | 56 passed (57)` — `AssertionError: expected true to be false`. Só 1 vermelho é o esperado aqui: os outros testes do bloco (câmera/microfone/sem track/401) afirmam que NADA acontece, e antes da implementação nada acontecia mesmo. O único que exigia código novo é o de `SCREEN_SHARE`.

Lint dos 4 arquivos tocados: `0 errors` novos. Os 5 erros de `explicit-function-return-type` restantes em `voice.test.ts` e os 2 em `voice.ts` são de código pré-existente (`insertUser`, `insertServerWithChannel`, `addMember`, `joinedAna` do bloco de setMuted, `insertVoiceState`, `requireOwnVoiceState`, `enrichVoiceStates`) — os helpers novos deste plano receberam retorno anotado no commit `dd2da93` justamente para não somar ao baseline. Restam avisos de `prettier/prettier` sobre vírgula final; são a classe de aviso que `convex/http.ts`, `convex/voice.ts` e `convex/voiceToken.ts` já tinham em todos os blocos equivalentes desde 07-01/07-02, e o código novo seguiu o estilo do bloco vizinho em vez de introduzir estilo misto dentro do mesmo `switch`.

## Decisions Made

Ver `key-decisions` no frontmatter. As duas que mais afetam quem vier depois:

1. **`trackSource` teve que ser adicionado ao retorno de `verifyLiveKitWebhook`.** `convex/http.ts` não enxerga o payload do webhook — enxerga só o que a action do runtime Node devolve. Qualquer campo novo do webhook que uma fase futura precisar passa pelo mesmo lugar.
2. **`@livekit/protocol` é importável em `convex/http.ts`.** A regra de 07-02 vale para `livekit-server-sdk`, e a razão é `node:crypto`. Vale checar caso a caso, não presumir a família inteira vetada.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `convex/http.ts` não tem acesso a `event.track.source`**

- **Found during:** Task 6 (GREEN do case `track_unpublished`)
- **Issue:** O plano manda escrever `event.track?.source === TrackSource.SCREEN_SHARE` em `convex/http.ts`. Isso pressupõe que `http.ts` tem o `WebhookEvent` em mãos, o que não é verdade na implementação real de 07-02: a verificação de assinatura mora numa `internalAction` em `convex/voiceToken.ts` (runtime Node, por causa de `node:crypto`), e ela devolve `{ event, channelId, userId }` — um objeto simples, porque a classe de protobuf não atravessa `ctx.runAction`. Sem `track.source` nesse objeto, o `case` não tem o que filtrar.
- **Fix:** `verifyLiveKitWebhook` passou a devolver também `trackSource: event.track?.source ?? null`, e o tipo do `makeFunctionReference` em `http.ts` acompanhou. `TrackSource` continua sendo importado em `http.ts` e a comparação continua sendo contra o enum, como o plano e `08-RESEARCH.md §7` exigem — o que mudou foi de onde vem o valor comparado.
- **Files modified:** `convex/voiceToken.ts` (fora do `files_modified` do plano), `convex/http.ts`
- **Verification:** o teste ponta a ponta via `t.fetch` com payload assinado e `source: 'SCREEN_SHARE'` só passa a partir desta mudança; os três testes de câmera/microfone/`screen_share_audio` continuam provando que o filtro não virou catch-all.
- **Committed in:** `78b872b`

**2. [Rule 1 — Bug] Teste de "evento desconhecido" apontando para um evento que passou a ser conhecido**

- **Found during:** Task 5 (RED do roteamento)
- **Issue:** O teste de 07-02 "evento desconhecido responde 200 e não altera voiceStates" usava `track_unpublished` como o evento não tratado. Com o `case` novo, ele continuaria verde (o payload não tinha campo `track`, então o filtro ignora) enquanto cobria exatamente nada — um teste que afirma uma coisa e verifica outra.
- **Fix:** trocado para `egress_started` (evento real do LiveKit, fora do switch), com comentário explicando a troca. Um teste separado, novo, cobre o caso de `track_unpublished` sem campo `track`.
- **Files modified:** `convex/voice.test.ts`
- **Verification:** ambos passam; o de `egress_started` volta a ser um teste de evento genuinamente fora do switch.
- **Committed in:** `4009a1f`

**3. [Rule 1 — Bug, preventivo] Mensagem de erro de `setSharing`**

- **Found during:** Task 2
- **Issue:** O plano sugere a mensagem "Não é possível compartilhar tela fora de um canal de voz", mas também manda reaproveitar o helper existente — e o helper (`requireOwnVoiceState`) já lança "Você não está em nenhum canal de voz". Escrever a mensagem do plano exigiria duplicar a busca por `by_user`, que é o que o plano proíbe no parágrafo anterior.
- **Fix:** reaproveitado o helper; a mensagem é a dele. O teste afirma `/canal de voz/i`, que é o requisito real ("erro descritivo", `must_haves.truths`).
- **Files modified:** `convex/voice.ts`
- **Committed in:** `e82de45`

---

**Total deviations:** 3 auto-fixed (1× Rule 3, 2× Rule 1)
**Impact on plan:** Nenhum desvio de escopo. O único arquivo fora de `files_modified` é `convex/voiceToken.ts`, e a mudança nele é de 1 campo no retorno de uma function existente — não há como escrever o `case` do plano sem ela. Nenhuma mudança arquitetural: a divisão isolate/Node de 07-02 foi preservada, não contornada.

## Issues Encountered

**Formato de `track.source` no fio.** `08-RESEARCH.md §7` registra explicitamente que a doc pública do LiveKit não fixa o literal serializado, e por isso manda comparar contra o enum. Resolvido rodando a lib de verdade antes de escrever o teste: um payload assinado com `"source": "SCREEN_SHARE"` (nome do enum, mapeamento JSON canônico de protobuf) sai de `WebhookReceiver.receive` como `3`, e `TrackSource.SCREEN_SHARE === 3`. Ou seja: **o nome vai no fio, o número chega no código.** Os testes constroem o payload com o nome, exatamente como o servidor do LiveKit envia, e a comparação no código é contra o enum — os dois lados corretos, nenhum literal hardcodado.

**Risco de bundler ao importar `@livekit/protocol` em `http.ts`.** A lição nº1 do HANDOFF é literalmente esta armadilha: 07-01 provou sob vitest que `livekit-server-sdk` rodava no runtime isolate, e o deploy real falhou com `Could not resolve "node:crypto"`. Vitest (edge-runtime) resolve `node:crypto`; o bundler do Convex não. Para não repetir isso, a verificação **não** foi feita sob vitest:

- grep por `node:` em `node_modules/@livekit/protocol/dist/` e em `node_modules/@bufbuild/protobuf/dist/esm/`: zero ocorrências; `@bufbuild/protobuf` não tem dependências.
- `npx esbuild convex/http.ts --bundle --platform=browser --format=esm` (as condições que reproduzem a falha original): **bundla limpo, 83.3kb**.
- Controle na mesma invocação: um arquivo importando `livekit-server-sdk` **falha** com erro de resolução. Ou seja, o harness detecta o modo de falha que se quer evitar — não é um teste que passa por vacuidade.

**Limite honesto dessa prova:** esbuild com `--platform=browser` é uma aproximação do bundler do Convex, não o bundler do Convex. A prova definitiva é um `npx convex deploy`/`dev` real, que esta execução não pode rodar (sem credenciais de deployment). Se algum dia falhar, a saída é conhecida e barata: mover a comparação para dentro de `verifyLiveKitWebhook` (runtime Node, onde o enum já é seguro) e devolver um booleano. Registrado abaixo como o único item de risco desta entrega.

## User Setup Required

Nenhum. Este plano não adiciona dependência, variável de ambiente nem configuração de serviço externo. O bloco `webhook:` do `livekit.yaml` já foi configurado em 07-02 e não muda — `track_unpublished` chega pela mesma rota que os eventos de participante, sem nenhum ajuste no servidor LiveKit.

## Next Phase Readiness

Pronto para 08-04/08-05 (UI): `setSharing` é a mutation que o cliente chama ao iniciar/parar a captura, e `voiceParticipantsByChannel`/`ByServer` (07-04) já devolvem `sharing` no payload enriquecido — a UI não precisa de query nova.

### O que fica por verificar em Windows (nada disso é testável aqui)

1. **`track_unpublished` de verdade chegando do servidor LiveKit da VPS.** Todos os testes deste plano constroem o payload e assinam localmente. Ninguém observou o LiveKit real emitir esse evento para uma track de tela, nem confirmou que ele envia `source: "SCREEN_SHARE"` para uma track publicada pelo `livekit-client` do Electron. **Se o valor no fio for outro, o `case` não dispara e `sharing` fica `true` para sempre naquele cenário — falha silenciosa, sem erro em lugar nenhum.** Verificação: compartilhar tela, matar a captura sem sair da call, e conferir que o indicador de compartilhamento some para os outros participantes.
2. **Deploy do Convex com o import de `@livekit/protocol` em `http.ts`.** Ver "Issues Encountered" acima. O sintoma, se der errado, é o deploy falhando com erro de resolução de módulo — barulhento, não silencioso, e com saída de contorno conhecida.
3. **SHARE-06 no caminho principal (o apresentador cai).** Continua coberto por `participant_left`/`participant_connection_aborted` de 07-02, não por este plano. A prova de que isso funciona é a mesma sessão de Windows já reservada para 07-08.

---
*Phase: 08-compartilhamento-de-tela*
*Completed: 2026-08-19*
