---
phase: 10-versao-web
plan: 04
type: execute
wave: 3
depends_on: ["10-02", "10-03"]
files_modified:
  - vercel.json
  - .planning/CHECKPOINT-WEB.md
  - README.md
autonomous: false

user_setup:
  - service: workos
    why: "O alvo web faz requisição de NAVEGADOR para a WorkOS — algo que o Electron nunca fez. Sem origem de CORS e redirect URI cadastrados, o login falha e nada no código pode consertar"
    dashboard_config:
      - task: "Acrescentar a origem web como Redirect URI (SEM remover a do desktop)"
        location: "WorkOS Dashboard -> ambiente de PRODUÇÃO -> Redirects"
      - task: "Acrescentar http://localhost:5173 como Redirect URI (destrava o ciclo rápido de desenvolvimento)"
        location: "WorkOS Dashboard -> Redirects"
      - task: "Definir a Sign-out URI apontando para a origem web"
        location: "WorkOS Dashboard -> Redirects"
      - task: "Acrescentar a origem web e http://localhost:5173 às origens de CORS permitidas — ITEM NOVO, não existe hoje"
        location: "WorkOS Dashboard -> Authentication -> Configure CORS"
  - service: vercel
    why: "Hospedagem da SPA. O preset 'Vite' não serve: o config é vite.config.web.ts e a saída é dist-web"
    env_vars:
      - name: VITE_CONVEX_URL
        source: "mesmo valor do .env.local do desktop (https://<deployment>.convex.cloud)"
      - name: VITE_WORKOS_CLIENT_ID
        source: "mesmo valor de MAIN_VITE_WORKOS_CLIENT_ID (client id é público por design)"
    dashboard_config:
      - task: "Framework Preset Other, Build Command npm run build:web, Output dist-web, Install Command npm ci --ignore-scripts"
        location: "Vercel -> Project -> Settings -> Build & Development"

must_haves:
  truths:
    - "Existe uma URL pública onde o Hydra abre no navegador"
    - "Uma pessoa loga com Google nessa URL e chega na aplicação, com o nome certo (não `usuario#1234`)"
    - "A sessão sobrevive a F5 — o refresh token do devMode é lido do localStorage e trocado com sucesso"
    - "O logout funciona e volta para a tela de login"
    - "O login do DESKTOP continua funcionando depois das mudanças no dashboard da WorkOS"
    - "O build na Vercel passa sem baixar o Electron"
  artifacts:
    - path: "vercel.json"
      provides: "rewrite de SPA e os cabeçalhos que <meta> não consegue emitir"
      min_lines: 25
    - path: ".planning/CHECKPOINT-WEB.md"
      provides: "roteiro operacional do que o Leo faz fora do repositório, em ordem de dependência"
      min_lines: 80
  key_links:
    - from: "vercel.json"
      to: "index.html"
      via: "rewrite total de SPA"
      pattern: "\"destination\": \"/index.html\""
    - from: "vercel.json"
      to: "frame-ancestors"
      via: "cabeçalho de resposta (a diretiva é IGNORADA em <meta>)"
      pattern: "frame-ancestors"
---

<objective>
Colocar a versão web no ar e provar o login de verdade — **antes** de existir
qualquer feature construída em cima.

Purpose: decisão travada da fase. Configuração de WorkOS e de Vercel é o tipo
de problema que não aparece em build, typecheck nem teste: aparece na primeira
requisição de navegador que o Chromium recusa. Se a origem de CORS não estiver
cadastrada, o login falha com um erro de console e mais nada — a mesma classe
de falha silenciosa que travou a Fase 2 (a CSP recusando o WebSocket do
Convex). Descobrir isso agora custa uma sessão de 30 minutos; descobrir depois
de quatro planos de voz e tela custa a confiança em tudo que foi construído no
meio.

Além disso, este plano tem um efeito que vale a fase inteira: ele é o que
transforma o `dev:web` num ciclo de segundos. Com `http://localhost:5173`
cadastrado na WorkOS, o Leo passa a poder logar no app rodando a partir do
WSL2, aberto no Chrome do Windows.

Output: uma URL no ar, o dashboard da WorkOS servindo aos DOIS clientes, e um
veredito escrito sobre cada item — inclusive os que falharem.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-versao-web/10-RESEARCH.md
@.planning/phases/10-versao-web/10-02-SUMMARY.md
@.planning/phases/10-versao-web/10-03-SUMMARY.md

# A ordem obrigatória que já existiu uma vez para o redirect URI do desktop —
# inverter os passos quebra o login de formas diferentes conforme o passo pulado
@.planning/phases/09-polimento-e-empacotamento/09-02-SUMMARY.md

# A CSP e por que ela é documentação viva
@src/renderer/index.html
@.planning/CHECKPOINT-WINDOWS.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: `vercel.json`, os cabeçalhos que o `<meta>` não consegue, e o roteiro do Leo</name>
  <files>vercel.json, .planning/CHECKPOINT-WEB.md, README.md</files>
  <action>
    **`vercel.json` na raiz:**

        {
          "$schema": "https://openapi.vercel.sh/vercel.json",
          "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
          "headers": [{ "source": "/(.*)", "headers": [
            { "key": "Content-Security-Policy", "value": "frame-ancestors 'none'" },
            { "key": "X-Content-Type-Options", "value": "nosniff" },
            { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
          ]}]
        }

    Comentários (em `.planning/CHECKPOINT-WEB.md`, já que JSON não os aceita) e
    as duas armadilhas que justificam o arquivo:
    - **`frame-ancestors` é IGNORADA em `<meta>` por especificação.** É a única
      diretiva da CSP do projeto que precisa ser cabeçalho de resposta. E ela
      importa aqui porque a integração client-only da WorkOS **não opera dentro
      de um `iframe`** — sem isso, um site de terceiros poderia emoldurar o
      Hydra e a falha seria confusa em vez de bloqueada.
    - **As duas CSPs se INTERSECCIONAM, não se substituem.** Por isso o
      cabeçalho traz SÓ `frame-ancestors`: duplicar a política inteira nos dois
      lugares é a armadilha real — qualquer divergência futura vira bloqueio
      silencioso, e a CSP do `index.html` é a que tem os comentários longos que
      explicam cada entrada.

    **Conferir antes de escrever:** o `index.html` já ganhou
    `https://api.workos.com` na `connect-src` no Plano 10-01. Sem essa entrada
    o `POST /user_management/authenticate` do `authkit-js` é recusado pelo
    Chromium sem erro de aplicação. Se por algum motivo não estiver lá,
    **parar e corrigir antes do checkpoint** — é a diferença entre "o login
    falhou" e "o login falhou e ninguém sabe por quê".

    **`.planning/CHECKPOINT-WEB.md`** — roteiro operacional, no mesmo espírito
    de `.planning/CHECKPOINT-WINDOWS.md`: agrupado por onde o Leo precisa
    estar, em ORDEM DE DEPENDÊNCIA, com o que observar em cada passo e o que
    significa cada falha. Conteúdo mínimo, todos os passos numerados e com
    caixa de marcar:

    *Bloco A — domínio (opcional, recomendado).* `hydra.usesenju.com` mantém a
    coerência com `livekit.usesenju.com`, e o DNS é o mesmo painel da
    Hostinger. **Dito com clareza para não virar expectativa errada:** ficar em
    `*.vercel.app` funciona igual. A única coisa que o domínio próprio
    destrancaria é o custom auth domain da WorkOS, que custa US$ 99/mês e está
    fora por decisão travada.

    *Bloco B — WorkOS, ambiente de PRODUÇÃO (o mesmo do desktop).* Quatro
    passos, e o aviso que os precede: **isto mexe no ambiente do qual dez
    pessoas dependem; fazer FORA de uma janela de uso.**
    B1. Redirects -> acrescentar a origem web. **NÃO remover nem trocar a
        entrada existente** — o desktop depende de
        `https://<deployment>.convex.site/auth/complete` (`convex/http.ts`,
        Plano 09-02). São duas entradas convivendo, e a WorkOS suporta várias.
    B2. Redirects -> acrescentar `http://localhost:5173`.
    B3. Redirects -> conferir/definir a **Sign-out URI** apontando para a
        origem web. A doc é explícita: sem ela, logout dá erro.
    B4. Authentication -> Configure CORS -> acrescentar a origem web e
        `http://localhost:5173`. **Este item é NOVO e não tem equivalente no
        desktop** (o Electron nunca fez requisição de navegador para a WorkOS).
        Sem ele o login web falha com erro de CORS no console e nada mais.
    B5. Conferir que o TTL do access token continua em 8h (elevado na Fase 2 —
        vale para os dois clientes).

    *Bloco C — Vercel.* Preset **Other** (o preset "Vite" espera
    `vite.config.ts` na raiz e saída `dist`; aqui é `vite.config.web.ts` e
    `dist-web`), Build `npm run build:web`, Output `dist-web`, **Install
    `npm ci --ignore-scripts`**. O motivo do `--ignore-scripts` em uma linha: o
    `postinstall` deste repo roda `node_modules/electron/install.js` e
    `scripts/postinstall-rebuild.mjs` — baixar o Electron inteiro num build da
    Vercel é lento e pode falhar, e nada do que o postinstall prepara (binário
    nativo do main) é usado pelo bundle web. Env vars `VITE_CONVEX_URL` e
    `VITE_WORKOS_CLIENT_ID` em Production (e Preview, se Preview for usado).
    **Decisão a tomar no checkpoint:** desligar deploys de Preview. Cada branch
    ganha uma URL `*.vercel.app` nova, nenhuma delas cadastrada na WorkOS — o
    login simplesmente não funciona ali, e a WorkOS não aceita wildcard como
    redirect URI padrão. Recomendação para v1: desligar.

    *Bloco D — Convex e LiveKit.* **Nada.** Mesmo deployment, mesmo
    `auth.config.ts`, mesmo token, mesmo webhook. Escrever isso explicitamente
    é útil: economiza a pergunta.

    **`README.md`:** uma seção curta "Versão web" com os três comandos
    (`dev:web`, `build:web`, `preview:web`), a nota de que o alvo web usa
    `VITE_WORKOS_CLIENT_ID` e a frase que evita a confusão mais provável — **o
    alvo web e o desktop falam com o MESMO Convex, o MESMO LiveKit e a MESMA
    aplicação WorkOS; não existe ambiente separado.**
  </action>
  <verify>`node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"` exit 0; `grep -c "frame-ancestors" vercel.json` = 1; `grep -c "api.workos.com" src/renderer/index.html` >= 1; `.planning/CHECKPOINT-WEB.md` tem os blocos A-D com todos os passos numerados e com caixa.</verify>
  <done>O repositório tem o que a Vercel precisa ler e o Leo tem um roteiro em ordem de dependência, com o motivo de cada passo.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    A versão web do Hydra, construída a partir do mesmo `src/renderer` do
    desktop, com autenticação por `@workos-inc/authkit-react` em `devMode`
    (refresh token em `localStorage` — decisão de custo: o cookie HttpOnly
    exigiria custom auth domain a US$ 99/mês) ligada ao MESMO Convex pelo mesmo
    `ConvexProviderWithAuth`.

    Nada do backend mudou: mesmo deployment do Convex, mesmo `auth.config.ts`,
    mesmo LiveKit, mesmo webhook. O app desktop instalado não foi alterado em
    comportamento nenhum.
  </what-built>
  <how-to-verify>
    Siga `.planning/CHECKPOINT-WEB.md` na ordem. Resumo do que precisa ser
    observado, e o que cada falha significa:

    ────────────────────────────────────────────────────────
    **PASSO 0 — o ciclo rápido, e faça este primeiro**
    ────────────────────────────────────────────────────────
    Depois dos passos B2 e B4 (localhost como redirect URI e como origem de
    CORS), no WSL2: `npm run dev:web`. No Chrome do **Windows**, abrir
    `http://localhost:5173`.
    - A tela de login aparece com estilo (fundo escuro, marca). **Se aparecer
      sem estilo nenhum, pare**: é a armadilha do root de varredura do Tailwind
      e o Plano 10-01 falhou em silêncio.
    - Se aparecer "Configuração incompleta: VITE_CONVEX_URL não definida", o
      `envDir` do `vite.config.web.ts` não está lendo o `.env.local` da raiz.
    - Clicar em entrar -> a própria aba navega para a WorkOS -> login com
      Google -> volta para `localhost:5173` já autenticado, e a URL fica limpa
      (sem `?code=`).
    - **Se o console mostrar erro de CORS**, o passo B4 não foi feito ou a
      origem está escrita diferente (porta, `http` vs `https`).

    Este passo sozinho já vale a fase: a partir daqui, qualquer trabalho de UI,
    voz ou tela na web é um ciclo de segundos em vez de um ciclo de
    build + instalador.

    ────────────────────────────────────────────────────────
    **PASSO 1 — o deploy**
    ────────────────────────────────────────────────────────
    Criar o projeto na Vercel conforme o Bloco C e disparar o build.
    - O build **não pode** baixar o Electron. Se o log mostrar download do
      Electron, o Install Command não ficou `npm ci --ignore-scripts`.
    - Se o build falhar por outro motivo, copiar o log inteiro — é a pergunta
      em aberto nº 3 da pesquisa e o plano B já está nomeado (mover o
      `postinstall` para um script opcional).

    ────────────────────────────────────────────────────────
    **PASSO 2 — login na URL pública**
    ────────────────────────────────────────────────────────
    Abrir a URL da Vercel, logar com Google.
    - Chega na aplicação (servidores, canais, chat visíveis).
    - **O nome exibido é o nome de verdade, não `usuario#1234`.** Se for o nome
      feio, `getProfile()` não está entregando o perfil ao `ensureUser` — o
      `User` do authkit-js deveria ter os quatro campos.
    - Abrir o DevTools e confirmar no console a linha `[platform] web
      hydra-platform:web`. É a prova, em runtime, de que a implementação certa
      da costura entrou no bundle.

    ────────────────────────────────────────────────────────
    **PASSO 3 — F5, a prova do `devMode`**
    ────────────────────────────────────────────────────────
    Com a sessão aberta, apertar F5.
    - Volta autenticado, sem passar pelo login.
    - Fechar a aba, abrir de novo na mesma URL: idem.
    - Se cair no login, o refresh token não está persistindo — `devMode` não
      está ligado, ou algo está limpando o `localStorage`.

    ────────────────────────────────────────────────────────
    **PASSO 4 — logout**
    ────────────────────────────────────────────────────────
    Sair pelo painel do usuário. Volta para a tela de login. Se der erro, é a
    Sign-out URI (passo B3).

    ────────────────────────────────────────────────────────
    **PASSO 5 — O DESKTOP NÃO PODE TER REGREDIDO. Não pule.**
    ────────────────────────────────────────────────────────
    Abrir o app Hydra **instalado** (o `.exe`, não `npm run dev`), na mesma
    máquina, e fazer login.
    - O login do desktop funciona como antes.
    - Se não funcionar: alguma entrada de Redirects foi **substituída** em vez
      de acrescentada no passo B1. Restaurar
      `https://<deployment>.convex.site/auth/complete` imediatamente — dez
      pessoas dependem dela.
    Este passo é a resposta à pergunta em aberto nº 2 da pesquisa: se a WorkOS
    aceita bem duas plataformas no mesmo ambiente de produção. Ninguém sabe até
    aqui.
  </how-to-verify>
  <resume-signal>
    Escreva o veredito de cada passo (0 a 5) como "passou" ou o que aconteceu,
    sem suavizar. Para qualquer falha, cole o erro do console ou o log do build.
    Depois digite "aprovado" ou descreva o que travou.
  </resume-signal>
</task>

</tasks>

<verification>
**O que passou a ser verificável NESTE ambiente (WSL2) — permanentemente, a
partir deste plano:**
- Login real. Com `http://localhost:5173` cadastrado, o `dev:web` rodando no
  WSL2 e aberto no Chrome do Windows é uma sessão autenticada de verdade,
  contra o Convex de verdade. Chat, servidores, canais, amigos e DMs passam a
  ser verificáveis num ciclo de segundos.
- `http://localhost` é *secure context*: microfone, `getDisplayMedia` e WebRTC
  funcionam ali. Os Planos 10-05 e 10-06 dependem disso.

**O que continua exigindo Windows nativo:**
- Nada deste plano em si (o Chrome do Windows já é o ambiente). Mas o passo 5
  exige a máquina onde o app instalado roda.

**Prova de que o desktop não regrediu:** o passo 5 é literalmente isso, e é
bloqueante. O código do desktop não foi tocado neste plano; o risco aqui é
**de configuração externa**, e é o único ponto da fase inteira onde uma ação
fora do repositório pode derrubar o app de dez pessoas.
</verification>

<success_criteria>
- `vercel.json` válido, com o rewrite de SPA e `frame-ancestors` como
  cabeçalho.
- `.planning/CHECKPOINT-WEB.md` com os blocos A-D em ordem de dependência.
- Veredito humano escrito para os passos 0 a 5.
- O login do desktop continua funcionando (passo 5) — este é o critério que,
  se falhar, para a fase.
</success_criteria>

<output>
Ao terminar, criar `.planning/phases/10-versao-web/10-04-SUMMARY.md` com: a URL
final no ar, a decisão tomada sobre deploys de Preview, o veredito passo a
passo, e — se houver — o log do build da Vercel que falhou. Registrar também se
o `npm ci --ignore-scripts` bastou ou se o `postinstall` precisou virar
opcional (pergunta em aberto nº 3 da pesquisa).
</output>
