---
phase: 09-polimento-e-empacotamento
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - convex/http.ts
  - src/main/auth/auth.ts
  - src/renderer/src/lib/convex-client.ts
  - src/renderer/src/main.tsx
  - .env.local.example
autonomous: true

must_haves:
  truths:
    - "Ao concluir o login, a aba do navegador mostra uma página própria dizendo que o login deu certo e que a aba pode ser fechada, em vez de ficar parada na tela interna do provedor de autenticação"
    - "Um build empacotado sem VITE_CONVEX_URL configurada mostra uma tela de erro legível em português, não um popup de exceção com stack trace de node_modules"
  artifacts:
    - path: "convex/http.ts"
      provides: "Rota GET /auth/complete que serve HTML de conclusão e dispara o redirect para janja://callback"
      contains: "/auth/complete"
    - path: "src/main/auth/auth.ts"
      provides: "REDIRECT_URI construído a partir de VITE_CONVEX_SITE_URL + /auth/complete, com erro legível se a variável faltar"
      contains: "VITE_CONVEX_SITE_URL"
    - path: "src/renderer/src/lib/convex-client.ts"
      provides: "Nenhum throw no nível do módulo — falha de configuração vira estado, não exceção não capturada"
  key_links:
    - from: "src/main/auth/auth.ts (getSignInUrl)"
      to: "convex/http.ts (rota /auth/complete)"
      via: "redirectUri passado à WorkOS, cadastrado no dashboard como o mesmo host de VITE_CONVEX_SITE_URL"
      pattern: "VITE_CONVEX_SITE_URL"
    - from: "convex/http.ts (rota /auth/complete)"
      to: "janja://callback"
      via: "window.location.href no HTML servido, preservando code/state/error da query string"
      pattern: "janja://callback"
    - from: "src/renderer/src/main.tsx"
      to: "src/renderer/src/lib/convex-client.ts"
      via: "checagem de configuração antes de montar ConvexProviderWithAuth"
      pattern: "isConvexConfigured|convexClient"
---

<objective>
Implementar AUTH-07 (página de conclusão de login) pelo caminho já decidido em
`STATE.md` — uma HTTP action do Convex servindo HTML em `VITE_CONVEX_SITE_URL`, sem
infraestrutura nova — e, na mesma varredura pelo processo de auth, corrigir um crash de
módulo ainda vivo em `convex-client.ts` que reproduziria, num build empacotado com env
var faltando, o mesmo tipo de bug que a Fase 2 já corrigiu uma vez para `auth.ts`
(`02-VERIFICACAO.md`, achado #3) — só que nunca foi corrigido para este arquivo.

Purpose: fecha AUTH-07. A aba do navegador não pode ser fechada pelo app — foi aberta
pelo SO via `shell.openExternal`, não por script, e todo navegador bloqueia
`window.close()` nesse caso por design (mesmo comportamento de Discord/Slack/Spotify,
já documentado na decisão registrada). O que dá pra fazer, e é o que este plano faz, é
não deixar o usuário encarando a tela interna da WorkOS sem saber se deu certo.
Output: rota HTTP nova no Convex, `redirectUri` da WorkOS apontando pra ela, e duas
armadilhas de variável de ambiente (uma nova, uma preexistente) fechadas com mensagem
legível em vez de crash.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/09-polimento-e-empacotamento/09-RESEARCH.md
@.planning/STATE.md
@.planning/phases/02-convex-auth-workos/02-VERIFICACAO.md
@src/main/auth/auth.ts
@src/renderer/src/lib/convex-client.ts
@src/renderer/src/main.tsx
@.env.local.example

# convex/http.ts é criado pela Fase 7 (Plano 07-02) para a rota do webhook do LiveKit
# (/livekit/webhook). Por causa da ordem de dependência (F9 depende de F0-F8 inteiras,
# ver ROADMAP), esse arquivo já existe quando este plano executa de verdade. Ler o
# arquivo primeiro e ADICIONAR a rota nova ao httpRouter existente — nunca sobrescrever
# ou recriar o arquivo do zero. Se por algum motivo o arquivo ainda não existir (F7 não
# executada), criar o arquivo com só a rota desta fase e registrar isso claramente no
# SUMMARY como uma dependência fora de ordem.
#
# VITE_CONVEX_SITE_URL já é mencionada (só em comentário, não em código) pelo Plano
# 07-02 (`infra/livekit/livekit.yaml`) — não é uma variável nova inventada aqui, é a
# formalização de um nome que a Fase 7 já assume existir em `.env.local`.
#
# Padrão a seguir para erro legível (já estabelecido em src/main/auth/auth.ts,
# AuthNotConfiguredError): nunca lançar no nível do módulo; validar só no primeiro uso
# real, com mensagem dizendo exatamente qual variável falta e onde configurá-la.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rota /auth/complete no Convex</name>
  <files>convex/http.ts</files>
  <action>
    Ler `convex/http.ts` (criado pela Fase 7 para `/livekit/webhook`) e adicionar uma
    rota nova ao mesmo `httpRouter`, sem tocar na rota existente:

    ```ts
    http.route({
      path: "/auth/complete",
      method: "GET",
      handler: httpAction(async (_ctx, request) => {
        const params = new URL(request.url).searchParams
        const hasCallbackParams = params.has("code") || params.has("error")
        const callbackUrl = `janja://callback?${params.toString()}`
        const html = renderCompletionPage(hasCallbackParams, callbackUrl)
        return new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        })
      })
    })
    ```

    `renderCompletionPage` (função auxiliar no mesmo arquivo, ou em
    `convex/lib/authCompletionPage.ts` seguindo o padrão de `convex/lib` já existente no
    projeto) monta um HTML **totalmente inline** (sem CSS/JS externos — HTTP action não
    serve assets estáticos):

    - Se `hasCallbackParams`: um `<script>` que roda `window.location.href =
      '${callbackUrl}'` assim que a página carrega (dispara o handler do protocolo
      `janja://` no SO), MAIS um texto sempre visível ("Login concluído. Você pode
      fechar esta aba.") e um link manual `<a href="${callbackUrl}">Abrir o Janja</a>`
      como fallback caso o navegador bloqueie o redirect automático (alguns navegadores
      pedem confirmação explícita de clique para abrir um app externo).
    - Se **não** `hasCallbackParams` (alguém abriu a URL sem vir de um callback de
      verdade — ex: digitou a URL à mão): mensagem genérica ("Nada para completar aqui.")
      sem tentar redirecionar para `janja://callback` vazio.
    - Nunca reformatar `code`/`state`/`error` — repassar exatamente a query string
      recebida (`params.toString()`), porque `handleCallback` (main process) já valida
      `state` contra o PKCE em memória; alterar a ordem ou formatação dos parâmetros não
      quebra nada (são só query params), mas reconstruir a query manualmente convidaria a
      esquecer um campo que a WorkOS mande no futuro (ex: `error_description`).

    Escapar `callbackUrl` como atributo HTML (`href`) antes de interpolar — mesmo os
    valores vindo da WorkOS, não confiar em query string não escapada dentro de HTML.
  </action>
  <verify>
    `npx convex dev --once` (ou `npx tsc --noEmit -p convex/tsconfig.json`, o comando de
    typecheck do Convex já usado no projeto) não acusa erro de tipo na rota nova.
    Ler o HTML gerado manualmente (chamar a função helper com params de teste) e
    confirmar que contém `janja://callback?code=...` com os mesmos parâmetros passados,
    o texto "pode fechar esta aba", e não contém `<script>` nenhum se `hasCallbackParams`
    for falso.
  </verify>
  <done>`convex/http.ts` com a rota `/auth/complete` registrada no `httpRouter`
  existente, servindo HTML de conclusão que redireciona para `janja://callback`
  preservando a query string original, com fallback de link manual e mensagem sempre
  visível.</done>
</task>

<task type="auto">
  <name>Task 2: Trocar o redirectUri da WorkOS para a página de conclusão</name>
  <files>src/main/auth/auth.ts, .env.local.example</files>
  <action>
    Em `src/main/auth/auth.ts`, trocar:
    ```ts
    const REDIRECT_URI = 'janja://callback'
    ```
    por uma leitura de `VITE_CONVEX_SITE_URL` (prefixo `VITE_` sozinho — sem
    `MAIN_VITE_` — já é visível no processo main, confirmado em `09-RESEARCH.md` §4, e é
    o mesmo nome que `.env.local.example`/o Plano `07-02` já usam para a URL de HTTP
    actions do Convex, distinta de `VITE_CONVEX_URL` que é a URL do client SDK):

    ```ts
    const SITE_URL = import.meta.env.VITE_CONVEX_SITE_URL
    const REDIRECT_URI = `${SITE_URL}/auth/complete`
    ```

    Atualizar a interface `ImportMetaEnv` (bloco `declare global` no topo do arquivo)
    incluindo `VITE_CONVEX_SITE_URL: string` ao lado de `MAIN_VITE_WORKOS_CLIENT_ID`.

    **Não deixar isso falhar em silêncio se a variável faltar.** Seguir o mesmo padrão
    já usado para `MAIN_VITE_WORKOS_CLIENT_ID`: estender `isAuthConfigured()` para
    também exigir `SITE_URL` não-vazia, e o texto de `AuthNotConfiguredError` para citar
    as duas variáveis possivelmente faltando, deixando claro qual delas realmente está
    ausente (montar a mensagem dinamicamente, não um texto fixo genérico).

    Em `.env.local.example`, adicionar a entrada nova com comentário explicando as duas
    pontas que dependem dela — o `redirectUri` que o app usa E o valor que precisa estar
    cadastrado no dashboard da WorkOS como redirect URI permitido (isso é feito no
    checkpoint humano do Plano `09-03`, só documentar aqui onde a variável é usada):
    ```
    # URL de HTTP actions do Convex (domínio .convex.site, diferente de VITE_CONVEX_URL
    # que é .convex.cloud). Usada para montar o redirectUri do login (auth.ts) — o mesmo
    # valor + "/auth/complete" precisa estar cadastrado no dashboard da WorkOS como
    # redirect URI permitido (ver checkpoint da Fase 9).
    VITE_CONVEX_SITE_URL=
    ```
  </action>
  <verify>
    `npm run typecheck:node` passa (confirma a extensão de `ImportMetaEnv`).
    `grep -n "janja://callback'" src/main/auth/auth.ts` não retorna nada — confirma que
    o literal antigo não sobrou em nenhum outro lugar do arquivo por engano (o literal
    `janja://callback` ainda deve existir dentro de `convex/http.ts`, que é o novo lugar
    correto).
    `grep -n "VITE_CONVEX_SITE_URL" .env.local.example src/main/auth/auth.ts` confirma
    as duas pontas.
  </verify>
  <done>`REDIRECT_URI` construído a partir de `VITE_CONVEX_SITE_URL`, com erro legível
  (não crash) se a variável faltar; `.env.local.example` documentando a variável nova e
  as duas configurações externas que dependem dela.</done>
</task>

<task type="auto">
  <name>Task 3: Corrigir o crash de módulo em convex-client.ts</name>
  <files>src/renderer/src/lib/convex-client.ts, src/renderer/src/main.tsx</files>
  <action>
    `convex-client.ts` hoje lança uma exceção no nível do módulo se `VITE_CONVEX_URL`
    estiver vazia — e `main.tsx` importa esse módulo antes de `createRoot(...).render()`
    rodar, então essa exceção nunca é capturada por nenhum error boundary React (nem
    existe DOM montado ainda). Num build empacotado com a variável faltando (o cenário
    descrito em `09-RESEARCH.md` §5), isso é a mesma classe de bug que `02-VERIFICACAO.md`
    já registrou e corrigiu para `auth.ts` (achado #3) — só que nunca foi corrigido
    aqui.

    Refatorar `convex-client.ts` para não lançar no import:
    ```ts
    import { ConvexReactClient } from 'convex/react'

    const url = import.meta.env.VITE_CONVEX_URL

    export const isConvexConfigured = Boolean(url)
    export const convexClient = isConvexConfigured ? new ConvexReactClient(url) : null
    ```

    Em `src/renderer/src/main.tsx`, antes de montar `ConvexProviderWithAuth`, checar
    `isConvexConfigured` e `convexClient`. Se falso/null, renderizar uma tela mínima e
    autocontida (sem depender de nenhum componente que precise do Convex já montado) com
    texto direto ao ponto, em português, dizendo o que está errado e o que fazer — por
    exemplo "Configuração incompleta: VITE_CONVEX_URL não definida. Este build não foi
    gerado corretamente — contate quem fez o empacotamento." Não precisa de um componente
    novo em `features/` se a tela for simples o bastante para ficar inline em `main.tsx`;
    usar bom senso dado o padrão já estabelecido em `features/auth/` se preferir extrair.

    Só chamar `createRoot(...).render(<ConvexProviderWithAuth client={convexClient!}
    ...>)` no caminho em que `convexClient` não é null — o `!` é seguro ali porque está
    dentro do branch que já checou `isConvexConfigured`.
  </action>
  <verify>
    `npm run typecheck:web` passa.
    Simular localmente: rodar `VITE_CONVEX_URL= npm run build` (variável vazia) e
    confirmar que o build **não falha** (a checagem é em runtime, não em build time — só
    o texto de erro muda o que aparece na tela, o bundle continua sendo gerado
    normalmente). Depois `grep -n "throw new Error" src/renderer/src/lib/convex-client.ts`
    não retorna nenhuma ocorrência no nível do módulo (fora de função).
  </verify>
  <done>Faltar `VITE_CONVEX_URL` num build nunca mais produz um popup de exceção com
  stack trace de `node_modules` — produz uma tela de erro legível em português, o mesmo
  padrão já em vigor para `MAIN_VITE_WORKOS_CLIENT_ID`.</done>
</task>

</tasks>

<verification>
- `npm run build` completo (typecheck + electron-vite build) passa depois das três
  tarefas.
- `grep -rn "janja://callback" src convex` mostra exatamente duas ocorrências: dentro do
  HTML gerado por `convex/http.ts` (o destino final do redirect) e nenhuma mais em
  `src/main/auth/auth.ts` (que agora usa `VITE_CONVEX_SITE_URL`).
- Nenhuma das mudanças deste plano toca em `src/main/auth/deep-link-handler.ts` nem em
  `ipc-handlers.ts` — o parsing do callback (`extractCallbackUrl`, `handleCallback`)
  continua recebendo exatamente o mesmo formato de URL (`janja://callback?code=...
  &state=...`) que já esperava, só a origem de quem dispara essa navegação muda (da
  WorkOS diretamente para a página HTML desta fase).
</verification>

<success_criteria>
AUTH-07 implementado pelo caminho decidido em `STATE.md`, sem infraestrutura nova. A
armadilha de variável de ambiente ausente em build empacotado — já corrigida uma vez
para o client WorkOS na Fase 2 — está fechada também para o client do Convex, a outra
metade do mesmo tipo de bug que nunca tinha sido corrigida.
</success_criteria>

<output>
After completion, create `.planning/phases/09-polimento-e-empacotamento/09-02-SUMMARY.md`
</output>
