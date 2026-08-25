# quick/003 — Tela preta no primeiro cadastro (web)

**Sintoma (Leo, uso real, 2026-08-25):** "Quando você cadastra pela primeira vez
ele fica só com uma tela preta e você precisa dar F5 pra funcionar."

**Onde:** https://janja-omega.vercel.app e `localhost:5173`. Primeiro acesso.

**Commits:** `d4b6860` (a causa), `8c5a6b8` (a rede), `<este>` (o resumo).

---

## 1. A primeira coisa que a tela preta contou

Preta, não branca. `src/renderer/index.html` fixa `class="dark"` no `<html>` e
`assets/main.css:170` aplica `bg-background` no `body` — que no bloco `.dark` é
`oklch(0.145 0 0)`, quase preto.

Ou seja: **o CSS carregou e o `body` está pintado. O que está vazio é o
`<div id="root">`.** Tela preta ≠ "o app não abriu"; tela preta = **a árvore do
React desmontou**.

Isso elimina de saída metade das hipóteses da investigação: não é o
`initialize()` do authkit "não terminando" (isso daria a tela "Carregando…"),
não é `loading` preso em `true` (idem), não é a trava de módulo do
`AuthKitLatch` (ela só afeta `signIn`/`getProfile`, nunca o que renderiza).
Sobra a hipótese 3 — exceção — e ela é a certa. O provider da WorkOS, aliás,
**sempre** renderiza `children` (`authkit-react/src/provider.tsx:126`), então
ele nunca poderia produzir uma árvore vazia.

## 2. A causa raiz

**"Autenticado" e "tem linha na tabela `users`" são duas coisas diferentes, e
entre elas cabe uma corrida que só existe para quem está se cadastrando.**

A sequência, linha a linha:

1. O Convex vira `isAuthenticated: true` (o JWT do WorkOS é válido desde o
   primeiro segundo — ele não sabe nada sobre a nossa tabela `users`).
2. `AuthGate` renderizava `children` **na hora**, e só num **efeito** —
   depois do commit — disparava `ensureUser`, a mutation que **INSERE** a linha
   em `users` (`convex/users.ts:115`).
3. No mesmo commit, `AppShell` monta `SelectionProvider`, cujo primeiro hook é
   `useQuery(api.servers.listMyServers)` (`state/selection-context.tsx:47`).
   Esse render **não** quebra: query recém-assinada devolve `undefined`.
4. A resposta chega. Para quem acabou de se cadastrar, `requireIdentity`
   (`convex/lib/membership.ts:17-19`) lança:
   `Usuário sem documento em users — ensureUser deveria ter rodado antes`.
5. **`useQuery` do `convex/react` RELANÇA esse erro DURANTE O RENDER**
   (`node_modules/convex/dist/esm/react/client.js:463-466`:
   `if (result instanceof Error) { throw result }`). Não havia nenhum error
   boundary na árvore. O React desmonta a raiz. **`#root` vazio. Tela preta.**
6. **E o F5 conserta porque a mutation do passo 2 CHEGOU A SER ENVIADA** antes
   do desmonte — a linha em `users` já existe no segundo carregamento, nenhuma
   query lança, e o app abre normal. Para sempre, naquele navegador.

Não são três queries azaradas: `listMyServers`, `friends.listFriends`,
`friends.listIncomingFriendRequests`, `dms.listMyDmChannels` e
`presence.heartbeat` passam todas pelo mesmo `requireIdentity`. A primeira a
responder derruba a árvore.

### O que a causa NÃO é

**Não é do alvo web.** `AuthGate.tsx` é compartilhado; o Electron monta a
mesma árvore, na mesma ordem, com o mesmo efeito tardio. O defeito só apareceu
agora porque a web foi a primeira ocasião em anos de alguém **se cadastrar do
zero** — os dez do desktop já têm linha em `users` desde a Fase 2. Quem quiser
conferir: os testes desta correção rodam com `@platform` apontando para o
**Electron** (é o alias do `vitest.config.ts`), e falhavam antes da correção.

## 3. Como foi reproduzido (antes de corrigir)

`src/renderer/src/features/auth/AuthGate.test.tsx` (jsdom), com o `useQuery`
**de verdade** do `convex/react` — só o transporte é falso. Um cliente mínimo
implementa o que o `QueriesObserver` consome (`watchQuery` →
`localQueryResult`/`onUpdate`/`journal`); `localQueryResult()` lançando é
exatamente como o cliente real entrega um erro de servidor
(`queries_observer.js:63`). `ensureUser` fica pendente até o teste soltá-la —
que é a latência da vida real.

Rodando contra o `AuthGate` **de antes**:

```
FAIL  ... > não monta o app antes de `ensureUser` responder (a causa da tela preta)
      AssertionError: expected <div data-testid="app"></div> to be null
FAIL  ... > a resposta de erro do servidor NÃO desmonta a árvore
      Error: [CONVEX Q(servers:listMyServers)] ... Server Error
      Uncaught Error: Usuário sem documento em users — ensureUser deveria ter rodado antes
```

O segundo é o defeito com todas as letras: o erro **escapa do render**.

E há um terceiro teste, `o mecanismo — erro de query sem error boundary esvazia
a raiz`, que passa antes e depois da correção: ele existe para que ninguém
precise reconstruir a cadeia "erro de query → raiz vazia → retângulo preto" a
partir do relato. `container.innerHTML` vira `''`, executável.

## 4. A correção

### 4.1 A causa — `features/auth/AuthGate.tsx`

O portão tinha dois estados (carregando / deslogado). Agora tem **quatro**:
carregando → deslogado → **logado mas a conta ainda não existe** → app.

`children` só monta depois que `ensureUser` **responde**. Nenhum componente do
app precisa saber que a conta pode não existir — porque, quando ele monta, ela
existe.

- `ensuredRef` virou `accountReady` em `useState` (agora ele decide o que vai
  na tela; enquanto era só guard de efeito, um ref bastava).
- O guard de "já disparei" continua sendo ref (`ensuringRef`), pelo motivo já
  registrado no arquivo: state ali seria `set-state-in-effect`. Ele é **solto**
  no `catch`, para a falha poder ser tentada de novo — e **não** é solto na
  limpeza do efeito, senão o efeito duplo do StrictMode em dev descartaria o
  primeiro disparo e travaria o portão em "Preparando sua conta…" (tem teste).
- Zerar o portão no logout é ajuste de estado **durante a renderização**, o
  mesmo padrão que o `AuthWatchdog` já usava.
- `ensureUser` falhando deixou de ser só um `console.error` sob um app montado
  sobre uma conta inexistente: **vira tela** — "Não foi possível preparar sua
  conta", com a frase do servidor desembrulhada por `lib/convex-error.ts` (sem
  Request ID, sem stack de node_modules) e um botão "Tentar de novo".

Custo: um round-trip a mais na entrada. Nos logins seguintes `ensureUser` é um
upsert que só devolve o documento existente.

### 4.2 A rede — `components/boundary/RootErrorBoundary.tsx` + `main.tsx`

"Deixe o defeito visível." A causa acima está corrigida onde nasceu, mas
**qualquer** `useQuery` do app está a um erro de servidor de distância de
relançar dentro do render, e o resultado default do React é a mesma raiz vazia
silenciosa. Agora a raiz tem error boundary: a quebra vira texto legível na
tela e uma linha no console com prefixo buscável —
`[hydra] a árvore do React foi derrubada por um erro não tratado:` — com o erro
e o `componentStack`.

Fica **por fora de tudo**, inclusive das telas de "Configuração incompleta". É
inerte enquanto nada lança (teste: `container.innerHTML` é exatamente
`children`, sem wrapper).

## 5. Prova por mutação

| Mutação aplicada | Resultado |
| --- | --- |
| remover `if (!accountReady) return <TelaDeEspera>…` | 2 falhas (as duas da tela preta) |
| remover `if (accountError !== null) return <ContaIndisponivel …>` | 1 falha (`ensureUser` falhando vira tela legível) |
| árvore sem `RootErrorBoundary` | `container.innerHTML === ''` — asserido no próprio teste do boundary, como contraprova |

## 6. Desktop não regride

- Os testes novos rodam com `@platform` → **Electron** (alias do
  `vitest.config.ts`). É o caminho do grupo que está sendo exercitado.
- Dois testes existem só para isso: sessão carregando continua na tela
  "Carregando…", e não-autenticado continua caindo na `LoginScreen` — os dois
  sem chamar `ensureUser`.
- `RootErrorBoundary` não altera a árvore quando nada lança.
- O que muda no desktop é o mesmo que muda na web: um instante de "Preparando
  sua conta…" na entrada, e o mesmo defeito corrigido (ele existia lá também).

**Risco conhecido e aceito:** se `ensureUser` for **rejeitada** pelo servidor,
a pessoa passa a ver a tela de erro em vez de um app montado. Não vale para
queda de rede — o cliente do Convex mantém a mutation pendente até reconectar
em vez de rejeitá-la —, só para erro real do servidor, caso em que o
comportamento anterior era a tela preta de qualquer jeito.

## 7. O que o Leo confirma no navegador

1. Em **aba anônima** (para não ter `localStorage` da WorkOS), abrir
   https://janja-omega.vercel.app e **cadastrar uma conta nova** com o Google.
2. Ao voltar do Google: em vez da tela preta, deve aparecer por um instante
   **"Preparando sua conta…"** e então o app, **sem F5**.
3. Recarregar (F5) uma vez: deve continuar entrando direto, como antes.
4. No desktop, sair e entrar de novo com a conta dele: mesmo comportamento de
   sempre, com o mesmo instante de "Preparando sua conta…".

## 8. Arquivos

| Arquivo | O quê |
| --- | --- |
| `src/renderer/src/features/auth/AuthGate.tsx` | a correção da causa |
| `src/renderer/src/features/auth/AuthGate.test.tsx` | reprodução + regressão (9 testes) |
| `src/renderer/src/components/boundary/RootErrorBoundary.tsx` | a rede |
| `src/renderer/src/components/boundary/RootErrorBoundary.test.tsx` | 4 testes |
| `src/renderer/src/main.tsx` | monta o boundary por fora de tudo |

**Não tocado:** `platform/web/auth.tsx`, `AuthWatchdog.tsx`, `voice-context.tsx`
e `lib/vad.ts` (executor paralelo).

**Verificações:** typecheck limpo nas quatro passadas; suíte 46 arquivos /
711 testes (baseline era 41 / 664 — +2 arquivos e +13 testes meus, o resto é do
executor paralelo); `build:web` e `verify:web-bundle` ok; eslint limpo nos
arquivos tocados (o erro `react-refresh/only-export-components` em `main.tsx`
já existia em `HEAD`, sobre `NotConfiguredScreen` — conferido, não é meu).
