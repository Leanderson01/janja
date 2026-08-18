---
phase: 02-convex-auth-workos
plan: 04
type: execute
wave: 2
depends_on: ["02-01"]
files_modified:
  - .env.local
autonomous: false

user_setup:
  - service: convex
    why: "Criar o projeto Convex real (a conta já existe, o projeto não) e ligar o deployment ao repositório local — passo interativo de login no navegador, o executor não tem acesso à conta"
    env_vars:
      - name: VITE_CONVEX_URL
        source: "Impresso no terminal por `npx convex dev` na primeira execução; também visível no dashboard do Convex em Settings > URL & Deploy Key"
      - name: CONVEX_DEPLOYMENT
        source: "Escrito automaticamente em .env.local por `npx convex dev` — não copiar manualmente"
    dashboard_config:
      - task: "Setar a env var WORKOS_CLIENT_ID no deployment do Convex (lida por convex/auth.config.ts)"
        location: "`npx convex env set WORKOS_CLIENT_ID client_xxx` ou Dashboard do Convex > Settings > Environment Variables"
  - service: workos
    why: "Confirmar o Client ID (já configurado pelo usuário no dashboard WorkOS, junto com o redirect URI janja://callback e Google OAuth) — só precisa ser copiado, não criado"
    env_vars:
      - name: MAIN_VITE_WORKOS_CLIENT_ID
        source: "Dashboard do WorkOS > sua aplicação AuthKit > Client ID (mesmo valor usado no passo do Convex acima)"

must_haves:
  truths:
    - "Existe um projeto Convex real, ligado a este repositório, com o schema e o auth.config.ts do plano 02-01 já publicados"
    - "convex/auth.config.ts consegue resolver process.env.WORKOS_CLIENT_ID no ambiente do deployment"
    - "O app Electron sabe onde está o Convex (VITE_CONVEX_URL) e qual client WorkOS usar (MAIN_VITE_WORKOS_CLIENT_ID)"
  artifacts:
    - path: ".env.local"
      provides: "CONVEX_DEPLOYMENT, VITE_CONVEX_URL, MAIN_VITE_WORKOS_CLIENT_ID preenchidos com valores reais (arquivo já cai no .gitignore via .env.*)"
  key_links:
    - from: ".env.local (VITE_CONVEX_URL)"
      to: "Convex deployment real"
      via: "ConvexReactClient (plano 02-07)"
      pattern: "VITE_CONVEX_URL"
---

<objective>
Único checkpoint desta fase que exige uma conta humana com sessão de navegador: rodar
`npx convex dev` pela primeira vez, criar o projeto Convex (a conta já existe, o projeto
ainda não — por desenho, ver a tarefa), e preencher as env vars reais que todos os planos
seguintes desta fase dependem. Nenhum passo aqui pode ser automatizado pelo executor — não
há credencial de conta Convex disponível para ele.

Purpose: `convex/_generated/` só existe depois que este comando roda com sucesso pela
primeira vez. Todo plano que importa de `./_generated/server` (identidade, presença,
wiring do renderer) trava sem isso.
Output: projeto Convex criado e linkado, `convex/_generated/` existindo, `.env.local` com
as três variáveis reais preenchidas.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/02-convex-auth-workos/02-RESEARCH.md
@.planning/phases/02-convex-auth-workos/02-01-convex-schema-e-auth-config-PLAN.md
@.env.local.example

# O usuário já tem conta Convex, mas NENHUM projeto criado ainda (é intencional — o comando
# abaixo cria o projeto). O usuário já configurou tudo do lado WorkOS (redirect URI
# janja://callback, Google OAuth, TTL do access token em 8h) — só falta copiar o Client ID.
# NÃO existe API key da WorkOS necessária em nenhum passo abaixo (02-RESEARCH.md §2).
</context>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <what-built>
    `convex/schema.ts` e `convex/auth.config.ts` (plano 02-01) já existem no repositório,
    prontos para serem publicados no primeiro projeto Convex real deste app.
  </what-built>
  <how-to-verify>
    Passos a executar na sua máquina (login interativo no navegador — não pode ser
    automatizado por mim):

    1. Na raiz do repositório, rodar:
       ```
       npx convex dev
       ```
    2. Quando pedir login, autenticar com a conta Convex que você já tem.
    3. Quando pedir para escolher/criar um projeto, criar um novo (ex: `janja`) — não há
       projeto Convex existente para este app ainda, essa etapa cria o primeiro.
    4. Deixar o comando terminar o primeiro push (ele vai criar `convex/_generated/` e
       escrever `CONVEX_DEPLOYMENT` em `.env.local` automaticamente). Pode deixar rodando em
       background durante o desenvolvimento das próximas fases, ou parar com Ctrl+C depois
       do primeiro push — os próximos planos desta fase não precisam dele continuar rodando,
       só precisam que `convex/_generated/` já exista.
    5. Copiar a URL do deployment mostrada no terminal (algo como
       `https://algum-nome-123.convex.cloud`) e adicionar ao `.env.local`:
       ```
       VITE_CONVEX_URL=https://algum-nome-123.convex.cloud
       ```
    6. No dashboard do WorkOS, copiar o Client ID da sua aplicação AuthKit (já configurada
       com o redirect URI `janja://callback`) e adicionar ao `.env.local`:
       ```
       MAIN_VITE_WORKOS_CLIENT_ID=client_xxxxxxxxxxxx
       ```
    7. Setar a mesma variável do lado do Convex (env var separada, outro runtime):
       ```
       npx convex env set WORKOS_CLIENT_ID client_xxxxxxxxxxxx
       ```
    8. Confirmar que não houve erro de validação de schema/auth.config no output do
       `npx convex dev` (se `convex/auth.config.ts` tivesse algum erro de sintaxe, o comando
       teria falhado no push).

    Ao final, `.env.local` deve conter três variáveis com valores reais:
    `CONVEX_DEPLOYMENT` (escrita automaticamente), `VITE_CONVEX_URL` (copiada do terminal) e
    `MAIN_VITE_WORKOS_CLIENT_ID` (copiada do dashboard WorkOS). Nenhuma API key da WorkOS
    entra em lugar nenhum deste arquivo.
  </how-to-verify>
  <resume-signal>Digite "provisionado" quando `.env.local` tiver as três variáveis preenchidas e `convex/_generated/` existir no repositório, ou descreva o erro encontrado (ex: falha de login, erro de push do schema).</resume-signal>
</task>

</tasks>

<verification>
- `convex/_generated/` existe no repositório (mesmo que não versionado — é gerado localmente).
- `.env.local` tem `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL` e `MAIN_VITE_WORKOS_CLIENT_ID` com valores reais.
- `npx convex env get WORKOS_CLIENT_ID` (ou o dashboard) confirma o valor setado do lado do Convex.
</verification>

<success_criteria>
Projeto Convex real existe, linkado a este repositório, com o schema e auth.config desta
fase já publicados; todas as env vars que os planos seguintes precisam existem com valores
reais.
</success_criteria>

<output>
After completion, create `.planning/phases/02-convex-auth-workos/02-04-SUMMARY.md`.
</output>
