# janja

## What This Is

Cliente desktop de chat e voz no modelo Discord, para Windows, construído para uso
real por um grupo de ~10 pessoas. Replica o layout do Discord porque é a interface
que o grupo já conhece, e entrega o que o grupo realmente usa: canais de texto,
canais de voz e compartilhamento de tela com áudio do sistema.

## Core Value

Dez pessoas conseguem entrar num canal de voz e compartilhar tela com áudio, de
forma estável o bastante para o grupo abandonar o Discord.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Login com Google, sessão persistente entre reinícios do app
- [ ] Identidade pública no formato `USER#123` (username + tag de 4 dígitos)
- [ ] Criar servidores e entrar em servidores por convite
- [ ] Canais de texto e canais de voz dentro de um servidor
- [ ] Chat em tempo real nos canais de texto
- [ ] Adicionar amigos por `USER#123`
- [ ] Mensagens diretas entre amigos
- [ ] Entrar/sair de canal de voz com áudio para até 10 pessoas
- [ ] Mute, deafen e indicador visual de quem está falando
- [ ] Compartilhar tela com áudio do sistema junto
- [ ] Presença online/offline dos usuários
- [ ] Instalador Windows que pessoa não-técnica consegue rodar

### Out of Scope

- Versão web — o app precisa de `desktopCapturer` do Electron para capturar áudio de sistema; navegador não entrega isso de forma confiável
- macOS e Linux — macOS não expõe áudio de sistema sem driver virtual; Linux exige PipeWire/portal XDG. Ambos multiplicam a superfície de teste sem servir a nenhum usuário atual
- Roles e permissões granulares — grupo de 10 pessoas que se conhecem não precisa de hierarquia
- Reações, threads, upload de arquivos, markdown rico, busca de mensagens, edição/deleção de mensagem — adições posteriores, nenhuma altera a arquitetura
- Vídeo de webcam — o grupo compartilha tela, não rosto
- Notificações push — exige serviço adicional; o app fica aberto durante o uso
- Federação, monetização, escala além de ~50 usuários registrados — não é produto

## Context

**Design aprovado:** `docs/superpowers/specs/2026-08-18-janja-discord-clone-design.md`
contém arquitetura completa, schema do Convex, fluxo de auth passo a passo,
requisitos de infraestrutura e análise de riscos. É a referência para todo o
planejamento de fases.

**Princípio arquitetural central:** o LiveKit nunca é fonte da verdade. Quem está
em um canal de voz é uma linha na tabela `voiceStates` do Convex; o Convex
autoriza e emite JWT com escopo de sala, e o LiveKit apenas obedece ao token.
Isso permite testar permissões sem mídia, e mantém o texto funcionando se o
LiveKit cair.

**Infraestrutura disponível:** VPS no Brasil com 2 vCPU / 8 GB RAM / 1 TB de
tráfego, e domínio `usesenju.com`. O LiveKit roda em `livekit.usesenju.com`.
Consumo estimado de ~200 GB/mês usa um quinto da franquia.

**Ambiente de desenvolvimento:** WSL2/Linux. Máquina Windows nativa disponível
para validar a fase de compartilhamento de tela, que não é testável no WSL.

**Armadilhas pesquisadas:** `.planning/research/PITFALLS.md` traz 7 armadilhas
críticas verificadas contra documentação oficial, cada uma mapeada para uma fase
e com sinais de alerta. Três alteraram o design: reconciliação de `voiceStates`
por webhook, piso de versão do Electron, e TTL do token do WorkOS.

**Pendência de configuração:** confirmar se a porta 443 da VPS já está ocupada.
Se houver Nginx ou Traefik na frente, o LiveKit vai atrás do proxy existente em
vez de subir o próprio Caddy.

## Constraints

- **Tech stack**: Electron >= 43.4.0 + electron-vite, TypeScript, React + Tailwind + shadcn/ui, Convex, WorkOS AuthKit, LiveKit self-hosted — decidido no design, não reabrir sem motivo forte
- **Plataforma**: Windows exclusivamente — único OS com captura de áudio de sistema nativa e confiável
- **Budget**: custo marginal próximo de zero — VPS e domínio já existem, WorkOS AuthKit é gratuito nesse volume. Nenhum serviço pago novo
- **Escala**: ~10 usuários simultâneos, ~50 registrados — não otimizar além disso
- **Performance**: mensagem de texto visível para os outros em menos de 500 ms; áudio estável com 10 participantes
- **Dependências**: LiveKit exige portas 443/TCP, 5349/TCP, 7881/TCP e 50000-60000/UDP liberadas, `use_external_ip: true`, TURN habilitado, e certificado TLS válido (WebRTC não aceita self-signed)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| LiveKit self-hosted em vez de LiveKit Cloud | Minuto do Cloud conta por participante: call de 10 pessoas consome 10 min/min, e o free tier cobre só ~8h20/mês. Uso real custaria US$ 25-35/mês. A VPS já existe | — Pending |
| SFU em vez de WebRTC mesh | Mesh exigiria 9 uploads simultâneos por cliente; upload doméstico brasileiro não sustenta, e o screenshare degrada primeiro | — Pending |
| WorkOS AuthKit em vez de Convex Auth ou Clerk | Único com caminho oficial dos dois lados: `@convex-dev/workos` é mantido pelo Convex, e o WorkOS mantém exemplo oficial de Electron. Convex Auth está em beta e não lista Electron; Clerk não tem lado Electron | — Pending |
| OAuth via navegador do sistema (não `BrowserWindow`) | O Google recusa autenticação dentro de `BrowserWindow` do Electron (`disallowed_useragent`). Não existe caminho embutido | — Pending |
| Custom protocol `janja://` em vez de loopback RFC 8252 | Loopback é mais seguro e é o padrão recomendado por Google e IETF, mas não tem biblioteca pronta nesta stack — exigiria PKCE, state, porta aleatória e proteção de socket escritos à mão. O exemplo oficial da WorkOS usa custom protocol. Com 10 usuários conhecidos, sequestro de scheme é risco menor que errar criptografia própria | — Pending |
| Electron >= 43.4.0 como piso de versão | `restrictOwnAudio` era ignorado antes dessa versão, e sem ele o loopback WASAPI captura o áudio da própria call, gerando eco | — Pending |
| Webhooks do LiveKit reconciliam `voiceStates` | O princípio "LiveKit nunca é fonte da verdade" sozinho deixa linhas órfãs quando o app morre sem executar cleanup. O webhook corrige o estado sem tornar o LiveKit autoridade | — Pending |
| TTL do access token do WorkOS em 8-12h em vez de 5 min | Bug documentado (`get-convex/convex-backend#259`) trava o cliente Convex em `isAuthenticated: false` após expiração. Uma call de 30 min atravessaria o padrão de 5 min várias vezes | — Pending |
| TURN habilitado desde o início, mesmo parecendo desnecessário | Sem TURN, a mídia falha em silêncio atrás de CGNAT e rede corporativa: conecta mas ninguém ouve. Custo de configurar é baixo; custo de depurar remotamente depois é alto | — Pending |
| TypeScript em vez de JavaScript | Convex gera tipos a partir do schema; sem TS perde-se autocomplete de queries, validação de args e erros de schema viram bug em runtime | — Pending |
| DMs com tabela de junção `dmMembers` em vez de array `participantIds` | Índices do Convex sobre campos de array não suportam consulta "contém" — listar DMs do usuário seria varredura completa da tabela | — Pending |
| Windows como alvo único | macOS não expõe áudio de sistema sem driver virtual; Linux exige PipeWire/portal XDG. Nenhum usuário atual precisa deles | — Pending |

---
*Last updated: 2026-08-18 after pitfalls research*
