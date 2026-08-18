# Fase 9 — Pesquisa (Polimento e empacotamento)

**Data:** 2026-08-18
**Nível de discovery:** 2/3 — nenhuma lib nova, mas duas armadilhas de empacotamento
(binário do Electron, módulo nativo) precisavam de confirmação contra código-fonte, não
memória, porque o comportamento mudou entre versões do Electron/electron-builder e a
documentação renderizada em `electron.build` estava indisponível durante a pesquisa
(erros 404 recorrentes no fetch). Toda afirmação abaixo foi confirmada lendo o
código-fonte publicado no GitHub das próprias ferramentas (`electron`, `electron-vite`,
`electron-builder`) na branch/tag correspondente à versão pinada no `package.json` deste
repo, ou o `package.json` publicado no npm da dependência em questão.
**Confiança:** ALTA. Cada afirmação abaixo cita o arquivo-fonte exato inspecionado.

## 1. Causa raiz confirmada do `Error: Electron uninstall` (00-04-SUMMARY)

A fase 0 já tinha reproduzido o sintoma e contornado manualmente, mas não sabia a causa
exata. Encontrada lendo o código-fonte de duas peças:

**`electron@43.4.0` não tem `postinstall`.** Confirmado no `package.json` publicado
([`electron/electron` branch `main`, `npm/package.json`](https://github.com/electron/electron/blob/main/npm/package.json)
e no registry do npm para a versão exata `43.4.0`): o campo `scripts` está ausente. Isso é
deliberado — versões atuais do pacote `electron` não baixam o binário automaticamente via
lifecycle script.

**`require('electron')` baixaria sozinho, mas `electron-vite dev` nunca chama isso.**
`npm/index.js` do próprio Electron exporta `getElectronPath()`, que baixa o binário sob
demanda (`downloadElectron()`) se `dist/` estiver ausente — mas isso só dispara se algo
fizer `require('electron')` de verdade (executando o módulo). `electron-vite`, em
[`src/electron.ts`](https://github.com/alex8088/electron-vite/blob/master/src/electron.ts)
(função `getElectronPath`, por volta da linha 49), usa
`path.dirname(_require.resolve('electron'))` — **`require.resolve`, não `require`** —
para achar a pasta do pacote, e então lê `path.txt` diretamente com `fs.readFileSync`. Se
`path.txt` não existir (porque o `install.js` do Electron nunca rodou), a função joga
`throw new Error('Electron uninstall')` — a mensagem exata do defeito relatado na Fase 0.

**Consequência para o plano:** `electron-builder install-app-deps` (o `postinstall` atual)
não resolve isso — ele recompila módulos nativos para a ABI do Electron, mas não baixa o
binário do próprio Electron, que é uma preocupação de um pacote diferente
(`electron/install.js`). A correção é encadear os dois no `postinstall`:
`node node_modules/electron/install.js && electron-builder install-app-deps`. O
`install.js` do Electron ([`npm/install.js`](https://github.com/electron/electron/blob/main/npm/install.js))
tem um `isInstalled()` que checa versão + `path.txt` antes de baixar qualquer coisa — rodar
de novo com o binário certo já presente é um no-op rápido, seguro para verificar
localmente sem apagar o ambiente de desenvolvimento compartilhado do worktree.

## 2. `uiohook-napi` já embute o binário do Windows — o risco real é `asarUnpack`, não rebuild

Publicado com N-API (`node-gyp-build` como única dependência de runtime, confirmado no
`package.json` da versão `1.5.5` no [registry do npm](https://registry.npmjs.org/uiohook-napi/latest))
e binários pré-compilados via `prebuildify --napi`, empacotados **dentro do próprio pacote
publicado**, não baixados por rede na hora do install. Confirmado inspecionando a lista de
arquivos do tarball publicado (via jsdelivr): existe
`prebuilds/win32-x64/uiohook-napi.node`, `prebuilds/win32-arm64/...`, junto dos de
`linux-*`/`darwin-*` — todos no mesmo pacote, independente de qual SO rodou o `npm
install`.

**O que isso muda:** não existe risco de compilação cruzada nem de "o binário errado foi
baixado" — o binário Windows x64 já está em `node_modules/uiohook-napi/prebuilds/win32-x64/`
mesmo instalando a partir do WSL2. `node-gyp-build` (chamado pelo próprio `require`)
escolhe o prebuild certo em runtime, olhando plataforma/arquitetura/versão do N-API do
processo atual — no executável empacotado, isso é a plataforma Windows de quem instalou.

**O risco real é outro: Electron não consegue `dlopen` um `.node` de dentro de um
`asar`.** Isso é uma limitação de sistema operacional (mapear um arquivo executável de
dentro de um arquivo tar/asar), não do `uiohook-napi`. electron-builder v26 (a versão
pinada aqui, `^26.0.12`) já tem uma heurística de "smart unpack" **ligada por padrão**: em
[`packages/app-builder-lib/src/asar/unpackDetector.ts`](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/asar/unpackDetector.ts),
a função `detectUnpackedDirs` varre todo arquivo empacotado e, se o nome terminar em
`.node`/`.dll`/`.exe`/`.so`/`.dylib` (função `isLibOrExe`), tira o **módulo inteiro** (a
pasta raiz do pacote npm) do asar automaticamente — sem precisar de `asarUnpack` manual.
Isso só é desligado se `smartUnpack: false` for setado explicitamente na config `asar`
(não está, no `electron-builder.yml` atual).

**Decisão para o plano:** mesmo com o auto-detect cobrindo isso, o plano vai declarar
`asarUnpack` explicitamente para `node_modules/uiohook-napi/**` — não porque é necessário
tecnicamente, mas porque é o único item da fase com uma feature de aceite do projeto
inteiro pendurada nele (VOICE-11) e "funciona por heurística automática, não verificado"
não é confiança suficiente para não custar nada tornar explícito. `npmRebuild: false`
(já presente no `electron-builder.yml`) continua correto — não tem nada em C++ para
recompilar num módulo N-API com prebuild embutido, e desligar isso evita a
electron-builder tentar rodar `node-gyp rebuild` sem toolchain de compilação C++
disponível no WSL2.

## 3. NSIS: a configuração atual já satisfaz "poucos cliques" — confirmado, não assumido

Lendo a interface `NsisOptions` em
[`packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts`](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts):

- `oneClick` — **default `true`**. Instalador de um clique: sem tela de escolha de
  diretório, sem tela de modo per-user/per-machine, instala e roda automaticamente.
- `runAfterFinish` — **default `true`** (em `CommonWindowsInstallerConfiguration.ts`).
  Abre o app sozinho ao terminar.
- `createDesktopShortcut` — já setado como `always` no `electron-builder.yml` atual.
- `allowToChangeInstallationDirectory` — só relevante se `oneClick: false`; não é o caso.
- `deleteAppDataOnUninstall` — default `false` (opção *one-click only*; preservar dados
  do usuário ao desinstalar é o comportamento correto por padrão, não precisa de ajuste).

O `electron-builder.yml` atual não declara `oneClick`, então já herda o default (`true`).
**Nenhuma mudança funcional é necessária** para "poucos cliques" — o plano só torna
`oneClick: true` explícito no arquivo, por clareza para quem ler depois, sem alterar
comportamento.

## 4. electron-vite: variáveis de ambiente são substituição estática em tempo de build

Confirmado lendo
[`packages/electron-vite` (`alex8088/electron-vite`) `src/plugins/electron.ts`](https://github.com/alex8088/electron-vite/blob/master/src/plugins/electron.ts),
que define `envPrefix` por processo:

```
main:     ['MAIN_VITE_', 'VITE_']      (linha ~107)
preload:  ['PRELOAD_VITE_', 'VITE_']   (linha ~260)
renderer: ['RENDERER_VITE_', 'VITE_']  (linha ~379)
```

**Achado que resolve uma dúvida de nomenclatura:** o prefixo `VITE_` sozinho (sem
`MAIN_VITE_`) já é visível nos três processos, inclusive no main. Isso bate exatamente
com o nome que a Decisão registrada de 2026-08-18 no `STATE.md` já usa —
`VITE_CONVEX_SITE_URL` — e com o que o Plano `07-02` desta base de código **já** assume
existir em `.env.local` (comentário no plano: *"O `<deployment-real>` é o mesmo host que
aparece em `VITE_CONVEX_SITE_URL` no `.env.local`"*). Não é necessário o prefixo
`MAIN_VITE_` mesmo a variável sendo lida dentro de `src/main/auth/auth.ts` (processo
main) — `VITE_CONVEX_URL` (usada no renderer) segue o mesmo padrão de prefixo único.

**O que isso implica para o empacotamento:** `import.meta.env.X` é substituído por um
literal estático no bundle **na hora do `npm run build` / `electron-vite build`**, não
lido de `process.env` em runtime no executável final. Consequências diretas:

1. Quem roda `npm run build:win` precisa ter os valores reais em `.env.local` (ou
   `process.env`) **na máquina de build**, no momento do build — não no computador de
   quem vai instalar o app depois. O instalador final não lê nenhum `.env` — o valor já
   está compilado dentro de `out/main/index.js` / `out/renderer/*.js`.
2. Isso é bom para APP-03 (zero configuração pro usuário final) e ruim se esquecido: se
   `.env.local` estiver incompleto na máquina que roda `build:win`, o instalador
   resultante embute strings vazias — e falha **silenciosamente only at runtime**, não no
   build (Vite não valida presença de env vars, só faz a substituição textual).
3. Por isso o padrão já usado em `src/main/auth/auth.ts` (checar a variável e lançar um
   erro com mensagem legível só no primeiro uso, nunca no carregamento do módulo) é a
   defesa correta contra isso — e é exatamente o padrão que falta em
   `src/renderer/src/lib/convex-client.ts`, que ainda lança no nível do módulo (ver §5).

## 5. Bug vivo confirmado por leitura de código: `convex-client.ts` ainda crasha no load

Não é uma suposição — lido diretamente:

```ts
// src/renderer/src/lib/convex-client.ts
const url = import.meta.env.VITE_CONVEX_URL
if (!url) {
  throw new Error('VITE_CONVEX_URL não definida — ...')
}
export const convexClient = new ConvexReactClient(url)
```

`src/renderer/src/main.tsx` importa esse módulo **antes** de `createRoot(...).render(...)`
rodar (import ESM é hoisted). Se `VITE_CONVEX_URL` vier vazia num build empacotado — o
exato cenário do item 4.2 acima — isso reproduz **a mesma classe de bug que a Fase 2 já
corrigiu uma vez** (achado #3 do `02-VERIFICACAO.md`, `createWorkOS` no nível do módulo):
popup de "Uncaught Exception" com stack trace de `node_modules`, sem nenhuma pista pro
usuário. A correção da Fase 2 cobriu `auth.ts`; nunca cobriu este arquivo. Faz parte do
escopo desta fase corrigir isso — é exatamente o `hard_constraint` "packaging must not
reintroduce it", só que aqui nunca foi de fato corrigido para este arquivo específico.

## 6. Convex HTTP actions: servir HTML é suportado nativamente

Confirmado (doc oficial `docs.convex.dev/functions/http-actions` + já em uso no projeto
via `07-02`, que cria `convex/http.ts` com `httpRouter`/`httpAction` para o webhook do
LiveKit): uma `httpAction` retorna um `Response` padrão da Fetch API. Servir HTML é só:

```ts
return new Response(htmlString, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } })
```

HTTP actions são servidas em `https://<deployment>.convex.site` (**não** `.convex.cloud`
— esse é o domínio do client SDK/WebSocket). `http.ts` deve exportar `export default
http` (uma instância de `httpRouter()`), e múltiplas rotas (`http.route({...})`) convivem
no mesmo arquivo/router — a rota nova desta fase (`/auth/complete`) é **adicionada** ao
arquivo que a Fase 7 já cria para `/livekit/webhook`, não um arquivo novo.

## 7. WorkOS redirect URI: por que trocar de `janja://callback` para uma página https pode também consertar o Brave

Achado de raciocínio, não de doc — registrado aqui para orientar o checkpoint humano do
Plano `09-03`, não como fato confirmado (só é verificável numa máquina Windows real com
Brave instalado).

Hoje o `redirectUri` passado a `getAuthorizationUrlWithPKCE` é `janja://callback`
diretamente — ou seja, é o **próprio WorkOS/Google** que precisa navegar o topo da aba
para um esquema de URL não-http ao final do fluxo de OAuth. Navegadores tratam navegação
para esquema customizado de formas diferentes dependendo de como a página que inicia a
navegação foi carregada (redirect HTTP 3xx do servidor vs. `window.location` disparado por
JS já carregado), e o Brave em particular é mais agressivo bloqueando navegação para
esquemas não registrados vindos de contextos de terceiros (Shields). O `02-VERIFICACAO.md`
já registra que a configuração do WorkOS está comprovadamente correta (o `state` decodifica
`janja://callback`) e que Chrome/Edge não reproduzem o problema — o que aponta para
comportamento específico do navegador na navegação final para o esquema customizado, não
para a config do WorkOS.

Com a mudança desta fase, o `redirectUri` registrado no WorkOS passa a ser
`https://<deployment>.convex.site/auth/complete` — uma URL `https://` normal, que todo
navegador (Brave incluso) trata como qualquer redirect OAuth comum. É **essa página**, já
carregada e executando no contexto da própria aba, que dispara `window.location.href =
'janja://callback?...'` via JS. É uma situação materialmente diferente da atual (JS de uma
página já carregada navegando para um esquema customizado, com um link manual de
fallback), e tem chance real de também resolver o travamento do Brave como efeito
colateral — mas isso só se confirma testando de verdade. O Plano `09-03` instrui testar o
Brave especificamente depois da mudança, e documentar o resultado de qualquer forma
(resolvido ou não).

## Fontes consultadas

- https://github.com/electron/electron/blob/main/npm/package.json
- https://github.com/electron/electron/blob/main/npm/index.js
- https://github.com/electron/electron/blob/main/npm/install.js
- https://github.com/alex8088/electron-vite/blob/master/src/electron.ts
- https://github.com/alex8088/electron-vite/blob/master/src/utils.ts
- https://github.com/alex8088/electron-vite/blob/master/src/plugins/electron.ts
- https://registry.npmjs.org/uiohook-napi/latest (package.json publicado)
- https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/asar/unpackDetector.ts
- https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/asar/asarUtil.ts
- https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts
- https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/options/CommonWindowsInstallerConfiguration.ts
- https://github.com/electron-userland/electron-builder/blob/master/packages/electron-builder/src/cli/install-app-deps.ts
- docs.convex.dev/functions/http-actions (via fetch — confirma padrão já usado no repo pela Fase 7)
- Leitura direta do código deste repo: `package.json`, `electron-builder.yml`,
  `src/main/auth/auth.ts`, `src/renderer/src/lib/convex-client.ts`,
  `src/renderer/src/main.tsx`, `.env.local.example`,
  `.planning/phases/07-voz/07-02-webhook-reconciliacao-PLAN.md`,
  `.planning/phases/02-convex-auth-workos/02-VERIFICACAO.md`,
  `.planning/phases/00-bootstrap-do-repo/00-04-SUMMARY.md`.
