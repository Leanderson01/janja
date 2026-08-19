# Handoff — retomar o janja em outra sessão

Leia isto primeiro. Depois `README.md`, depois `.planning/ROADMAP.md`.

O objetivo aqui não é listar o que foi feito — o Git faz isso. É carregar **por que** as
decisões foram tomadas e **quais erros já custaram tempo**, para não serem repetidos.

---

## O que é o janja

Cliente desktop de chat e voz no modelo Discord, para Windows, para uso real por um grupo
de ~10 amigos. Não é exercício: o critério de sucesso é o grupo abandonar o Discord.

**Core value:** dez pessoas num canal de voz, compartilhando tela com áudio, de forma
estável o bastante para largarem o Discord.

Isso define prioridade em toda decisão: **mídia funcionando antes de fidelidade visual.**

## Stack e por que cada peça

| Camada | Escolha | Por que essa |
|---|---|---|
| Shell | Electron >= 43.4.0 | Único caminho para capturar áudio de sistema com a tela. A versão mínima não é arbitrária: `restrictOwnAudio` era ignorado antes dela, e sem ele o loopback WASAPI captura o áudio da própria call e gera eco |
| Linguagem | TypeScript | O Convex gera tipos do schema; sem TS metade do valor da ferramenta se perde |
| UI | React + Tailwind v4 + shadcn/ui | Componentes headless, estilo sob controle — necessário para imitar o Discord |
| Backend | Convex | Reatividade por subscription resolve chat, presença e estado de voz sem WebSocket próprio |
| Auth | WorkOS AuthKit | Único com caminho oficial dos dois lados: `@convex-dev/workos` é mantido pelo Convex, e o WorkOS mantém exemplo de Electron |
| Mídia | LiveKit self-hosted | SFU na VPS própria: custo marginal zero e sem teto de uso. O LiveKit Cloud cobraria US$ 25-35/mês no perfil real de uso, porque minuto conta por participante |

### Alternativas descartadas, para não serem reabertas

- **WebRTC mesh** — exigiria 9 uploads simultâneos por cliente. Upload doméstico
  brasileiro não sustenta, e o screenshare degrada primeiro.
- **Convex Auth** — beta, e não lista Electron como plataforma suportada.
- **Clerk** — integração Convex documentada, mas sem caminho para Electron, que é a
  metade difícil.
- **`@convex-dev/workos`** — dependência dura de `authkit-react`, que assume o token
  gerenciado no browser. Aqui ele vem do processo main por IPC. O adaptador `useAuth`
  escrito à mão sobre `ConvexProviderWithAuth` não é contorno, é o único caminho.

## A regra arquitetural que sustenta tudo

**O LiveKit nunca é fonte da verdade.** Quem está num canal de voz é uma linha em
`voiceStates` no Convex. O Convex autoriza participação e assina um JWT com escopo de
sala; o LiveKit só obedece o token.

Consequências que valem o design:
- A UI de voz funciona antes de qualquer áudio conectar
- Testar permissão não precisa de mídia — é teste de mutation
- Se o LiveKit cair, o texto continua funcionando

**Mas o princípio sozinho é incompleto**, e é aqui que quase todo mundo erra: nada apaga a
linha em `voiceStates` quando o app morre — crash, `Alt+F4`, Windows Update, queda de
rede. `beforeunload` não roda em crash. Por isso existe o webhook de reconciliação
(`convex/http.ts` + `voiceToken.ts`), que o LiveKit chama para corrigir o estado sem virar
autoridade.

Usuário-fantasma no canal, screenshare congelado após queda do apresentador, e mute
dessincronizado após reconexão **são o mesmo problema**. Um padrão de reconciliação, não
três correções.

## Onde cada segredo mora

| Segredo | Onde vive | Onde NUNCA pode estar |
|---|---|---|
| `LIVEKIT_API_SECRET` | env var do Coolify (`LIVEKIT_KEYS`) e env var do Convex | No app Electron — iria empacotado para as dez pessoas |
| Token de DNS da Hostinger | `/etc/letsencrypt/dns-multi.ini` na VPS, permissão 600 | Repositório |
| `WORKOS_CLIENT_ID` | `.env.local` e env var do Convex | É público por design, sem problema |
| API key do WorkOS | **Não é usada em lugar nenhum** | O fluxo é PKCE com cliente público; o Convex valida por JWKS |

Se alguém sentir vontade de adicionar uma `sk_...` ao app, é sinal de que algo está sendo
feito errado.

---

## Lições que custaram tempo — não repetir

### 1. Verificar no ambiente errado não é verificar

O spike do plano 07-01 "provou" que o `livekit-server-sdk` rodava no runtime padrão do
Convex. Passou em 19 testes. **O deploy real falhou**: `Could not resolve "node:crypto"`.
O ambiente edge-runtime do vitest resolve `node:crypto`; o bundler do Convex não.

Custou uma separação de runtime no meio da fase. **Provar que algo roda sob vitest não
prova que roda sob o bundler do Convex.** O spike do push-to-talk (07-06) foi feito num
Electron real por causa disso.

### 2. Build verde não significa app funcionando

Cinco defeitos da Fase 2 só apareceram com a janela aberta no Windows. Com todos eles
presentes, o build passava, o typecheck passava e os testes passavam. O principal — a CSP
do template do electron-vite bloqueando o WebSocket do Convex — **nem gerava erro de
aplicação**: era o Chromium recusando a conexão.

Toda fase tem checkpoint humano por isso, e não é formalidade.

### 3. Guarda que só marca sucesso não protege o caminho de falha

A conexão duplicada ao LiveKit vinha de `activeChannelRef` só ser atribuído no fim de um
join bem-sucedido. Quando a primeira tentativa falhava, a segunda invocação refazia tudo —
dois tokens, duas conexões, mesma identidade, e o SFU derrubava uma. O sintoma era "do
nada começou a funcionar".

Reivindicação de alvo agora é **síncrona**, antes de qualquer `await`, e é liberada
quando o join falha.

### 4. Corrigir a classe, não o caso

Três bugs de rede atingiram um testador: barra sobrando na URL do Convex (login travava
para sempre), coleta de candidatos ICE em adaptador virtual morto, e DNS sobre HTTPS
falhando numa rede com DNS IPv6.

Os três foram corrigidos **no app**, não documentados como contorno. Quem instala não
deveria precisar saber o que é candidato ICE.

### 5. `git add` amplo quebra o main

`git add src/renderer` varreu para um commit o trabalho pela metade de um agente que
ainda escrevia. O `main` ficou sem compilar por minutos, com o usuário puxando para
testar. **Sempre stagear por caminho explícito.**

### 6. Escrita concorrente perde conteúdo

Três planejadores paralelos editaram `ROADMAP.md` ao mesmo tempo e a entrada de uma fase
desapareceu. Agentes paralelos escrevem **só nos próprios diretórios de fase**; o
orquestrador consolida arquivos compartilhados em série. O mesmo vale para
`convex/_generated/api.ts`.

### 7. Um incidente de perda de dados

Um agente rodou o scaffolder do electron-vite com `yes |` para pular prompts. O `yes`
respondeu "y" a tudo, inclusive ao "diretório não vazio, sobrescrever?" — apagou `.git`,
`docs/`, `.claude/` e parte de `.planning/`. Recuperado por clone do remote, que tinha
sido pushado minutos antes.

**Regras que nasceram daí:** scaffolder interativo nunca roda dentro do repo; nada de
`yes |`, `--force` ou auto-confirmação cega; verificar integridade após qualquer scaffold;
`git push` a cada commit, não em lote.

---

## Como o trabalho é conduzido

- **Um plano por agente**, com propriedade de arquivo declarada no prompt
- Agentes **não rodam git** — o orquestrador commita em série, stageando por caminho
- Commit + push a cada plano que fecha, com o **porquê** na mensagem
- Verificação: `npm run typecheck`, `npm run build`, `npx vitest run` — e **ler a saída**,
  não só rodar
- `npx tsc --noEmit -p convex/tsconfig.json` é a mesma checagem que o `npx convex dev` do
  usuário roda; falhar ali bloqueia o deploy dele
- Atenção: `convex/tsconfig.json` **exclui arquivos de teste**; o `tsconfig.convex.json`
  da raiz os inclui. Rodar só o primeiro já deixou erro passar para um commit

## O que só o Leo pode fazer

O ambiente de desenvolvimento é WSL2. Não renderiza janela Electron, não tem dispositivo
de áudio, não tem acesso à VPS nem sessão autenticada do Convex.

| Precisa dele | Por quê |
|---|---|
| Verificação visual no Windows | WSL2 não renderiza a janela |
| Qualquer coisa de áudio | Sem dispositivo aqui |
| Deploy na VPS | Sem SSH; não há CI/CD |
| `npx convex dev` | Login interativo |
| Teste com duas contas | Trava de instância única impede duas na mesma máquina |

---

## Estado ao fim da Fase 7

Preenchido quando a fase fechar. Ver `.planning/ROADMAP.md` para a tabela viva.
