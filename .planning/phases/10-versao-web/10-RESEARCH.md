# Pesquisa: Fase 10 — Versão web

**Pesquisado em:** 2026-08-25
**Domínio:** portar o renderer do Hydra para o navegador (Vercel) contra o MESMO Convex, o MESMO LiveKit e a MESMA aplicação WorkOS
**Confiança geral:** ALTA para auth, build e compartilhamento de tela; MÉDIA para convivência dos dois clientes; BAIXA para o comportamento real do eco (só se prova em Windows, com gente)

---

## Sumário executivo

Três achados mudam o tamanho e a forma da fase, e nenhum deles é opinião — todos vêm de
leitura direta do código publicado dos pacotes ou da documentação oficial.

**1. A premissa que descartou o caminho oficial da WorkOS não vale na web, e o caminho
oficial é menor do que o ROADMAP supõe.** O `@convex-dev/workos` é um wrapper de **30
linhas** que não importa `authkit-react` em runtime — ele só aceita um `useAuth` com a
forma `{ isLoading, user, getAccessToken }`. Quem gerencia token de verdade é o
`@workos-inc/authkit-react` (via `@workos-inc/authkit-js`), e no navegador ele faz
exatamente o que o processo main faz hoje: PKCE, troca de código, refresh automático,
persistência. **A costura de auth deixa de ser "reescrever o adaptador" e vira "trocar a
fonte do token".** O `useConvexAuthAdapter` atual continua sendo o formato certo — muda só
de onde ele lê.

**2. O caminho "oficial ao pé da letra" custa US$ 99/mês, e por isso não é o recomendado.**
O `authkit-js` em produção guarda o refresh token num cookie HttpOnly do domínio da WorkOS
(`create-client.ts`, `get #useCookie() { return !this.#devMode }`). Para esse cookie
funcionar sem depender de cookie de terceiros, a WorkOS exige um **custom auth domain** —
que é uma linha de preço explícita: **"Custom domain — $99/mo"**. Para dez amigos isso está
fora. O caminho documentado pela própria WorkOS para quem não tem custom domain é
`devMode={true}`, que guarda o refresh token no `localStorage`. É o que a fase deve usar, e
é uma decisão de custo, não de engenharia.

**3. O eco NÃO desaparece de graça na web — mas a web dá acesso ao botão que o desliga.**
Por padrão, o áudio de sistema capturado pelo Chrome "inclui todo o áudio tocado pelo
sistema nos dispositivos de saída" (Chrome 141 beta, texto oficial) — ou seja, inclui a voz
dos outros participantes que a própria aba está tocando. O que muda é que o Chromium ganhou
em **Chrome 141 (Windows e Mac)** a propriedade `restrictOwnAudio`, que filtra o áudio
originado do documento que chamou `getDisplayMedia` — e o `livekit-client@2.22.0` instalado
**já expõe** essa opção. Além disso, compartilhar uma **aba** (não a tela inteira) é
estruturalmente sem eco: o Chrome captura o áudio daquela aba, não do dispositivo.

**Recomendação primária:** um único alvo web construído a partir do MESMO `src/renderer`,
com `root: 'src/renderer'` preservado, uma camada de plataforma resolvida por **alias do
Vite** (`@platform`), e autenticação por `@workos-inc/authkit-react` com `devMode={true}`
ligada ao Convex pelo `ConvexProviderWithAuth` que já existe — **sem** instalar
`@convex-dev/workos`.

---

## §1 — A pergunta mais importante: autenticação na web

### 1.1 O que `@convex-dev/workos` realmente é

Baixei e extraí o tarball publicado (`@convex-dev/workos@0.0.3`, `time.modified =
2026-08-06`). O pacote inteiro é isto (`package/dist/index.js`, arquivo completo, sem
cortes além dos comentários):

```js
import { useCallback, useMemo } from "react";
import { ConvexProviderWithAuth } from "convex/react";

export function ConvexProviderWithAuthKit({ children, client, useAuth }) {
  const useAuthFromWorkOS = useUseAuthFromAuthKit(useAuth);
  return (_jsx(ConvexProviderWithAuth, { client, useAuth: useAuthFromWorkOS, children }));
}

function useUseAuthFromAuthKit(useAuth) {
  return useMemo(() => function useAuthFromWorkOS() {
    const { isLoading, user, getAccessToken } = useAuth();
    const fetchAccessToken = useCallback(async () => {
      try { return await getAccessToken(); } catch { return null; }
    }, [getAccessToken]);
    return useMemo(() => ({ isLoading, isAuthenticated: !!user, fetchAccessToken }),
      [isLoading, user, fetchAccessToken]);
  }, [useAuth]);
}
```

Três consequências, todas verificáveis no arquivo acima:

- **Ele não importa `authkit-react` em lugar nenhum do `dist`.** A dependência declarada no
  `package.json` é de conveniência/tipos; o componente aceita **qualquer** hook com a forma
  `{ isLoading, user, getAccessToken }`. A frase do HANDOFF ("dependência dura de
  `authkit-react`") era verdadeira como leitura do `package.json` e continua verdadeira como
  *decisão* (a fase 2 não queria arrastar o pacote), mas **não** como restrição técnica de
  runtime.
- **Ele é literalmente o `useConvexAuthAdapter.ts` que já existe no repo**, com outro nome.
  O arquivo do projeto (`src/renderer/src/hooks/useConvexAuthAdapter.ts:14-39`) faz o mesmo
  `useMemo` sobre o mesmo trio.
- **Ele PERDE o `forceRefreshToken`.** O `ConvexProviderWithAuth` chama
  `fetchAccessToken({ forceRefreshToken: true })` quando o backend recusa o token; o wrapper
  chama `getAccessToken()` sem argumento. O `authkit-js` aceita
  `getAccessToken({ forceRefresh: true })` (`create-client.ts`, assinatura
  `async getAccessToken(options?: { forceRefresh?: boolean }): Promise<string>`). Usar o
  wrapper joga fora exatamente a alavanca que o `AuthWatchdog` existe para puxar
  (Pitfall 4, `get-convex/convex-backend#259`).

**Decisão: NÃO instalar `@convex-dev/workos`.** Não porque seja incompatível — na web ele
funcionaria — mas porque ele custa uma dependência para reimplementar, pior, um arquivo de
26 linhas que o projeto já tem. Confiança: **ALTA** (código lido na íntegra).

### 1.2 O que o `authkit-react`/`authkit-js` de fato entrega

Versões atuais no npm em 2026-08-25: `@workos-inc/authkit-react@0.16.2` (dep:
`@workos-inc/authkit-js@^0.20.1`, peer: `react >=17`), `@workos-inc/authkit-js@0.20.2`.
Compatível com React 19 (`peerDependencies: { react: ">=17" }`).

O `AuthKitProvider` (`authkit-react/src/provider.tsx`) monta um `Client` do `authkit-js` e
expõe por contexto `{ isLoading, user, signIn, signUp, signOut, getAccessToken, ... }`. O
`Client` (`authkit-js/src/create-client.ts`) faz, no navegador, tudo o que
`src/main/auth/auth.ts` faz hoje no processo main:

| Responsabilidade | Hoje (Electron) | Na web (`authkit-js`) |
|---|---|---|
| Gerar URL PKCE | `getAuthorizationUrlWithPKCE` (`auth.ts:105`) | `#getAuthorizationUrl` + `createPkceChallenge`, verifier em `sessionStorage` |
| Abrir o login | `shell.openExternal(url)` | `window.location.assign(url)` (navegação de topo) |
| Receber o callback | `janja://callback` → `second-instance` → IPC | `initialize()` detecta `?code=&state=` na própria URL e limpa com `history.replaceState` |
| Trocar código por token | `authenticateWithCodeAndVerifier` | `POST api.workos.com/user_management/authenticate` |
| Guardar o refresh token | `safeStorage.encryptStringAsync` em `userData` | cookie HttpOnly da WorkOS **ou** `localStorage` (ver 1.3) |
| Renovar | `getAccessToken(force)` (`auth.ts:168`) | timer de 1s + buffer configurável, com `navigator.locks` entre abas |
| Logout | `getLogoutUrl({ sessionId })` | `signOut()` decodifica `sid` e redireciona para a mesma URL |

**Não existe rota `/callback` a criar.** O `redirectUri` default do `authkit-js` é
`window.origin` (`create-client.ts`, `redirectUri = window.origin`), e a documentação
client-only da WorkOS diz para apontar o callback "para a mesma rota onde você exige auth".
Isso significa: **SPA de uma rota só, redirect URI = a origem, nada de router**. Confiança:
**ALTA** (código + doc oficial).

### 1.3 O achado que decide o desenho: o cookie custa US$ 99/mês

`authkit-js/src/create-client.ts`:

```ts
get #useCookie() { return !this.#devMode; }
```

e `src/utils/session-data.ts`:

```ts
const storage = devMode ? window.localStorage : memoryStorage;
storage.setItem(refreshTokenKey(clientId), refreshToken);
```

Ou seja, **fora de `devMode` o refresh token só existe em memória**; a persistência entre
recargas depende de um cookie HttpOnly que a WorkOS emite no domínio da API. Para esse
cookie ser *same-site* com a aplicação (e portanto sobreviver ao bloqueio de cookies de
terceiros), a WorkOS exige um **custom auth domain** (`auth.seudominio.com`), e a doc
client-only é explícita sobre a alternativa:

> "If you have not set up a custom authentication domain in WorkOS, set `devMode={true}` on
> `<AuthKitProvider />`, which will keep the refresh token in local storage instead of a
> secure, HTTP-only cookie."

E a página de preços da WorkOS lista **"Custom domain — $99/mo"**, item separado do free
tier de 1M MAU.

**Decisão: `devMode={true}` em produção.** Alternativa nomeada: custom auth domain
`auth.usesenju.com` + o app numa origem `*.usesenju.com` (Vercel com domínio próprio, nunca
`*.vercel.app` — o cookie precisa do mesmo *site* eTLD+1). **Critério que decide entre
elas:** só trocar se alguém estiver disposto a pagar US$ 99/mês; nenhum critério técnico
justifica antes disso.

**O que se perde com `devMode`, dito com todas as letras:** o refresh token fica legível por
JavaScript da própria origem. O risco concreto é XSS. Mitigações que já existem e devem ser
mantidas como requisito verificável da fase: nenhum `dangerouslySetInnerHTML`/`innerHTML` no
renderer (verificado: **zero ocorrências** hoje), CSP restritiva mantida, e nada de carregar
script de terceiro. Confiança: **ALTA** (código + doc + preço oficiais).

### 1.4 O caminho recomendado, em código

```tsx
// src/renderer/src/platform/web/AuthProvider.tsx
import { AuthKitProvider } from '@workos-inc/authkit-react'

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthKitProvider
      clientId={import.meta.env.VITE_WORKOS_CLIENT_ID}
      devMode={true}          // sem custom domain: refresh token em localStorage
      // redirectUri omitido de propósito -> window.origin
      onRefreshFailure={({ signIn }) => { void signIn() }}
    >
      {children}
    </AuthKitProvider>
  )
}
```

```ts
// src/renderer/src/platform/web/useConvexAuthAdapter.ts
import { useAuth } from '@workos-inc/authkit-react'

export function useConvexAuthAdapter() {
  const { isLoading, user, getAccessToken } = useAuth()
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try { return await getAccessToken({ forceRefresh: forceRefreshToken }) }
      catch { return null }   // LoginRequiredError/RefreshError viram "sem token"
    },
    [getAccessToken]
  )
  return useMemo(() => ({ isLoading, isAuthenticated: !!user, fetchAccessToken }),
    [isLoading, user, fetchAccessToken])
}
```

Isto é **byte a byte a mesma forma** do `useConvexAuthAdapter.ts:14-39` que já está no repo.
`ConvexProviderWithAuth` continua sendo o provider, e `convex/auth.config.ts` **não muda uma
linha** — o JWT é o mesmo access token da WorkOS, mesmo issuer, mesmo JWKS.

### 1.5 Custo real de cada um dos 5 arquivos da costura de auth

| Arquivo | O que muda | Tamanho |
|---|---|---|
| `lib/profile-hint.ts` | **NADA.** O `User` do `authkit-js` (`interfaces/user.interface.ts`) tem exatamente `email`, `firstName`, `lastName`, `profilePictureUrl` — o mesmo `AuthUserLike` de `profile-hint.ts:27-32` | zero |
| `hooks/useConvexAuthAdapter.ts` | vira porta de plataforma; a versão web é o snippet acima | ~15 linhas por alvo |
| `hooks/useAuth.ts` | vira porta de plataforma; a versão web é um re-export tipado do `useAuth` do AuthKit | ~20 linhas |
| `features/auth/AuthGate.tsx` | única mudança: `window.auth.getUser()` (linha 42) vira `platform.auth.getProfile()` | 1 linha |
| `features/auth/AuthWatchdog.tsx` | única mudança: `window.auth.getUser()` (linha 55) vira `platform.auth.hasLiveSession()` | 1 linha |

**A costura "grande" do ROADMAP é, medida arquivo a arquivo, a menor das três.** O que
sobra de trabalho real é: instalar o pacote, montar o provider, e a tela de login (que na
web precisa de um botão que navega, não de um IPC).

### 1.6 O `AuthWatchdog` continua necessário na web

O Pitfall 4 é do lado do cliente Convex, não do Electron. Na web ele reaparece com outra
causa possível: `getAccessToken()` lança `LoginRequiredError` quando o refresh falha de vez,
o adaptador devolve `null`, e o Convex fica em `isAuthenticated: false`. A diferença é o
teste de "a sessão ainda vale?": em vez de perguntar ao processo main, pergunta-se ao
AuthKit (`user !== null` no contexto). E a saída deixa de ser `window.location.reload()`
cego — passa a ser `signIn()`, que na web é barato (redirect silencioso se a sessão da
WorkOS ainda existe). Confiança: **MÉDIA** — o comportamento do `#onRefreshFailure` está
lido no código, mas a frequência do bug #259 na web não foi medida por ninguém aqui.

---

## §2 — Build: um alvo web a partir do mesmo `src/renderer`

### 2.1 Não precisa virar pacote próprio. Precisa de um segundo `vite.config`.

`electron-vite` resolve o renderer com `root = config.root || './src/renderer'` (confirmado
em `node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js`). Um `vite.config.web.ts` na
raiz com o **mesmo** `root` produz o mesmo grafo de módulos, com o mesmo `index.html` e os
mesmos aliases. Nada precisa se mover de diretório.

```ts
// vite.config.web.ts  (RECOMENDADO)
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src/renderer',              // NÃO MUDAR — ver 2.2
  base: '/',
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src'),
      '@platform': resolve('src/renderer/src/platform/web')   // <- a chave da fase
    }
  },
  build: { outDir: resolve('dist-web'), emptyOutDir: true },
  plugins: [react(), tailwindcss()]
})
```

E o alias espelho no `electron.vite.config.ts`:
`'@platform': resolve('src/renderer/src/platform/electron')`.

### 2.2 A armadilha silenciosa: o Tailwind v4 usa o `root` do Vite como base de varredura

Este é o achado que mais barato custa agora e mais caro custaria depois. Lido no plugin
instalado, `node_modules/@tailwindcss/vite/dist/index.mjs`:

- o objeto de compilação é criado com `new z(i, e.root, ...)`, onde `e` é a config resolvida
  do Vite — ou seja, **`this.base = config.root`**;
- quando não há `@source`/`source()` no CSS (o caso do projeto: `main.css:1-4` só tem
  `@import "tailwindcss"`), as fontes viram `[{ base: this.base, pattern: "**/*" }]`.

**Consequência:** um `vite.config.web.ts` com `root: 'src/web'` (ou qualquer coisa que não
`src/renderer`) faria o Tailwind varrer apenas aquele diretório. O build passaria verde,
o typecheck passaria, os testes passariam — e **o app abriria sem estilo nenhum**. É
exatamente a forma da lição nº 2 do HANDOFF.

**Regra para o plano:** o alvo web mantém `root: 'src/renderer'`. Se algum dia precisar
mudar, a mudança obrigatória e simultânea é acrescentar `@source "../";` (ou o caminho
explícito) em `src/renderer/src/assets/main.css`. Confiança: **ALTA** (código do plugin
instalado).

### 2.3 O `index.html` e a CSP

O `index.html` atual (`src/renderer/index.html:17-19`) serve aos dois alvos sem duplicação.
Duas coisas precisam de decisão:

**a) `connect-src` precisa ganhar `https://api.workos.com`.** Sem isso o
`POST /user_management/authenticate` do `authkit-js` é recusado pelo Chromium, sem erro de
aplicação — a mesma classe de falha que travou a Fase 2. Acrescentar ao meta existente é
inofensivo para o desktop (o renderer do Electron nunca fala com a WorkOS: quem fala é o
processo main, fora da CSP). **Recomendação: um único `index.html`, com
`https://api.workos.com` na `connect-src`, comentado como "necessário só no alvo web".**
Alternativa: um `index.web.html` e `build.rollupOptions.input` apontando para ele — rejeitada
porque duplica a estrutura e o comentário longo da CSP, que é documentação viva.

**b) `frame-ancestors` NÃO funciona em `<meta>`.** É ignorada por especificação. E a doc
client-only da WorkOS diz que a integração **não opera dentro de um `iframe`**. Portanto o
alvo web precisa de um cabeçalho de resposta na Vercel (ver §6), não de meta.

**c) `script-src 'self'` continua válido.** O build da web é o mesmo Vite, com os mesmos
chunks servidos da própria origem. `assetsInlineLimit: 0` (hoje no
`electron.vite.config.ts:55`) existe pelo worklet de áudio, que não é usado na web — manter
por simetria não custa nada, mas não é requisito.

### 2.4 Scripts, ignore e o ganho escondido do dev server

```jsonc
"dev:web":       "vite --config vite.config.web.ts",
"build:web":     "npm run typecheck:web && vite build --config vite.config.web.ts",
"preview:web":   "vite preview --config vite.config.web.ts",
"verify:web-bundle": "node scripts/verify-web-bundle.mjs"
```

- `.gitignore` tem `dist` (que casa só com o diretório de nome exato). **`dist-web` precisa
  ser acrescentado** — senão o primeiro build local vira 200 arquivos no `git status`.
- `vitest.config.ts` já repete os aliases `@`/`@renderer` (linhas 10-14). Ele vai precisar
  também de `@platform` — apontando para a implementação **electron**, para os testes
  existentes (27 do `ScreenSharePicker`) continuarem valendo, mais testes específicos que
  importem o caminho web por path relativo.

**O ganho escondido:** `npm run dev:web` roda no WSL2 e o Leo abre `http://localhost:5173`
no Chrome do Windows (o WSL2 encaminha `localhost`). `http://localhost` é *secure context*,
então **microfone, `getDisplayMedia` e WebRTC funcionam ali**. Pela primeira vez no projeto
uma parte grande do "só o Leo pode verificar" vira um ciclo de segundos em vez de um ciclo
de build+instalador. Isso não é efeito colateral — é argumento para fazer a fase.
(Requer cadastrar `http://localhost:5173` como redirect URI e como origem CORS na WorkOS;
o `authkit-js` já liga `devMode` sozinho em `localhost`.)

---

## §3 — A camada de plataforma: o menor desenho que funciona

**Regra:** nenhum `if (isElectron)` em código de feature. A escolha é do **bundler**, via o
alias `@platform`. O que não existe no alvo simplesmente não entra no grafo de módulos — o
bundle da web nunca vê `window.screenshare`, `window.voice` nem o worklet de PCM.

```
src/renderer/src/platform/
  contract.ts              # só tipos, zero implementação, importável pelos dois
  electron/
    index.ts               # auth/ptt/screenshare/capabilities sobre window.*
    AuthProvider.tsx       # <>{children}</> (o Electron não tem provider de auth)
    ScreenShareExtras.tsx  # monta o <ScreenSharePicker />
  web/
    index.ts
    AuthProvider.tsx       # <AuthKitProvider devMode>
    ScreenShareExtras.tsx  # () => null
```

Contrato mínimo — derivado dos 9 arquivos medidos, não inventado:

```ts
// contract.ts
export type PlatformCapabilities = {
  /** PTT funciona com o app SEM foco (uiohook). Web: false. */
  globalPushToTalk: boolean
  /** O app desenha o próprio seletor de fonte. Web: false (o Chrome desenha). */
  ownScreenSourcePicker: boolean
  /** De onde vem o som do compartilhamento. */
  screenShareAudio: 'process-exclude' | 'browser-surface' | 'none'
  /** Existe atualização automática / instância única / deep link. Web: false. */
  desktopIntegration: boolean
}

export type PlatformAuth = {
  AuthProvider: React.ComponentType<{ children: React.ReactNode }>
  useSession(): { user: SessionUser | null; loading: boolean; error: string | null }
  useConvexAuthAdapter(): {
    isLoading: boolean
    isAuthenticated: boolean
    fetchAccessToken(a: { forceRefreshToken: boolean }): Promise<string | null>
  }
  signIn(): Promise<void>
  signOut(): Promise<void>
  /** Perfil para a dica do ensureUser. Nunca lança. */
  getProfile(): Promise<AuthUserLike | null>
  /** O watchdog pergunta isto antes de tomar qualquer medida drástica. */
  hasLiveSession(): Promise<boolean>
}

export type PlatformPushToTalk = {
  /** Registra os dois handlers; devolve o cleanup. */
  subscribe(h: { onDown(): void; onUp(): void }): () => void
  /** Electron: liga/desliga o hook nativo. Web: no-op. */
  setActive(active: boolean): void
}

export type PlatformScreenShare = {
  /** Opções que vão para room.localParticipant.setScreenShareEnabled. */
  captureOptions(hint: ContentHint, wantsAudio: boolean): ScreenShareCaptureOptions
  /** Electron: 2º passo (WASAPI por processo). Web: no-op — o áudio já veio junto. */
  startAudio(room: Room): Promise<void>
  stopAudio(): Promise<void>
  /** Componentes que só existem num alvo (o seletor próprio). */
  Extras: React.ComponentType
}
```

**Guardas que valem o preço (o projeto já tem o precedente em
`scripts/verify-renderer-runtime.mjs`):**

1. **ESLint `no-restricted-syntax`**: proibir `window.auth|voice|screenshare|electron` fora
   de `src/renderer/src/platform/electron/**`. Custo: uma regra. Ganho: a regra segura a
   fase seguinte, não só esta.
2. **`scripts/verify-web-bundle.mjs`**: varre `dist-web/**/*.js` procurando marcadores que
   só podem vir do lado Electron (`auth:get-access-token`, `screenshare:`, `uiohook`,
   `screenshare-pcm-player`). Mesma forma e mesma justificativa do script de runtime do
   Convex — build verde não prova nada.

`src/renderer/src/components/Versions.tsx` (o único outro consumidor de `window.electron`,
linha 4) **não é importado por nenhum arquivo** — verificado por grep. Deve ser **apagado**
na fase, não portado.

---

## §4 — O que não existe na web, e o que cada um deve fazer

| Recurso | Por que não existe | Comportamento recomendado |
|---|---|---|
| **PTT sem foco** (`uiohook-napi`, tecla fixa `CtrlRight`, `src/main/voice/ptt.ts:38`) | Nenhuma API de navegador captura tecla fora de foco | **Degradar, dizendo.** `keydown`/`keyup` em `window` filtrando `event.code === 'ControlRight'`, ignorando `input/textarea/[contenteditable]`, e — obrigatório — **forçar `onUp()` em `blur` e em `visibilitychange`**, senão Alt+Tab com a tecla presa deixa o microfone aberto para sempre. A UI de configurações precisa dizer "só com a janela em foco" |
| **Seletor de tela próprio** (`ScreenSharePicker`, 326 linhas + 27 testes) | O Chrome desenha o seu | **Esconder.** Não montar (`Extras: () => null`). Os 27 testes continuam válidos para o alvo Electron |
| **Áudio por processo** (`loopback-capture` + worklet + ponte PCM, Fase 8.6) | Só existe no processo main, via WASAPI | **Substituir por outro caminho**, não desligar: na web o áudio vem no mesmo `getDisplayMedia` (§5) |
| **Instância única / deep link `janja://`** | Sem processo main | **Desligar em silêncio.** Na web, abrir duas abas é legítimo — mas ver §8, tem consequência em voz |
| **Bandeja e atualização automática** | Sem processo main | **Desligar em silêncio.** A web já é sempre a última versão — isso é vantagem, e vale dizer na tela |
| **`window.electron.process.versions`** | — | **Apagar o arquivo** (não usado) |
| **Janela com `minWidth: 900`** (`src/main/index.ts:20`) | O navegador não tem mínimo | **Decisão de produto pendente**: hoje o shell assume ≥900px. Recomendação para v1: tela de aviso abaixo de ~800px ("abra num navegador de computador") em vez de tentar layout responsivo, que é uma fase inteira |

**Requisito novo sugerido (o ROADMAP já antecipou): "paridade declarada".** Uma única
fonte de verdade — o objeto `capabilities` do `@platform` — alimentando os textos da
interface. Nunca uma string duplicada em cada tela.

---

## §5 — Compartilhamento de tela na web, e a pergunta do eco

### 5.1 O que o Chrome no Windows realmente oferece

| Superfície | Vídeo | Áudio |
|---|---|---|
| **Aba** (`browser`) | sim | **sim** — só o áudio daquela aba |
| **Janela** (`window`) | sim | **não** — não existe áudio de janela no Chrome/Windows |
| **Tela inteira** (`monitor`) | sim | **sim, se `systemAudio: 'include'`** — e é o áudio do sistema inteiro |

Confiança: **ALTA** (documentação do Chrome + issue do Chromium 40947205, "getDisplayMedia
can't capture window audio"). Consequência de produto que precisa estar na interface:
**"compartilhar janela" na web é sempre mudo.** Quem quer som escolhe aba ou tela inteira —
e o Chrome não deixa o app escolher por ele; quem escolhe é o usuário no diálogo nativo.

### 5.2 O eco existe na web? Sim, por padrão. E há um botão que o desliga.

O texto oficial do Chrome 141 beta é direto: *"By default, when system audio is captured, it
includes all audio played out by the system on audio output devices."* Ou seja, na captura
de **tela inteira com áudio de sistema**, a voz dos outros participantes — que a própria aba
do Hydra está tocando — entra na captura. **O eco de 2026-08-20 se reproduz na web.**

Duas saídas, e as duas existem hoje:

1. **`restrictOwnAudio: true`** — *"When `restrictOwnAudio` is enabled, the captured system
   audio will be filtered to exclude audio originating from the document that performed
   `getDisplayMedia`."* Shipped no **Chrome 141**, **Windows e Mac** (Linux/ChromeOS não
   fornecem o necessário). É uma constraint de áudio, e o `livekit-client@2.22.0` instalado
   **já a expõe** — `node_modules/livekit-client/dist/src/room/track/options.d.ts:266-272`,
   em `AudioCaptureOptions`, com o comentário do próprio SDK: *"when capturing
   system/screen-share audio, excludes the local participant's own audio from the captured
   stream to prevent echo"*.
2. **Compartilhar uma aba** — estruturalmente sem eco, porque o Chrome captura o áudio
   daquela aba, não do dispositivo. Combinado com `selfBrowserSurface: 'exclude'` (que
   impede escolher a própria aba do Hydra), é o caminho mais seguro.

### 5.3 O código do alvo web

```ts
// platform/web — captureOptions()
{
  audio: { restrictOwnAudio: true },   // vai DENTRO de audio: é constraint de áudio
  video: true,
  contentHint,                          // 'motion' | 'detail', já existe em QUALITY_PRESETS
  systemAudio: 'include',
  selfBrowserSurface: 'exclude',        // não deixa compartilhar a própria aba
  surfaceSwitching: 'include'
}
```

Depois disso o LiveKit faz sozinho o que hoje custa 140 linhas no Electron: em
`livekit-client.esm.mjs:29010-29013`, se o stream do `getDisplayMedia` trouxer faixa de
áudio, ele cria um `LocalAudioTrack` com `source = Track.Source.ScreenShareAudio` e publica
junto. **Nada de ponte PCM, nada de `AudioWorklet`, nada de IPC de 100 msg/s.**

**Duas armadilhas verificadas no SDK instalado:**

- `screenCaptureToDisplayMediaStreamOptions` (`livekit-client.esm.mjs:13350-13359`) devolve
  **apenas** `{ audio, video, controller, selfBrowserSurface, surfaceSwitching, systemAudio,
  preferCurrentTab }`. **`suppressLocalAudioPlayback` do nível de cima NÃO é repassado** —
  se for preciso, tem que ir dentro de `audio: { ... }`. Silenciosamente ignorado é pior que
  erro.
- `restrictOwnAudio` é *best-effort*: a especificação diz que, se a remoção por
  processamento falhar, o agente pode excluir **todo** o áudio originado da aba
  capturadora. Portanto o plano precisa **ler de volta**
  `track.getSettings().restrictOwnAudio` e logar — é a única prova de que o pedido foi
  atendido, e é barata.

### 5.4 O que a web diz sobre o defeito do desktop

Esta é a parte que interessa ao projeto, e ela dá para ser respondida com um experimento
barato em vez de uma teoria.

Do lado do Electron, a concessão é feita pelo processo main e o tipo publicado
(`node_modules/electron/electron.d.ts:23716-23731`) mostra que `Streams.audio` só aceita
**três** coisas: `'loopback'`, `'loopbackWithMute'` ou um `WebFrameMain`. Não existe a opção
"áudio do sistema menos o meu documento" — que é justamente o que `restrictOwnAudio` faz no
Chrome. Isto é evidência estrutural (não prova) de que a constraint não tinha como ser
honrada no Electron: **a fonte já estava fixada pela concessão** antes de qualquer
constraint ser avaliada; `'loopback'` é o dispositivo inteiro, por definição.

**O experimento que fecha a questão** (uma máquina Windows, três pessoas, ~15 min):
compartilhar tela inteira **pela web** com `systemAudio: 'include'` + `restrictOwnAudio:
true`, com música tocando e alguém falando. Três resultados possíveis, e os três informam:

| Resultado | O que significa |
|---|---|
| Sem eco, `getSettings().restrictOwnAudio === true` | O defeito era do caminho de concessão do Electron. A Fase 8.6 continua sendo a resposta certa **para o desktop**, e a web fica mais simples do que o desktop |
| Com eco, mesmo com a flag aceita | O problema é do próprio loopback do Windows e a Fase 8.6 (excluir por árvore de processos) é o único caminho nos dois alvos — a web herdaria a limitação "só aba tem áudio limpo" |
| A flag não aparece em `getSettings()` | A versão do Chrome do Leo é < 141: a base de comparação está errada e o teste precisa ser refeito |

Confiança: **ALTA** na mecânica documentada; **BAIXA** em qual dos três resultados sai — e
nenhuma leitura substitui o teste.

---

## §6 — Vercel

**SPA de rota única.** Como o `redirectUri` do AuthKit é a própria origem e o `authkit-js`
limpa `?code&state` com `history.replaceState`, **não há deep link a suportar**. Mesmo
assim, o `vercel.json` com o rewrite total é a rede de segurança recomendada pela própria
Vercel para SPAs Vite:

```jsonc
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        // frame-ancestors é IGNORADA em <meta> — precisa ser cabeçalho.
        // A integração client-only da WorkOS não funciona dentro de iframe.
        { "key": "Content-Security-Policy", "value": "frame-ancestors 'none'" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

Duas CSPs (a do `<meta>` e a do cabeçalho) **se interseccionam**, não se substituem. Como o
cabeçalho traz **só** `frame-ancestors`, ele não restringe mais nada — é seguro. Duplicar a
política inteira nos dois lugares seria a armadilha (qualquer divergência vira bloqueio
silencioso).

**Configuração do projeto na Vercel:**

| Item | Valor |
|---|---|
| Framework Preset | **Other** (o preset "Vite" espera `vite.config.ts` na raiz e `dist`; aqui o config é `vite.config.web.ts` e a saída é `dist-web`) |
| Build Command | `npm run build:web` |
| Output Directory | `dist-web` |
| Install Command | ⚠️ **atenção**: o `postinstall` do projeto roda `node_modules/electron/install.js` e `scripts/postinstall-rebuild.mjs`. Baixar o Electron inteiro num build da Vercel é lento e pode falhar. Recomendação: `npm ci --ignore-scripts` como install command, e verificar que o build web não depende de nada gerado no postinstall (ele não depende — o que o postinstall prepara é binário nativo do main) |

**Variáveis de ambiente (tempo de build, não runtime).** Vite substitui `import.meta.env.*`
no bundle; **não existe env var em runtime numa SPA estática**. Precisam estar cadastradas
no projeto da Vercel, escopo Production **e** Preview:

- `VITE_CONVEX_URL` — mesmo valor do `.env.local` do desktop (`https://<deployment>.convex.cloud`)
- `VITE_WORKOS_CLIENT_ID` — **novo nome**: hoje o client id só existe como
  `MAIN_VITE_WORKOS_CLIENT_ID`, que o electron-vite expõe ao **main**, não ao renderer. É
  público por design (HANDOFF, tabela de segredos) — pode ir no bundle
- `VITE_CONVEX_SITE_URL` — **não é necessária na web**: ela existe só para montar o
  `redirectUri` que devolve para `janja://` (`src/main/auth/auth.ts:33-34`)

**Deploys de preview são um risco de auth**, e vale decidir antes: cada branch ganha uma URL
`*.vercel.app` nova, e **nenhuma delas estará cadastrada na WorkOS** como redirect URI nem
como origem CORS — o login simplesmente falha ali. A WorkOS aceita wildcard em subdomínio,
mas **não** como redirect URI padrão. Recomendação para v1: desligar deploys de preview, ou
aceitar que só o domínio de produção loga.

---

## §7 — LiveKit e Convex no navegador

**Convex:** nenhuma diferença. O `ConvexReactClient` já é um cliente de navegador; o
Electron é que era o caso incomum. Mesma URL, mesmo WebSocket, mesmo deployment. A CSP já
tem `wss://*.convex.cloud`. Confiança: **ALTA**.

**LiveKit:** o transporte é idêntico (é o mesmo Chromium). Quatro diferenças de
comportamento que precisam de código novo:

1. **Autoplay — e este é o mais provável de virar "entrei na call e não ouço ninguém".**
   O renderer anexa as tracks remotas com `track.attach()`
   (`src/renderer/src/state/voice-context.tsx:1010`) e **nunca** trata a política de
   autoplay. Verificado no SDK instalado (`Room.d.ts:202-214`, `events.d.ts:256-259`): existe
   `room.canPlaybackAudio`, o evento `AudioPlaybackStatusChanged` e `room.startAudio()`, que
   **precisa ser chamado de dentro de um gesto do usuário**. O plano precisa de um estado de
   UI ("clique para ouvir") ligado a esse evento. Na prática o clique em "entrar no canal"
   já é um gesto, então o caso comum funciona — mas reconexão, recarregar a aba com a call
   ativa e restaurar sessão não são. Confiança: **ALTA** de que a API é necessária; **MÉDIA**
   sobre com que frequência dispara.
2. **Permissão de microfone.** No Electron a permissão é implícita; na web há um prompt, e
   `Room.getLocalDevices(kind)` **pede permissão por padrão** (`livekit-client.esm.mjs:32925-32927`,
   `requestPermissions = true`). Efeito colateral concreto: abrir o popover de configurações
   de voz (`VoiceSettingsPopover.tsx:105-106`) dispara o prompt do navegador. Decidir se
   isso é aceitável ou se o popover deve pedir permissão explicitamente antes.
   Sem permissão concedida, `enumerateDevices` devolve **rótulos vazios** — a lista de
   dispositivos aparece como "Dispositivo 1, 2, 3".
3. **`setSinkId` (saída de áudio, VOICE-20).** `room.switchActiveDevice('audiooutput', id)`
   depende de `HTMLMediaElement.setSinkId`, que é **Chromium-only** e depende de o
   `deviceId` de saída estar exposto — o que só acontece depois da permissão de microfone.
   No Firefox, escolher saída de áudio simplesmente não vai funcionar. Recomendação:
   esconder o seletor de saída quando `!('setSinkId' in HTMLMediaElement.prototype)`, em vez
   de deixá-lo mentir. Confiança: **MÉDIA** — não pude testar navegador nenhum aqui.
4. **Aba em segundo plano.** O heartbeat de presença é de 45s
   (`features/auth/PresenceHeartbeat.tsx`) contra um limiar de 90s
   (`convex/members.ts`, `ONLINE_THRESHOLD_MS`). O Chrome limita `setInterval` de aba oculta
   a ~1/min, o que ainda cabe nos 90s; mas aba **congelada** (sem mídia ativa, bateria) para
   de vez, e a pessoa aparece offline estando com a aba aberta. Durante uma call isso não
   acontece (a mídia mantém a aba viva). Confiança: **MÉDIA**.

**Navegadores suportados — decidir explicitamente:** áudio de compartilhamento e
`restrictOwnAudio` são Chromium-only; o Firefox ignora a parte de áudio do `getDisplayMedia`
inteiramente, e o Safari também. Recomendação: **declarar Chrome/Edge como suportados** e
mostrar um aviso claro nos outros, em vez de degradar em silêncio.

---

## §8 — Riscos de convivência: dois clientes, um backend

Nada no backend precisa mudar. O que muda é que passa a existir um caso que não existia: **a
mesma pessoa em dois clientes ao mesmo tempo.**

| Área | O que acontece | Gravidade |
|---|---|---|
| **Sessão / login** | Independentes. Mesma `users` no Convex (`ensureUser` é idempotente por `workosId`), mesmo `USER#tag`. Deslogar num não desloga no outro | nenhuma |
| **Presença** | `presence.heartbeat` faz upsert por `userId`; dois heartbeats só mantêm a linha mais viva. Sair de um cliente não deixa a pessoa offline enquanto o outro estiver aberto | nenhuma |
| **Voz — este é o problema real** | O `identity` do token do LiveKit é o `users._id` do Convex (`convex/voiceToken.ts:80`). Duas conexões simultâneas com o mesmo identity no mesmo room fazem o SFU **derrubar uma** — o próprio repo documenta isso em `voiceToken.ts:103-105` e a lição nº 3 do HANDOFF nasceu desse sintoma | **alta** |
| **Efeito colateral do acima** | O cliente derrubado gera um `participant_left` no webhook → `reconcileParticipantLeft` **apaga a linha de `voiceStates`** (`convex/voice.ts:193-205`) do par `(channelId, userId)` — inclusive para o cliente que ficou. Resultado: a pessoa **continua ouvindo e falando**, mas **some da lista de participantes** para todo mundo | **alta** |
| **Chat / não lidas** | `channelReadState` é por usuário: ler numa aba marca como lido na outra. Comportamento razoável, mas diferente do esperado | baixa |
| **Digitando** | Por usuário; duas abas escrevendo fazem o indicador piscar | baixa |
| **Preferências** | `localStorage` é por origem: desktop e web têm volume, dispositivo, modo de voz e qualidade **separados**. Não é bug, mas alguém vai reclamar que "as configurações sumiram" | baixa |

**Recomendação para o plano:** não tentar suportar duas sessões de voz da mesma pessoa. Fazer
o que é honesto e barato — antes de entrar num canal, se já existe linha em `voiceStates`
para aquele `userId` (a query já existe, `by_user`), avisar: *"Você já está num canal de voz
em outro dispositivo. Entrar aqui vai desconectar o outro."* e exigir confirmação.
Alternativa nomeada: sufixar o identity do LiveKit com um id de sessão (o padrão que o
próprio projeto já usa no testador de microfone, `voiceToken.ts:143-144`,
`${userId}-mictest-${role}`) — mas isso obriga a mudar o mapeamento
`participant.identity → userId` do webhook (`convex/http.ts` + `voiceToken.ts:210`) e
reabre o Pitfall 3. **Critério que decide:** só vale o segundo caminho se "a mesma pessoa em
dois dispositivos na mesma call" virar requisito de produto. Hoje não é.

**O webhook em si não muda.** Ele já é a fonte de reconciliação para queda de qualquer
cliente, e um navegador fechando a aba é o mesmo caso de um `.exe` sendo morto.

---

## §9 — O que o Leo precisa fazer fora do repositório

Em ordem de dependência. Nada aqui é feito por agente.

**A. Domínio e DNS (só se quiser domínio próprio — recomendado)**
1. Escolher o nome. Sugestão coerente com a infra existente: `hydra.usesenju.com` (o LiveKit
   já vive em `livekit.usesenju.com`, então o DNS é o mesmo painel da Hostinger).
2. Adicionar o domínio no projeto da Vercel e criar o registro CNAME que ela pedir.
   - Se ficar só no `*.vercel.app`, funciona igual — **a única coisa que o domínio próprio
     destravaria seria o custom auth domain da WorkOS, que custa US$ 99/mês e está fora.**

**B. WorkOS — dashboard, ambiente de PRODUÇÃO (o mesmo que o desktop usa)**
3. **Redirects** → acrescentar `https://hydra.usesenju.com` (ou a URL da Vercel) como
   redirect URI. **Não remover nem trocar o padrão** — o desktop depende de
   `https://<deployment>.convex.site/auth/complete` (`convex/http.ts:145-158`). São duas
   entradas convivendo, e a WorkOS suporta múltiplas.
4. **Redirects** → acrescentar `http://localhost:5173` para o dev server (é o que destrava
   o ciclo rápido do §2.4).
5. **Redirects** → conferir/definir a **Sign-out URI**. A doc é explícita: sem ela, logout
   dá erro. Precisa apontar para a origem web.
6. **Authentication → Configure CORS** → acrescentar `https://hydra.usesenju.com` e
   `http://localhost:5173` como origens permitidas. **Isto é novo e não existe hoje**: o
   Electron nunca fez requisição de navegador para a WorkOS. Sem isso o login web falha com
   erro de CORS no console e nada mais.
7. Conferir que o TTL do access token continua em 8h (foi elevado na Fase 2) — vale para os
   dois clientes.

**C. Vercel — projeto**
8. Criar o projeto apontando para o repo, Framework Preset **Other**, Build Command
   `npm run build:web`, Output Directory `dist-web`, Install Command `npm ci --ignore-scripts`.
9. Cadastrar as env vars `VITE_CONVEX_URL` e `VITE_WORKOS_CLIENT_ID` (Production e, se
   forem usados, Preview).
10. Decidir sobre deploys de preview (ver §6) — recomendado desligar para v1.

**D. Convex**
11. **Nada.** Mesmo deployment, mesmo `auth.config.ts`, mesmas env vars. Confirmado: o JWT é
    o mesmo, emitido pelo mesmo `client_id`.

**E. LiveKit**
12. **Nada.** Mesma URL, mesmo token, mesmo webhook.

---

## §10 — O que só se prova com o Leo (WSL2 não alcança)

| O quê | Por quê | Custo |
|---|---|---|
| Login web ponta a ponta | Precisa do dashboard da WorkOS configurado e de um navegador gráfico | 10 min, sozinho |
| A sessão sobrevive a F5 com `devMode` | Depende do `localStorage` real e do refresh contra a API da WorkOS | 2 min |
| Microfone e voz no navegador | Sem dispositivo de áudio aqui | com 2 pessoas |
| **O teste do eco (§5.4)** | 3 máquinas, alguém falando enquanto outro compartilha | o mais caro, e o mais informativo |
| `restrictOwnAudio` aparece em `getSettings()` | Depende da versão do Chrome do Leo (precisa ≥141) | 1 min, e faz sentido ser o **primeiro** passo |
| Escolha de saída de áudio (`setSinkId`) no navegador | Sem dispositivo aqui | 5 min |
| Layout abaixo de 900px | Sem tela aqui | 5 min |
| Desktop + web ao mesmo tempo no mesmo canal de voz (§8) | Precisa dos dois clientes rodando | 10 min, sozinho — e é o teste que mais provavelmente acha bug |

---

## §11 — Tamanho real da fase e fatiamento sugerido

A medição do ROADMAP ("10 de 96 arquivos") continua correta em contagem, mas o **peso está
distribuído ao contrário do que ela sugere**: auth é a costura mais barata, e o trabalho de
verdade está no andaime (build + camada de plataforma) e na verificação.

| Bloco | Peso | Por quê |
|---|---|---|
| Camada de plataforma + segundo build | **médio-grande** | É andaime novo: contrato, dois pacotes de implementação, dois aliases, guarda de lint, script de verificação de bundle. Toca 9 arquivos existentes de forma rasa |
| Autenticação | **pequeno** | 1 pacote, 1 provider, ~35 linhas de adaptador, 2 chamadas trocadas. `profile-hint.ts` não muda |
| Compartilhamento de tela | **negativo** | O alvo web apaga 140 linhas de ponte PCM do seu caminho e ganha 6 linhas de constraints |
| Voz | **pequeno-médio** | PTT em foco (com a armadilha do `blur`), `startAudio()` para autoplay, seletor de saída condicional |
| Paridade declarada | **pequeno** | Uma fonte de verdade (`capabilities`) e os textos |
| Vercel + WorkOS | **pequeno em código, médio em coordenação** | Um `vercel.json`, o resto é dashboard e DNS |
| Convivência dos dois clientes | **pequeno em código, alto em risco** | Uma confirmação antes do join; e um checkpoint humano que provavelmente acha bug |

**Fatiamento sugerido — 7 planos**, com o de deploy propositalmente cedo (é o que revela
problema de configuração antes de existir feature em cima):

1. Camada de plataforma e o segundo alvo de build (sem nenhuma feature nova; o alvo web
   sobe mostrando a tela de "Convex não configurado", e o desktop continua idêntico)
2. Autenticação na web (`authkit-react`, `devMode`, adaptador, `AuthGate`/`AuthWatchdog`)
3. **Checkpoint humano curto**: deploy na Vercel + config da WorkOS + login real
4. Voz na web (autoplay/`startAudio`, PTT em foco com trava de `blur`, dispositivos)
5. Compartilhamento de tela na web (`restrictOwnAudio`, `systemAudio`, leitura de
   `getSettings()` para prova)
6. Paridade declarada + convivência (aviso de "já está em voz em outro dispositivo",
   navegadores não suportados, largura mínima)
7. **Checkpoint humano final**: o teste do eco, o teste dos dois clientes, e a regressão do
   roteiro de texto/servidores/DMs pelo navegador

**Pré-condição do ROADMAP mantida:** nada disso começa antes do
`.planning/CHECKPOINT-WINDOWS.md` — abrir uma segunda plataforma antes da primeira ter sido
verificada uma vez dobra a superfície de algo que ninguém viu funcionar ainda.

---

## §12 — Perguntas em aberto

1. **`restrictOwnAudio` funciona de fato no Chrome do Leo, no Windows dele?**
   O que se sabe: shipped no Chrome 141, Windows e Mac; a API existe no LiveKit instalado.
   O que falta: um `getSettings()` real e uma call com três pessoas. Recomendação: fazer
   disto o **primeiro** item do checkpoint da fase — o resultado muda o texto da interface
   e a lição sobre a Fase 8.6.
2. **A WorkOS aceita bem duas plataformas no MESMO ambiente de produção?**
   O que se sabe: múltiplos redirect URIs são suportados e documentados; o CORS é uma lista.
   O que falta: confirmação prática de que acrescentar a origem web não afeta o fluxo do
   desktop (que não passa por CORS nenhum). Risco avaliado como baixo, mas é uma mudança no
   ambiente do qual dez pessoas dependem — fazer **fora** de uma janela de uso.
3. **O `postinstall` do repo atrapalha o build da Vercel?**
   O que se sabe: ele baixa o Electron e roda um rebuild nativo, nada disso necessário para
   o bundle web. O que falta: rodar um build lá. Mitigação já nomeada (`--ignore-scripts`),
   com plano B de mover o postinstall para um script opcional.
4. **Qual é a largura mínima aceitável?**
   Decisão de produto, não de pesquisa. O shell foi desenhado com `minWidth: 900`.
5. **Vale reaproveitar o alvo web como ambiente de desenvolvimento oficial?**
   O ganho é grande (§2.4) e mudaria o ritmo do projeto inteiro. Mas cria o risco novo de
   "funciona no dev server e não no app" — a lição nº 1 do HANDOFF, ao contrário. Sugestão:
   usar para iterar UI, **nunca** para validar comportamento de mídia ou de plataforma.

---

## Fontes

### Primárias (confiança ALTA) — código instalado/publicado, lido diretamente
- `@convex-dev/workos@0.0.3` — tarball do npm, `package/dist/index.js` e `package/dist/index.d.ts` (arquivos completos)
- `@workos-inc/authkit-react@0.16.2` — `src/provider.tsx`, `src/hook.ts`, `src/state.ts`, `src/types.ts`
- `@workos-inc/authkit-js@0.20.2` — `src/create-client.ts`, `src/http-client.ts`, `src/utils/session-data.ts`, `src/interfaces/user.interface.ts`
- `node_modules/livekit-client/dist/src/room/track/options.d.ts:195-285` — `ScreenShareCaptureOptions` e `AudioCaptureOptions` (incl. `restrictOwnAudio`)
- `node_modules/livekit-client/dist/livekit-client.esm.mjs:13350-13359` — o que é e o que **não** é repassado ao `getDisplayMedia`
- `node_modules/livekit-client/dist/livekit-client.esm.mjs:29001-29013` — publicação automática da track `ScreenShareAudio`
- `node_modules/livekit-client/dist/src/room/Room.d.ts:160-214` — `getLocalDevices`, `startAudio`, `canPlaybackAudio`
- `node_modules/livekit-client/dist/livekit-client.esm.mjs:32925-32927` — `requestPermissions = true` por padrão
- `node_modules/electron/electron.d.ts:23716-23731` — `Streams.audio: 'loopback' | 'loopbackWithMute' | WebFrameMain`
- `node_modules/@tailwindcss/vite/dist/index.mjs` — base de varredura = `config.root`
- `node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js` — `root = config.root || './src/renderer'`
- Repo: `src/renderer/src/hooks/useConvexAuthAdapter.ts`, `hooks/useAuth.ts`, `features/auth/AuthGate.tsx:42`, `features/auth/AuthWatchdog.tsx:55`, `lib/profile-hint.ts:27-32`, `state/voice-context.tsx:648,783-930,1441-1466`, `components/shell/ScreenSharePicker.tsx`, `components/Versions.tsx` (não importado), `src/preload/index.ts`, `src/main/auth/auth.ts:24-34,105-211`, `src/main/screenshare.ts:308-344`, `src/main/voice/ptt.ts:38`, `convex/http.ts:140-158`, `convex/voice.ts:62-205`, `convex/voiceToken.ts:77-105,143-144`, `convex/members.ts:16-18`, `electron.vite.config.ts`, `vitest.config.ts`, `.gitignore`

### Oficiais (confiança ALTA)
- https://workos.com/docs/user-management/client-only — integração client-only, `devMode`, redirect URI = a rota do app, CORS, sign-out URI, "não funciona em iframe"
- https://github.com/workos/authkit-react — props do `AuthKitProvider`, API do `useAuth`, exigências de dashboard
- https://workos.com/pricing.md — "Custom domain — $99/mo"; AuthKit grátis até 1M MAU
- https://workos.com/docs/custom-domains/authkit — CNAME, só ambiente de produção, verificação em até 72h
- https://workos.com/docs/sso/redirect-uris — múltiplos redirect URIs, wildcard não pode ser o padrão
- https://docs.convex.dev/auth/authkit — `auth.config.ts` (idêntico ao que o repo já tem)
- https://developer.chrome.com/blog/chrome-141-beta — texto oficial de `restrictOwnAudio` e do comportamento padrão do áudio de sistema
- https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/restrictOwnAudio — semântica e o caso "se a remoção falhar, pode excluir todo o áudio da aba"
- https://developer.chrome.com/docs/web-platform/screen-sharing-controls — `systemAudio`, `selfBrowserSurface`, `surfaceSwitching`
- https://vercel.com/docs/frameworks/frontend/vite — rewrite de SPA, env vars com prefixo `VITE_` em tempo de build
- https://vercel.com/docs/project-configuration/vercel-json — `rewrites` e `headers`

### Secundárias (confiança MÉDIA — cruzadas, não verificadas em máquina)
- https://issues.chromium.org/issues/40947205 — "getDisplayMedia can't capture window audio"
- https://www.mail-archive.com/blink-dev@chromium.org/msg14230.html — Intent to Ship do `restrictOwnAudio` (marco anunciado como 140; enviado de fato no 141, Windows/Mac)
- https://blog.addpipe.com/recording-the-screen-in-chrome-with-both-microphone-audio-and-system-sounds/ — matriz aba/janela/tela × áudio no Windows

---

## Metadata

**Confiança por área:**
- Autenticação na web: **ALTA** — código dos três pacotes lido na íntegra + doc + preço oficiais
- Build e camada de plataforma: **ALTA** — comportamento do Tailwind e do electron-vite lido no código instalado
- Compartilhamento de tela / eco: **ALTA** na mecânica, **BAIXA** no resultado — só o teste com 3 pessoas decide
- Vercel: **MÉDIA-ALTA** — doc oficial, mas nenhum build foi executado lá
- LiveKit no navegador: **MÉDIA** — APIs confirmadas no SDK instalado, comportamento não observado
- Convivência dos dois clientes: **MÉDIA** — a mecânica está lida no código do repo; o sintoma não foi reproduzido

**Ambiente da pesquisa:** WSL2, sem Windows, sem navegador gráfico, sem dispositivo de
áudio, sem acesso ao deployment do Convex nem ao dashboard da WorkOS. Nenhuma linha de
código foi alterada e nenhum pacote foi instalado no repo.

**Validade estimada:** 30 dias para auth e build; **7 dias** para o que depende de versão do
Chrome (`restrictOwnAudio` é recente e a matriz de plataformas ainda muda).
