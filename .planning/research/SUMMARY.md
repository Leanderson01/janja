# Research Summary: janja

**Escopo da pesquisa:** duas dimensões — features e armadilhas. Stack e arquitetura
não foram pesquisadas porque já estavam decididas e justificadas no design aprovado
(`docs/superpowers/specs/2026-08-18-janja-discord-clone-design.md`).

## Achados que alteraram o design

| Achado | Consequência | Fase |
|---|---|---|
| `voiceStates` fica órfão quando o app morre sem cleanup | Webhooks do LiveKit (`participant_left`, `participant_connection_aborted`, `room_finished`) reconciliam via HTTP action do Convex. Assinatura exige corpo bruto (`request.text()`) | F7 |
| `restrictOwnAudio` era ignorado antes do Electron 43.4.0 | Piso de versão obrigatório; sem ele o loopback WASAPI captura o áudio da própria call e gera eco | F8 |
| Bug `get-convex/convex-backend#259` trava o cliente em `isAuthenticated: false` | TTL do access token do WorkOS elevado para 8-12h; log local para detectar em uso | F2 |
| Exemplo oficial da WorkOS usa custom protocol, não loopback | Fluxo de auth trocado para `janja://`; loopback exigiria PKCE, state e proteção de socket escritos à mão | F2 |
| Sem TURN, a mídia falha em silêncio atrás de CGNAT e firewall | `turn.enabled` e `use_external_ip` obrigatórios; validar de hotspot 4G | F1 |
| Schema não tinha tabela de convites, mas "entrar por convite" era requisito ativo | Tabela `invites` adicionada — o requisito era impossível de implementar | F4 |
| Schema não tinha estado de leitura | Tabela `channelReadState` adicionada, sustentando divisor de não-lidas e badge | F5 |
| `globalShortcut` do Electron não expõe `keydown`/`keyup` separados | Push-to-talk exige `uiohook-napi` no processo main. Complexidade sobe de baixa para alta, e o módulo nativo afeta o empacotamento | F7, F9 |
| Electron não tem picker nativo de tela | UI de seleção de tela/janela construída do zero sobre `desktopCapturer.getSources()` | F8 |

## Confirmações que reduziram risco

- Cancelamento de eco, supressão de ruído e ganho automático são nativos do WebRTC e gratuitos — mas precisam ser setados explicitamente em `AudioCaptureOptions`.
- Estados de conexão (`Connecting`/`Connected`/`Reconnecting`/`Disconnected`) e qualidade por participante (`Excellent`/`Good`/`Poor`/`Lost`) vêm prontos do LiveKit.
- Troca de dispositivo de áudio via `switchActiveDevice` não exige reconectar à sala.
- SFU não transcodifica: 10 participantes é carga trivial para 2 vCPU.

## Decisões derivadas da pesquisa

- **Qualidade de conexão em 4 níveis**, não ping em milissegundos — o número exigiria `getStats()` cru com polling e responde a mesma pergunta do usuário.
- **Krisp fora**: cobra licença, contraria a constraint de nenhum serviço pago novo. Supressão nativa basta.
- **Deafen implica mute**, e unmute enquanto ensurdecido remove o deafen — evita o estado "falando sem ouvir ninguém".
- **Convite único reutilizável e revogável** por servidor, sem expiração nem limite de usos: para 10 amigos fixos, gerenciar múltiplos convites é trabalho sem beneficiário.
- **Simulcast no preset padrão**, sem tunar camadas — o ganho é marginal para 10 pessoas conhecidas e consome CPU do SFU.

## Anti-features confirmadas

Roles e permissões granulares, limite de usuários por canal, webcam, mover usuário
à força entre canais, markdown rico, busca de mensagens, notificações push, rich
presence, descoberta pública de servidores. Cada uma com justificativa registrada
em `.planning/REQUIREMENTS.md` para não ser reaberta sem contexto.

## Padrão transversal identificado

Usuário-fantasma em canal de voz, screenshare congelado após queda do apresentador,
e mute/deafen dessincronizado após reconexão **são o mesmo problema**: estado no
Convex que só o cliente atualiza, e o cliente não roda quando morre. Tratar como
um único padrão de reconciliação por webhook, não como três bugs distintos.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `FEATURES.md` | Table stakes, diferenciadores e anti-features, com complexidade, dependências e matriz de priorização |
| `PITFALLS.md` | 7 armadilhas críticas verificadas em documentação oficial, com sinais de alerta, prevenção acionável e mapeamento por fase |

## Lacunas conhecidas

- Custo do Krisp para self-hosted em baixo volume não foi encontrado na documentação. Irrelevante enquanto o Krisp estiver fora de escopo.
- Semântica de mute/deafen do Discord é conhecimento de comunidade, não API pública documentada. Foi tratada como decisão de design explícita, não cópia.
