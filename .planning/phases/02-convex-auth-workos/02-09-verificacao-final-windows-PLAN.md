---
phase: 02-convex-auth-workos
plan: 09
type: execute
wave: 6
depends_on: ["02-08"]
files_modified: []
autonomous: false

must_haves:
  truths:
    - "Os 5 critérios de sucesso da Fase 2 (ROADMAP.md) são verdadeiros numa máquina Windows real, não em suposição de código"
    - "AUTH-01 a AUTH-06 funcionam de ponta a ponta: login pelo navegador do sistema, persistência entre reinícios, recuperação de credencial corrompida, resiliência de sessão, logout, e username#tag exibido"
  artifacts: []
  key_links: []
---

<objective>
Verificação humana final da Fase 2, na máquina Windows nativa — o único ambiente onde o
fluxo completo (protocolo customizado, `second-instance`, `safeStorage`/DPAPI, navegador
do sistema) pode ser validado de verdade (WSL2 não renderiza a janela do Electron de forma
confiável, conforme já registrado em `00-04-SUMMARY.md`).

Purpose: fechar a Fase 2 com os 5 critérios de sucesso do ROADMAP confirmados por um humano,
não por leitura de código — em particular a resiliência de sessão (critério 4) e a
recuperação de credencial corrompida (critério 3), que são exatamente os pitfalls que
motivaram o desenho desta fase inteira.
Output: Fase 2 marcada como concluída, com evidência de cada critério testado.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/research/PITFALLS.md
@.planning/phases/00-bootstrap-do-repo/00-04-SUMMARY.md
</context>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <what-built>
    Todo o fluxo de auth desta fase (planos 02-01 a 02-08): login via `janja://` no
    navegador do sistema, persistência criptografada via `safeStorage`, refresh automático
    de token, geração de `username#tag`, heartbeat de presença, logout, e o vigia de
    `isAuthenticated` (mitigação do bug documentado do Convex).
  </what-built>
  <how-to-verify>
    Preparação na máquina Windows nativa:
    1. `git pull` do branch desta fase; `npm install`; confirmar que `.env.local` tem
       `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL` e `MAIN_VITE_WORKOS_CLIENT_ID` preenchidos
       (do checkpoint 02-04).
    2. Rodar `npx convex dev` numa aba de terminal (deixar rodando) e `npm run dev` numa
       outra.

    Confirme "provisionado" ou descreva o que faltou antes de seguir para o roteiro de
    verificação abaixo.
  </how-to-verify>
  <resume-signal>Digite "ambiente pronto" quando as duas etapas acima estiverem OK, ou descreva o problema.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Fluxo de autenticação completo, ponta a ponta, rodando de verdade.
  </what-built>
  <how-to-verify>
    Com o app aberto (`npm run dev`) e sem sessão salva ainda:

    1. **AUTH-01 (login)**: clicar "Entrar com Google" — o navegador padrão do Windows abre
       (nunca uma janela do próprio app), você autentica com uma conta Google real, e o app
       volta automaticamente autenticado (a tela de login some) em menos de 15 segundos,
       sem precisar colar nada manualmente.
    2. **AUTH-06 (identidade)**: depois do primeiro login, confirmar em algum lugar visível
       da tela (mesmo que temporário/simples nesta fase) que um `username#tag` foi gerado —
       ex: abrir o DevTools do Electron (F12) e checar `window.auth.getUser()` no console,
       ou o que a Task 1 do plano 02-08 tiver exposto na tela.
    3. **AUTH-02 (persistência)**: fechar o app inteiro e abrir de novo. Confirma que volta
       autenticado, sem pedir login de novo.
    4. **AUTH-03 (corrupção da credencial)**: fechar o app; apagar ou corromper o arquivo
       `auth-session.enc` (procurar em `%APPDATA%/<nome-do-app>/auth-session.enc` — o nome
       exato da pasta depende do `app.getPath('userData')`; confirmar o caminho durante o
       teste). Abrir o app de novo: confirma que cai na tela de login (nunca crash, nunca
       tela branca).
    5. **AUTH-05 (logout)**: logar de novo; usar a ação de logout (onde a Task 1/2 do plano
       02-08 tiver exposto); confirma que volta à tela de login e que uma nova tentativa de
       login funciona normalmente depois.
    6. **AUTH-04 (sessão longa)**: logar de novo e deixar o app aberto e em uso por pelo
       menos 30 minutos (pode minimizar, mas manter o processo rodando — simula o cenário de
       call de voz longa). Depois desse tempo, interagir com o app de novo (qualquer coisa
       que dispare uma query/mutation do Convex) e confirmar que não trava em estado
       não-autenticado. Observar o console do DevTools (F12) por qualquer log
       `[auth-watchdog]` — se aparecer, confirmar que o app se recupera sozinho (reload
       automático) em até ~15s depois do log, sem intervenção manual.
  </how-to-verify>
  <resume-signal>Digite "aprovado" se todos os 6 pontos acima passaram, ou descreva exatamente qual falhou (número do ponto + o que aconteceu).</resume-signal>
</task>

</tasks>

<verification>
- Os 5 critérios de sucesso da Fase 2 no ROADMAP.md estão confirmados por teste humano real.
- AUTH-01 a AUTH-06 verificados individualmente conforme o roteiro acima.
</verification>

<success_criteria>
Fase 2 (Convex + auth WorkOS) completa: login resiliente, sessão persistente, recuperação
graciosa de falha de `safeStorage`, resiliência a sessão longa (ou mitigação observada
funcionando), logout, e identidade única — todos confirmados na máquina Windows real.
</success_criteria>

<output>
After completion, create `.planning/phases/02-convex-auth-workos/02-09-SUMMARY.md`.
</output>
