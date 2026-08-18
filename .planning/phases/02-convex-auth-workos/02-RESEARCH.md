# Research: Fase 2 — Convex + auth WorkOS

**Pesquisado em:** 2026-08-18
**Fontes:** documentação oficial (electronjs.org, docs.convex.dev, workos.com), código-fonte
real do exemplo oficial `workos/electron-authkit-example` (via GitHub API/raw, arquivo por
arquivo), e os `.d.ts`/`.d.mts` publicados no pacote npm `@workos-inc/node` (extraído
diretamente do tarball da versão estável mais recente e comparado com a versão usada pelo
exemplo oficial). Nível de confiança: ALTO para tudo abaixo — nada aqui é memória, é leitura
direta de tipos/arquivos publicados.

## 1. `workos/electron-authkit-example` — estrutura real e API usada

Repositório público, confirmado via GitHub API. Estrutura (mesma convenção electron-vite que
o janja já usa):

```
src/main/auth/auth.ts               # PKCE, troca de código, refresh, sessão
src/main/auth/deep-link-handler.ts  # registro do protocolo + open-url/second-instance
src/main/auth/ipc-handlers.ts       # canais IPC (sign-in, sign-out, get-user, on-auth-change)
src/main/auth/types.ts              # AUTH_CHANNELS + tipos compartilhados
src/main/index.ts                   # requestSingleInstanceLock + registerProtocol + wiring
src/preload/index.ts                # contextBridge expõe window.auth
src/renderer/src/hooks/useAuth.ts   # hook React consumindo window.auth via IPC
```

Isso é literalmente o mesmo split main/preload/renderer que o janja já tem do bootstrap (F0).
Os planos abaixo reaproveitam essa estrutura, adaptando ao protocolo `janja://` e ao
`safeStorage` assíncrono (o exemplo oficial usa `electron-store`, que só usa o `safeStorage`
*síncrono* para derivar uma chave — diverge do hard constraint desta fase, que exige a API
assíncrona pura; ver §3).

**Protocolo:** o exemplo registra `workos-auth://`, não loopback — confirma que a decisão
tomada no design doc (§4, custom protocol) é exatamente o caminho oficial, e que o `PITFALLS.md`
(Pitfall 5, que fala de loopback) descreve uma versão anterior/descartada do design. Este
plano segue o design doc e o hard constraint da tarefa (custom protocol), não o Pitfall 5.

**Registro do protocolo** (`deep-link-handler.ts`, código real):
```ts
const PROTOCOL = 'workos-auth'
export function registerProtocol(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }
}
```
`process.defaultApp` é `true` quando roda via `electron .`/`electron-vite dev` (o executável é
o binário genérico do Electron, não um `.exe` empacotado) — nesse caso é preciso passar
`process.execPath` + o caminho do script como argumento, senão o registro no Windows aponta
para `electron.exe` sem argumentos e o SO nunca sabe qual projeto abrir. Em produção
(empacotado, F9) `process.defaultApp` é `false` e a chamada sem argumentos basta.

**Second-instance (Windows)** — trata tanto `open-url` (macOS, não relevante para o alvo
Windows-only do janja, mas inofensivo manter) quanto `second-instance`:
```ts
app.on('second-instance', (_event, argv) => {
  const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))
  if (url) handleUrl(url)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})
```
Isso é exatamente o que falta no `second-instance` já existente em `src/main/index.ts` do
janja (criado em F0, hoje só foca a janela — ver seção "current_state" da tarefa).

**IPC** — 4 canais, nomes literais a reaproveitar:
`auth:sign-in`, `auth:sign-out`, `auth:get-user`, `auth:on-auth-change`. `sign-in` chama
`shell.openExternal(url)` a partir do main (nunca abre `BrowserWindow` — confirma o hard
constraint de que o Google recusa auth embutida).

## 2. `@workos-inc/node` — API pública (sem API key) confirmada nos tipos publicados

Este é o achado mais importante da pesquisa: **a WORKOS_API_KEY (`sk_...`) não é necessária
em nenhum lugar desta fase — nem no Electron, nem no Convex.**

Inspecionei `node_modules`-equivalente extraído diretamente do tarball do npm
(`@workos-inc/node`, testado tanto na versão `8.0.0-rc.10` usada pelo exemplo oficial quanto
na `10.10.0`, que é a `latest` real no npm hoje — **a fase deve pinar `^10.10.0`, não a
rc usada pelo exemplo**, ambas expõem a mesma API pública). O arquivo de tipos da factory
declara explicitamente:

```ts
/** Method names available without API key - single source of truth. */
type PublicUserManagementMethods =
  | 'getAuthorizationUrl' | 'getAuthorizationUrlWithPKCE'
  | 'authenticateWithCode' | 'authenticateWithCodeAndVerifier'
  | 'authenticateWithRefreshToken' | 'getLogoutUrl' | 'getJwksUrl';

/**
 * WorkOS client for public/PKCE-only usage.
 * Returned when initialized with only clientId (no API key).
 * For browser, mobile, CLI, and desktop applications that cannot
 * securely store an API key.
 */
declare function createWorkOS(options: { clientId: string }): PublicWorkOS;      // sem API key
declare function createWorkOS(options: { apiKey: string; clientId: string }): WorkOS; // com API key
```

Ou seja: o SDK foi desenhado precisamente para o caso do janja (app desktop público, sem
segredo). `createWorkOS({ clientId: CLIENT_ID })` (sem `apiKey`) já retorna um cliente
type-safe que só expõe os métodos PKCE/públicos — o TypeScript recusa em tempo de compilação
qualquer tentativa de chamar um método que precisaria da API key (ex: `listUsers`). Isso
elimina de vez a pergunta feita pelo hard constraint ("determinar se a API key é necessária"):
**não é.** A validação de JWT do lado do Convex também não precisa dela — usa JWKS público
(ver §4). A `WORKOS_API_KEY` só seria necessária para operações administrativas server-side
(ex: `listUsers`, criar convites de organização) que não existem no escopo desta fase.

### Métodos exatos a usar no processo main

```ts
import { createWorkOS } from '@workos-inc/node'

const workos = createWorkOS({ clientId: MAIN_VITE_WORKOS_CLIENT_ID }) // PublicWorkOS

// 1. Iniciar login — gera PKCE E state automaticamente, retorna os três juntos
const { url, state, codeVerifier } = await workos.userManagement.getAuthorizationUrlWithPKCE({
  provider: 'authkit',
  clientId: MAIN_VITE_WORKOS_CLIENT_ID,
  redirectUri: 'janja://callback',
})
// -> persistir { state, codeVerifier, expiresAt } em memória/arquivo local (curto prazo,
//    ex. 10 min), abrir `url` com shell.openExternal(url)

// 2. Callback recebido via second-instance: extrair `code` e `state` da querystring de
//    `janja://callback?code=...&state=...`. Comparar o `state` recebido com o guardado no
//    passo 1 — rejeitar se não bater (proteção CSRF; a função getAuthorizationUrlWithPKCE já
//    GERA o state, mas não o valida sozinha no retorno — a validação é responsabilidade do
//    app, exatamente como no fluxo loopback do Pitfall 5, só que aplicada ao custom protocol).

// 3. Troca do code por tokens (client público, com verifier — não confundir com
//    authenticateWithCode "auto-detect", que lança erro se não houver nem verifier nem API
//    key; usar a variante explícita evita ambiguidade):
const auth = await workos.userManagement.authenticateWithCodeAndVerifier({
  code,
  codeVerifier, // vem do passo 1
})
// auth: { user, accessToken, refreshToken, ... }

// 4. Refresh (chamado quando o access token expirar, ou por decisão de refresh silencioso):
const refreshed = await workos.userManagement.authenticateWithRefreshToken({
  refreshToken,
})

// 5. Logout — precisa do `sid` (session id), que vem do payload do access token (claim
//    `sid`, decodificável sem verificar assinatura porque é só para montar a URL de logout,
//    a verificação de assinatura de verdade acontece no Convex via JWKS):
const logoutUrl = workos.userManagement.getLogoutUrl({ sessionId })
await shell.openExternal(logoutUrl)
```

`getAuthorizationUrlWithPKCE` e `getLogoutUrl` são exatamente os nomes/assinaturas
confirmados nos `.d.ts` publicados (não são inferência) — o JSDoc embutido no próprio pacote
traz este exemplo, literal:
```
const { url, state, codeVerifier } = await workos.userManagement.getAuthorizationUrlWithPKCE({
  provider: 'authkit',
  clientId: 'client_123',
  redirectUri: 'myapp://callback',
});
```

### `User` (campos disponíveis para popular `users` no Convex)

```ts
interface User {
  id: string                       // -> workosId
  email: string
  firstName: string | null
  lastName: string | null
  profilePictureUrl: string | null // -> avatarUrl
  // ... (emailVerified, locale, createdAt, updatedAt, externalId, metadata — não usados)
}
```
Não há campo de `username`. `username`/`tag` são gerados pelo app no primeiro login
(AUTH-06) — ver §5.

## 3. `safeStorage` assíncrono — API exata (Electron docs oficiais, `docs/api/safe-storage.md`)

```ts
safeStorage.isEncryptionAvailable(): boolean          // sync — utilitário de diagnóstico
safeStorage.isAsyncEncryptionAvailable(): Promise<boolean>
safeStorage.encryptStringAsync(plainText: string): Promise<Buffer>
safeStorage.decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>
```

Pontos confirmados na doc oficial (não em memória):
- "We recommend using the asynchronous API ... over the synchronous API ... The
  synchronous API may be deprecated in a future version of Electron."
- No Windows, ambas as APIs (sync e async) usam DPAPI — mesmo modelo de segurança, mas a
  assíncrona "supports additional features like key rotation ... and temporary
  unavailability handling", sinalizado por `shouldReEncrypt` no retorno.
- "The asynchronous encryptor is initialized lazily the first time this method,
  `encryptStringAsync`, or `decryptStringAsync` is called **after the app is ready**." —
  confirma o hard constraint de nunca chamar antes de `app.whenReady()`.

**Desvio deliberado do exemplo oficial:** o `electron-authkit-example` usa `electron-store`
com uma `encryptionKey` derivada de `safeStorage.encryptString(...)` **síncrono** — ou seja,
usa a API síncrona só para gerar uma chave, e delega a persistência real ao `electron-store`
(que grava em disco por conta própria). Isso não atende ao hard constraint desta tarefa
("via Electron `safeStorage` (async API)"). O plano abaixo persiste a sessão manualmente:
serializa `{ refreshToken, workosId }` como JSON, criptografa a string inteira com
`encryptStringAsync`, grava o Buffer resultante (base64) num arquivo em
`app.getPath('userData')` via `fs/promises`. A leitura faz o caminho inverso e qualquer falha
(arquivo ausente, JSON inválido, `decryptStringAsync` rejeitando — típico após reinstalar o
Windows ou troca de máquina, DPAPI amarrado à credencial de login do usuário do SO) cai em
`catch` e retorna "sem sessão", nunca lança para fora da função. Isso satisfaz literalmente
o critério de sucesso 3 do ROADMAP (F2): corromper/apagar a credencial não trava nem gera
tela branca.

## 4. Convex + WorkOS AuthKit — `auth.config.ts` e contrato do `useAuth` customizado

Confirmado em `docs.convex.dev/auth/authkit` (setup oficial) e no código-fonte real do
componente `@convex-dev/workos` (lido diretamente do repositório `get-convex/convex-backend`,
`npm-packages/@convex-dev/workos/src/index.tsx`).

### Por que **não** usar o pacote `@convex-dev/workos`

O `package.json` publicado do componente declara:
```json
"dependencies": { "@workos-inc/authkit-react": "^0.16.0" }
```
Confirma exatamente o que o design doc já previa: o componente assume `AuthKitProvider` do
`@workos-inc/authkit-react` rodando **no browser/renderer**, gerenciando o token ali. No
janja, o token nunca é obtido no renderer — chega do processo main via IPC, depois de um
fluxo OAuth que abre o navegador do sistema. Não há `AuthKitProvider` possível aqui. Portanto
o pacote **não é instalado**; o "escape hatch" documentado do Convex é usado diretamente
(código abaixo), como o design doc §4 já antecipava.

Lendo o código-fonte do componente mesmo assim confirma a forma exata do contrato que o
Convex espera do lado do cliente (o componente é só um adaptador fino em volta disso):
```tsx
import { ConvexProviderWithAuth, type AuthTokenFetcher } from "convex/react"
// useAuth customizado deve retornar exatamente:
{ isLoading: boolean; isAuthenticated: boolean; fetchAccessToken: AuthTokenFetcher }
// onde AuthTokenFetcher = (args: { forceRefreshToken: boolean }) => Promise<string | null>
```

### `convex/auth.config.ts` — forma oficial documentada para WorkOS AuthKit

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
A segunda entrada (`user_management/${clientId}` como issuer) é a relevante para o fluxo do
janja (login via AuthKit/User Management, não SSO puro) — o access token retornado por
`authenticateWithCodeAndVerifier` tem esse issuer. Mantém-se a primeira entrada também
(documentação oficial traz as duas juntas; custo zero manter ambas, e cobre o caso de o
WorkOS emitir por SSO em algum fluxo futuro). **`WORKOS_CLIENT_ID` aqui é uma env var do lado
do Convex** (setada via `npx convex env set WORKOS_CLIENT_ID client_...` ou pelo dashboard do
Convex) — não é a mesma variável de ambiente `MAIN_VITE_WORKOS_CLIENT_ID` usada pelo
electron-vite no processo main (mesmo valor, dois lugares diferentes de configuração, porque
são dois runtimes/dashboards distintos). Nenhuma API key aparece em lugar nenhum deste
arquivo — a validação é 100% via JWKS público.

### Hook `useAuth` customizado — contrato exato para `ConvexProviderWithAuth`

```ts
import { ConvexProviderWithAuth } from 'convex/react'

function useAuth() {
  // isLoading: true enquanto o main process ainda não respondeu getUser()/getAccessToken()
  // isAuthenticated: !!user (do IPC auth:on-auth-change / auth:get-user)
  // fetchAccessToken: chamado pelo ConvexProviderWithAuth sempre que precisa de um token
  //   (montagem inicial e renovações). forceRefreshToken=true deve ignorar qualquer cache e
  //   pedir ao main um token garantidamente fresco (chamando authenticateWithRefreshToken).
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        return await window.auth.getAccessToken({ forceRefreshToken })
      } catch {
        return null
      }
    },
    [],
  )
  return { isLoading, isAuthenticated, fetchAccessToken }
}

<ConvexProviderWithAuth client={convex} useAuth={useAuth}>
  {children}
</ConvexProviderWithAuth>
```
Isso exige um **novo canal IPC** (`auth:get-access-token`) além dos 4 do exemplo oficial —
o exemplo só expõe `getUser()` (retorna o objeto `User`, não o JWT). O janja precisa que o
main devolva a string do `accessToken` puro para o Convex validar.

## 5. Índice composto e geração de `username#tag` (AUTH-06)

Confirmado em `docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf`:
**o Convex não tem constraint de unicidade no nível do banco.** Um índice composto só
ordena/acelera a consulta — a unicidade é responsabilidade da mutation, feita por
"consultar antes de inserir":

```ts
// schema.ts
users: defineTable({
  workosId: v.string(),
  username: v.string(),
  tag: v.string(),
  displayName: v.string(),
  avatarUrl: v.optional(v.string()),
})
  .index('by_workos_id', ['workosId'])
  .index('by_username_tag', ['username', 'tag'])
```

```ts
// dentro de uma mutation (transacional — nenhuma outra mutation intercala a leitura+escrita)
for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
  const tag = randomFourDigitTag()
  const existing = await ctx.db
    .query('users')
    .withIndex('by_username_tag', (q) => q.eq('username', username).eq('tag', tag))
    .unique()
  if (!existing) {
    await ctx.db.insert('users', { workosId, username, tag, displayName, avatarUrl })
    return { username, tag }
  }
}
throw new Error('Não foi possível gerar tag única — todas as tentativas colidiram')
```
Como a mutation do Convex é atômica, não há corrida real entre duas tentativas de criar o
mesmo usuário simultaneamente — o "retry" aqui é só para colisão de tag dentro do espaço de
10.000 combinações (0000-9999), que com ~10-50 usuários tem probabilidade de colisão baixa
mas não nula por username repetido. É exatamente o caso de teste ideal para TDD (input:
username + conjunto de tags já usadas -> output: tag nova e diferente; ou lançar erro após
N tentativas esgotadas) — plano dedicado abaixo usa `convex-test` (`convex-test@^0.0.55`,
peer `convex@^1.43.0`, ambos compatíveis com o que será instalado).

## 6. `app.setAsDefaultProtocolClient` — dev vs. empacotado (Electron docs oficiais)

```
app.setAsDefaultProtocolClient(protocol[, path, args])
```
- `path`/`args` só têm efeito no Windows.
- Em dev (`electron-vite dev`, `process.defaultApp === true`): é preciso passar
  `process.execPath` e o caminho do script como `args`, exatamente como no
  `deep-link-handler.ts` do exemplo oficial (reproduzido em §1). Sem isso, o registro no
  Windows aponta para o binário genérico do Electron sem saber qual app abrir.
- Em empacotado: chamar sem `path`/`args` já basta — internamente usa o Registro do Windows +
  `LSSetDefaultHandlerForURLScheme`.
- `open-url` (macOS) não existe no Windows — o único caminho é `second-instance`, com a
  ressalva documentada: "if the second instance is started by a different user than the
  first, the `argv` array will not include the arguments" (não é um caso realista aqui, todos
  os 10 usuários rodam sob a própria conta do Windows).

## 7. Presença (infraestrutura, escopo desta fase)

O ROADMAP determina que F2 escreve `presence` a partir da sessão autenticada; a exibição é
F4/F6. O `PITFALLS.md` (armadilha de performance) recomenda não escrever a cada poucos
segundos por usuário. Decisão para esta fase: heartbeat simples de **45 segundos** disparado
pelo renderer só quando `isAuthenticated === true` (mutation `presence.heartbeat` faz upsert
por `userId`, usando `ctx.auth.getUserIdentity()` para nunca aceitar heartbeat de um usuário
não autenticado). Não se adota o componente `@convex-dev/presence` nesta fase: seu modelo de
dados (por "room"/sessão de presença) não corresponde ao schema simples já fixado no design
doc (`presence: userId·, lastSeen`), e adotá-lo agora obrigaria decidir um mapeamento de
"room" que só faz sentido a partir de F4 (canal/servidor). Documentado aqui para reavaliação
futura se F4/F6 precisarem de granularidade maior.

## 8. Decisões consolidadas para os planos

| Decisão | Escolha | Por quê |
|---|---|---|
| Versão do `@workos-inc/node` | `^10.10.0` (latest estável no npm) | Mesma API pública (`createWorkOS`, PKCE) do exemplo oficial (que usa uma rc antiga), sem depender de pre-release |
| API key da WorkOS | Nunca usada (nem Electron, nem Convex) | `createWorkOS({ clientId })` sem `apiKey` já expõe todos os métodos públicos necessários; Convex valida via JWKS público |
| `@convex-dev/workos` (pacote npm) | Não instalado | Depende de `@workos-inc/authkit-react`, incompatível com o fluxo main-process + custom protocol do janja |
| Persistência da sessão | `safeStorage.encryptStringAsync`/`decryptStringAsync` direto sobre um JSON serializado, arquivo próprio em `userData` | Hard constraint explícito da tarefa; diverge do `electron-store` do exemplo oficial |
| `state` do OAuth | Gerado por `getAuthorizationUrlWithPKCE` (automático), validado manualmente no callback | Método novo do SDK já gera com boa entropia; validação ainda é responsabilidade do app |
| Presença nesta fase | Heartbeat de 45s via mutation simples, schema `presence(userId·, lastSeen)` | Evita heartbeat "caro" (Pitfall de performance) sem introduzir componente com schema incompatível |
| Componente de username/tag | TDD dedicado com `convex-test` | Lógica pura, testável por input/output, colisão de índice composto sem unicidade nativa do Convex |
