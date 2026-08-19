---
phase: 09-polimento-e-empacotamento
plan: 02
subsystem: auth
tags: [convex, http-actions, workos, oauth, electron-vite, env-vars]

# Dependency graph
requires:
  - phase: 07-voz
    provides: "convex/http.ts com httpRouter já criado para o webhook do LiveKit (Plano 07-02) — este plano adiciona uma rota nova ao mesmo router"
  - phase: 02-convex-auth-workos
    provides: "Padrão de configuração preguiçosa (isAuthConfigured/AuthNotConfiguredError) em src/main/auth/auth.ts, estendido aqui para VITE_CONVEX_SITE_URL"
provides:
  - "Rota GET /auth/complete em convex/http.ts, servindo a página de conclusão de login (AUTH-07)"
  - "REDIRECT_URI da WorkOS construído a partir de VITE_CONVEX_SITE_URL + /auth/complete, com erro legível se a variável faltar"
  - "convex-client.ts sem throw no nível do módulo — isConvexConfigured como estado, checado em main.tsx antes de montar o provider"
affects: [09-03, packaging, auth]

tech-stack:
  added: []
  patterns:
    - "Falha de configuração de ambiente vira estado checável (isConvexConfigured/isAuthConfigured), nunca throw no nível do módulo — mesmo padrão nos dois lados (main e renderer) agora"
    - "HTML de HTTP action montado inline, com escape distinto para contexto de atributo HTML e contexto de literal de string JS (não são intercambiáveis)"

key-files:
  created:
    - convex/lib/authCompletionPage.ts
  modified:
    - convex/http.ts
    - src/main/auth/auth.ts
    - src/renderer/src/lib/convex-client.ts
    - src/renderer/src/main.tsx
    - .env.local.example

key-decisions:
  - "Helper de HTML isolado em convex/lib/authCompletionPage.ts (não inline em http.ts) — segue o padrão já existente de convex/lib/ (inviteCode.ts, tag.ts) e mantém http.ts focado em roteamento"
  - "Página de conclusão nunca promete fechar a aba sozinha — só confirma sucesso e diz que pode ser fechada manualmente, com um link de fallback para o redirect automático via JS"
  - "main.tsx usa checagem inline (isConvexConfigured && convexClient) em vez do não-null assertion sugerido no plano — mesmo resultado, sem precisar do '!'"

patterns-established:
  - "Escape de query string vindo de provedor externo (WorkOS) para dois contextos HTML distintos: escapeHtmlAttribute (para href) e escapeJsStringLiteral (para dentro de <script>) — nunca reusar um para o outro"

duration: ~15min
completed: 2026-08-19
---

# Phase 9 Plan 02: Página de conclusão de login Summary

**Rota `GET /auth/complete` no Convex servindo uma página HTML autocontida que confirma o login e redireciona para `janja://callback`, `redirectUri` da WorkOS migrado de `janja://callback` direto para essa página via `VITE_CONVEX_SITE_URL`, e o crash de módulo remanescente em `convex-client.ts` fechado com o mesmo padrão já usado para o client WorkOS.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-08-19T16:44:16Z
- **Tasks:** 3/3
- **Files modified:** 5 (4 modificados + 1 criado)

## Accomplishments

- AUTH-07 implementado pelo caminho decidido em `STATE.md`: HTTP action do Convex, sem infraestrutura nova. A aba do navegador, ao final do login, agora mostra "Login concluído. Você pode fechar esta aba e voltar para o app janja." em vez de ficar parada na tela interna da WorkOS — com link manual de fallback caso o redirect automático via JS seja bloqueado.
- `REDIRECT_URI` em `src/main/auth/auth.ts` passa a ser `${VITE_CONVEX_SITE_URL}/auth/complete`, não mais o literal `janja://callback` — a WorkOS agora navega para uma URL `https://` normal, e é essa página (rodando no contexto da própria aba) que dispara o redirect final para o esquema customizado.
- Fechada a segunda metade da armadilha de variável de ambiente ausente em build empacotado: `convex-client.ts` não lança mais no nível do módulo (mesma classe de bug que `02-VERIFICACAO.md` já tinha corrigido uma vez para `auth.ts`, achado #3, mas nunca para este arquivo). `main.tsx` agora checa `isConvexConfigured` antes de montar `ConvexProviderWithAuth` e mostra uma tela de erro legível em português no lugar de deixar o React derrubar o processo de render.
- `isAuthConfigured()`/`AuthNotConfiguredError` em `auth.ts` estendidos para cobrir as duas variáveis (`MAIN_VITE_WORKOS_CLIENT_ID` e `VITE_CONVEX_SITE_URL`), com mensagem montada dinamicamente citando exatamente qual(is) falta(m).

## Task Commits

Nenhum commit foi criado por este agente — o prompt de execução instruiu explicitamente **NO_GIT** ("Leave your files uncommitted — the orchestrator commits"). Todos os arquivos abaixo estão modificados/criados no working tree, não commitados:

1. **Task 1: Rota /auth/complete no Convex** — não commitado (orquestrador commita)
2. **Task 2: Trocar o redirectUri da WorkOS para a página de conclusão** — não commitado (orquestrador commita)
3. **Task 3: Corrigir o crash de módulo em convex-client.ts** — não commitado (orquestrador commita)

## Files Created/Modified

- `convex/lib/authCompletionPage.ts` (novo) — monta o HTML da página de conclusão; duas variantes (`hasCallbackParams` true/false); dois escapes distintos (atributo HTML vs. literal de string JS)
- `convex/http.ts` — rota `GET /auth/complete` adicionada ao `httpRouter` já existente (criado pela Fase 7 para `/livekit/webhook`), sem tocar na rota do webhook
- `src/main/auth/auth.ts` — `REDIRECT_URI` construído a partir de `VITE_CONVEX_SITE_URL`; `ImportMetaEnv` estendida; `isAuthConfigured()`/`AuthNotConfiguredError` cobrindo as duas variáveis
- `src/renderer/src/lib/convex-client.ts` — `isConvexConfigured`/`convexClient` (pode ser `null`) em vez de `throw` no nível do módulo
- `src/renderer/src/main.tsx` — checa `isConvexConfigured` antes de montar `ConvexProviderWithAuth`; renderiza `ConvexNotConfiguredScreen` (inline, sem depender do Convex) se a variável faltar
- `.env.local.example` — entrada `VITE_CONVEX_SITE_URL` documentada, citando as duas pontas que dependem dela (código do app + dashboard da WorkOS)

## Decisions Made

- Helper de HTML em `convex/lib/authCompletionPage.ts`, seguindo o padrão de `convex/lib/` já estabelecido (`inviteCode.ts`, `tag.ts`, `membership.ts`), em vez de inline em `http.ts`.
- Dois escapes diferentes e não-intercambiáveis para o mesmo valor (`callbackUrl`): `escapeHtmlAttribute` para o `href` do link de fallback, `escapeJsStringLiteral` (aspas, barra invertida, e a sequência `</script` neutralizada via `<`) para o literal dentro do `<script>`. HTML entities não são decodificadas dentro de um bloco `<script>` — usar o mesmo escape nos dois lugares quebraria a URL de redirect ou deixaria uma brecha de injeção, dependendo de qual fosse reusado onde.
- `main.tsx` implementa a checagem como `isConvexConfigured && convexClient ? <Provider/> : <TelaDeErro/>` em vez do `convexClient!` sugerido literalmente no plano — TypeScript já estreita o tipo pela condição, sem precisar de non-null assertion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Escape de atributo HTML reusado incorretamente dentro do `<script>`**
- **Found during:** Task 1 (helper `authCompletionPage.ts`), durante a implementação — antes de qualquer verificação, autodetectado ao revisar o próprio código escrito.
- **Issue:** A primeira versão do helper aplicava `escapeHtmlAttribute` (que produz `&quot;`, `&lt;`, `&gt;`) tanto no `href` quanto dentro do literal `window.location.href = "..."` no `<script>`. Entities HTML não são decodificadas em conteúdo de `<script>` — o navegador executaria `window.location.href = "janja://callback?code=abc&amp;state=..."` literalmente, com `&amp;` no meio da URL em vez de `&`, quebrando o parse de query string do lado do app (`extractCallbackUrl`/`handleCallback`).
- **Fix:** Adicionada `escapeJsStringLiteral`, um escape distinto (barra invertida, aspas duplas, `<` neutralizado como `<` contra a sequência `</script`) usado só dentro do `<script>`; `escapeHtmlAttribute` continua reservado só para o `href`.
- **Files modified:** `convex/lib/authCompletionPage.ts`
- **Verification:** Chamada manual do helper com params de teste incluindo aspas e `<script>` na query string (via `npx tsx -e`); confirmado que o `href` sai HTML-escapado e o literal do `<script>` sai JS-escapado, cada um correto para seu próprio contexto — ver seção "Issues Encontrados" abaixo para o output completo.
- **Committed in:** N/A (NO_GIT — arquivo não commitado por este agente)

---

**Total deviations:** 1 auto-fixed (1 bug, Rule 1)
**Impact on plan:** Bug de correção (não de escopo) encontrado e corrigido durante a própria implementação da Task 1, antes de qualquer commit ou verificação externa. Nenhum scope creep — o plano já pedia escape ao interpolar `callbackUrl`; a correção só troca *qual* escape é aplicado em cada contexto.

## Issues Encountered

Nenhum além do deviation acima. Verificação manual do HTML gerado (via `npx tsx -e`, chamando `renderCompletionPage` diretamente) confirmou:
- Com `hasCallbackParams=true`: contém `janja://callback?code=...` (parâmetros preservados exatamente como recebidos via `params.toString()`), o texto "Você pode fechar esta aba", um `<a href="...">` de fallback, e um único `<script>` disparando o redirect automático.
- Com `hasCallbackParams=false`: nenhum `<script>`, mensagem genérica "Nada para completar aqui.".
- Um valor de teste malicioso (`state` contendo `"` e `<script>`) veio automaticamente percent-encoded pelo próprio `URLSearchParams.toString()` antes mesmo de chegar aos escapes — os dois escapes aplicados são defesa em profundidade, não a única camada.

## User Setup Required

**Este plano não inclui o checkpoint humano — ele está alocado ao Plano 09-03.** Mas como o hard_constraint exigiu registrar aqui, com precisão, a ordem correta e o que quebra se invertida:

### O que precisa mudar fora do código (dashboard da WorkOS)

O valor cadastrado como *redirect URI permitido* no dashboard da WorkOS precisa passar de
`janja://callback` para `https://<deployment>.convex.site/auth/complete` (o mesmo host de
`VITE_CONVEX_SITE_URL` + `/auth/complete`).

### Ordem obrigatória (fazer fora de ordem quebra o login)

1. **Definir `VITE_CONVEX_SITE_URL` em `.env.local`** com a URL `.convex.site` real do
   deployment (aparece no dashboard do Convex ou via `npx convex dashboard`; **não** é a
   mesma URL de `VITE_CONVEX_URL`, que termina em `.convex.cloud`).
2. **Publicar `convex/http.ts` no deployment** (`npx convex deploy`, ou o fluxo de deploy
   já em uso pelo projeto) — isso coloca a rota `/auth/complete` no ar, respondendo na URL
   de `VITE_CONVEX_SITE_URL`.
3. **Verificar a rota está no ar** antes de mexer no dashboard da WorkOS: abrir
   `https://<deployment>.convex.site/auth/complete` (sem `code`/`error` na query) num
   navegador — deve mostrar "Nada para completar aqui.", não um 404. Isso confirma a rota
   existe antes de qualquer redirect real depender dela.
4. **Gerar o build com a variável nova presente** (`npm run build:win` ou equivalente) —
   `VITE_CONVEX_SITE_URL` é substituída no bundle em tempo de build (09-RESEARCH.md §4);
   um instalador gerado sem essa variável em `.env.local` embute `REDIRECT_URI` como
   `undefined/auth/complete` (não crasha, mas o login falha com um erro claro vindo de
   `isAuthConfigured()`/`AuthNotConfiguredError` — não um crash silencioso).
5. **Só então trocar o redirect URI no dashboard da WorkOS** para
   `https://<deployment>.convex.site/auth/complete`.

### O que quebra se a ordem for invertida

- **Se o dashboard da WorkOS for atualizado ANTES do passo 2 (rota publicada):** qualquer
  login real durante essa janela navega para uma URL que ainda não existe no Convex — o
  usuário vê um erro genérico do Convex (rota não encontrada), não a página de conclusão.
  Falha visível, mas confusa.
- **Se o dashboard for atualizado ANTES do build novo estar em uso (passo 4) em alguma
  máquina:** qualquer instalação com o binário antigo ainda pede `redirectUri:
  'janja://callback'` diretamente à WorkOS — que agora rejeita, porque esse valor não é
  mais o cadastrado. Login quebra para quem não atualizou o app, com um erro da própria
  WorkOS (`redirect_uri_mismatch` ou equivalente), antes mesmo de chegar a qualquer código
  deste projeto.
- **Se o build novo for distribuído ANTES do dashboard ser atualizado (ordem seguindo os
  passos 1-4 mas pulando o 5):** o app pede `redirectUri` apontando para
  `.../auth/complete`, mas a WorkOS só aceita o antigo `janja://callback` — rejeita a
  requisição de autorização (falha imediata, visível, antes de abrir qualquer aba) até o
  passo 5 ser feito. Esta é a ordem mais segura de errar, porque a falha é imediata e
  óbvia, não um travamento silencioso numa aba.

## Next Phase Readiness

- Código pronto para o checkpoint humano do Plano `09-03`, que deve seguir a sequência
  acima (env var → deploy Convex → verificar rota → build → dashboard WorkOS) e testar o
  fluxo completo numa máquina Windows real, incluindo Brave (ver `09-RESEARCH.md §7` —
  há uma chance não confirmada de que a mudança também resolva o travamento conhecido do
  Brave, por ser uma navegação para `https://` normal em vez de direto para um esquema
  customizado).
- 173 testes, `npm run typecheck` e `npm run build` passam limpos após as três tasks.
- Nenhum arquivo fora do escopo declarado (`convex/http.ts`, `src/main/auth/auth.ts`,
  `src/renderer/src/lib/convex-client.ts`, `src/renderer/src/main.tsx`,
  `.env.local.example`, mais o novo `convex/lib/authCompletionPage.ts`) foi tocado —
  confirmado via `git status --short`.
- Nada commitado por este agente (NO_GIT) — todos os cinco arquivos modificados e o
  arquivo novo permanecem no working tree para o orquestrador commitar.

---
*Phase: 09-polimento-e-empacotamento*
*Completed: 2026-08-19*
