# Research: Fase 0 — Bootstrap do repo

**Domain:** Scaffold seguro de app Electron + electron-vite (TypeScript, React,
Tailwind v4, shadcn/ui), instância única
**Researched:** 2026-08-18
**Confidence:** ALTA — todos os comandos e trechos abaixo foram confirmados
contra o registry oficial do npm e o código-fonte real dos pacotes (baixados e
lidos diretamente), não por memória nem por resumo de terceiros.

> Este arquivo existe por causa de um incidente real: a primeira tentativa de
> planejar/executar F0 rodou o scaffolder com `yes |` na frente, dentro do
> próprio repo, e a resposta automática "y" ao prompt de "diretório não vazio,
> sobrescrever?" apagou `.git`, `docs/`, `.claude/` e parte de `.planning/`.
> Cada decisão abaixo existe para tornar esse erro estruturalmente impossível
> de repetir, não só "improvável".

## 1. Versão do Electron — piso exato

Consultado diretamente no registry do npm (`npm view electron` e
`registry.npmjs.org/electron`), não por memória:

```
dist-tags.latest = 43.4.0
dist-tags['43-x-y'] = 43.4.0   (não existe 43.4.1, 43.5.0 etc. ainda)
```

**43.4.0 é, hoje, a própria versão mais recente do Electron** — não apenas o
piso mínimo do `restrictOwnAudio` (documentado em `PITFALLS.md` Pitfall 1).
Isso significa que pinar exatamente `"43.4.0"` (sem `^`, sem `~`) no
`package.json` não é uma restrição artificial: é usar a versão mais atual que
existe, e ao mesmo tempo travar contra qualquer downgrade OU upgrade
silencioso. O template padrão do scaffolder gera `"electron": "^39.2.6"` —
**esse caret precisa ser sobrescrito manualmente após o scaffold**, ou o
`npm install` resolve para uma 39.x qualquer, muito abaixo do piso que o
projeto exige.

Comando determinístico para o pin (não editar o JSON à mão — evita erro de
sintaxe): `npm pkg set devDependencies.electron=43.4.0`. O `npm pkg set`
grava exatamente a string passada, sem adicionar `^`.

## 2. Scaffolder do electron-vite — comando não-interativo real

A documentação do electron-vite (`electron-vite.org/guide/`) anuncia o
comando como `npm create @quick-start/electron@latest`. Isso é um *alias* do
`npm create`: por convenção do próprio npm, `npm create @escopo/nome` resolve
para o pacote `@escopo/create-nome` — ou seja, o pacote real por trás do
comando é **`@quick-start/create-electron`** (confirmado via
`npm view @quick-start/create-electron` → versão atual `1.0.30`; o nome
`@quick-start/electron` sozinho **não existe** no registry, um `npm view`
direto nele retorna 404).

O `index.js` desse pacote (baixado e lido linha a linha via `npm pack`) usa a
lib `prompts` para até 7 perguntas interativas. Mapeamento exato de cada
prompt e como suprimi-lo:

| Prompt | Condição para aparecer (`type: ...`) | Como suprimir |
|---|---|---|
| `projectName` | `targetDir ? null : 'text'` | Passar o nome do projeto como **argumento posicional** (`... janja -- --template ...`) |
| `shouldOverwrite` | `canSafelyOverwrite(targetDir) || skip ? null : 'confirm'` — `canSafelyOverwrite` é `!existe(dir) \|\| dir vazio` | Nunca aparece se o diretório-alvo não existir ainda ou estiver vazio. **É por isso que este plano escala num diretório temporário fresco, nunca dentro do repo** |
| `overwriteChecker` | Só lança erro se `shouldOverwrite === false` | N/A — nunca disparado se o prompt acima nunca aparece |
| `packageName` | `isValidPackageName(targetDir) ? null : 'text'` | Usar um nome de projeto que já é um nome de pacote npm válido (`janja` — minúsculo, sem espaço, bate no regex) |
| `framework` | `skip \|\| (template && TEMPLATES.includes(template)) ? null : 'select'` | Passar `--template react-ts` (está na lista `TEMPLATES`) |
| `needsTypeScript` | `skip \|\| (template && TS_TEMPLATES.includes(template)) ? null : 'toggle'` | `react-ts` já está em `TS_TEMPLATES` — não precisa nem do `--skip` para este |
| `needsUpdater` | `skip ? null : 'toggle'` | **Só é suprimido pela flag `--skip`** — nenhuma outra combinação de argumentos evita esse prompt |
| `needsMirror` | `skip ? null : 'toggle'` | Idem — só `--skip` suprime |

**Comando final, 100% não-interativo, testado linha por linha contra o
código-fonte real:**

```bash
npm create @quick-start/electron@latest janja -- --template react-ts --skip < /dev/null
```

- `< /dev/null` é defesa extra, não parte da lógica de supressão: se por
  qualquer motivo (mudança de versão do pacote, bug) um prompt aparecer mesmo
  assim, o processo recebe EOF imediato no stdin e a lib `prompts` cancela a
  operação com erro visível — nunca aceita um "y" às cegas. Isso é o oposto
  de `yes |`, que responde "sim" para qualquer pergunta, incluindo a que
  apaga arquivos.
- **Nunca usar `yes |`, `--force` nem `--yes`** contra este scaffolder rodando
  dentro do diretório do repo. `--force`/`--yes` não existem nas flags reais
  do pacote (só `--template`/`-t` e `--skip`) — se alguém tentar usá-las,
  `minimist` as ignora silenciosamente e cai nos prompts normais.
- Mesmo com o comando acima 100% correto, **o diretório-alvo (`janja`) só
  pode ser criado dentro de um diretório temporário vazio fora do repo**
  (ex.: `/tmp/janja-scaffold-<pid>/`), nunca com cwd = raiz do repo. Isso é
  cinto-e-suspensório: mesmo se toda a tabela acima estivesse errada, rodar
  fora do repo torna fisicamente impossível apagar `.git`/`docs`/`.claude`.

### O que o scaffolder realmente gera (`template/react-ts/`)

Confirmado lendo os arquivos do pacote publicado (não documentação, os
arquivos de verdade):

- `src/main/index.ts`, `src/preload/index.ts` + `index.d.ts`,
  `src/renderer/index.html` + `src/renderer/src/{main.tsx,App.tsx,env.d.ts}`
  — já bate com a estrutura `src/main/`, `src/preload/`, `src/renderer/` do
  design §3.
- `electron.vite.config.ts` já vem com os três sub-builds (`main: {}`,
  `preload: {}`, `renderer: { resolve: { alias: { '@renderer': ... } },
  plugins: [react()] }`) — é o arquivo onde o plugin do Tailwind entra (§3
  abaixo).
- `package.json` gerado tem `"electron": "^39.2.6"` — **precisa do pin do
  §1** — e scripts prontos: `dev`, `build` (roda `typecheck` antes),
  `typecheck:node`, `typecheck:web`, `start` (preview).
- `main/index.ts` gerado **não** tem `requestSingleInstanceLock` nem declara
  `contextIsolation`/`nodeIntegration` explicitamente no `webPreferences`
  (usa só `sandbox: false`) — ambos precisam ser adicionados manualmente
  (§4).
- `.gitignore` só existe depois do scaffold renomear `_gitignore` →
  `.gitignore` (o pacote publica como `_gitignore` de propósito, para não
  ser interpretado pelo próprio `.gitignore` do pacote em si).

## 3. Tailwind v4 + shadcn/ui dentro do electron-vite

**Versões atuais confirmadas via `npm view` (não memória):** `tailwindcss@4.3.3`,
`@tailwindcss/vite@4.3.3`, `shadcn@4.18.0` (o pacote `shadcn-ui` antigo está
descontinuado — o nome atual do CLI é só `shadcn`), `electron-vite@5.0.0`.

### 3.1 Instalação do Tailwind (padrão Vite, sem `tailwind.config.js`)

```bash
npm install -D tailwindcss @tailwindcss/vite
```

No `electron.vite.config.ts`, o plugin entra **só no bloco `renderer`** (main
e preload não têm CSS):

```ts
import tailwindcss from '@tailwindcss/vite'
// ...
renderer: {
  resolve: { alias: { '@renderer': resolve('src/renderer/src'), '@': resolve('src/renderer/src') } },
  plugins: [react(), tailwindcss()]
}
```

(o alias `@` — além do `@renderer` que o scaffold já cria — existe porque
todo componente gerado pelo CLI do shadcn importa de `@/lib/utils`,
hardcoded; ver §3.3.)

### 3.2 Achado crítico: `shadcn init` não funciona com `electron.vite.config.ts`

Confirmado por issue oficial do repositório `shadcn-ui/ui`
(**#4885, "CLI cannot detect electron.vite.config.ts"**, fechada como "not
planned" — sem correção prevista) e reforçado por uma PR em aberto de
fevereiro/2026 (#9632) ainda tentando consertar detecção de tsconfig paths em
setups de electron-vite. O `shadcn init` depende de reconhecer um arquivo
chamado exatamente `vite.config.ts` na raiz para inferir aliases/config — e
falha com "could not detect a supported framework" contra
`electron.vite.config.ts`.

**Fallback documentado e confirmado como funcional:** escrever
`components.json` manualmente (a própria doc do shadcn confirma: "é só
obrigatório se você usa a CLI"; qualquer config manualmente escrita é aceita
por `shadcn add`). O `init` só existe para gerar esse arquivo + injetar CSS
automaticamente — pulando o `init` e escrevendo os dois artefatos à mão
(`components.json` + bloco de CSS) chega no mesmo estado final.

### 3.3 `components.json` manual — conteúdo exato

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "iconLibrary": "lucide",
  "tailwind": {
    "config": "",
    "css": "src/renderer/src/assets/main.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

`rsc: false` porque não há React Server Components (Vite, não Next.js) —
copiar exemplos da doc do shadcn sem mudar esse campo (muitos exemplos
públicos são de projetos Next.js) geraria imports incorretos. `style:
"new-york"` é um valor válido confirmado contra o schema oficial
(`ui.shadcn.com/schema.json`).

### 3.4 CSS base — descoberta que evita copiar dezenas de variáveis à mão

A versão atual do registry do shadcn (consultado em
`ui.shadcn.com/r/styles/new-york-v4/index.json`, JSON real, não resumo) não
pede mais para colar um bloco gigante de variáveis CSS (`--background`,
`--primary`, etc. em hexadecimal) — a partir da versão atual do CLI, o tema
base vem embutido no próprio pacote `shadcn` como um import:

```json
"devDependencies": ["tw-animate-css", "shadcn"],
"css": {
  "@import \"tw-animate-css\"": {},
  "@import \"shadcn/tailwind.css\"": {},
  "@layer base": {
    "*": { "@apply border-border outline-ring/50": {} },
    "body": { "@apply bg-background text-foreground": {} }
  }
}
```

Ou seja: `npm install -D shadcn tw-animate-css` e o CSS final
(`src/renderer/src/assets/main.css`, substituindo o conteúdo de demo gerado
pelo scaffold) fica:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

Isso resolve tema claro/escuro e todas as variáveis (`--background`,
`--primary`, `--border` etc.) sem precisar hardcodar valores — o pacote
`shadcn` já os traz.

### 3.5 Componentes via `shadcn add` (com fallback manual documentado)

Comando esperado (deve funcionar mesmo sem `init`, porque `components.json`
já existe manualmente):

```bash
npx shadcn@latest add button
```

**Se ainda assim falhar por detecção de framework** (risco residual, já que
o bug documentado é especificamente sobre detecção, não só sobre `init`): o
conteúdo exato dos dois arquivos que o comando geraria está confirmado abaixo
(baixado direto do registry, `ui.shadcn.com/r/styles/new-york-v4/utils.json`
e `.../button.json`) — plano B é criar os arquivos manualmente com este
conteúdo, sem depender da CLI:

`src/renderer/src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```
(depende de `npm install clsx tailwind-merge`)

`src/renderer/src/components/ui/button.tsx`: componente completo já
confirmado no registry, usa `cva` (`class-variance-authority`) + `Slot` de
`radix-ui`, importa `cn` de `@/lib/utils` — depende de
`npm install class-variance-authority radix-ui`.

### 3.6 `tsconfig.web.json` — paths adicionais

O scaffold já cria `@renderer/*` → `src/renderer/src/*`. Adicionar `@/*`
apontando para o mesmo diretório (não substituir, os dois convivem):

```json
"paths": {
  "@renderer/*": ["src/renderer/src/*"],
  "@/*": ["src/renderer/src/*"]
}
```

## 4. `requestSingleInstanceLock` + `second-instance` — padrão oficial

Confirmado contra a documentação oficial do Electron (`electronjs.org/docs/latest/api/app`):

```js
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    createWindow()
  })
}
```

Pontos que o design doc (§4) já confirma e que valem repetir aqui:

- O lock precisa ser pedido **antes** de qualquer criação de janela, e o
  handler `second-instance` precisa estar registrado **antes** de
  `app.whenReady()` resolver — não depois.
- O mecanismo (`ProcessSingleton` do Chromium) é multiplataforma — funciona
  igual em Linux/WSL2 e Windows. O que **não** é validável fora do Windows é
  o cenário de produção completo (retorno de OAuth via `janja://` chegando
  pelo `second-instance` com uma URL na `commandLine`) — isso é trabalho de
  F2, não de F0. F0 só precisa provar que o lock existe e que uma segunda
  instância não abre uma segunda janela.
- `contextIsolation: true` e `nodeIntegration: false` já são o *default* do
  Electron moderno, mas o hard constraint deste projeto pede declaração
  **explícita** no `webPreferences` — não confiar no default silencioso,
  porque defaults podem mudar entre versões e um `grep` no código deve
  provar a intenção, não a versão do Electron instalada.

## 5. Dev em WSL2/Linux (WSLg) vs. validação em Windows nativo

- `npm run dev` (electron-vite dev) abre a janela via **WSLg** (o subsistema
  gráfico integrado ao WSL2 desde Windows 11) — não precisa de X server
  externo nem de `--no-sandbox` na maioria das instalações atuais de WSLg.
  Se a janela não abrir e o processo travar/crashar silenciosamente, as
  causas mais comuns documentadas pela comunidade Electron+WSL são (a)
  `chrome-sandbox` sem permissão de SUID dentro do WSL — mitigado rodando
  com `--no-sandbox` **só em dev**, nunca no build de produção Windows — e
  (b) bibliotecas gráficas do sistema faltando (`libnss3`, `libatk1.0-0`,
  `libgtk-3-0`, `libgbm1`). Confiança MÉDIA nessa lista — é conhecimento
  consolidado da comunidade, não uma página oficial única; documentar como
  "se a janela não abrir, tente X" em vez de aplicar preventivamente.
- **O que só é verificável numa máquina Windows nativa** (fora do escopo de
  F0, mas registrado para não ser esquecido em F8/F9): comportamento real de
  foco de janela via DWM do Windows, registro do protocolo `janja://`,
  captura de áudio de sistema (WASAPI). Nenhum desses é testado em F0.
- O que **é** verificável em WSL2 e faz parte do critério de aceite de F0: a
  janela abre sem crash, e o mecanismo de `requestSingleInstanceLock` (que é
  independente de SO) realmente impede uma segunda instância de rodar em
  paralelo.

## Resumo de decisões que os planos usam

| Decisão | Valor |
|---|---|
| Comando de scaffold | `npm create @quick-start/electron@latest janja -- --template react-ts --skip < /dev/null`, executado num diretório temporário vazio fora do repo |
| Versão do Electron | `"43.4.0"` exato, via `npm pkg set devDependencies.electron=43.4.0` |
| Template | `react-ts` |
| Tailwind | v4, `@tailwindcss/vite`, sem `tailwind.config.js` |
| shadcn | CLI `shadcn@latest`, `components.json` escrito à mão (init não funciona com electron.vite.config.ts), CSS via `shadcn/tailwind.css` + `tw-animate-css` |
| Alias do renderer | `@renderer/*` (já vem do scaffold) + `@/*` (para bater com o default do shadcn) |
| Single instance | `requestSingleInstanceLock` + `second-instance` antes de `app.whenReady()` |
