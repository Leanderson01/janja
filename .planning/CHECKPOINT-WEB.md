# Roteiro — pôr o Hydra web no ar (WorkOS + Vercel)

Roteiro operacional do Plano `10-04`. Vale a mesma regra do
`CHECKPOINT-WINDOWS.md` (HANDOFF, lição nº 1): **nada aqui pode ser marcado como
feito por raciocínio, build verde ou teste unitário.** Só observação no
navegador conta.

O que este documento cobre é o que **não está no repositório**: dashboard da
WorkOS, projeto na Vercel e DNS. O código já está pronto desde o Plano 10-03 — o
que impede o login não é código, é configuração externa.

**Ordem de dependência, resumida:**

| Bloco | O que é | Depende de |
|---|---|---|
| A | Domínio próprio (opcional) | nada |
| B | WorkOS — redirects, sign-out e **CORS** | A, se houver domínio |
| C | Vercel — projeto, build e env vars | B (a parte de localhost pode ir antes) |
| C.pós | Voltar à WorkOS com a URL de produção | C (a URL só existe depois do 1º deploy) |
| D | Convex e LiveKit | — (nada a fazer) |

---

## Situação em 2026-08-25 — o que JÁ foi feito e funcionou

Registrado aqui para ninguém refazer, e porque o caminho custou tempo.

- [x] **B2 + B4 (localhost).** `http://localhost:5173` cadastrado **nos
      Redirects e nas origens de CORS** da WorkOS (ambiente **Dev**).
- [x] **Passo 0 do checkpoint — login web ponta a ponta em
      `http://localhost:5173`:** entrou, apareceu na lista de membros com o
      nome humano (`Leo#7777`), conectou voz e o palco renderizou.
- [x] **Passo 5 — o desktop NÃO regrediu.** Login do app **instalado** conferido
      depois de mexer na WorkOS: continua funcionando. **Este era o passo
      bloqueante do plano, e está cumprido.**
- [ ] Todo o Bloco C (Vercel) — é o que falta.

### O achado que custou a sessão: onde fica o CORS na WorkOS

O erro que travava tudo era este, no console do Chrome:

```
Access to fetch at 'https://api.workos.com/user_management/authenticate'
from origin 'http://localhost:5173' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

Três coisas que a próxima pessoa precisa saber **antes** de procurar:

1. **A configuração de CORS não está na página de Authentication nem em
   Domains.** O painel atual da WorkOS mudou de layout: a documentação pública
   descreve o layout antigo, e as duas páginas que deveriam ter as instruções
   hoje só redirecionam. Procurar ali é perder tempo.
2. **O caminho confiável é a busca do painel: `Ctrl+K` → digite "CORS".** É
   assim que se chega na tela certa.
3. **O CORS é exigido no ambiente Dev também** — não é uma exigência só de
   produção. Sem a origem cadastrada, o login falha em `localhost` do mesmo
   jeito que falharia em `*.vercel.app`.

### O que o login em localhost já provou sobre o ambiente

O alvo web usa `VITE_WORKOS_CLIENT_ID`, e esse valor é **o mesmo** de
`MAIN_VITE_WORKOS_CLIENT_ID` (o do desktop) — cada ambiente da WorkOS tem seu
próprio client id. Como o login web funcionou com esse client id, **o ambiente
que foi editado é o mesmo do qual o desktop depende.** É exatamente por isso que
o passo 5 (desktop instalado) era bloqueante — e é por isso que ele valeu: a
resposta à pergunta em aberto nº 2 da pesquisa ("a WorkOS aceita bem duas
plataformas no mesmo ambiente?") é **sim, as entradas convivem**.

Consequência prática para o resto do roteiro: **a URL de produção da Vercel tem
que ser cadastrada no MESMO ambiente**, e o aviso do Bloco B continua valendo em
peso — mexer ali mexe no login de dez pessoas.

---

## Bloco A — domínio próprio (opcional, recomendado)

- [ ] **A1.** Escolher o nome. Sugestão coerente com a infra existente:
      `hydra.usesenju.com` — o LiveKit já vive em `livekit.usesenju.com`, então o
      DNS é o mesmo painel da Hostinger.
- [ ] **A2.** Adicionar o domínio no projeto da Vercel (Settings → Domains) e
      criar na Hostinger o registro CNAME que ela pedir.

**Dito com clareza para não virar expectativa errada:** ficar em `*.vercel.app`
**funciona igual**. A única coisa que o domínio próprio destrancaria é o *custom
auth domain* da WorkOS (que permitiria cookie HttpOnly em vez do `devMode` com
`localStorage`) — e ele custa **US$ 99/mês**, decisão travada como fora de
escopo. O domínio próprio aqui é estética e estabilidade de URL, nada mais.

---

## Bloco B — WorkOS (o MESMO ambiente que o desktop usa)

> **AVISO, antes de tocar em qualquer campo:** este ambiente é o do qual **dez
> pessoas dependem**. Faça FORA de uma janela de uso. Nenhuma entrada existente
> pode ser **removida ou trocada** — só acrescentada.

- [x] **B1a.** *(feito)* Redirects → `http://localhost:5173` acrescentado.
- [ ] **B1b.** Redirects → acrescentar a **origem de produção**
      (`https://<projeto>.vercel.app` ou `https://hydra.usesenju.com`).
      **Só executável depois do C6** — a URL não existe antes do primeiro deploy.
- [ ] **B2.** Redirects → **NÃO REMOVER NEM TROCAR** a entrada existente
      `https://impressive-oyster-898.convex.site/auth/complete`. É dela que o
      desktop instalado depende (`convex/http.ts`, Plano 09-02). São entradas
      convivendo; a WorkOS suporta várias. *(Conferir a cada visita ao painel.)*
- [ ] **B3.** Redirects → conferir/definir a **Sign-out URI** apontando para a
      origem web. A doc é explícita: **sem ela, o logout dá erro** — e é o
      `auth.signOut()` da web que navega para lá. **Depende do C6** se for
      apontar para produção.
- [x] **B4a.** *(feito)* CORS → `http://localhost:5173` como origem permitida.
      **Onde fica:** `Ctrl+K` → "CORS" (ver o achado acima).
- [ ] **B4b.** CORS → acrescentar a **origem de produção**. **Este item é NOVO e
      não tem equivalente no desktop:** o Electron nunca fez requisição de
      *navegador* para a WorkOS — quem falava com `api.workos.com` era o processo
      main, e processo main não tem origem. **Só executável depois do C6.**
- [ ] **B5.** Conferir (não mudar) que o **TTL do access token continua em 8h**,
      elevado na Fase 2. Vale para os dois clientes e é o que segura a
      frequência do Pitfall 4.

**Como escrever a origem, nos dois lugares:** exatamente como o navegador a vê —
esquema, host e porta. `https://hydra.usesenju.com` (sem barra final) não é o
mesmo que `http://hydra.usesenju.com` nem que `https://hydra.usesenju.com/`. A
maioria dos "mas eu cadastrei" é isto.

---

## Bloco C — Vercel

### C.1 Criar o projeto

- [ ] **C1.** Vercel → **Add New → Project** → importar o repositório
      `Leanderson01/janja`. *Motivo: o deploy é a partir do Git; não use upload.*
- [ ] **C2.** **Framework Preset: `Other`.** *Motivo: o preset "Vite" espera
      `vite.config.ts` na raiz e saída `dist`; aqui o config é
      `vite.config.web.ts` e a saída é `dist-web` — o preset erra os dois.*
- [ ] **C3.** **Build Command: `npm run build:web`.** *Motivo: é o script que
      roda as duas passadas de typecheck e o `vite build --config
      vite.config.web.ts`; o comando padrão da Vercel construiria o alvo errado.*
- [ ] **C4.** **Output Directory: `dist-web`.** *Motivo: é para onde
      `vite.config.web.ts` emite; apontar para `dist` entrega uma pasta vazia (ou
      o build do Electron).*
- [ ] **C5.** **Install Command: `npm ci --ignore-scripts`.** *Motivo: o
      `postinstall` deste repo roda `node node_modules/electron/install.js` e
      `scripts/postinstall-rebuild.mjs` — baixar o Electron inteiro num build da
      Vercel é lento e pode falhar, e **nada** do que o postinstall prepara
      (binário nativo do processo main) é usado pelo bundle web.*

### C.2 Variáveis de ambiente — ANTES de disparar o build

Vite substitui `import.meta.env.*` **em tempo de build**. Não existe env var em
runtime numa SPA estática: se a variável não estiver lá quando o build rodar, o
valor não entra no bundle e nenhum ajuste posterior no painel conserta sem um
**redeploy**.

- [ ] **C6a.** `VITE_CONVEX_URL` = mesmo valor do `.env.local` do desktop
      (`https://impressive-oyster-898.convex.cloud`). Escopo **Production** (e
      **Preview**, se Preview for usado).
- [ ] **C6b.** `VITE_WORKOS_CLIENT_ID` = mesmo valor de
      `MAIN_VITE_WORKOS_CLIENT_ID`. *Motivo de poder ir no bundle: client id é
      **público por design** — o fluxo é PKCE com cliente público.* Mesmos
      escopos.
- [ ] **C6c.** `VITE_CONVEX_SITE_URL` → **não cadastrar.** *Motivo: ela só existe
      para montar o `redirectUri` que devolve para `janja://` no desktop
      (`src/main/auth/auth.ts`). Na web não é usada.*
- [ ] **C6d.** Nenhuma `sk_...`, nenhuma API key da WorkOS, nenhum segredo do
      LiveKit. *Motivo: tudo que o bundle lê é distribuído para todo mundo. Se
      alguém sentir vontade de adicionar um segredo aqui, algo está errado.*

### C.3 Preview deploys — o ciclo que morde

**Cada deploy de Preview ganha uma URL `*.vercel.app` NOVA** (muda por branch e
por commit), e **nenhuma delas está cadastrada na WorkOS** — nem como redirect
URI, nem como origem de CORS. Resultado: o login **simplesmente não funciona** em
nenhum preview, e a WorkOS **não aceita wildcard como redirect URI padrão**, então
não há como cadastrar "todos" de uma vez.

- [ ] **C7.** Decidir e registrar: **desligar deploys de Preview**
      (Settings → Git → desmarcar deploys de branches que não a de produção), ou
      aceitar por escrito que **só a URL de produção loga**. *Recomendação para
      v1: desligar — um preview onde ninguém consegue entrar só gera relato de
      bug falso.*
- [ ] **C8.** Se optar por manter Preview: fixe uma URL estável para ele
      (Vercel → Settings → Domains, um domínio de preview fixo do tipo
      `hydra-preview.usesenju.com`) e cadastre **essa** na WorkOS nos dois
      lugares. É a única forma de preview logável sem wildcard.

### C.4 Deploy e volta à WorkOS

- [ ] **C9.** Disparar o build (**Deploy**) e acompanhar o log.
- [ ] **C10.** Anotar a URL de produção exata que a Vercel devolver.
- [ ] **C11.** Voltar ao Bloco B e executar, com essa URL:
      **B1b** (Redirect URI), **B4b** (origem de CORS) e **B3** (Sign-out URI).
      *Motivo de ser depois: os três campos precisam da URL literal, e errar por
      uma barra ou por `http` vs `https` produz exatamente o mesmo sintoma de não
      ter cadastrado nada.*
- [ ] **C12.** Só então abrir a URL pública e fazer o login (passos 2 a 4 do
      checkpoint do plano).

---

## Bloco D — Convex e LiveKit

- [x] **D1. Convex: NADA.** Mesmo deployment (`impressive-oyster-898`), mesmo
      `auth.config.ts`, mesmas env vars, mesmo JWKS. O JWT que o navegador manda
      é emitido pelo mesmo `client_id` que o do desktop.
- [x] **D2. LiveKit: NADA.** Mesma URL (`wss://livekit.usesenju.com`), mesmo
      token, mesmo webhook. Uma aba fechando é, para o webhook, o mesmo caso de
      um `.exe` sendo morto.

Está escrito explicitamente porque economiza a pergunta.

---

## Sintomas e diagnóstico

O padrão de falha desta fase é o pior que existe: **quase nada aqui grita.** A
tabela é o atalho.

| Sintoma | O que significa | Onde consertar |
|---|---|---|
| Console: `No 'Access-Control-Allow-Origin' header` em `POST https://api.workos.com/user_management/authenticate` | A origem não está nas origens de CORS da WorkOS — ou está escrita diferente (porta, `http` vs `https`, barra final) | B4a / B4b (`Ctrl+K` → "CORS") |
| Tela: **"Configuração incompleta: `VITE_CONVEX_URL` não definida"** | O build saiu **sem a variável**. Na Vercel: ela não estava cadastrada no escopo certo **na hora do build** — cadastrar agora exige **redeploy**. Em `dev:web`: o `envDir` do `vite.config.web.ts` não está lendo o `.env.local` da raiz | C6a (+ Redeploy) |
| Tela: **"Configuração incompleta: `VITE_WORKOS_CLIENT_ID` não definida"** | Idem, para o client id. É a variável **nova** da fase — existia só como `MAIN_VITE_WORKOS_CLIENT_ID` | C6b (+ Redeploy) |
| A tela de login aparece **sem estilo nenhum** (sem fundo escuro, sem marca) | Armadilha do root de varredura do Tailwind — o CSS não entrou no bundle | Parar: o Plano 10-01 falhou em silêncio. `npm run verify:web-bundle` mede isso (afirmação 4, "CSS real") |
| O log do build mostra **download do Electron** / o build demora demais ou estoura | O Install Command não ficou `npm ci --ignore-scripts`. O `postinstall` está baixando o binário do Electron (dezenas de MB) por nada | C5. Se o Install Command estiver certo e ainda assim rodar, o plano B já está nomeado: mover o `postinstall` para um script opcional (pergunta em aberto nº 3 da pesquisa) |
| O build falha por **outro** motivo | Copiar o **log inteiro** — é o insumo do SUMMARY e da pergunta em aberto nº 3 | — |
| Login volta para a tela de login depois do redirect, sem erro de CORS | A URL não está nos **Redirects** (é uma lista diferente da de CORS — as duas precisam da mesma origem) | B1b |
| **Logout** dá erro | Sign-out URI ausente ou apontando para outra origem | B3 |
| F5 cai no login | O refresh token não persistiu: `devMode` desligado ou algo limpando o `localStorage` | Código (10-03), não configuração |
| O nome exibido é `usuario#1234` em vez do nome de verdade | `getProfile()` não entregou o perfil ao `ensureUser` | Código (10-03), não configuração |
| Login web OK, **desktop parou de funcionar** | Alguma entrada de Redirects foi **substituída** em vez de acrescentada | **Restaurar `https://impressive-oyster-898.convex.site/auth/complete` imediatamente** (B2) |

---

## Por que o `vercel.json` existe

Duas armadilhas, e nenhuma delas é opcional (JSON não aceita comentário, então a
explicação mora aqui):

1. **`frame-ancestors` é IGNORADA em `<meta>` por especificação.** É a única
   diretiva da CSP do projeto que **precisa** ser cabeçalho de resposta — e ela
   importa aqui porque a integração client-only da WorkOS **não opera dentro de
   um `iframe`**. Sem o cabeçalho, um site de terceiros poderia emoldurar o Hydra
   e a falha seria confusa em vez de bloqueada.
2. **As duas CSPs se INTERSECCIONAM, não se substituem.** Por isso o cabeçalho
   traz **só** `frame-ancestors`: duplicar a política inteira nos dois lugares é a
   armadilha real — qualquer divergência futura vira bloqueio silencioso, e a CSP
   do `src/renderer/index.html` é a que tem os comentários longos que explicam
   cada entrada.

O `rewrites` total para `/index.html` é a rede de segurança recomendada pela
própria Vercel para SPAs Vite. Não há deep link a suportar (o `redirectUri` do
AuthKit é a própria origem, e o `authkit-js` limpa `?code&state` com
`history.replaceState`), mas sem ele um F5 em qualquer caminho que não `/` vira
404 da Vercel.
