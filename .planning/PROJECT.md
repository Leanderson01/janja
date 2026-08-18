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

**Pendência de configuração:** confirmar se a porta 443 da VPS já está ocupada.
Se houver Nginx ou Traefik na frente, o LiveKit vai atrás do proxy existente em
vez de subir o próprio Caddy.

## Constraints

- **Tech stack**: Electron + electron-vite, TypeScript, React + Tailwind + shadcn/ui, Convex, WorkOS AuthKit, LiveKit self-hosted — decidido no design, não reabrir sem motivo forte
- **Plataforma**: Windows exclusivamente — único OS com captura de áudio de sistema nativa e confiável
- **Budget**: custo marginal próximo de zero — VPS e domínio já existem, WorkOS AuthKit é gratuito nesse volume. Nenhum serviço pago novo
- **Escala**: ~10 usuários simultâneos, ~50 registrados — não otimizar além disso
- **Performance**: mensagem de texto visível para os outros em menos de 500 ms; áudio estável com 10 participantes
- **Dependências**: LiveKit exige portas 443/TCP, 7881/TCP e 50000-60000/UDP liberadas, e certificado TLS válido (WebRTC não aceita self-signed)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| LiveKit self-hosted em vez de LiveKit Cloud | Minuto do Cloud conta por participante: call de 10 pessoas consome 10 min/min, e o free tier cobre só ~8h20/mês. Uso real custaria US$ 25-35/mês. A VPS já existe | — Pending |
| SFU em vez de WebRTC mesh | Mesh exigiria 9 uploads simultâneos por cliente; upload doméstico brasileiro não sustenta, e o screenshare degrada primeiro | — Pending |
| WorkOS AuthKit em vez de Convex Auth ou Clerk | Único com caminho oficial dos dois lados: `@convex-dev/workos` é mantido pelo Convex, e o WorkOS mantém exemplo oficial de Electron. Convex Auth está em beta e não lista Electron; Clerk não tem lado Electron | — Pending |
| OAuth via navegador do sistema + loopback HTTP (RFC 8252) | O Google recusa autenticação dentro de `BrowserWindow` do Electron (`disallowed_useragent`). Não existe caminho embutido | — Pending |
| TypeScript em vez de JavaScript | Convex gera tipos a partir do schema; sem TS perde-se autocomplete de queries, validação de args e erros de schema viram bug em runtime | — Pending |
| DMs com tabela de junção `dmMembers` em vez de array `participantIds` | Índices do Convex sobre campos de array não suportam consulta "contém" — listar DMs do usuário seria varredura completa da tabela | — Pending |
| Windows como alvo único | macOS não expõe áudio de sistema sem driver virtual; Linux exige PipeWire/portal XDG. Nenhum usuário atual precisa deles | — Pending |

---
*Last updated: 2026-08-18 after initialization*
