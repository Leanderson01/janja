---
phase: 10-versao-web
plan: 01
subsystem: infra
tags: [vite, tailwind-v4, typescript, platform-layer, bundler-alias, csp, workos, verificacao-de-artefato]

requires:
  - phase: 00-bootstrap-do-repo
    provides: "o `src/renderer` com `root` do electron-vite, o Tailwind v4 via plugin e a CSP do index.html"
  - phase: 02-convex-auth-workos
    provides: "`useConvexAuthAdapter` com `forceRefreshToken`, `AuthGate`, `AuthWatchdog` e o formato `AuthUserLike` de `profile-hint.ts` — de onde o contrato foi DERIVADO"
  - phase: 08.6-audio-por-processo
    provides: "o caminho de áudio por processo que `screenShareAudio: 'process-exclude'` descreve, e o `assetsInlineLimit: 0` que o alvo web NÃO herda"
provides:
  - "`vite.config.web.ts`: segundo alvo de build a partir do MESMO `src/renderer`, com as três armadilhas (root do Tailwind, envDir, fs.allow) desarmadas e documentadas no próprio arquivo"
  - "`platform/contract.ts`: os quatro tipos da costura (`PlatformCapabilities`, `PlatformAuth`, `PlatformPushToTalk`, `PlatformScreenShare`) mais `SessionUser` e `ContentHint`"
  - "`capabilities` implementado nos dois alvos, com conformidade provada pelo compilador em DUAS passadas de typecheck"
  - "o alias `@platform`, resolvido por alvo nos três configs (electron.vite, vite.config.web, vitest) e nos dois tsconfigs"
  - "`scripts/verify-web-bundle.mjs`: quatro afirmações sobre o ARTEFATO compilado, com a terceira em modo aviso até o Plano 10-07"
  - "`npm run dev:web` — ciclo de verificação de segundos em secure context, no lugar de build + instalador"
affects: [10-02 ptt e screenshare na web, 10-03 auth na web, 10-04 vercel e cabecalhos, 10-06 restrictOwnAudio, 10-07 migracao dos consumidores e portao estrito]

tech-stack:
  added: []
  patterns:
    - "Escolha de plataforma pelo BUNDLER (alias `@platform`), nunca por `if (isElectron)` — o lado não escolhido não entra no grafo de módulos"
    - "Contrato importado por `@/platform/contract` (fixo) e implementação por `@platform/...` (troca de alvo) — dois caminhos com papéis diferentes, de propósito"
    - "Sentinela de bundle: literal de string por alvo, porque literais sobrevivem à minificação e nomes de função não"
    - "Segunda passada de typecheck (`tsconfig.web-target.json`) sobre o MESMO código com o alias invertido — sem ela, metade da costura nunca é compilada do ponto de vista de quem importa"
    - "Guarda de artefato com portão adiável: a afirmação que ainda não pode passar sai como AVISO com contagem, e vira erro por flag quando a migração terminar"

key-files:
  created:
    - vite.config.web.ts
    - tsconfig.web-target.json
    - src/renderer/src/platform/contract.ts
    - src/renderer/src/platform/electron/capabilities.ts
    - src/renderer/src/platform/web/capabilities.ts
    - src/renderer/src/platform/capabilities.test.ts
    - scripts/verify-web-bundle.mjs
  modified:
    - package.json
    - tsconfig.node.json
    - tsconfig.web.json
    - electron.vite.config.ts
    - vitest.config.ts
    - src/renderer/index.html
    - src/renderer/src/env.d.ts
    - src/renderer/src/main.tsx
    - .gitignore
    - .prettierignore
    - eslint.config.mjs
  deleted:
    - src/renderer/src/components/Versions.tsx

key-decisions:
  - "`root: 'src/renderer'` no alvo web é inegociável: é o `config.root` que o `@tailwindcss/vite` usa como base de varredura das classes"
  - "`envDir: resolve('.')` explícito — o electron-vite fazia isso sozinho, o Vite puro não, e a falha é silenciosa"
  - "Um único `index.html` para os dois alvos, com `https://api.workos.com` na `connect-src`; nada de `index.web.html`"
  - "`frame-ancestors` fica FORA do `<meta>` (ignorada por especificação) — vira cabeçalho de resposta no Plano 10-04"
  - "`forceRefreshToken` é obrigatório no tipo `PlatformAuth`, com o motivo escrito no contrato para ninguém 'simplificar' depois"
  - "`verify:web-bundle` NÃO entra no `build:web` ainda: a afirmação 3 falha por design até os Planos 10-02/10-03 migrarem os consumidores"
  - "`assetsInlineLimit: 0` não é copiado do desktop — existe lá pelo AudioWorklet, que não entra no alvo web"
  - "`@platform` do vitest aponta para o Electron: a suíte existente testa o alvo desktop; teste de alvo web importa por caminho relativo"

patterns-established:
  - "Prova por artefato, não por configuração: cada armadilha desarmada foi confirmada no arquivo gerado ou na resposta do dev server"
  - "Comentário de config carrega o modo de falha que a linha evita, não o que a linha faz"

duration: 12min
completed: 2026-08-25
---

# Fase 10 Plano 01: Alvo web e contrato de plataforma — Summary

**O MESMO `src/renderer` passa a construir para o navegador com CSS real e sem uma linha do lado Electron no bundle, e existe uma costura de tipos — escolhida pelo bundler, não por `if` — onde as diferenças entre os dois alvos vão morar.**

## Performance

- **Duração:** ~12 min
- **Tarefas:** 3/3
- **Arquivos alterados:** 19 (7 criados, 11 modificados, 1 apagado)
- **Commits:** 3 de tarefa + 1 de metadados

## O que foi feito

### 1. O segundo alvo de build (`c355613`)

`vite.config.web.ts` na raiz, lendo o mesmo `root`, o mesmo `index.html` e os
mesmos aliases do desktop. As três linhas não óbvias carregam no próprio
arquivo o modo de falha que evitam — as três são **silenciosas**, passam em
typecheck, teste e build, e só aparecem no navegador.

Cinco scripts novos (`dev:web`, `build:web`, `preview:web`,
`typecheck:web-target`, `verify:web-bundle`); `dist-web` nos três ignores.

`tsconfig.web-target.json` é a peça que prova a costura: a mesma árvore de
código compilada uma segunda vez com `@platform` invertido.

### 2. O contrato e as duas implementações (`1ea1fd3`)

`contract.ts` — só tipos, derivados dos arquivos que hoje falam com a ponte,
não inventados. `capabilities` dos dois lados com anotação explícita, quatro
testes, aliases nos outros dois configs, `env.d.ts` tipado, `main.tsx` como
primeiro consumidor real do alias, `api.workos.com` na CSP, `Versions.tsx`
apagado.

### 3. O verificador e o primeiro build de verdade (`9031745`)

`scripts/verify-web-bundle.mjs`, no molde de `verify-renderer-runtime.mjs`.

## Os números que o plano pediu

### (a) Baseline da afirmação 3 — as pontes que faltam migrar

`npm run verify:web-bundle` reporta **3 marcadores vivos** no bundle web
(`window.auth`, `window.voice`, `window.screenshare`), todos no chunk único
`dist-web/assets/index-*.js`. `window.electron` e `uiohook` **já estão
zerados** — o primeiro saiu com a remoção de `Versions.tsx`, o segundo nunca
existiu fora do processo main.

Na fonte, esses 3 marcadores vêm de **6 arquivos e 20 chamadas**:

| Arquivo | Chamadas | Migra em |
|---|---|---|
| `src/renderer/src/state/voice-context.tsx` | 9 | 10-02 |
| `src/renderer/src/hooks/useAuth.ts` | 4 | 10-03 |
| `src/renderer/src/components/shell/ScreenSharePicker.tsx` | 4 | 10-02 |
| `src/renderer/src/hooks/useConvexAuthAdapter.ts` | 1 | 10-03 |
| `src/renderer/src/features/auth/AuthGate.tsx` | 1 | 10-03 |
| `src/renderer/src/features/auth/AuthWatchdog.tsx` | 1 | 10-03 |

`src/renderer/src/lib/screenshare-audio-bridge.ts`, `lib/profile-hint.ts` e o
próprio `platform/contract.ts` aparecem num `grep` da fonte mas **não contam**:
as ocorrências são de comentário, e comentário não chega ao bundle.

**Alvo dos Planos 10-02 e 10-03: levar esses 3 a zero.** O Plano 10-07 então
liga `--strict-bridges` dentro do `build:web`.

### (b) O tamanho do CSS — e por que o número bruto engana

| | bytes | linhas | seletores de classe distintos |
|---|---|---|---|
| desktop `out/renderer/assets/*.css` | 63.932 | 3.012 | 311 |
| web `dist-web/assets/*.css` | **51.083** | 1 | **310** |

O CSS da web é ~13 KB menor, e **isso não é varredura errada — é
minificação**: o electron-vite não minifica o renderer (o `.js` dele sai com
2.582 KB contra 1.151 KB do web), o Vite puro minifica.

A prova de que o Tailwind varreu o **mesmo lugar** não é o tamanho, é o
inventário de seletores, que bate: 311 contra 310, e o único ausente é `.com`
— pedaço do banner `/*! tailwindcss v4.3.3 | MIT License |
https://tailwindcss.com */` que o minificador remove. As três marcas
`.h-screen`, `.flex-col` e `is(.dark *)` estão presentes nos dois.

Isso está escrito no cabeçalho do script para ninguém gastar uma tarde
perseguindo um fantasma de 13 KB.

## Como cada armadilha foi provada (artefato, não configuração)

1. **Root do Tailwind** — inventário de seletores idêntico entre os dois
   alvos, medido nos dois `.css` gerados. Configuração declara intenção; foi o
   arquivo gerado que mostrou o que aconteceu.
2. **`envDir`** — o módulo transformado servido por `dev:web` em
   `/src/lib/convex-client.ts` começa com
   `import.meta.env = {..., "VITE_CONVEX_URL": "https://<...>.convex.cloud"}`.
   A variável vem do `.env.local` da RAIZ, um diretório acima do `root`.
3. **`fs.allow`** — `GET /@fs/<repo>/convex/_generated/api.js` responde
   **HTTP 200**. É o import que `AuthGate.tsx` faz de fora do `root`.

E o alias por alvo não foi assumido, foi rastreado:

```
tsconfig.web.json        -> .../platform/electron/capabilities.ts
tsconfig.web-target.json -> .../platform/web/capabilities.ts
```
(`tsc --traceResolution`, mesmo especificador `@platform/capabilities`.)

## Prova de que o desktop não regrediu

| Verificação | Antes | Depois |
|---|---|---|
| `npm run typecheck` (3 projetos) | exit 0 | **exit 0** |
| `npx vitest run` | 38 arquivos, 644 testes | **39 arquivos, 648 testes** (644 + 4 novos, zero regressão) |
| `npm run build` (electron-vite) | verde | **verde** |
| `npm run verify:renderer-runtime` | ✓ | **✓** |
| `npm run verify:convex-paths` | ✓ | **✓** |
| `npm run verify:native-audio` | ✓ | **✓ (6 asserções, 0 puladas)** |

E a prova mais direta — `git diff --stat fdaf081..HEAD` restrito ao que **não
pode mudar** (`src/main`, `src/preload`, `hooks/useAuth.ts`,
`hooks/useConvexAuthAdapter.ts`, `lib/profile-hint.ts`, `features/`, `state/`,
`convex/` e os três scripts de verificação existentes) sai **vazio**.

O único arquivo do caminho do Electron com mudança de comportamento é
`main.tsx`, e a mudança é **um `console.info` de boot**. `Versions.tsx` foi
apagado sem consumidores (reconferido por `grep` antes de apagar).

## O que passou a ser verificável no WSL2 — e o que não

**Passou a ser verificável aqui, e não era:**

- Que o mesmo `src/renderer` constrói para o navegador **com CSS real**
  (`build:web` + `verify:web-bundle`).
- Que o alias de plataforma resolve por alvo (as duas passadas de typecheck).
- Que o `dev:web` sobe e serve (HTTP 200 no `index.html` e no módulo de fora
  do `root`).

**O que passa a ser verificável pelo Leo, num ciclo de segundos:** o WSL2
encaminha `localhost`, e `http://localhost` é *secure context*. A partir daqui
**microfone, `getDisplayMedia` e WebRTC** deixam de exigir um ciclo de
build + instalador + máquina Windows. Este plano não usa isso ainda — ele
destrava.

**O que continua exigindo a máquina do Leo:**

- Ver a página renderizada (o WSL2 não tem navegador gráfico; quem abre é o
  Chrome do Windows).
- Tudo do alvo **Electron empacotado**: áudio por processo, PTT global,
  seletor próprio — nada disso mudou neste plano.
- O experimento do `restrictOwnAudio` (§5.4 da pesquisa), que é do Plano 10-06.

**O comando que o Leo roda:**

```bash
cd /home/leo/workspace/janja && npm run dev:web
```

E abre **`http://localhost:5173`** no Chrome do Windows. Não usar o IP do WSL:
só `localhost` é secure context, e é dele que dependem microfone e captura de
tela.

Neste plano a tela ainda é o app Electron de sempre rodando no navegador — a
auth ainda fala com `window.auth`, que no navegador é `undefined`. **O que dá
para conferir agora é o estilo (a UI tem que aparecer pintada, não em branco)
e a primeira linha do console:** `[platform] web hydra-platform:web`. Se
aparecer `electron`, o alias quebrou.

## Desvios do plano

**1. [Regra 1 — verificação contraditória] `grep -c` do `index.html`**

O `<verify>` da Task 2 pedia `grep -c "api.workos.com" src/renderer/index.html`
= 1 e `grep -c "frame-ancestors"` = 0. A `<action>` da MESMA tarefa mandava
escrever um comentário explicando por que `api.workos.com` entrou e por que
`frame-ancestors` **não** entra — comentário que, para ser útil, precisa
nomear as duas coisas. Os dois requisitos não podem valer ao mesmo tempo.

Mantive o comentário (é o que a lição nº 2 do HANDOFF pede e o que a `<action>`
exige) e verifiquei a **propriedade real**, escopada à diretiva em vez do
arquivo inteiro: dentro do `content=` do `<meta>`, `api.workos.com` aparece
**1 vez** e `frame-ancestors`, **0**. Os contadores do arquivo inteiro dão 2 e
1 por causa do comentário.

**2. [Regra 1 — mensagem de erro enganosa] Referência de CSS do verificador**

O plano mandava o script comparar o CSS gerado com "os 62 KB do desktop". Ao
medir, o desktop atual dá 63.932 bytes **não minificados** e o web 51.083
**minificados** — comparar os dois números crus mandaria quem lesse a mensagem
de erro procurar um problema de varredura que não existe. Corrigi o cabeçalho
e a mensagem para citar as duas referências com o rótulo de minificação, e
para dizer que a prova real é o inventário de seletores. O piso de 30 KB e as
três marcas ficaram como estavam.

## Estado para o próximo plano

- O alias `@platform` existe e resolve nos **cinco** lugares que importam:
  `electron.vite.config.ts`, `vite.config.web.ts`, `vitest.config.ts`,
  `tsconfig.web.json` e `tsconfig.web-target.json`. **Quem criar
  `platform/web/<algo>.ts` tem que criar `platform/electron/<algo>.ts` no mesmo
  commit** — senão uma das duas passadas de typecheck quebra. Isso é o
  contrato funcionando, não um obstáculo.
- `PlatformAuth`, `PlatformPushToTalk` e `PlatformScreenShare` estão escritos
  mas **sem nenhuma implementação**. São contrato: os Planos 10-02 e 10-03
  implementam contra eles, não os reescrevem para caber no que for mais fácil.
- Nenhuma dependência nova foi instalada. `@workos-inc/authkit-react` é do
  Plano 10-03.
- `verify:web-bundle` roda em modo aviso. Enquanto a contagem da afirmação 3
  não for **0**, o Plano 10-07 não pode ligar o portão.
