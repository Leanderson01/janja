---
phase: 10-versao-web
plan: 03
type: execute
wave: 2
depends_on: ["10-01"]
files_modified:
  - package.json
  - package-lock.json
  - .env.local.example
  - src/renderer/src/platform/electron/auth.tsx
  - src/renderer/src/platform/web/auth.tsx
  - src/renderer/src/platform/web/auth.test.ts
  - src/renderer/src/hooks/useAuth.ts
  - src/renderer/src/hooks/useConvexAuthAdapter.ts
  - src/renderer/src/features/auth/AuthGate.tsx
  - src/renderer/src/features/auth/AuthWatchdog.tsx
  - src/renderer/src/features/auth/LoginScreen.tsx
  - src/renderer/src/features/auth/UserPanel.tsx
  - src/renderer/src/main.tsx
autonomous: true

must_haves:
  truths:
    - "No alvo web, o token que o Convex verifica vem do `@workos-inc/authkit-react`, e o `forceRefreshToken` do Convex chega ao `getAccessToken({ forceRefresh })` do AuthKit"
    - "No alvo Electron, o token continua vindo do processo main por IPC, sem nenhuma mudança de caminho"
    - "`AuthGate` e `AuthWatchdog` não sabem em qual plataforma estão: os dois perguntam ao contrato"
    - "`lib/profile-hint.ts` não mudou uma linha — o `User` do authkit-js tem exatamente os quatro campos que ele já esperava"
    - "A tela de login existe nos dois alvos: no Electron abre o navegador externo, na web navega a própria aba"
    - "Sem `VITE_WORKOS_CLIENT_ID`, o alvo web mostra uma tela de configuração incompleta legível — nunca uma exceção não capturada"
  artifacts:
    - path: "src/renderer/src/platform/web/auth.tsx"
      provides: "AuthKitProvider com devMode, adaptador do Convex com forceRefresh, sessão, signIn/signOut, perfil"
      exports: ["auth"]
      min_lines: 110
    - path: "src/renderer/src/platform/electron/auth.tsx"
      provides: "o caminho IPC de hoje, atrás do contrato"
      exports: ["auth"]
      min_lines: 80
    - path: "src/renderer/src/platform/web/auth.test.ts"
      provides: "prova de que forceRefreshToken vira forceRefresh e de que erro do AuthKit vira token nulo, nunca exceção"
      min_lines: 60
  key_links:
    - from: "src/renderer/src/main.tsx"
      to: "@platform/auth"
      via: "auth.AuthProvider envolvendo o ConvexProviderWithAuth, e auth.useConvexAuthAdapter como prop useAuth"
      pattern: "@platform/auth"
    - from: "src/renderer/src/platform/web/auth.tsx"
      to: "@workos-inc/authkit-react"
      via: "AuthKitProvider + useAuth"
      pattern: "@workos-inc/authkit-react"
    - from: "src/renderer/src/features/auth/AuthWatchdog.tsx"
      to: "@platform/auth"
      via: "hasLiveSession() antes de qualquer medida drástica"
      pattern: "hasLiveSession"
    - from: "src/renderer/src/features/auth/AuthGate.tsx"
      to: "@platform/auth"
      via: "getProfile() alimentando a dica do ensureUser"
      pattern: "getProfile"
---

<objective>
Trocar a FONTE do token no alvo web, sem trocar o formato — e sem tocar em
`convex/auth.config.ts`, que continua verificando o mesmo JWT, do mesmo
emissor, pelo mesmo JWKS.

Purpose: o ROADMAP media esta costura como "grande" porque hoje o login sai
pelo processo main, volta por protocolo customizado e a sessão vive cifrada em
disco. A pesquisa mediu arquivo por arquivo e concluiu o contrário: é a MENOR
das três costuras. `profile-hint.ts` não muda; `AuthGate` e `AuthWatchdog`
mudam uma linha cada; o adaptador do Convex é o mesmo `useMemo` sobre o mesmo
trio, lendo de outro lugar. O trabalho real é montar o provider e a tela de
login que navega em vez de fazer IPC.

Output: `@platform/auth` implementado dos dois lados, o app montando o provider
certo por alvo, e o `forceRefreshToken` preservado ponta a ponta — que é
exatamente o motivo de o `@convex-dev/workos` ter sido descartado.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-versao-web/10-RESEARCH.md
@.planning/phases/10-versao-web/10-01-SUMMARY.md
@src/renderer/src/platform/contract.ts

# Os cinco arquivos da costura, exatamente como estão hoje
@src/renderer/src/hooks/useAuth.ts
@src/renderer/src/hooks/useConvexAuthAdapter.ts
@src/renderer/src/features/auth/AuthGate.tsx
@src/renderer/src/features/auth/AuthWatchdog.tsx
@src/renderer/src/lib/profile-hint.ts
@src/renderer/src/main.tsx
@src/renderer/src/lib/convex-client.ts

# O lado que NÃO muda
@convex/auth.config.ts
@src/preload/index.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: `@platform/auth` nos dois alvos, com o forceRefreshToken preservado</name>
  <files>package.json, package-lock.json, .env.local.example, src/renderer/src/platform/electron/auth.tsx, src/renderer/src/platform/web/auth.tsx, src/renderer/src/platform/web/auth.test.ts</files>
  <action>
    **Instalar `@workos-inc/authkit-react`** (`npm install @workos-inc/authkit-react`,
    versão atual 0.16.2, que traz `@workos-inc/authkit-js` como dependência e
    declara `peerDependencies: { react: ">=17" }` — compatível com o React 19
    do projeto). **NÃO instalar `@convex-dev/workos`**: decisão travada, e o
    motivo precisa ficar escrito em comentário no `platform/web/auth.tsx`,
    porque ele é a coisa "óbvia" que a próxima pessoa vai querer adicionar. O
    `dist` publicado dele tem 30 linhas, não importa `authkit-react` em runtime,
    é literalmente o `useConvexAuthAdapter.ts` que já existe neste repo — e
    **descarta o `forceRefreshToken`**, chamando `getAccessToken()` sem
    argumento. Isso joga fora exatamente a alavanca que o `AuthWatchdog` existe
    para puxar (Pitfall 4, `get-convex/convex-backend#259`, TTL de 8h). Uma
    dependência a mais para ficar pior.

    **`platform/electron/auth.tsx`** — empacota o caminho de hoje, sem mudar
    comportamento:
    - `AuthProvider = ({ children }) => <>{children}</>` (o Electron não tem
      provider de auth: quem guarda a sessão é o processo main). Comentar isso,
      senão parece um esquecimento.
    - `useSession()` = o corpo atual de `hooks/useAuth.ts` (o
      `window.auth.getUser()` com `.catch`/`.finally` — **manter os dois**: sem
      eles qualquer rejeição deixa `loading` em true para sempre, e isso já
      travou o app uma vez).
    - `useConvexAuthAdapter()` = o corpo atual de
      `hooks/useConvexAuthAdapter.ts`.
    - `signIn`/`signOut` = `window.auth.signIn()`/`signOut()`.
    - `getProfile()` = `window.auth.getUser().catch(() => null)`.
    - `hasLiveSession()` = `window.auth.getUser().then(Boolean).catch(() => false)`.

    **`platform/web/auth.tsx`** — o caminho novo:

        <AuthKitProvider
          clientId={import.meta.env.VITE_WORKOS_CLIENT_ID}
          devMode={true}
          onRefreshFailure={({ signIn }) => { void signIn() }}
        >

    Cada decisão com o comentário que a sustenta:
    - **`devMode={true}` é decisão de CUSTO, não de engenharia, e está
      travada.** Fora de `devMode`, o `authkit-js` guarda o refresh token só em
      memória (`session-data.ts`) e depende de um cookie HttpOnly do domínio da
      WorkOS; para esse cookie sobreviver ao bloqueio de cookies de terceiros a
      WorkOS exige um **custom auth domain**, listado no preço deles como
      "Custom domain — US$ 99/mo". Para dez amigos, está fora. A própria doc
      client-only da WorkOS manda usar `devMode` nesse caso.
      **O que se perde, dito com todas as letras:** o refresh token fica em
      `localStorage`, legível por JavaScript da própria origem — o risco
      concreto é XSS. **A mitigação é um requisito verificável desta fase, não
      uma boa intenção:** zero `dangerouslySetInnerHTML`/`innerHTML` no
      renderer — hoje há **zero** `dangerouslySetInnerHTML` e **zero escrita** de
      `innerHTML` em código de produção (as 5 ocorrências de `innerHTML` no
      repo são LEITURAS em asserções de `LinkPreviewCard.test.tsx`) —, CSP
      restritiva mantida, nenhum script de terceiro. Escrever isso no comentário e repetir no SUMMARY.
    - **`redirectUri` OMITIDO de propósito** — o default do `authkit-js` é
      `window.origin` (`create-client.ts`), e a doc client-only manda apontar o
      callback para a mesma rota onde a autenticação é exigida. **Não existe
      rota `/callback` a criar, e não entra router nenhum neste projeto.** O
      `initialize()` detecta `?code=&state=` na própria URL e limpa com
      `history.replaceState`.
    - `onRefreshFailure` chama `signIn()`: se a sessão da WorkOS ainda existir,
      o redirect é silencioso; se não, cai na tela de login. É a saída da web
      para o mesmo problema que no desktop vira `window.location.reload()`.

    `useConvexAuthAdapter()` da web — **a linha que não pode ser simplificada**:

        const fetchAccessToken = useCallback(
          async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
            try { return await getAccessToken({ forceRefresh: forceRefreshToken }) }
            catch { return null }
          }, [getAccessToken])

    `LoginRequiredError`/`RefreshError` viram "sem token", nunca exceção que
    sobe. O retorno é o mesmo `useMemo({ isLoading, isAuthenticated: !!user,
    fetchAccessToken })` — byte a byte a forma que
    `ConvexProviderWithAuth` exige.

    `getProfile()` devolve o `user` do contexto do AuthKit mapeado para
    `SessionUser`. **`lib/profile-hint.ts` NÃO é tocado**: o `User` do
    `authkit-js` (`interfaces/user.interface.ts`) já tem `email`, `firstName`,
    `lastName`, `profilePictureUrl` — exatamente o `AuthUserLike` de
    `profile-hint.ts:27-32`. Confirmar isso lendo o `.d.ts` do pacote
    instalado antes de escrever, e registrar no SUMMARY.
    `hasLiveSession()` = `user !== null` no contexto (a pergunta "a sessão
    ainda vale?" na web é feita ao AuthKit, não a um processo main).

    **Configuração ausente não pode virar exceção.** `main.tsx` já trata
    `VITE_CONVEX_URL` faltando com uma tela legível (`isConvexConfigured`,
    corrigido no Plano 09-02 justamente porque um throw em nível de módulo
    acontece antes de existir qualquer error boundary). Fazer o mesmo aqui:
    exportar do módulo web um `isAuthConfigured = Boolean(import.meta.env.VITE_WORKOS_CLIENT_ID)`
    e **nunca lançar no topo do módulo**.

    **`platform/web/auth.test.ts`** (edge-runtime, import relativo `./auth`,
    com `@workos-inc/authkit-react` mockado por `vi.mock`): provar as duas
    coisas que só se veem em teste —
    1. `fetchAccessToken({ forceRefreshToken: true })` chama o
       `getAccessToken` do AuthKit com `{ forceRefresh: true }`, e com `false`
       passa `{ forceRefresh: false }`. **É o teste que impede a regressão para
       o comportamento do `@convex-dev/workos`.**
    2. `getAccessToken` rejeitando faz `fetchAccessToken` resolver `null` — não
       rejeitar.

    **`.env.local.example`:** acrescentar a variável nova com o comentário do
    porquê do nome: `VITE_WORKOS_CLIENT_ID` é o MESMO valor de
    `MAIN_VITE_WORKOS_CLIENT_ID` (client id é público por design, ver a tabela
    de segredos do HANDOFF), mas precisa do prefixo `VITE_` porque o
    `MAIN_VITE_` é exposto pelo electron-vite ao processo MAIN, não ao
    renderer — e no alvo web não existe processo main. Deixar claro que
    `VITE_CONVEX_SITE_URL` **não** é usada pelo alvo web (ela só monta o
    redirect que devolve para `janja://`).
  </action>
  <verify>
    `npx vitest run src/renderer/src/platform/web/auth.test.ts` — prova o forceRefresh nas duas direções e o catch->null.
    `npm run typecheck` + `npm run typecheck:web-target` exit 0.
    `grep -c "convex-dev/workos" package.json` = 0.
    `git diff --stat src/renderer/src/lib/profile-hint.ts` vazio.
    `node -e "const u=require('@workos-inc/authkit-js/package.json'); console.log(u.version)"` roda (a dep transitiva está instalada).
  </verify>
  <done>Os dois lados de `@platform/auth` existem e satisfazem o contrato; o `forceRefreshToken` está preservado e provado por teste; `profile-hint.ts` intacto.</done>
</task>

<task type="auto">
  <name>Task 2: Ligar o app ao contrato — main, gate, watchdog, login e painel do usuário</name>
  <files>src/renderer/src/main.tsx, src/renderer/src/hooks/useAuth.ts, src/renderer/src/hooks/useConvexAuthAdapter.ts, src/renderer/src/features/auth/AuthGate.tsx, src/renderer/src/features/auth/AuthWatchdog.tsx, src/renderer/src/features/auth/LoginScreen.tsx, src/renderer/src/features/auth/UserPanel.tsx</files>
  <action>
    **`hooks/useAuth.ts` e `hooks/useConvexAuthAdapter.ts`** passam a ser
    reexports finos de `@platform/auth` — não são apagados, porque
    `UserPanel.tsx` e `LoginScreen.tsx` já os importam e manter o caminho
    conhecido evita um diff maior do que a mudança:

        export const useAuth = auth.useSession
        export const useConvexAuthAdapter = auth.useConvexAuthAdapter

    Mover o comentário longo do `AuthUser` (o que explica por que o tipo é
    duplicado em vez de importado de `src/main`) para o contrato, onde ele
    agora pertence: com `SessionUser` no `contract.ts`, a duplicação deixa de
    ser um contorno e vira o formato canônico dos dois alvos.

    **`main.tsx`** — a árvore passa a ser:

        <StrictMode>
          {isConvexConfigured && convexClient ? (
            <auth.AuthProvider>
              <ConvexProviderWithAuth client={convexClient} useAuth={auth.useConvexAuthAdapter}>
                <AuthWatchdog />
                <AuthGate> <PresenceHeartbeat /> <App /> </AuthGate>
              </ConvexProviderWithAuth>
            </auth.AuthProvider>
          ) : ( <ConvexNotConfiguredScreen /> )}
        </StrictMode>

    **A ordem importa e precisa de comentário:** `AuthProvider` POR FORA do
    `ConvexProviderWithAuth`, porque o adaptador que o Convex recebe chama o
    `useAuth()` do AuthKit, que exige o contexto já montado. Invertido, o erro
    é "useAuth must be used within AuthKitProvider" no primeiro render — no
    Electron não apareceria (lá o provider é um fragmento), então é um bug que
    só existe num alvo. No caminho Electron a árvore fica idêntica à de hoje,
    porque o provider é transparente.

    Acrescentar à tela de configuração incompleta o caso novo: se
    `capabilities.target === 'web'` e `VITE_WORKOS_CLIENT_ID` estiver ausente,
    mostrar a mesma tela com a mensagem apontando a variável certa. Reusar
    `ConvexNotConfiguredScreen` generalizando-a para receber a mensagem (ela já
    é autocontida e não depende do Convex montado — requisito, porque é exibida
    exatamente quando ele não está).

    **`AuthGate.tsx`** — uma linha: `window.auth.getUser()` (linha 42) vira
    `auth.getProfile()`. Todo o resto fica: o `ensuredRef`, a passagem por
    `toProfileHint`, o `.catch` que deixa `ensureUser` rodar mesmo sem perfil
    (pior caso `usuario#1234`, renomeável) e o comentário longo que explica por
    que a dica de perfil existe.

    **`AuthWatchdog.tsx`** — uma linha: `window.auth.getUser()` (linha 55) vira
    `auth.hasLiveSession()`, e o `if (user)` vira `if (alive)`. **A saída
    continua sendo `window.location.reload()` nos dois alvos neste plano** —
    ela é legítima na web também (recarregar a aba refaz o handshake do
    AuthKit). Acrescentar ao comentário do topo o parágrafo que a pesquisa
    escreveu: na web o Pitfall 4 reaparece com outra causa possível
    (`getAccessToken` lançando `LoginRequiredError`, o adaptador devolvendo
    `null`, o Convex travando em `isAuthenticated: false`), e o
    `onRefreshFailure` do provider é a primeira linha de defesa; o watchdog é a
    segunda.

    **`LoginScreen.tsx`** — o botão continua sendo um botão; o que muda é o
    texto de espera, que hoje diz "Abrindo o navegador…" (verdade só no
    Electron). Ler `capabilities.target` (ou, melhor, um campo do próprio
    `auth`) e usar "Redirecionando…" no alvo web. Continuar exibindo o
    `sessionError`. Não redesenhar a tela — o visual é da Fase 8.5.

    **`UserPanel.tsx`** — nada muda no código (ele já importa
    `@/hooks/useAuth`, que agora reexporta do contrato). Verificar que
    `user.firstName`, `user.email` e `user.profilePictureUrl` continuam
    existindo em `SessionUser`; se o typecheck reclamar, o erro está no
    contrato, não aqui.
  </action>
  <verify>
    `grep -rn -E "window\.(auth|voice|screenshare|electron)" src/renderer/src --include=*.ts --include=*.tsx | grep -v "src/renderer/src/platform/electron/"` **não retorna nada** — a migração das pontes está completa.
    `npm run typecheck` + `npm run typecheck:web-target` exit 0.
    `npx vitest run` sem regressão sobre os 644.
    `npm run build` (desktop) exit 0 + `npm run verify:renderer-runtime` exit 0.
    `npm run build:web && npm run verify:web-bundle -- --strict-bridges` **exit 0** — a afirmação 3 do verificador fecha aqui, e é o marco deste plano.
  </verify>
  <done>Nenhum código de feature fala com `window.*`; o app monta o provider certo por alvo; a árvore de providers está na ordem que funciona nos dois.</done>
</task>

</tasks>

<verification>
**O que passou a ser verificável NESTE ambiente (WSL2):**
- Que o `forceRefreshToken` sobrevive à travessia (teste unitário) — a razão
  técnica inteira de não usar o `@convex-dev/workos`.
- Que o bundle web está limpo de pontes do Electron
  (`verify:web-bundle --strict-bridges` exit 0). Este é o primeiro momento da
  fase em que essa afirmação passa.
- Que o app web sobe e mostra a tela de login (`npm run dev:web`, sem
  credenciais válidas ainda).

**O que só o Leo prova, no Chrome do Windows — e o Plano 10-04 é onde isso
acontece:**
- Login ponta a ponta (exige o dashboard da WorkOS configurado: redirect URI e,
  o item NOVO, a lista de origens de CORS — o Electron nunca fez requisição de
  navegador para a WorkOS, então essa configuração não existe hoje).
- Que a sessão sobrevive a F5 com `devMode` (depende do `localStorage` real e
  de um refresh de verdade contra a API da WorkOS).
- Logout (exige a Sign-out URI cadastrada; sem ela a doc é explícita que dá
  erro).

**Prova de que o desktop não regrediu:**
1. `npm run typecheck` e `npm run build` verdes; `verify:renderer-runtime` verde.
2. Os 644 testes passando.
3. **A prova de leitura:** no alvo Electron, `AuthProvider` é um fragmento e
   `useSession`/`useConvexAuthAdapter` são o mesmo corpo de código de antes,
   movido de arquivo. O diff do caminho desktop precisa ser puro movimento +
   duas linhas trocadas (`AuthGate:42` e `AuthWatchdog:55`). Afirmar isso no
   SUMMARY.
4. `convex/auth.config.ts` não foi tocado — o `git diff` desse arquivo tem que
   estar vazio. O desktop instalado nas dez máquinas continua sendo aceito pelo
   mesmo backend.
</verification>

<success_criteria>
- `@workos-inc/authkit-react` instalado; `@convex-dev/workos` **não**.
- Zero `window.auth|voice|screenshare|electron` fora de `platform/electron/**`.
- `verify:web-bundle --strict-bridges` exit 0.
- Teste provando `forceRefreshToken -> forceRefresh` nas duas direções e o
  `catch -> null`.
- `profile-hint.ts` e `convex/auth.config.ts` com diff vazio.
- `VITE_WORKOS_CLIENT_ID` documentada no `.env.local.example`.
</success_criteria>

<output>
Ao terminar, criar `.planning/phases/10-versao-web/10-03-SUMMARY.md`, com uma
seção "Superfície de XSS assumida": o que `devMode` guarda em `localStorage`, a
contagem atual de `dangerouslySetInnerHTML` (esperado: zero) e de escritas de
`innerHTML` em código de produção (esperado: zero; as 5 ocorrências conhecidas
são leituras em teste), e a instrução de que essa contagem passa a ser
invariante do projeto.
</output>
