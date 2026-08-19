---
phase: 07-voz
plan: 02
subsystem: voice
tags: [convex, http-actions, livekit-server-sdk, webhooks, node-runtime]

# Dependency graph
requires:
  - phase: 07-01
    provides: "voiceStates schema (índices by_channel/by_user/by_channel_and_user), setMuted/setDeafened/leaveVoiceChannel, e a lição de runtime (livekit-server-sdk precisa do runtime Node do Convex) já corrigida em convex/voiceToken.ts"
provides:
  - "Rota POST /livekit/webhook (convex/http.ts) que valida a assinatura HMAC do LiveKit contra o corpo bruto da requisição antes de qualquer parse"
  - "internalMutations reconcileParticipantLeft e reconcileRoomFinished (convex/voice.ts), chamadas só pelo webhook"
  - "internalAction verifyLiveKitWebhook (convex/voiceToken.ts, runtime Node) isolando o uso de WebhookReceiver do livekit-server-sdk"
  - "infra/livekit/livekit.yaml com o bloco webhook estruturalmente pronto (api_key + urls), pendente só do host .convex.site real"
affects: ["07-08 (verificação final: deploy real na VPS + prova de matar o processo Electron)", "Fase 8 (screenshare: track_unpublished estende o mesmo switch de eventos em http.ts)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "httpAction (convex/http.ts, runtime isolate forçado pelo bundler — mustBeIsolate inclui 'http') delega qualquer trabalho que precise de livekit-server-sdk para uma internalAction 'use node' via ctx.runAction — nunca importa o pacote diretamente"
    - "makeFunctionReference('modulo:funcao') em vez de internal.X.Y gerado — convex/_generated/api.ts não foi regenerado nesta execução (codegen fora do escopo permitido), então toda referência cross-módulo em http.ts/voiceToken.ts é por string, mesmo padrão já usado em voiceToken.ts desde o 07-02 anterior (interrompido)"

key-files:
  created:
    - "convex/http.ts"
  modified:
    - "convex/voice.ts"
    - "convex/voiceToken.ts"
    - "convex/voice.test.ts"
    - "infra/livekit/livekit.yaml"

key-decisions:
  - "WebhookReceiver não pode ser importado em convex/http.ts. Motivo verificado no código-fonte do bundler do Convex (node_modules/convex/dist/esm/bundler/index.js, função mustBeIsolate): http.ts, crons.ts, schema.ts e auth.config.ts são forçados ao runtime isolate — 'use node' derruba o build com 'use node directive is not allowed for http'. E livekit-server-sdk/dist/index.js reexporta TUDO (export * from './WebhookReceiver.js'), que por sua vez importa crypto/digest.js — o MESMO arquivo com await import('node:crypto') que já quebrou o bundler do runtime padrão para AccessToken (registrado no cabeçalho de voiceToken.ts). Ou seja: importar qualquer coisa de livekit-server-sdk em http.ts (mesmo só WebhookReceiver) arrastaria o mesmo erro de bundling 'Could not resolve node:crypto', só que agora num arquivo que nem aceita 'use node' como saída. Resolvido movendo a verificação de assinatura para uma nova internalAction, verifyLiveKitWebhook, em convex/voiceToken.ts (já 'use node'), chamada via ctx.runAction a partir de http.ts."
  - "Checagem de LIVEKIT_API_KEY/LIVEKIT_API_SECRET ausentes acontece em convex/http.ts, direto via process.env, ANTES de chamar a action — não dentro dela. process.env já é acessível no runtime isolate sem 'use node' (mesmo padrão de convex/auth.config.ts, que lê WORKOS_CLIENT_ID sem 'use node'). Isso permite responder 500 'sem tentar validar nada' (texto exato do plano) sem gastar um runAction inteiro só para descobrir que a config está faltando. verifyLiveKitWebhook também confere as mesmas duas variáveis por segurança em profundidade caso seja chamada diretamente."
  - "Payload do evento de volta pro httpAction é um objeto simples ({ event, channelId, userId }), não a classe WebhookEvent do protobuf — WebhookEvent não atravessaria ctx.runAction (que serializa argumentos/retorno como Convex values, não instâncias de classe arbitrárias)."
  - "livekit.yaml: o bloco webhook foi escrito (api_key + urls), mas o host real do deployment (<convex-deployment>.convex.site) permanece um placeholder explícito — não um valor inventado. Este worktree não tem .env.local (só .env.local.example, sem até VITE_CONVEX_SITE_URL) e esta execução está proibida de rodar npx convex dev/login para descobrir o deployment real. Preencher com um valor fabricado teria o mesmo risco silencioso que o runbook já alerta para o bloco `keys:` antigo — pareceria correto e falharia sem erro visível. Ver 'User Setup Required' abaixo para o passo exato."

patterns-established:
  - "Qualquer nova rota HTTP do Convex que precise de uma lib com dependência transitiva de node:* deve seguir o mesmo padrão: handler fino em http.ts (isolate) delegando para uma internalAction/internalMutation em runtime apropriado via ctx.runAction/ctx.runMutation — nunca importar a lib diretamente em http.ts."

# Metrics
duration: ~45min
completed: 2026-08-19
---

# Phase 07 Plan 02: Webhook de Reconciliação (VOICE-04) Summary

**Rota `POST /livekit/webhook` em `convex/http.ts` que valida a assinatura HMAC do LiveKit contra o corpo bruto (`request.text()`) via uma `internalAction` isolada no runtime Node (`voiceToken.verifyLiveKitWebhook`), e reconcilia `voiceStates` órfão via duas `internalMutation`s idempotentes em `voice.ts` — cobrindo os 3 eventos do Pitfall 3 (`participant_left`, `participant_connection_aborted`, `room_finished`) e provado por 15 testes novos (32 no arquivo, 164 no repositório).**

## Performance

- **Duration:** ~45 min
- **Tasks:** 1 plano TDD, executado como bloco único (RED/GREEN entrelaçados por não haver checkpoint intermediário)
- **Files modified:** 4 (1 criado: `convex/http.ts`; 3 modificados: `convex/voice.ts`, `convex/voiceToken.ts`, `convex/voice.test.ts`) + `infra/livekit/livekit.yaml`

## Accomplishments

- **`convex/http.ts` (novo):** `httpRouter` + `httpAction` em `POST /livekit/webhook`. Lê `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` de `process.env` primeiro — ausentes, responde `500` sem tentar nada mais. Lê o corpo com `await request.text()` (nunca `request.json()` antes — Pitfall 3). Delega a verificação de assinatura para `voiceToken:verifyLiveKitWebhook` via `ctx.runAction`; exceção vira `401`, sem chamar nenhuma mutation. Roteia por `event.event`: `participant_left`/`participant_connection_aborted` → `voice:reconcileParticipantLeft`; `room_finished` → `voice:reconcileRoomFinished`; qualquer outro evento (inclusive o futuro `track_unpublished` da Fase 8) → `200` sem ação, para o LiveKit nunca receber um `500` por evento desconhecido e ficar reenviando.
- **`convex/voice.ts`:** `reconcileParticipantLeft` (apaga uma linha via `by_channel_and_user`, idempotente) e `reconcileRoomFinished` (apaga todas as linhas de um canal via `by_channel`, nunca toca em outro canal) — ambas `internalMutation`, só alcançáveis pelo webhook.
- **`convex/voiceToken.ts`:** nova `internalAction verifyLiveKitWebhook`, construindo `WebhookReceiver` e chamando `.receive(rawBody, authHeader)` — isolada aqui pelo mesmo motivo de runtime que já forçou `joinVoiceChannel` a sair de `voice.ts` no plano anterior, documentado em detalhe no cabeçalho do arquivo (ver "Decisões" abaixo).
- **Descoberta de runtime que o plano não previu explicitamente:** `WebhookReceiver` não podia simplesmente ganhar `"use node"` dentro de `http.ts`, porque `http.ts` é um dos quatro arquivos (`http`, `crons`, `schema`, `auth.config`) que o bundler do Convex proíbe explicitamente de rodar em Node (`mustBeIsolate`, verificado lendo `node_modules/convex/dist/esm/bundler/index.js`, não assumido). A solução (handler isolate fino delegando para uma `internalAction` Node por `ctx.runAction`) é o mesmo padrão de dois saltos que `voiceToken.ts` já usa para separar `validateVoiceJoin`/`upsertVoiceState` (isolate) de `joinVoiceChannel` (Node) — reaplicado aqui, não inventado.
- **15 testes novos** em `convex/voice.test.ts`: `reconcileParticipantLeft`/`reconcileRoomFinished` testadas diretamente (idempotência, isolamento entre canais); a rota testada ponta a ponta via `t.fetch` cobrindo sem header, assinatura inválida, corpo re-serializado com assinatura válida de um corpo diferente (prova de que o handler usa bytes brutos, não uma versão re-parseada), env vars ausentes (`500`), os 3 eventos do Pitfall 3, evento desconhecido (`200`), e evento duplicado para linha já removida (`200`, não lança).
- **`infra/livekit/livekit.yaml`:** bloco `webhook` descomentado e estruturado (`api_key` + `urls`), documentando explicitamente por que o host `.convex.site` real não pôde ser preenchido nesta execução (ver "User Setup Required").

## Files Created/Modified

- `convex/http.ts` - `httpRouter`, rota `POST /livekit/webhook`: valida env vars → lê corpo bruto → delega verificação de assinatura (`runAction`) → roteia por evento (`runMutation`)
- `convex/voice.ts` - `reconcileParticipantLeft`, `reconcileRoomFinished` (ambas `internalMutation`)
- `convex/voiceToken.ts` - `verifyLiveKitWebhook` (`internalAction`, runtime Node); cabeçalho do arquivo estendido explicando por que `WebhookReceiver` também precisa desse runtime
- `convex/voice.test.ts` - 15 testes novos: reconciliação direta (2 describes) + rota HTTP ponta a ponta (2 describes: assinatura, roteamento por evento)
- `infra/livekit/livekit.yaml` - bloco `webhook` preenchido estruturalmente (`api_key`/`urls`), host real pendente

## Módulos a registrar (não editei `convex/_generated/api.ts`)

Este ambiente não roda `npx convex dev`/codegen (fora do escopo permitido desta execução). `convex/_generated/api.ts` continua desatualizado em relação a este plano — ele **não lista** `http`, nem as novas exportações de `voice.ts`/`voiceToken.ts`. Isso não bloqueia nada: `http.ts` e `voiceToken.ts` já usam `makeFunctionReference('modulo:funcao')` em vez de `internal.X.Y` para chamadas cross-módulo (mesmo padrão que `voiceToken.ts` já usava para `voice:validateVoiceJoin`/`voice:upsertVoiceState`), e os testes usam `anyApi` (que não depende de codegen). Na próxima vez que alguém rodar `npx convex dev` neste projeto, o codegen vai adicionar automaticamente:

- `import type * as http from "../http.js"` em `api.ts`
- As novas exports de `voice.ts`: `reconcileParticipantLeft`, `reconcileRoomFinished`
- A nova export de `voiceToken.ts`: `verifyLiveKitWebhook`

Nenhuma ação manual é necessária nesses arquivos gerados — só rodar `npx convex dev` uma vez é suficiente, e nada no código deste plano depende desse arquivo estar atualizado.

## Decisions Made

Ver `key-decisions` no frontmatter para o texto completo. Resumo:

1. **`WebhookReceiver` não pode entrar em `convex/http.ts`, nem com `"use node"`.** Verificado lendo o código-fonte do bundler do Convex (`mustBeIsolate` em `node_modules/convex/dist/esm/bundler/index.js`), não assumido por analogia. `http.ts`/`crons.ts`/`schema.ts`/`auth.config.ts` são forçados ao runtime isolate — nenhum pode ter `"use node"`. E qualquer import de `livekit-server-sdk` (mesmo só `{ WebhookReceiver }`, mesmo só `{ AccessToken }`) arrasta `crypto/digest.js` para o grafo de bundling via `export *` em `index.js`, o mesmo arquivo com `await import("node:crypto")` que já quebrou o deploy real de `joinVoiceChannel` no plano anterior. Resolvido com uma `internalAction` (`verifyLiveKitWebhook`) em `voiceToken.ts` (já `"use node"`), chamada por `ctx.runAction` a partir do handler isolate de `http.ts`.
2. **Checagem de env vars ausentes em `http.ts` diretamente, via `process.env`, sem `"use node"`** — confirmado que env vars são acessíveis no runtime isolate pelo precedente já existente em `convex/auth.config.ts` (`process.env.WORKOS_CLIENT_ID`, sem `"use node"`). Permite responder `500` "sem tentar validar nada", como pede o plano, sem precisar de um `runAction` só para descobrir que falta configuração.
3. **`livekit.yaml`: host `.convex.site` real não preenchido.** Este worktree não tem `.env.local` (só `.env.local.example`, que nem declara `VITE_CONVEX_SITE_URL` — essa variável só é introduzida no Plano 09-03). Sem acesso a um deployment real e proibido de rodar `npx convex dev`/`login`, inventar um valor "realista" seria pior que um placeholder explícito: pareceria correto e falharia silenciosamente, exatamente o modo de falha que o próprio `DEPLOY-RUNBOOK.md` já alerta para o antigo bloco `keys:`. Ver "User Setup Required".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `WebhookReceiver` movido para uma `internalAction` em `voiceToken.ts` em vez de viver dentro de `convex/http.ts`**
- **Found during:** Escrita do handler da rota (antes de qualquer código, ao planejar os imports de `http.ts`)
- **Issue:** O plano original (frontmatter `key_links`) descreve `convex/http.ts` chamando `internal.voice.reconcile*` diretamente e implicitamente assume que a verificação de assinatura (`WebhookReceiver`) também mora ali. O contexto desta execução já alertava para checar isso; a checagem no código-fonte do bundler confirmou que `http.ts` é forçado ao runtime isolate (`mustBeIsolate`) e que `livekit-server-sdk` inteiro (via `export *`) arrasta uma dependência não resolvível (`node:crypto`) nesse runtime — o mesmo erro de bundling `Could not resolve "node:crypto"` já documentado para `joinVoiceChannel`.
- **Fix:** `WebhookReceiver` isolado numa nova `internalAction verifyLiveKitWebhook` em `convex/voiceToken.ts` (já `"use node"`), retornando um objeto simples (`{ event, channelId, userId }`, não a classe `WebhookEvent` do protobuf). `http.ts` chama essa action via `ctx.runAction` e trata a exceção como `401`.
- **Files modified:** `convex/http.ts`, `convex/voiceToken.ts`
- **Verification:** `npx tsc --noEmit -p convex/tsconfig.json` limpo; 15 testes cobrindo a rota ponta a ponta (incluindo o caso de assinatura inválida e de corpo re-serializado) passam via `t.fetch`, que exercita exatamente essa cadeia `httpAction → runAction → WebhookReceiver.receive`.
- **Committed in:** Não commitado — este plano roda sob a restrição `NO_GIT` (agente irmão 07-03 ainda pode estar finalizando arquivos em `src/`); arquivos ficam staged apenas no working tree.

---

**Total deviations:** 1 auto-fixado (Rule 3 - blocking). Sem esse ajuste, `convex/http.ts` não compilaria/bundlaria no deploy real do Convex (mesmo passando em testes locais sob `vitest`/edge-runtime) — exatamente a classe de erro que já custou um retrabalho no plano anterior desta mesma fase.
**Impact on plan:** Nenhum scope creep — o desvio é estritamente sobre ONDE o código mora (dois arquivos, dois runtimes, uma chamada `ctx.runAction` a mais), não sobre O QUE ele faz. Todo comportamento descrito no `<behavior>` do plano (os 3 eventos, corpo bruto, 401/500/200) está implementado como especificado.

## Issues Encountered

Nenhum além do já documentado em "Deviations". O typecheck (`convex/tsconfig.json`, `npm run typecheck`) e a suíte inteira (`npx vitest run`, 164 testes / 15 arquivos) passaram de primeira depois da correção de runtime — sem iteração de depuração adicional.

## User Setup Required

**Duas coisas precisam de uma pessoa com acesso ao deployment real do Convex e ao Coolify — nenhuma delas foi automatizada aqui, por escopo explícito do plano (a prova de ponta a ponta é do Plano 07-08):**

1. **Preencher o host real em `infra/livekit/livekit.yaml`:**
   - Achar o deployment real: rodar `npx convex dev` uma vez (ou abrir o dashboard do Convex) e observar a URL mostrada — algo como `https://algum-nome-123.convex.cloud`. Trocar `.convex.cloud` por `.convex.site` (é a URL de HTTP actions, não a de client SDK — são hosts diferentes, confirmado em `07-RESEARCH.md §4`).
   - Editar `infra/livekit/livekit.yaml`, trocando `https://<convex-deployment>.convex.site/livekit/webhook` pelo valor real.
   - Trocar `REPLACE_WITH_API_KEY` pelo valor real de `LIVEKIT_API_KEY` (o mesmo já usado em `LIVEKIT_KEYS` no Coolify, passo 9.1 do `DEPLOY-RUNBOOK.md`) — **nunca** um valor novo, tem que ser exatamente o mesmo par (`api_key`, `api_secret`) que o Convex já tem em `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`.
2. **Redeploy da stack do LiveKit no Coolify** para que o container carregue o `livekit.yaml` atualizado (**Redeploy**, não `docker compose down` — ver "Manutenção" no `DEPLOY-RUNBOOK.md`, apagaria o certificado TLS do Traefik).
3. **A prova real** (matar o processo do Electron com alguém em canal de voz e confirmar que a linha de `voiceStates` some em segundos) é escopo do **Plano 07-08**, não deste — a lógica que a sustenta já está implementada e coberta por 15 testes automatizados aqui.

## Next Phase Readiness

- `convex/voice.ts`/`convex/voiceToken.ts`/`convex/http.ts` prontos para o Plano 07-08 conectar contra um LiveKit real — nada de código pendente, só configuração de infra (item acima).
- Fase 8 (screenshare) pode estender o mesmo `switch (event.event)` em `http.ts` com um case `track_unpublished` sem tocar em mais nada — o design já foi feito pensando nisso (comentário explícito no código).
- Nenhum bloqueio para os próximos planos desta wave (07-04+); este plano não tocou `src/`.

---
*Phase: 07-voz*
*Completed: 2026-08-19*
