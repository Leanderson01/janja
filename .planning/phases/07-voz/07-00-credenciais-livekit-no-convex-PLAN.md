---
phase: 07-voz
plan: 00
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: false

must_haves:
  truths:
    - "O deployment do Convex consegue assinar tokens do LiveKit sem expor a API secret ao cliente"
  artifacts: []
  key_links:
    - from: "convex env (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL)"
      to: "actions de convex/voice.ts (Plano 07-01)"
      via: "process.env dentro da action que assina o AccessToken"
      pattern: "LIVEKIT_API_KEY|LIVEKIT_API_SECRET"
---

<objective>
Colocar no Convex o mesmo par de credenciais do LiveKit que já vive na VPS
(`LIVEKIT_KEYS`), para que as actions de voz (Plano 07-01) e o webhook
(Plano 07-02) consigam assinar/validar tokens sem que a API secret nunca
chegue ao cliente Electron.

Purpose: é a única peça desta fase que exige um segredo que só existe fora
do repositório (na env var `LIVEKIT_KEYS` da stack do Coolify) — nenhum
agente consegue lê-la sozinho. Sem isso, toda a Fase 7 fica bloqueada em
"parece implementado mas nenhuma chamada real funciona".
Output: três variáveis de ambiente configuradas no deployment do Convex.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@infra/livekit/livekit.yaml
@infra/livekit/.env.example
@infra/livekit/DEPLOY-RUNBOOK.md
@.planning/phases/01-livekit-na-vps/01-02-VERIFICACAO.md

O par de chaves já existe — foi gerado em `01-02` e vive só como env var
`LIVEKIT_KEYS` (formato `chave: segredo`) na stack do Coolify. Não está em
nenhum arquivo do repositório, de propósito (ver comentário em
`livekit.yaml`). O domínio do servidor é fixo: `livekit.usesenju.com`.
</context>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <what-built>
    Nada ainda — este é o único passo desta fase que precisa de um segredo
    que não está em nenhum lugar acessível a um agente.
  </what-built>
  <how-to-verify>
    1. Abrir o Coolify, na aplicação do LiveKit (a mesma stack de `01-02`),
       e copiar o valor de `LIVEKIT_KEYS` em Environment Variables. O
       formato é `chave: segredo` — a parte antes de `:` é a API key, a
       parte depois é a API secret.
    2. No diretório do projeto, rodar (substituindo pelos valores reais):
       ```
       npx convex env set LIVEKIT_API_KEY "<chave>"
       npx convex env set LIVEKIT_API_SECRET "<segredo>"
       npx convex env set LIVEKIT_URL "wss://livekit.usesenju.com"
       ```
    3. Confirmar com `npx convex env list` que as três variáveis aparecem
       (o valor de `LIVEKIT_API_SECRET` some da listagem por segurança —
       normal).
  </how-to-verify>
  <resume-signal>Digite "feito" depois de rodar os três `convex env set` e confirmar com `convex env list`.</resume-signal>
</task>

</tasks>

<verification>
`npx convex env list` mostra `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` e
`LIVEKIT_URL` configuradas no deployment corrente.
</verification>

<success_criteria>
As três env vars existem no Convex e batem com o par gerado em `01-02` —
sem isso, `joinVoiceChannel` (Plano 07-01) e o webhook (Plano 07-02) falham
em runtime real mesmo passando nos testes (que usam `convex-test`, não o
deployment real).
</success_criteria>

<output>
After completion, create `.planning/phases/07-voz/07-00-SUMMARY.md`
</output>
