---
phase: 10-versao-web
plan: 03
subsystem: auth
tags: [workos, authkit-react, authkit-js, convex, jwt, pkce, devMode, localStorage, xss, platform-layer]

requires:
  - phase: 02-convex-auth-workos
    provides: "o `useConvexAuthAdapter` com `forceRefreshToken`, o `AuthGate`, o `AuthWatchdog` (Pitfall 4) e o `toProfileHint` — tudo escrito à mão, e é isso que sobreviveu intacto"
  - phase: 10-versao-web
    plan: 01
    provides: "`platform/contract.ts` (`PlatformAuth`, `SessionUser`), o alias `@platform` nos cinco lugares, a segunda passada de typecheck e o `verify:web-bundle`"
provides:
  - "`@platform/auth` implementado nos DOIS alvos: IPC no Electron, `@workos-inc/authkit-react` com `devMode` na web"
  - "o `forceRefreshToken` do Convex chegando ao `getAccessToken({ forceRefresh })` do AuthKit — provado por teste que existe para impedir a regressão ao comportamento do `@convex-dev/workos`"
  - "`main.tsx` montando o provider certo por alvo, com `AuthProvider` POR FORA do `ConvexProviderWithAuth`"
  - "tela de 'Configuração incompleta' generalizada para as DUAS variáveis (VITE_CONVEX_URL e VITE_WORKOS_CLIENT_ID), sem nunca lançar em nível de módulo"
  - "zero `window.auth|voice|screenshare|electron` fora de `platform/electron/**` — `verify:web-bundle --strict-bridges` exit 0 pela primeira vez na fase"
affects: [10-04 vercel cabecalhos e o cadastro na WorkOS, 10-07 migracao final e portao estrito, 10-08 checkpoint humano]

tech-stack:
  added:
    - "@workos-inc/authkit-react@0.16.2 (traz @workos-inc/authkit-js@0.20.2)"
  patterns:
    - "A FONTE do token muda por alvo; o FORMATO não. `convex/auth.config.ts` continua verificando o mesmo JWT, do mesmo emissor, pelo mesmo JWKS — desktop e web convivem no mesmo backend"
    - "Trava de contexto (`AuthKitLatch`): um componente invisível dentro do provider publica o contexto do React num `let` de módulo, para o contrato poder oferecer `signIn`/`getProfile`/`hasLiveSession` como funções comuns em vez de hooks"
    - "`isAuthConfigured` existe nos dois lados (web: `Boolean(env)`, Electron: `true` anotado como `boolean`) — decisão de configuração sem `if (isElectron)` e sem `throw` em nível de módulo"
    - "Contrato traduz, o consumidor não sabe: `{ success, error }` do IPC vira `throw`, e a `LoginScreen` mostra a mesma string pelo `catch`"

key-files:
  created:
    - src/renderer/src/platform/electron/auth.tsx
    - src/renderer/src/platform/web/auth.tsx
    - src/renderer/src/platform/web/auth.test.ts
  modified:
    - package.json
    - package-lock.json
    - .env.local.example
    - src/renderer/src/main.tsx
    - src/renderer/src/hooks/useAuth.ts
    - src/renderer/src/hooks/useConvexAuthAdapter.ts
    - src/renderer/src/features/auth/AuthGate.tsx
    - src/renderer/src/features/auth/AuthWatchdog.tsx
    - src/renderer/src/features/auth/LoginScreen.tsx

key-decisions:
  - "`@convex-dev/workos` NÃO instalado: são 30 linhas que reimplementam pior o adaptador que o repo já tem, e descartam o `forceRefreshToken`. O motivo está no comentário de `platform/web/auth.tsx` E travado por teste"
  - "`devMode={true}`: decisão de CUSTO (custom auth domain da WorkOS = US$ 99/mês), com a superfície de XSS assumida por escrito e a mitigação virando invariante contável do projeto"
  - "`redirectUri` omitido de propósito — default `window.origin`; nenhuma rota `/callback` e nenhum router entram no projeto"
  - "`hooks/useAuth.ts` compõe o contrato (`useSession` + `signIn`/`signOut`) em vez de ser `export const useAuth = auth.useSession`: a forma literal do plano quebraria `LoginScreen` e `UserPanel`, que consomem `signIn`/`signOut` do mesmo hook"
  - "`signIn`/`signOut` do contrato LANÇAM em vez de devolver `{ success, error }` — na web quem 'falha' é uma navegação que não volta; no Electron a mesma mensagem chega à tela pelo `catch`"
  - "`lib/profile-hint.ts`, `convex/auth.config.ts`, `src/main/**`, `src/preload/**` e `UserPanel.tsx`: diff VAZIO, verificado"

patterns-established:
  - "Prova de boot por artefato: o bundle de `dist-web` carregado dentro do jsdom, com o texto da tela impresso e a contagem de erros — mede o que 'build verde' não mede"
  - "Prova de não-regressão por diff mecânico: comentários removidos programaticamente dos dois arquivos e `difflib` entre o corpo antigo e o novo, para 'é só movimento de código' virar verificável em vez de afirmado"

duration: 27min
completed: 2026-08-25
---

# Fase 10 Plano 03: Costura de autenticação — Summary

**No navegador o token agora vem do `@workos-inc/authkit-react` em vez do processo main, atravessando o `forceRefreshToken` inteiro até o `getAccessToken({ forceRefresh })` — e o `convex/auth.config.ts` não mudou uma linha, então o desktop das dez máquinas continua sendo aceito pelo mesmo backend.**

## Performance

- **Duração:** ~27 min
- **Tarefas:** 2/2
- **Arquivos:** 3 criados, 9 modificados (1 deles, `UserPanel.tsx`, ficou com diff zero — como o plano previu)
- **Commits:** 2 de tarefa + 1 de precisão + 1 de metadados

## Task Commits

1. **Task 1: `@platform/auth` nos dois alvos, com o forceRefreshToken preservado** — `e1a0077` (feat)
2. **Task 2: Ligar o app ao contrato — main, gate, watchdog e tela de login** — `1eebce6` (feat)
3. **Precisão da contagem de XSS** — `baac09d` (docs)

## O que foi feito

### 1. Os dois lados do contrato (`e1a0077`)

`@workos-inc/authkit-react@0.16.2` instalado (traz `@workos-inc/authkit-js@0.20.2`;
peer `react >=17`, compatível com o React 19 do projeto). **`@convex-dev/workos`
não** — e o motivo está escrito no lugar onde a próxima pessoa vai querer
adicioná-lo.

`platform/electron/auth.tsx` empacota o caminho de hoje. `platform/web/auth.tsx`
monta o `AuthKitProvider` com `devMode`, `redirectUri` omitido e
`onRefreshFailure -> signIn()`, e traduz o token.

`platform/web/auth.test.ts`: 8 testes, os três primeiros existindo só para
impedir uma regressão específica.

### 2. O app ligado ao contrato (`1eebce6`)

`main.tsx` monta `auth.AuthProvider` por fora do `ConvexProviderWithAuth`;
`AuthGate` e `AuthWatchdog` mudaram **uma chamada cada**; `LoginScreen` passou a
tratar exceção em vez de `{ success }` e a ler o texto de espera de
`capabilities`; os dois hooks da Fase 2 viraram reexports finos.

## O teste que impede a regressão do `forceRefresh`

`src/renderer/src/platform/web/auth.test.ts` — 8 testes, `jsdom`,
`@workos-inc/authkit-react` mockado, `renderHook` sobre o hook DE VERDADE (não
sobre uma função auxiliar extraída: o que precisa ser provado é a travessia,
não uma função).

Os três que travam o comportamento:

| Teste | O que ele impede |
|---|---|
| `forceRefreshToken: true` vira `getAccessToken({ forceRefresh: true })` | o token recusado pelo backend nunca ser renovado à força |
| `forceRefreshToken: false` vira `getAccessToken({ forceRefresh: false })` | alguém "consertar" fixando `true` e forçar refresh a cada chamada |
| **`NUNCA chama getAccessToken sem argumento`** | **exatamente o que o `@convex-dev/workos@0.0.3` faz** — o teste varre `mock.calls` e exige que cada chamada tenha um objeto com a propriedade `forceRefresh` |

Mais: `getAccessToken` rejeitando faz `fetchAccessToken` **resolver `null`**, não
rejeitar (`LoginRequiredError`/`RefreshError` viram "sem token"); o mapeamento
`isLoading`/`isAuthenticated`; `useSession` devolvendo os quatro campos de
`SessionUser`; `getProfile`/`hasLiveSession` não lançando sem provider montado.

```
✓ src/renderer/src/platform/web/auth.test.ts  (8 tests) 18ms
```

## `profile-hint.ts` não mudou — e por quê, conferido no pacote instalado

`node_modules/@workos-inc/authkit-js/dist/index.d.ts`, `interface User`, tem
`email: string`, `firstName: string | null`, `lastName: string | null`,
`profilePictureUrl: string | null` — os quatro campos de `AuthUserLike`
(`profile-hint.ts:27-32`), com os mesmos tipos. (Os extras — `object`, `id`,
`emailVerified`, `lastSignInAt`, `externalId`, `createdAt`, `updatedAt` — são
descartados por `toSessionUser`.)

```
$ git diff --stat dea862d..HEAD -- src/renderer/src/lib/profile-hint.ts
(vazio)
```

## Prova de que o desktop não regrediu — chamada por chamada

O caminho do Electron é movimento de código, e o compilador não reclama se a
ordem mudar. Por isso a prova é mecânica: comentários removidos
programaticamente dos dois arquivos e `difflib` entre o corpo da Fase 2 (em
`dea862d`) e o corpo de hoje.

**`hooks/useAuth.ts` (Fase 2) → `useSession` de `platform/electron/auth.tsx`** —
diff completo, sem cortes:

```
-export function useAuth(): UseAuthReturn {
-const [user, setUser] = useState<AuthUser | null>(null)
+function useSession(): { user: SessionUser | null; loading: boolean; error: string | null } {
+const [user, setUser] = useState<SessionUser | null>(null)
-const signIn = useCallback(() => window.auth.signIn(), [])
-const signOut = useCallback(() => window.auth.signOut(), [])
-return { user, loading, error, signIn, signOut }
+return { user, loading, error }
```

Lidas as linhas que NÃO aparecem no diff: o `useEffect` inteiro é idêntico —
`window.auth.getUser()`, `.then(setUser)`, `.catch` (que loga, zera o usuário e
guarda a causa), **`.finally(() => setLoading(false))`**, e o `return
window.auth.onAuthChange(...)` como cleanup, com os mesmos três `set` dentro.
Nenhuma guarda sumiu, nenhum `try/catch` por passo virou um só, nenhuma ordem
mudou. `AuthUser` → `SessionUser` é troca de NOME do mesmo formato (o Electron
segue devolvendo o objeto do preload, com `workosId` incluído; `SessionUser` é
estruturalmente compatível).

**`hooks/useConvexAuthAdapter.ts` (Fase 2) → `useConvexAuthAdapter` de
`platform/electron/auth.tsx`** — diff completo:

```
-export function useConvexAuthAdapter(): {
+function useConvexAuthAdapter(): {
-const { user, loading } = useAuth()
+const { user, loading } = useSession()
```

O `useCallback` com `window.auth.getAccessToken({ forceRefreshToken })` dentro do
`try`, o `catch { return null }` e o `useMemo` com as três dependências: byte a
byte iguais.

**As duas chamadas que MUDARAM de destino, uma em cada arquivo:**

| Antes (Fase 2) | Agora | O que acontece no Electron |
|---|---|---|
| `AuthGate.tsx:42` `window.auth.getUser()` | `auth.getProfile()` | `window.auth.getUser().catch(() => null)` — mesma chamada IPC, mesmo objeto, e o `.catch` do `AuthGate` continua no lugar (agora redundante por contrato, mantido de propósito) |
| `AuthWatchdog.tsx:55` `window.auth.getUser().then(user => if (user))` | `auth.hasLiveSession().then(alive => if (alive))` | `window.auth.getUser().then(Boolean).catch(() => false)` — mesma pergunta, mesmo IPC, e agora com `.catch` (antes uma rejeição aqui era uma promise sem tratamento) |

**A tradução que muda a FORMA sem mudar o que a pessoa vê:** `signIn`/`signOut`
saíram de dentro do hook e viraram funções de módulo que **lançam** quando o IPC
devolve `{ success: false }`. A `LoginScreen` passou a usar `try/catch` e exibe
`err.message`, que é exatamente o `result.error` de antes — mesma string, mesmo
lugar na tela, mesmo `setPending(false)` só no caminho de erro. No sucesso o
botão continua travado de propósito, como antes.

**A árvore de providers do desktop é idêntica à de antes:** `auth.AuthProvider`
no Electron é `<>{children}</>`, então `<StrictMode><ConvexProviderWithAuth>` →
`AuthWatchdog` + `AuthGate(PresenceHeartbeat, App)` sai igual, na mesma ordem.

**Diff vazio no que não podia mudar** (`dea862d..HEAD`): `convex/`, `src/main/`,
`src/preload/`, `lib/profile-hint.ts`, `features/auth/UserPanel.tsx`,
`features/auth/PresenceHeartbeat.tsx`.

## Verificação — saída real

Rodado com a árvore limpa (`git status --short` vazio), depois dos commits do
Plano 10-02 que rodava em paralelo:

| Verificação | Resultado |
|---|---|
| `npm run typecheck:node` | exit 0 |
| `npm run typecheck:web` | exit 0 |
| `npm run typecheck:convex` | exit 0 (`✓ Nomes de módulo do Convex válidos`) |
| `npm run typecheck:web-target` | exit 0 |
| `npx vitest run` | **41 arquivos, 664 testes, 0 falhas** |
| `npm run build` (electron-vite) | exit 0 |
| `npm run verify:renderer-runtime` | `✓ Renderer sem runtime de servidor do Convex` |
| `npm run build:web` | exit 0 |
| `npm run verify:web-bundle -- --strict-bridges` | **exit 0** |

**A contagem de testes, separada por dono** — baseline do 10-01 era 39 arquivos
/ 648 testes. Hoje: 41 / 664. Deste plano vêm **1 arquivo e 8 testes**
(`platform/web/auth.test.ts`); os outros 1 arquivo e 8 testes são do Plano
10-02 (`platform/web/ptt.test.ts`). 39+1+1 = 41 e 648+8+8 = 664 — fecha exato,
zero regressão.

**O marco da fase (afirmação 3 do verificador):**

```
✓ [1] Implementacao web presente (dist-web/assets/index-DKRHLce5.js)
✓ [2] Nenhum vestigio da implementacao Electron
✓ [3] Nenhuma ponte de Electron no bundle web
✓ [4] CSS real: dist-web/assets/index-C8k-Kv45.css, 51083 bytes (...)

✓ Bundle web verificado (1 .js, 1 .css) — modo estrito
```

Os 3 marcadores vivos que o 10-01 mediu foram a zero: `window.auth` saiu neste
plano, `window.voice` e `window.screenshare` no 10-02. O `grep` da FONTE ainda
acha 4 ocorrências (`profile-hint.ts:13`, `screenshare-audio-bridge.ts:7`,
`contract.ts:10` e `:107`) — **todas em comentário**, e comentário não chega ao
bundle.

**O Plano 10-07 já pode ligar `--strict-bridges` dentro do `build:web`.**

## A prova de boot que "build verde" não dá

O bundle de `dist-web` carregado dentro do jsdom, com o `<script>` executado à
mão e o `textContent` do `#root` impresso — mede o que nenhum typecheck mede:

```
=== A) SEM VITE_WORKOS_CLIENT_ID ===
  [console.info] [platform] web hydra-platform:web
  texto da tela: "HydraConfiguração incompleta: VITE_WORKOS_CLIENT_ID não definida.
                  Este build não foi gerado corretamente — contate quem fez o empacotamento."
  erros: nenhum

=== B) COM VITE_WORKOS_CLIENT_ID=client_teste ===
  [console.info] [platform] web hydra-platform:web
  texto da tela: "HydraEntrar com Google"
  erros: nenhum
```

Ou seja: configuração ausente vira **tela legível**, nunca exceção não capturada
(nem `console.error`, nem `jsdomError`); e com a variável presente o app web
chega **na tela de login**, com o `AuthKitProvider` montado. O script viveu no
scratchpad, não no repo — virar `scripts/verify-*.mjs` é candidato natural para
o 10-07.

## Superfície de XSS assumida

`devMode={true}` guarda o **refresh token da WorkOS em `window.localStorage`**
(`authkit-js/src/utils/session-data.ts`: `const storage = devMode ?
window.localStorage : memoryStorage`), sob a chave do `clientId`. Fora de
`devMode` ele só existiria em memória e a persistência entre recargas dependeria
de um cookie HttpOnly do domínio da WorkOS — que, para sobreviver ao bloqueio de
cookies de terceiros, exige um **custom auth domain a US$ 99/mês**. É decisão de
custo, tomada, e o que se perde é isto: **o refresh token fica legível por
qualquer JavaScript da própria origem. O risco concreto é XSS**, e o prejuízo
não é "a aba do fulano": é a sessão dele inteira, renovável.

**A mitigação é contável, e a contagem é a de HOJE (conferida com `grep -rn` em
`src/`, `convex/` e `scripts/`):**

| Item | Contagem hoje | Onde |
|---|---|---|
| `dangerouslySetInnerHTML` em código | **0** | a única ocorrência do repo é o comentário em `platform/web/auth.tsx` que explica isto |
| Escrita de `innerHTML` em código de **produção** | **0** | — |
| Escrita de `innerHTML` em **teste** | 1 | `platform/web/ptt.test.ts:31`, `document.body.innerHTML = ''` — string constante vazia, chegou no Plano 10-02 |
| Leitura de `innerHTML` em teste | 5 | asserções `expect(container.innerHTML).toBe('')` em `LinkPreviewCard.test.tsx` |
| `script-src` da CSP | `'self'` | `src/renderer/index.html` — sem `unsafe-inline`, sem `unsafe-eval` |
| Scripts de terceiro | **0** | nenhum `<script src>` externo no `index.html` |

**Essa contagem passa a ser invariante do projeto.** Quem introduzir um
`dangerouslySetInnerHTML`, uma escrita de `innerHTML` em produção, um
`unsafe-inline` em `script-src` ou um script de terceiro não está "adicionando
uma feature": está entregando junto o refresh token de todo mundo que usa a web.
Se um dia isso for necessário mesmo, o caminho é pagar o custom auth domain e
tirar o `devMode` — não relaxar a contagem. **Recomendação para o 10-07:**
transformar as quatro primeiras linhas da tabela num `scripts/verify-xss-surface.mjs`,
no molde dos outros verificadores — invariante que ninguém mede volta a zero
sozinho.

## Desvios do plano

**1. [Regra 1 — a forma literal do plano não compila] `hooks/useAuth.ts` compõe
em vez de reexportar**

O plano manda `export const useAuth = auth.useSession`. Mas `useSession` do
contrato devolve `{ user, loading, error }`, e `LoginScreen.tsx` faz
`const { signIn, error } = useAuth()` enquanto `UserPanel.tsx` faz
`const { user, signOut } = useAuth()` — os dois arquivos que o próprio plano cita
como razão para NÃO apagar o hook. A forma literal quebraria as duas passadas de
typecheck.

O hook virou a composição mínima: `{ ...useSession(), signIn: auth.signIn,
signOut: auth.signOut }`, memoizada pelos três campos (o lado Electron devolve
objeto novo a cada render, então depender do objeto não memoizaria nada). O
contrato ficou intacto — que é o ponto: o consumidor não mudou, e `UserPanel.tsx`
saiu com **diff zero**, exatamente como o plano previa.

**2. [Regra 1 — o contrato tem `signIn(): Promise<void>`] a tradução do
`{ success, error }`**

Consequência do item 1. `window.auth.signIn()` devolve `{ success, error }`; o
contrato devolve `Promise<void>`. Se a implementação Electron engolisse o
`success: false`, o erro de login sumiria da tela — regressão silenciosa no
caminho que o grupo usa. A tradução é lançar `new Error(result.error ?? '<a
mesma mensagem padrão de antes>')`, e a `LoginScreen` exibe `err.message`. Mesma
string, mesmo lugar, mesmo comportamento do botão.

**3. [Regra 3 — arquivo fora de `files_modified`] o comentário do `AuthUser` não
foi para `contract.ts`**

O plano manda mover o comentário longo do `AuthUser` para o contrato, mas
`platform/contract.ts` **não está em `files_modified`** — e há outro executor na
mesma árvore. O comentário foi para `platform/electron/auth.tsx`, que é onde a
duplicação fisicamente vive hoje, e `hooks/useAuth.ts` aponta para ele. O
`contract.ts` já carregava, desde o 10-01, o parágrafo que explica que
`SessionUser` é deliberadamente igual ao `AuthUserLike` e ao `User` do
`authkit-js` — a informação não se perdeu, só não duplicou.

**4. [Regra 1 — o ambiente do plano não consegue provar o que ele pede] o teste
é `jsdom`, não `edge-runtime`**

O plano pede o teste em `edge-runtime`. O que precisa ser provado é um **hook**
(`useConvexAuthAdapter`), e `edge-runtime` não tem DOM para renderizar um. As
saídas seriam: extrair uma função auxiliar e testar a função (provaria a função,
não a travessia — e a regressão que o teste existe para impedir mora justamente
na travessia), ou usar `jsdom`. Usei `jsdom` com `renderHook`, que o projeto já
suporta por arquivo (docblock `// @vitest-environment jsdom`, mesmo padrão de
`MessageInput.test.tsx`). O ambiente global do projeto continua `edge-runtime`.

**5. [Regra 1 — precisão de um número que virou invariante] `baac09d`**

O comentário do `devMode` afirmava "as ocorrências de `innerHTML` no repo são
LEITURAS". Na mesma onda, o Plano 10-02 acrescentou `document.body.innerHTML =
''` em `platform/web/ptt.test.ts` — escrita, de string constante, em teste. Um
número que vira invariante precisa estar certo, senão a primeira pessoa que
conferir conclui que a tabela inteira é decorativa. Corrigido para a contagem
exata, com a distinção produção/teste explícita.

**Nenhum desvio arquitetural. Nenhuma pergunta pendente para o Leo dentro do
código.**

## Convivência com o Plano 10-02 (executor paralelo)

Mesma árvore de trabalho, zero arquivos em comum. Os dois commits deste plano
foram feitos com `git commit -- <caminhos explícitos>` justamente porque o outro
executor tinha trabalho **staged** no índice no momento do primeiro commit —
`git commit -a` ou um `git add` amplo teria varrido o trabalho pela metade dele
para dentro de um commit meu (lição nº 5 do HANDOFF, na direção contrária).
`git show --stat` dos dois commits confirma: só arquivos de `files_modified`.

## Estado para o próximo plano

- `verify:web-bundle --strict-bridges` passa. O 10-07 pode promover a flag a
  padrão dentro de `build:web`.
- O alvo web está **pronto para o primeiro login real**, e nada além de
  configuração externa falta. O que impede o login hoje não é código: é o
  dashboard da WorkOS, que nunca precisou saber de um navegador.
- `VITE_WORKOS_CLIENT_ID` **não está no `.env.local` do Leo** (só o
  `MAIN_VITE_WORKOS_CLIENT_ID`). Sem ela, `npm run dev:web` mostra a tela de
  configuração incompleta em vez da tela de login. É uma linha, mesmo valor.

## O que só o Leo prova — e o que ele precisa cadastrar (insumo do 10-04)

**No repositório dele, 1 linha:**

- `.env.local` → acrescentar `VITE_WORKOS_CLIENT_ID=<mesmo valor de MAIN_VITE_WORKOS_CLIENT_ID>`.

**No dashboard da WorkOS, ambiente de PRODUÇÃO (o mesmo que o desktop usa) — em
`Redirects`:**

1. **Redirect URI** `http://localhost:5173` — o dev server, e é o que destrava o
   ciclo de segundos.
2. **Redirect URI** da origem de produção (`https://<projeto>.vercel.app` ou o
   domínio próprio, quando existir).
3. **NÃO REMOVER NEM TROCAR** a redirect URI atual
   `https://impressive-oyster-898.convex.site/auth/complete` — é dela que o
   desktop instalado depende (`convex/http.ts:145-158`). São entradas
   convivendo; a WorkOS suporta várias.
4. **Sign-out URI** apontando para a origem web. A doc é explícita: **sem ela o
   logout dá erro** — e é o `auth.signOut()` da web que navega para lá.

**Em `Authentication → Configure CORS` — o item NOVO, que não existe hoje:**

5. Origem permitida `http://localhost:5173`.
6. Origem permitida da produção (`https://<projeto>.vercel.app` / domínio
   próprio).
   **Por que é novo:** o Electron nunca fez requisição de NAVEGADOR para a
   WorkOS — quem falava com `api.workos.com` era o processo main, e processo main
   não tem origem. Sem estas duas entradas o login web falha com erro de CORS no
   console e mais nada.

**Conferir (não mudar):**

7. TTL do access token continua em **8h** (elevado na Fase 2) — vale para os dois
   clientes, e é o que segura a frequência do Pitfall 4.
8. **Convex: nada.** Mesmo deployment, mesmo `auth.config.ts`, mesmas env vars.
   **LiveKit: nada.**

**O que só o Chrome do Windows prova, depois disso (é o corpo do 10-04):**

- Login ponta a ponta na web (PKCE no navegador, `?code=&state=` limpo por
  `history.replaceState`, `ensureUser` recebendo a dica de perfil).
- **Que a sessão sobrevive a F5** — depende do `localStorage` real e de um
  refresh de verdade contra a API da WorkOS. É o teste que valida o `devMode`.
- **Logout** — depende da Sign-out URI do item 4.
- Desktop e web logados ao mesmo tempo, no mesmo backend, sem um derrubar o
  outro.
