# Requirements: janja

**Defined:** 2026-08-18
**Core Value:** Dez pessoas conseguem entrar num canal de voz e compartilhar tela com áudio, de forma estável o bastante para o grupo abandonar o Discord.

## v1 Requirements

### Infraestrutura

- [ ] **INFRA-01**: LiveKit responde em `wss://livekit.usesenju.com` com certificado TLS válido
- [ ] **INFRA-02**: TURN sobre TLS habilitado, permitindo mídia a partir de rede com CGNAT ou firewall restritivo
- [ ] **INFRA-03**: Servidor anuncia candidatos ICE com IP público (`use_external_ip: true`), alcançáveis de fora da VPS
- [ ] **INFRA-04**: Serviço sobe sozinho após reboot da VPS

### Autenticação

- [ ] **AUTH-01**: Usuário faz login com conta Google pelo navegador do sistema, e o app recebe o retorno via `janja://`
- [ ] **AUTH-02**: Sessão persiste entre reinícios do app sem novo login
- [ ] **AUTH-03**: Falha ao ler credencial armazenada leva o usuário à tela de login, nunca a crash ou tela branca
- [ ] **AUTH-04**: Sessão permanece funcional durante uma call de 30+ minutos, sem travar em estado não-autenticado
- [ ] **AUTH-05**: Usuário consegue sair da conta pelo app
- [ ] **AUTH-06**: Primeiro login gera identidade pública `username#tag` única
- [ ] **AUTH-07**: Após o login, a aba do navegador exibe confirmação de conclusão e instrução para fechá-la

### Servidores e canais

- [ ] **SRV-01**: Usuário cria um servidor e vira dono dele
- [ ] **SRV-02**: Dono gera um código de convite reutilizável para o servidor
- [ ] **SRV-03**: Usuário entra num servidor usando um código de convite
- [ ] **SRV-04**: Dono revoga um código de convite, invalidando-o para novos ingressos
- [ ] **SRV-05**: Usuário cria canais de texto e de voz dentro de um servidor onde é membro
- [ ] **SRV-06**: Não-membro não consegue ler nem escrever em canais do servidor
- [ ] **SRV-07**: Usuário vê a lista de membros do servidor

### Chat de texto

- [ ] **CHAT-01**: Usuário envia mensagem de texto num canal
- [ ] **CHAT-02**: Mensagem aparece para os outros membros em menos de 500 ms
- [ ] **CHAT-03**: Usuário rola para cima e carrega histórico mais antigo sem a lista "pular"
- [ ] **CHAT-04**: Mensagem nova não rouba o scroll de quem está lendo histórico; aparece aviso de nova mensagem
- [ ] **CHAT-05**: Ao reabrir um canal, usuário vê divisor marcando a primeira mensagem não lida
- [x] **CHAT-14**: Ao abrir um canal, o scroll posiciona na primeira mensagem não lida — ou no fim da conversa, se tudo já foi lido
- [ ] **CHAT-06**: Sidebar mostra badge de contagem de não lidas por canal
- [ ] **CHAT-07**: Usuário vê indicação de quem está digitando, que expira sozinha

### Amigos e DMs

- [ ] **SOCIAL-01**: Usuário encontra outro pelo identificador `USER#123`
- [ ] **SOCIAL-02**: Usuário envia pedido de amizade
- [ ] **SOCIAL-03**: Usuário aceita ou recusa pedido de amizade recebido
- [ ] **SOCIAL-04**: Usuário vê sua lista de amigos com status online/offline
- [ ] **SOCIAL-05**: Usuário abre conversa direta com um amigo e troca mensagens
- [ ] **SOCIAL-06**: Usuário remove uma amizade

### Voz

- [x] **VOICE-01**: Usuário entra num canal de voz e ouve os outros participantes
- [ ] **VOICE-02**: Dez pessoas permanecem no mesmo canal com áudio estável
- [x] **VOICE-03**: Usuário sai do canal de voz
- [x] **VOICE-04**: Usuário que perde conexão ou fecha o app à força desaparece do canal para os outros
- [x] **VOICE-05**: Sidebar mostra quem está em cada canal de voz, mesmo para quem não entrou
- [x] **VOICE-06**: Usuário muta e desmuta o próprio microfone, e os outros veem o ícone
- [x] **VOICE-07**: Usuário ensurdece e desensurdece; ensurdecer também muta
- [x] **VOICE-08**: Avatar de quem está falando é destacado, sem piscar em micropausas
- [x] **VOICE-09**: Usuário escolhe entre transmissão por detecção de voz e push-to-talk
- [x] **VOICE-10**: Usuário ajusta o limiar de sensibilidade da detecção de voz
- [x] **VOICE-11**: Push-to-talk funciona com o app sem foco
- [x] **VOICE-12**: Preferência de transmissão persiste entre reinícios
- [x] **VOICE-13**: Usuário escolhe qual microfone e qual saída de áudio usar, com troca sem reconectar
- [x] **VOICE-14**: Usuário vê o estado da própria conexão de voz (conectando, conectado, reconectando)
- [x] **VOICE-15**: Usuário vê indicador de qualidade de conexão por participante
- [x] **VOICE-16**: Cancelamento de eco e supressão de ruído ativos na captura do microfone
- [x] **VOICE-17**: Som ao entrar e sair de canal, com opção de desligar
- [x] **VOICE-21**: Usuário vê o nível do próprio microfone em tempo real, com a marca do limiar do VAD
- [x] **VOICE-22**: O teste passa pelo servidor, provando a corrente completa sem depender de outra pessoa

### Compartilhamento de tela

- [ ] **SHARE-01**: Usuário escolhe qual tela ou janela compartilhar, com miniaturas
- [ ] **SHARE-02**: Outros participantes veem a tela compartilhada
- [ ] **SHARE-03**: Áudio do sistema de quem compartilha é ouvido pelos outros
- [ ] **SHARE-04**: Áudio da própria call não retorna como eco pela track de compartilhamento
- [ ] **SHARE-05**: Usuário para o compartilhamento e os outros voltam ao layout normal
- [ ] **SHARE-06**: Queda de quem compartilha devolve os outros ao layout normal, sem frame congelado
- [ ] **SHARE-07**: Cancelar o seletor de tela não impede uma nova tentativa na mesma sessão
- [ ] **SHARE-08**: Usuário escolhe entre priorizar fluidez e priorizar nitidez

### Aplicativo

- [ ] **APP-01**: Layout replica a estrutura do Discord: barra de servidores, sidebar de canais, área de conversa, lista de membros
- [ ] **APP-02**: Usuário vê status online/offline dos outros
- [ ] **APP-03**: Instalador Windows que pessoa não-técnica consegue executar
- [ ] **APP-04**: App abre em instância única, condição para o retorno do login funcionar

## v2 Requirements

### Chat

- **CHAT-08**: Editar e apagar mensagem própria
- **CHAT-09**: Reações a mensagens
- **CHAT-10**: Upload de arquivos e imagens
- **CHAT-11**: Markdown e blocos de código
- **CHAT-12**: Menção `@usuario` com autocomplete
- **CHAT-13**: Busca no histórico

### Voz

- **VOICE-18**: Volume individual por participante
- **VOICE-19**: Ping numérico em milissegundos
- **VOICE-20**: Supressão de ruído avançada (Krisp)

### Servidores

- **SRV-08**: Cargos e permissões granulares — a UI da Fase 8.5 deixa o lugar preparado, sem o conceito no backend

### Aplicativo

- **APP-05**: Status ausente automático por inatividade
- **APP-06**: Atualização automática do app
- **APP-07**: Notificações do sistema operacional

## Out of Scope

| Feature | Reason |
|---------|--------|
| Versão web | Captura de áudio de sistema exige `desktopCapturer` do Electron; navegador não entrega de forma confiável |
| macOS e Linux | macOS não expõe áudio de sistema sem driver virtual; Linux exige PipeWire e portal XDG. Nenhum usuário atual precisa |
| Roles e permissões granulares | Grupo de 10 pessoas que se conhecem não tem hierarquia. Multiplicaria a superfície de teste de autorização em cada mutation |
| Vídeo de webcam | O grupo compartilha tela, não rosto. Dobraria a complexidade de publish e o custo de banda da VPS |
| Notificações push | Exige serviço externo; o app fica aberto durante o uso |
| Limite de usuários por canal de voz | O objetivo do produto é ter 10 pessoas no mesmo canal; um limite só criaria um caso de erro sem cenário real |
| Mover usuário entre canais à força | Ferramenta de moderação; entre amigos, cada um muda de canal sozinho |
| Rich presence ("jogando X") | Exige integração por jogo ou detecção de processos, para um dado decorativo |
| Descoberta pública de servidores | Implicaria moderação de conteúdo, que não existe e não deveria existir aqui |
| Simulcast customizado no screenshare | Preset padrão do LiveKit basta para 10 pessoas conhecidas; tunar camadas consome CPU do SFU sem ganho proporcional |
| Federação e monetização | Não é produto |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Fase 1 | Pendente |
| INFRA-02 | Fase 1 | Pendente |
| INFRA-03 | Fase 1 | Pendente |
| INFRA-04 | Fase 1 | Pendente |
| AUTH-01 | Fase 2 | Pendente |
| AUTH-02 | Fase 2 | Pendente |
| AUTH-03 | Fase 2 | Pendente |
| AUTH-04 | Fase 2 | Pendente |
| AUTH-05 | Fase 2 | Pendente |
| AUTH-06 | Fase 2 | Pendente |
| AUTH-07 | Fase 9 | Pendente |
| SRV-01 | Fase 4 | Pendente |
| SRV-02 | Fase 4 | Pendente |
| SRV-03 | Fase 4 | Pendente |
| SRV-04 | Fase 4 | Pendente |
| SRV-05 | Fase 4 | Pendente |
| SRV-06 | Fase 4 | Pendente |
| SRV-07 | Fase 4 | Pendente |
| CHAT-01 | Fase 5 | Pendente |
| CHAT-02 | Fase 5 | Pendente |
| CHAT-03 | Fase 5 | Pendente |
| CHAT-04 | Fase 5 | Pendente |
| CHAT-05 | Fase 5 | Pendente |
| CHAT-14 | Fase 5 | Verificado 2026-08-19 |
| CHAT-06 | Fase 5 | Pendente |
| CHAT-07 | Fase 5 | Pendente |
| SOCIAL-01 | Fase 6 | Pendente |
| SOCIAL-02 | Fase 6 | Pendente |
| SOCIAL-03 | Fase 6 | Pendente |
| SOCIAL-04 | Fase 6 | Pendente |
| SOCIAL-05 | Fase 6 | Pendente |
| SOCIAL-06 | Fase 6 | Pendente |
| VOICE-01 | Fase 7 | Verificado 2026-08-19 |
| VOICE-02 | Fase 7 | Pendente — falta o teste com dez |
| VOICE-03 | Fase 7 | Verificado 2026-08-19 |
| VOICE-04 | Fase 7 | Verificado 2026-08-19 |
| VOICE-05 | Fase 7 | Verificado 2026-08-19 |
| VOICE-06 | Fase 7 | Verificado 2026-08-19 |
| VOICE-07 | Fase 7 | Verificado 2026-08-19 |
| VOICE-08 | Fase 7 | Verificado 2026-08-19 |
| VOICE-09 | Fase 7 | Verificado 2026-08-19 |
| VOICE-10 | Fase 7 | Verificado 2026-08-19 |
| VOICE-11 | Fase 7 | Verificado 2026-08-19 |
| VOICE-12 | Fase 7 | Verificado 2026-08-19 |
| VOICE-13 | Fase 7 | Verificado 2026-08-19 |
| VOICE-14 | Fase 7 | Verificado 2026-08-19 |
| VOICE-15 | Fase 7 | Verificado 2026-08-19 |
| VOICE-16 | Fase 7 | Verificado 2026-08-19 |
| VOICE-17 | Fase 7 | Verificado 2026-08-19 |
| VOICE-21 | Fase 7 | Verificado 2026-08-19 |
| VOICE-22 | Fase 7 | Verificado 2026-08-19 |
| SHARE-01 | Fase 8 | Pendente |
| SHARE-02 | Fase 8 | Pendente |
| SHARE-03 | Fase 8 | Pendente |
| SHARE-04 | Fase 8 | Pendente |
| SHARE-05 | Fase 8 | Pendente |
| SHARE-06 | Fase 8 | Pendente |
| SHARE-07 | Fase 8 | Pendente |
| SHARE-08 | Fase 8 | Pendente |
| APP-01 | Fase 3 | Pendente |
| APP-02 | Fase 4 | Pendente |
| APP-03 | Fase 9 | Pendente |
| APP-04 | Fase 0 | Pendente |

**Coverage:**
- v1 requirements: 63 total
- Mapped to phases: 63
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-18*
*Last updated: 2026-08-18 after roadmap creation*
