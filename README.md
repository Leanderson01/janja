# janja

Cliente desktop de chat e voz no modelo Discord, para Windows. Construído para uso
real por um grupo de ~10 pessoas.

**Core value:** dez pessoas num canal de voz, compartilhando tela com áudio, de forma
estável o bastante para o grupo abandonar o Discord.

---

## Estado do projeto

| Fase | Entrega | Estado |
|---|---|---|
| 0 · Bootstrap | App Electron abre, instância única | ✅ verificada no Windows |
| 1 · LiveKit na VPS | Servidor de voz em `livekit.usesenju.com` | ✅ 4/4 critérios |
| 2 · Convex + auth | Login Google, sessão persistente, `USER#123` | ✅ AUTH-01..06 |
| 3 · Shell da UI | Layout do Discord | ✅ verificada no Windows |
| 4 · Servidores e canais | Criar, convidar, canais, membros | 🔨 em execução |
| 5 · Chat em tempo real | Mensagens, histórico, não lidas | 📋 planejando |
| 6 · Amigos e DMs | Busca por `USER#123`, pedidos, DM | 🔨 em execução |
| 7 · Voz | 10 pessoas em call | 📋 planejada (9 planos) |
| 8 · Compartilhar tela | Tela + áudio, sem eco | 📋 planejando |
| 9 · Polimento | Instalador Windows | 📋 planejando |

> Este quadro é resumo. A fonte da verdade é `.planning/ROADMAP.md`, com os 60
> requisitos rastreados um a um, e cada fase concluída tem seu `VERIFICACAO.md`.

## Como rodar

Precisa de **Windows** — é o alvo, e a captura de áudio de sistema não funciona no WSL2.

```bash
git clone https://github.com/Leanderson01/janja.git
cd janja && npm install
npm run dev
```

Se aparecer `Error: Electron uninstall`, o binário não foi baixado no install:

```bash
node node_modules/electron/install.js
```

*(Dívida conhecida — a Fase 9 resolve com um `postinstall`.)*

Num segundo terminal, para publicar as funções do backend e mantê-las sincronizadas:

```bash
npx convex dev
```

### Configuração

`.env.local` na raiz (não versionado). O `.env.local.example` documenta os campos:

| Variável | Origem |
|---|---|
| `CONVEX_DEPLOYMENT` | escrita pelo `npx convex dev` |
| `VITE_CONVEX_URL` | escrita pelo `npx convex dev` |
| `VITE_CONVEX_SITE_URL` | escrita pelo `npx convex dev` |
| `MAIN_VITE_WORKOS_CLIENT_ID` | dashboard do WorkOS — é público |

**Nenhuma API key do WorkOS é necessária em lugar nenhum.** O fluxo usa PKCE com
cliente público, e o Convex valida por JWKS. Se algum dia alguém sentir vontade de
adicionar uma `sk_...` ao app, é sinal de que algo está sendo feito errado — o
Electron distribui tudo que lê para todas as máquinas.

## Arquitetura em uma tabela

| Peça | Responsabilidade | Explicitamente não faz |
|---|---|---|
| Electron main/preload | Janela, OAuth, captura de tela, IPC | Nenhuma lógica de negócio |
| Renderer (React) | Toda a UI e estado de aplicação | Nunca assina tokens do LiveKit |
| Convex | Fonte da verdade do domínio; emite tokens | Não transporta áudio/vídeo |
| LiveKit (VPS) | Transporte de mídia | Não conhece permissões do app |

**O LiveKit nunca é fonte da verdade.** Quem está num canal de voz é uma linha em
`voiceStates` no Convex. Consequência que só aparece na prática: nada limpa essa linha
quando o app morre, então a Fase 7 usa webhooks do LiveKit para reconciliar. Sem isso,
usuários-fantasma ficam no canal para sempre.

## Comandos

```bash
npm run dev          # desenvolvimento
npm run build        # typecheck (main + renderer + convex) e build
npm run typecheck    # só as checagens de tipo
npx vitest run       # testes do backend Convex
```

## Onde está o quê

| Caminho | Conteúdo |
|---|---|
| `.planning/ROADMAP.md` | 10 fases, 60 requisitos rastreados |
| `.planning/REQUIREMENTS.md` | Requisitos v1, v2 e exclusões justificadas |
| `.planning/STATE.md` | Estado atual, decisões e incidentes |
| `.planning/research/` | Pesquisa de features e armadilhas, verificada em doc oficial |
| `.planning/phases/NN-*/` | Planos, pesquisa e verificação de cada fase |
| `docs/superpowers/specs/` | Design aprovado |
| `infra/livekit/` | Config do servidor de voz e runbook de deploy |

## Infraestrutura

| | |
|---|---|
| LiveKit | `wss://livekit.usesenju.com` — VPS própria, via Coolify |
| Convex | deployment `impressive-oyster-898` |
| Auth | WorkOS AuthKit, ambiente de staging |

O certificado do TURN renova sozinho por cron mensal (`infra/livekit/renew-and-restart.sh`),
que também reinicia o container — o LiveKit lê o certificado só ao subir, e renovar sem
reiniciar quebraria em silêncio 90 dias depois.

## Pendências conhecidas

- **Brave trava no seletor de contas do Google** durante o login. Não reproduz no
  Chrome/Edge. A configuração do WorkOS está comprovadamente correta. Investigar antes
  do empacotamento.
- **`convex/_generated/` foi reconstruído à mão** no ambiente Linux, que não tem sessão
  autenticada do Convex. A versão autoritativa é a que o `npx convex dev` gera no Windows.
- **TURN roda na porta 5349, não na 443** recomendada pela doc do LiveKit — a 443 pertence
  ao Traefik do Coolify. Testado e funcionando em 5G real; se alguém não tiver áudio de
  uma rede específica, esta é a primeira hipótese.
