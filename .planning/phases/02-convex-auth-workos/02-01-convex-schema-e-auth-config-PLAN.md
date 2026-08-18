---
phase: 02-convex-auth-workos
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - convex/schema.ts
  - convex/auth.config.ts
  - .env.local.example
autonomous: true

must_haves:
  truths:
    - "O projeto tem um schema Convex com as tabelas users e presence, prontas para receber dados reais quando o projeto Convex existir"
    - "Convex sabe validar um JWT emitido pelo WorkOS AuthKit sem precisar de nenhuma API key"
  artifacts:
    - path: "convex/schema.ts"
      provides: "Tabelas users (workosId, username, tag, displayName, avatarUrl) e presence (userId, lastSeen), com índices por workosId, por (username, tag) e por userId"
      contains: "defineTable"
    - path: "convex/auth.config.ts"
      provides: "Providers customJwt do WorkOS (JWKS público, sem apiKey)"
      contains: "customJwt"
    - path: ".env.local.example"
      provides: "Documentação das env vars necessárias dos dois lados (electron-vite e Convex)"
  key_links:
    - from: "convex/auth.config.ts"
      to: "https://api.workos.com/sso/jwks/${WORKOS_CLIENT_ID}"
      via: "jwks url (fetch automático do Convex, sem código nosso)"
      pattern: "jwks:.*workos\\.com"
---

<objective>
Criar a fundação Convex desta fase: o schema com as duas tabelas que este fase precisa
(`users` e `presence` — nada de servers/channels/messages, isso é F4-F6) e a configuração
de autenticação (`auth.config.ts`) que ensina o Convex a validar tokens do WorkOS AuthKit
via JWKS público, sem nunca precisar da API key secreta.

Purpose: Sem este schema e este `auth.config.ts` já existindo, o checkpoint humano de
`npx convex dev` (próximo plano, 02-04) não tem nada de útil para fazer push — subiria um
projeto Convex vazio. Este plano garante que o primeiro `npx convex dev` do usuário já leva
o projeto real, não um placeholder.
Output: `convex/schema.ts`, `convex/auth.config.ts`, `.env.local.example` documentando toda
env var necessária, e a dependência `convex` instalada no projeto.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/02-convex-auth-workos/02-RESEARCH.md
@docs/superpowers/specs/2026-08-18-janja-discord-clone-design.md

# Seções relevantes do design doc: §5 (Modelo de dados) — mas SÓ implementar as tabelas
# users e presence aqui. servers, channels, messages, invites, friendships, voiceStates
# etc. são de outras fases (F4-F7) — não criar essas tabelas agora, mesmo que apareçam no
# schema completo do design doc.

# 02-RESEARCH.md §2 e §4 já confirmam, com evidência de tipos publicados: nenhuma API key
# da WorkOS é necessária, nem aqui nem no Electron. Não adicionar WORKOS_API_KEY em
# lugar nenhum.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Dependência do Convex e schema das duas tabelas desta fase</name>
  <files>package.json, convex/schema.ts</files>
  <action>
    Adicionar ao `package.json`: dependência `convex` (`^1.44.0`) e dependência de
    desenvolvimento `convex-test` (`^0.0.55`) — esta última será usada pelo plano de TDD da
    identidade (`username#tag`, plano 02-05) e pelos testes de presença (plano 02-06), ambos
    mais adiante nesta fase. Rodar `npm install` depois de editar.

    Criar `convex/schema.ts`:
    ```ts
    import { defineSchema, defineTable } from 'convex/server'
    import { v } from 'convex/values'

    export default defineSchema({
      users: defineTable({
        workosId: v.string(),
        username: v.string(),
        tag: v.string(),
        displayName: v.string(),
        avatarUrl: v.optional(v.string()),
      })
        .index('by_workos_id', ['workosId'])
        .index('by_username_tag', ['username', 'tag']),

      presence: defineTable({
        userId: v.id('users'),
        lastSeen: v.number(),
      }).index('by_user', ['userId']),
    })
    ```
    Não criar nenhuma outra tabela (servers, channels, messages, invites, friendships,
    voiceStates, dmChannels, dmMembers, friendRequests, channelReadState pertencem a F4-F7).
    O Convex não tem constraint de unicidade nativa — o índice `by_username_tag` só acelera
    a consulta que a mutation de F2 (plano 02-05) vai usar para checar colisão antes de
    inserir; a unicidade de fato é responsabilidade da mutation, não do índice.
  </action>
  <verify>`cat package.json` mostra `convex` em dependencies e `convex-test` em devDependencies; `npm install` roda sem erro; `convex/schema.ts` existe e exporta `defineSchema` com exatamente as tabelas `users` e `presence`.</verify>
  <done>Schema Convex com users+presence criado; convex/convex-test instalados; nenhuma tabela fora do escopo desta fase foi criada.</done>
</task>

<task type="auto">
  <name>Task 2: auth.config.ts e documentação das env vars</name>
  <files>convex/auth.config.ts, .env.local.example</files>
  <action>
    Criar `convex/auth.config.ts` exatamente como documentado oficialmente pelo Convex para
    WorkOS AuthKit (confirmado em 02-RESEARCH.md §4 — não inventar variação):
    ```ts
    const clientId = process.env.WORKOS_CLIENT_ID

    export default {
      providers: [
        {
          type: 'customJwt',
          issuer: 'https://api.workos.com/',
          algorithm: 'RS256',
          jwks: `https://api.workos.com/sso/jwks/${clientId}`,
          applicationID: clientId,
        },
        {
          type: 'customJwt',
          issuer: `https://api.workos.com/user_management/${clientId}`,
          algorithm: 'RS256',
          jwks: `https://api.workos.com/sso/jwks/${clientId}`,
        },
      ],
    }
    ```
    A segunda entrada (issuer `user_management/${clientId}`) é a que valida o token real
    emitido pelo fluxo AuthKit/Google usado aqui; a primeira cobre SSO puro e é mantida por
    ser exatamente o exemplo oficial. `process.env.WORKOS_CLIENT_ID` é uma env var do lado do
    **Convex** (setada via `npx convex env set WORKOS_CLIENT_ID ...` no checkpoint do próximo
    plano) — não confundir com a env var do Electron abaixo, que tem outro nome porque roda
    em outro runtime.

    Criar `.env.local.example` na raiz do repo (não é `.env.local` real — é o template
    versionado; `.env.local` já está no `.gitignore` via `.env.*`):
    ```
    # electron-vite expõe ao processo main qualquer variável prefixada com MAIN_VITE_
    # (ver electron.vite.config.ts). Client ID é público, pode estar aqui.
    MAIN_VITE_WORKOS_CLIENT_ID=client_xxx

    # Convex client no renderer. Preenchido com a URL do deployment mostrada por
    # `npx convex dev` na primeira vez que ele rodar (plano 02-04, checkpoint humano).
    VITE_CONVEX_URL=

    # Gerado automaticamente por `npx convex dev` na primeira execução — não editar à mão.
    # CONVEX_DEPLOYMENT=

    # NÃO EXISTE WORKOS_API_KEY NESTE ARQUIVO. Nenhuma API key da WorkOS é necessária nesta
    # fase — nem no Electron nem no Convex (ver 02-RESEARCH.md §2). O WORKOS_CLIENT_ID que o
    # convex/auth.config.ts lê é uma env var separada, do lado do Convex, setada via
    # `npx convex env set WORKOS_CLIENT_ID client_xxx` (mesmo valor do MAIN_VITE_WORKOS_CLIENT_ID
    # acima, só que configurada no painel/CLI do Convex, não neste arquivo).
    ```
  </action>
  <verify>`convex/auth.config.ts` exporta exatamente os dois providers `customJwt` acima, lendo `process.env.WORKOS_CLIENT_ID`; `.env.local.example` existe na raiz, documenta `MAIN_VITE_WORKOS_CLIENT_ID` e `VITE_CONVEX_URL`, e não contém nenhuma referência a uma API key secreta.</verify>
  <done>auth.config.ts pronto para validar tokens reais do WorkOS via JWKS assim que WORKOS_CLIENT_ID existir no ambiente Convex; template de env vars documentado e sem segredo nenhum.</done>
</task>

</tasks>

<verification>
- `npm install` concluído sem erro, `convex` e `convex-test` presentes no `package.json`.
- `convex/schema.ts` define somente `users` e `presence`, com os três índices descritos.
- `convex/auth.config.ts` não referencia nenhuma API key, só `WORKOS_CLIENT_ID`.
- `.env.local.example` deixa claro quais variáveis existem e em qual lado (Electron vs Convex).
</verification>

<success_criteria>
Base Convex pronta para o checkpoint humano do próximo plano (`npx convex dev`) já subir
algo real — schema e auth config completos para o escopo desta fase, sem nenhuma tabela ou
segredo fora do escopo.
</success_criteria>

<output>
After completion, create `.planning/phases/02-convex-auth-workos/02-01-SUMMARY.md`.
</output>
