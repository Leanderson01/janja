# janja — Design

**Data:** 2026-08-18
**Status:** aprovado (aguardando revisão final)
**Repo:** `git@github.com:Leanderson01/janja.git`

## 1. Objetivo

Cliente desktop de chat e voz no modelo Discord, para uso real por um grupo de
~10 pessoas. Não é exercício de portfólio: o critério de sucesso é o grupo
abandonar o Discord e usar o janja no dia a dia.

Isso define a prioridade: **mídia funcionando antes de fidelidade visual**. A UI
replica o Discord porque é o layout que o grupo já conhece, não como fim em si.

### Critérios de sucesso

1. 10 pessoas em um canal de voz simultaneamente, com áudio estável.
2. Compartilhamento de tela com áudio do sistema audível pelos demais.
3. Login com Google em menos de 15 segundos, sessão persistente entre reinícios.
4. Mensagens de texto aparecem para os outros em menos de 500 ms.
5. Instalador Windows que uma pessoa não-técnica consegue rodar.

### Não-objetivos

Versão web, suporte a macOS/Linux, federação, escala além de ~50 usuários
registrados, monetização.

## 2. Decisões de stack

| Camada | Escolha | Por quê |
|---|---|---|
| Shell | Electron + `electron-vite` | Único caminho para capturar áudio de sistema junto com a tela |
| Linguagem | TypeScript | Convex gera tipos do schema; sem TS metade do valor da ferramenta se perde |
| UI | React + Tailwind + shadcn/ui | Componentes headless, estilo controlado por nós — necessário para imitar o Discord |
| Backend/estado | Convex | Reatividade por subscription resolve chat, presença e voice states sem WebSocket próprio |
| Auth | WorkOS AuthKit | First-party dos dois lados: `@convex-dev/workos` é mantido pelo Convex, e o WorkOS mantém exemplo oficial de Electron |
| Mídia | LiveKit self-hosted | SFU na VPS própria: custo marginal zero, sem teto de uso, latência menor por estar no Brasil |
| Plataforma | Windows | Único OS onde captura de áudio de sistema é nativa e confiável |

### Alternativas descartadas

**WebRTC mesh** — cada cliente enviaria 9 streams simultâneos. O upload
doméstico brasileiro típico não sustenta isso, e o screenshare degrada primeiro.
Descartado por não atender ao requisito dos 10 simultâneos.

**LiveKit Cloud** — o plano Build inclui 5.000 minutos-participante e 50 GB de
downstream por mês. Como o minuto conta por participante, uma call de 10 pessoas
consome 10 min/min: o free tier cobre ~8h20 de call por mês. Uso realista
(40h de voz + 15h de screenshare) custaria US$ 25–35/mês em overage. A VPS
existente entrega o mesmo por custo marginal zero.

**Convex Auth** — em beta e sem Electron na lista de plataformas suportadas.
Seria necessário um spike de risco. WorkOS elimina o spike.

**Clerk** — integração Convex documentada, mas sem caminho oficial para Electron,
que é justamente a metade difícil.

## 3. Arquitetura

Quatro peças com fronteiras explícitas:

| Peça | Responsabilidade | Explicitamente não faz |
|---|---|---|
| Electron main/preload | Janela, OAuth via loopback, `desktopCapturer`, IPC | Nenhuma lógica de negócio |
| Renderer (React) | Toda a UI e estado de aplicação | Nunca assina tokens do LiveKit |
| Convex | Fonte da verdade de todo o domínio; emite tokens do LiveKit | Não transporta áudio/vídeo |
| LiveKit (VPS) | Transporte de mídia: áudio e screenshare | Não conhece as permissões do app |

### Princípio central

**O LiveKit nunca é fonte da verdade.** Quem está em um canal de voz é uma linha
na tabela `voiceStates` do Convex, não uma query ao LiveKit. O Convex autoriza e
emite um JWT com escopo de sala; o LiveKit apenas obedece ao token.

Consequências que valem o design:

- A UI de voz (quem está no canal, quem está mudo) funciona antes de qualquer
  áudio conectar.
- Testes de permissão não precisam de mídia — são testes de mutation do Convex.
- Se o LiveKit cair, o app continua funcionando para texto.

O único estado que vive no LiveKit é *quem está falando agora* (evento
`ActiveSpeakers`): efêmero demais para justificar escrita no banco.

### Estrutura do repositório

```
janja/
├── src/main/       # processo main: janela, OAuth loopback, IPC, safeStorage
├── src/preload/    # contextBridge — superfície mínima e explícita
├── src/renderer/   # React + shadcn — a UI
├── convex/         # schema, queries, mutations, actions
├── infra/livekit/  # docker-compose, Caddyfile, livekit.yaml
└── docs/
```

Pacote único, sem monorepo. Não haverá versão web, então não há código a
compartilhar entre alvos.

## 4. Autenticação

O fluxo, passo a passo:

1. Renderer solicita login via IPC ao main.
2. Main sobe servidor HTTP efêmero em `http://127.0.0.1:<porta-aleatória>`
   (padrão RFC 8252, OAuth 2.0 for Native Apps).
3. Main chama `shell.openExternal(authkitUrl)` — abre o **navegador do sistema**.
4. Usuário autentica no Google via WorkOS AuthKit.
5. WorkOS redireciona ao loopback com o código; o servidor efêmero captura e encerra.
6. Main troca o código por tokens e persiste o refresh token no `safeStorage`
   do Electron (criptografia do OS, não `localStorage`).
7. Main entrega o access token ao renderer via IPC.
8. Renderer alimenta o Convex através de `ConvexProviderWithAuth` com um hook
   `useAuth` customizado.

O passo 3 não é preferência: **o Google recusa autenticação dentro de
`BrowserWindow` do Electron** (`disallowed_useragent`). Não existe caminho
embutido.

### Ponto de integração conhecido

`@convex-dev/workos` assume `@workos-inc/authkit-react` gerenciando o token no
browser. Aqui o token chega do main via IPC, então o hook `useAuth` é escrito à
mão sobre `ConvexProviderWithAuth` — escape hatch documentado do Convex,
aproximadamente 50 linhas. É implementação, não pesquisa.

### Identidade do usuário

No primeiro login, cria-se o documento `users` com `username` e um `tag` de 4
dígitos gerado aleatoriamente e verificado quanto a unicidade. O par
`username#tag` é o identificador público — o `USER#123` usado para adicionar
amigos.

## 5. Modelo de dados (Convex)

Campos marcados com `·` são indexados.

```
users          workosId·, username, tag, displayName, avatarUrl, status
servers        name, iconUrl, ownerId
serverMembers  serverId·, userId·, nickname, joinedAt
channels       serverId·, name, type: 'text' | 'voice', position
messages       channelId·, authorId, content, createdAt, editedAt
dmChannels     participantIds·
friendRequests fromUserId·, toUserId·, status
friendships    userA·, userB·
voiceStates    channelId·, userId·, muted, deafened, sharing
presence       userId·, lastSeen, status
```

Índice composto único em `users` sobre `(username, tag)` — garante que
`USER#123` resolve para no máximo um usuário.

`voiceStates` é a peça central da voz: toda a UI de presença em canal é uma
subscription reativa sobre essa tabela.

## 6. Voz e compartilhamento de tela

### Entrar em canal de voz

1. Renderer chama a action `joinVoiceChannel(channelId)`.
2. Action valida que o usuário é membro do servidor dono do canal.
3. Action assina um JWT do LiveKit com a API secret (variável de ambiente do
   Convex — nunca exposta ao cliente), com escopo restrito à sala `channelId`.
4. Action insere a linha em `voiceStates`.
5. Renderer conecta em `wss://livekit.usesenju.com`, sala = `channelId`.

### Compartilhar tela com áudio

No main, `setDisplayMediaRequestHandler` com `audio: 'loopback'` — API do
Electron que no Windows entrega o áudio do sistema junto com o vídeo via WASAPI
loopback. O stream resultante gera duas tracks publicadas no LiveKit (vídeo da
tela e áudio do sistema), independentes da track do microfone.

## 7. Infraestrutura — LiveKit na VPS

**Host:** VPS no Brasil, 2 vCPU / 8 GB RAM / 1 TB de tráfego.
**Domínio:** `livekit.usesenju.com`.

| Recurso | Requisito |
|---|---|
| Portas | 443/TCP (WSS + TURN/TLS), 7881/TCP (fallback WebRTC sobre TCP), 50000-60000/UDP (mídia RTP) |
| IP | Público e estável, com `use_external_ip` habilitado |
| TLS | Certificado válido via Caddy — WebRTC exige WSS, certificado self-signed não serve |
| Stack | Docker Compose: `livekit/livekit-server` + Caddy |

**Dimensionamento:** o SFU encaminha pacotes sem transcodificar, então 10
participantes é carga trivial para 2 vCPU. O consumo estimado de ~200 GB/mês
usa um quinto da franquia de 1 TB.

**Pendência de configuração:** confirmar se a porta 443 já está ocupada na VPS.
Se houver Nginx ou Traefik na frente, o LiveKit vai atrás do proxy existente em
vez de subir o próprio Caddy. É detalhe de configuração, não de arquitetura.

## 8. Escopo do MVP

**Incluído:** servidores (criar e entrar por convite); canais de texto e voz;
chat em tempo real; amigos por `USER#123`; DMs; call de voz com mute, deafen e
indicador de fala; compartilhamento de tela com áudio do sistema; presença
online/offline; instalador Windows.

**Fora do MVP** — nenhum destes altera a arquitetura, todos são adição posterior:
roles e permissões granulares, reações, threads, upload de arquivos, vídeo de
webcam, busca de mensagens, notificações push, edição e deleção de mensagens,
markdown rico.

## 9. Fases e paralelismo

```
Onda A  F0  Bootstrap do repo                      (bloqueia tudo)

Onda B  F1  LiveKit na VPS                         ┐
        F2  Convex + auth WorkOS                   ├ 3 em paralelo
        F3  Shell da UI (estático, sem dados)      ┘

Onda C  F4  Servidores + canais                    ┐ 2 em paralelo
        F6  Amigos + DMs                           ┘

Onda D  F5  Chat em tempo real                     ┐ 2 em paralelo
        F7  Voz (LiveKit)                          ┘

Onda E  F8  Screenshare + áudio de sistema         (exige Windows nativo)

Onda F  F9  Presença, settings, packaging
```

**F1 é totalmente independente do código do app** — pode começar imediatamente,
em paralelo ao bootstrap.

### Dependências

- F1, F2, F3 dependem apenas de F0.
- F4 depende de F2 e F3. F6 depende de F2.
- F5 depende de F4. F7 depende de F1 e F4.
- F8 depende de F7. F9 depende de tudo.

## 10. Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| Áudio de sistema não testável no ambiente de dev (WSL2) | Alta | Máquina Windows nativa disponível; F8 é validada exclusivamente lá |
| Ponte `useAuth` entre WorkOS/IPC e Convex | Média | Escape hatch documentado do Convex; superfície pequena |
| Porta 443 ocupada na VPS | Baixa | Config atrás de proxy existente; resolvido em F1 |
| Qualidade de voz sob upload doméstico ruim | Média | SFU exige apenas 1 upload por cliente; simulcast no screenshare se necessário |

## 11. Estratégia de testes

- **Convex** — mutations e queries testadas com `convex-test`, incluindo os
  casos de autorização (não-membro não entra em canal de voz, `USER#123`
  inexistente, tag duplicada).
- **Renderer** — componentes de UI com estado derivado testados isoladamente;
  o layout estático de F3 não precisa de teste automatizado.
- **Mídia** — verificação manual em máquina Windows, com roteiro fixo:
  entrar em canal, mutar, compartilhar tela com áudio, sair.
- **Integração** — F1 validada por conexão real ao `wss://livekit.usesenju.com`
  antes de qualquer código de app depender dela.
