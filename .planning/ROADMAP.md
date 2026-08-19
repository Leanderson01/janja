# Roadmap: janja

## Overview

Dez fases levam o janja do repositório vazio a um instalador Windows que o grupo
usa no dia a dia. As três primeiras fases (F1, F2, F3) rodam em paralelo assim
que o bootstrap (F0) termina — infraestrutura de mídia, backend/auth e casca de
UI não dependem umas das outras. Servidores/canais (F4) e amigos/DMs (F6) sobem
juntos na sequência, seguidos por chat (F5) e voz (F7) em paralelo. Screenshare
(F8) só é validável numa máquina Windows nativa e fecha depois da voz estar
sólida. Polimento e empacotamento (F9) é a última fase, e depende de tudo.

O produto só está pronto quando o critério central do projeto é verdadeiro: dez
pessoas ficam num canal de voz e compartilham tela com áudio, de forma estável o
bastante para abandonar o Discord. F7 e F8 são as fases que decidem isso — todo
o resto existe para sustentá-las.

## Phases

**Numeração de fases:**
- Fases inteiras (1, 2, 3...): trabalho de marco planejado
- Fases decimais (2.1, 2.2): inserções urgentes (marcadas com INSERTED)

- [ ] **Fase 0: Bootstrap do repo** - Scaffold do app Electron, instância única
- [ ] **Fase 1: LiveKit na VPS** - Infra de voz/mídia acessível de qualquer rede
- [ ] **Fase 2: Convex + auth WorkOS** - Login com Google, sessão resiliente
- [ ] **Fase 3: Shell da UI** - Layout Discord estático, sem dados reais
- [ ] **Fase 4: Servidores e canais** - Criar servidor, convidar, canais, membros
- [ ] **Fase 5: Chat em tempo real** - Mensagens, histórico, não lidas, digitando
- [ ] **Fase 6: Amigos e DMs** - Busca por USER#123, pedidos, conversa direta
- [ ] **Fase 7: Voz** - Call estável de 10 pessoas, controles completos
- [ ] **Fase 8: Compartilhamento de tela** - Tela + áudio de sistema sem eco
- [ ] **Fase 9: Polimento e empacotamento** - Instalador Windows, regressão final

## Paralelismo

```
Onda A  F0  Bootstrap do repo                       (bloqueia tudo)

Onda B  F1  LiveKit na VPS                          ┐
        F2  Convex + auth WorkOS                    ├ 3 em paralelo
        F3  Shell da UI (estático, sem dados)        ┘

Onda C  F4  Servidores + canais                     ┐ 2 em paralelo
        F6  Amigos + DMs                             ┘

Onda D  F5  Chat em tempo real                       ┐ 2 em paralelo
        F7  Voz (LiveKit)                             ┘

Onda E  F8  Screenshare + áudio de sistema           (exige Windows nativo)

Onda F  F9  Polimento e empacotamento                (depende de tudo)
```

**F1 é totalmente independente do código do app** — pode começar imediatamente,
em paralelo ao bootstrap, já que só precisa da VPS e do domínio.

### Dependências por fase

| Fase | Depende de | Motivo |
|---|---|---|
| F0 | — | Primeira fase |
| F1 | — (só precisa da VPS) | Infra desacoplada do app |
| F2 | F0 | Precisa do processo main/preload existir |
| F3 | F0 | Precisa do shell Electron existir |
| F4 | F2, F3 | Precisa de auth (quem é o dono) e da UI onde os dados aparecem |
| F6 | F2 | Precisa de auth (identidade `USER#123`); não depende de F3/F4 |
| F5 | F4 | Chat vive dentro de um canal de um servidor |
| F7 | F1, F4 | Precisa da infra de mídia e do canal de voz existir como entidade |
| F8 | F7 | Screenshare é publicado na mesma sala de voz já conectada |
| F9 | F0-F8 | Empacota e testa o produto completo |

## Ajustes em relação ao design aprovado (§9)

O design aprovado lista F9 como "Presença, settings, packaging". Ao mapear os 59
requisitos, presença online/offline (`APP-02`, `SOCIAL-04`) é requisito v1, não
polimento — adiá-la para a última fase deixaria F4 (lista de membros) e F6
(lista de amigos) incompletas até o fim do projeto. A infraestrutura de presença
(escrita da tabela `presence` a partir da sessão autenticada) entra em F2, junto
do resto do estado de auth; a exibição entra em F4 (lista de membros) e F6
(lista de amigos), onde os requisitos realmente vivem. F9 foi renomeada para
"Polimento e empacotamento" e carrega o instalador (`APP-03`) e a regressão
final do roteiro completo — o que o design original chamava de "settings" já
está distribuído: preferências de voz em F7, layout em F3.

`APP-04` (instância única) foi movida de "Aplicativo" (categoria pensada para
polimento) para F0: é precondição técnica para `AUTH-01` funcionar no Windows,
já que o retorno do OAuth chega pelo evento `second-instance`, que só existe se
`requestSingleInstanceLock` estiver ativo desde a primeira janela. Colocá-la em
F9 quebraria o login antes mesmo de F2 rodar.

## Phase Details

### Fase 0: Bootstrap do repo
**Goal**: O app Electron abre numa janela única, pronto para receber código de
produto.
**Depends on**: Nada (primeira fase)
**Requirements**: APP-04
**Success Criteria** (o que precisa ser verdade):
  1. Repositório clonado roda em modo dev (`electron-vite`) sem passos manuais
     além de instalar dependências.
  2. App abre uma janela Electron vazia (shell), sem crash.
  3. Abrir o app uma segunda vez não cria uma nova janela: a instância existente
     ganha foco (`requestSingleInstanceLock` ativo desde o primeiro commit).
**Plans**: 4 plans

Plans:
- [ ] 00-01-scaffold-seguro-do-app-PLAN.md — Scaffold electron-vite react-ts gerado em diretório temporário fora do repo e copiado com verificação de integridade; Electron pinado em 43.4.0 exato
- [ ] 00-02-tailwind-e-shadcn-PLAN.md — Tailwind v4 + shadcn/ui no renderer, com components.json manual (o CLI do shadcn não detecta electron.vite.config.ts)
- [ ] 00-03-instancia-unica-e-hardening-PLAN.md — requestSingleInstanceLock + second-instance, contextIsolation/nodeIntegration explícitos, doc de dev no WSL2
- [ ] 00-04-verificacao-final-PLAN.md — Reverificação de integridade do repo + checkpoint humano dos 3 critérios de sucesso

### Fase 1: LiveKit na VPS
**Goal**: A infraestrutura de mídia está no ar, alcançável de qualquer rede, e
sobrevive a reboot — sem depender de nenhuma linha de código do app.
**Depends on**: Nada (independente; pode rodar em paralelo a F0)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04
**Success Criteria** (o que precisa ser verdade):
  1. Um cliente WebRTC conecta em `wss://livekit.usesenju.com` com certificado
     TLS válido, sem aviso de segurança do navegador/Chromium.
  2. A partir de uma rede restritiva de verdade — hotspot 4G com CGNAT, não a
     rede de casa — a mídia flui via TURN/TLS: um candidato `relay` aparece
     selecionado em `chrome://webrtc-internals`.
  3. Os candidatos ICE anunciados pelo servidor usam o IP público da VPS
     (`use_external_ip: true`), alcançáveis de fora da própria VPS.
  4. Depois de reiniciar a VPS, o LiveKit volta a responder sozinho, sem
     intervenção manual.
**Plans**: 2 plans

Plans:
- [ ] 01-01-config-livekit-PLAN.md — livekit.yaml (mux de porta UDP única), docker-compose para recurso do Coolify, .env.example, dns-multi.ini.example e script de certificado do TURN via DNS-01
- [ ] 01-02-runbook-e-deploy-PLAN.md — Runbook: token da Hostinger, DNS, firewall, certificado do TURN, cron de renovação, criação do recurso no Coolify, deploy e os 4 testes de validação + checkpoint humano na VPS

### Fase 2: Convex + auth WorkOS
**Goal**: Usuário entra com a conta Google e a sessão se sustenta durante uso
real, incluindo calls longas — sem travar em estado não-autenticado.
**Depends on**: Fase 0
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06
**Success Criteria** (o que precisa ser verdade):
  1. Usuário pede login, autentica no navegador do sistema (não numa
     `BrowserWindow`) e volta autenticado ao app pelo retorno em `janja://`.
  2. Fechar e reabrir o app mantém o usuário logado, sem pedir login de novo.
  3. Corromper ou apagar a credencial local (`safeStorage`) não trava nem gera
     tela branca: o usuário cai na tela de login.
  4. Uma sessão de 30+ minutos de uso contínuo (simulando uma call) não trava
     em `isAuthenticated: false` — TTL do access token do WorkOS elevado para
     8-12h, com log local para detectar o bug documentado se ele aparecer.
  5. Usuário sai da conta pelo app e volta à tela de login; o primeiro login de
     um novo usuário gera `username#tag` único, exibido a ele.
**Plans**: 9 plans

Plans:
- [ ] 02-01 — Schema do Convex (users, presence) + auth.config.ts
- [ ] 02-02 — Núcleo do OAuth no processo main (PKCE, safeStorage, refresh)
- [ ] 02-03 — Registro do protocolo janja:// + IPC + preload
- [ ] 02-04 — Criação do projeto Convex e env vars (checkpoint humano)
- [ ] 02-05 — Geração de username#tag com retry de colisão (TDD)
- [ ] 02-06 — Heartbeat de presença
- [ ] 02-07 — Hook useAuth + adaptador ConvexProviderWithAuth
- [ ] 02-08 — LoginScreen, AuthGate e AuthWatchdog
- [ ] 02-09 — Verificação ponta a ponta no Windows (checkpoint humano)

### Fase 3: Shell da UI
**Goal**: A estrutura visual do Discord existe e responde à navegação, mesmo
sem nenhum dado real ainda.
**Depends on**: Fase 0
**Requirements**: APP-01
**Success Criteria** (o que precisa ser verdade):
  1. Usuário vê barra de servidores, sidebar de canais, área de conversa e
     lista de membros dispostos na mesma estrutura do Discord.
  2. Redimensionar a janela não quebra o layout.
  3. Navegar entre servidor/canal fictícios (dados estáticos) muda a área de
     conversa sem exigir nenhum backend.
**Plans**: 5 plans

Plans:
- [ ] 03-01-fundacao-layout-e-dados-mock-PLAN.md — Dados mockados + contexto de seleção + esqueleto de 4 regiões + barra de servidores
- [ ] 03-02-sidebar-de-canais-PLAN.md — Sidebar de canais (categorias, badge de não lidas, voz aninhada) + rodapé de controles de voz
- [ ] 03-03-area-de-conversa-PLAN.md — Área de conversa (chat mockado, divisor de não lidas, visão de voz + placeholder de screenshare)
- [ ] 03-04-lista-de-membros-PLAN.md — Lista de membros agrupada por status com overlay de voz
- [ ] 03-05-verificacao-e-janela-minima-PLAN.md — Tamanho mínimo de janela + verificação humana do shell completo

### Fase 4: Servidores e canais
**Goal**: Usuário cria e administra um servidor com convite, canais e controle
de acesso — e vê quem está nele.
**Depends on**: Fase 2, Fase 3
**Requirements**: SRV-01, SRV-02, SRV-03, SRV-04, SRV-05, SRV-06, SRV-07, APP-02
**Success Criteria** (o que precisa ser verdade):
  1. Usuário cria um servidor e aparece como dono dele.
  2. Dono gera um código de convite reutilizável; outro usuário entra no
     servidor usando esse código.
  3. Dono revoga o convite e o código para de funcionar para novos ingressos
     (quem já entrou continua dentro).
  4. Membro cria canais de texto e de voz dentro do servidor; não-membro não
     consegue ler nem escrever em nenhum canal dele.
  5. Usuário vê a lista de membros do servidor, cada um com status
     online/offline.
**Plans**: 8 plans

Plans:
- [x] 04-01 — Schema (servers, serverMembers, invites, channels) + helper de autorização
- [x] 04-02 — Convites: gerar, revogar, entrar por código (TDD)
- [x] 04-03 — Canais de texto e voz (TDD, com teste direto de SRV-06)
- [x] 04-04 — Membros e presença (TDD)
- [x] 04-05 — Navegação real de servidores + diálogo de criar/entrar
- [x] 04-06 — Canais reais na sidebar + diálogos de canal e convite
- [x] 04-07 — Lista de membros sobre dado real
- [ ] 04-08 — Verificação humana no Windows (checkpoint)

### Fase 5: Chat em tempo real
**Goal**: Um canal de texto se comporta como um chat de verdade: rápido,
navegável, e claro sobre o que já foi lido.
**Depends on**: Fase 4
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07
**Success Criteria** (o que precisa ser verdade):
  1. Mensagem enviada num canal aparece para os outros membros em menos de
     500 ms.
  2. Usuário rola para cima e o histórico mais antigo carrega sem a lista
     "pular" de posição, mesmo com mensagens novas chegando durante a carga.
  3. Mensagem nova não rouba o scroll de quem está lendo histórico antigo; em
     vez disso aparece um aviso de mensagem nova.
  4. Reabrir um canal mostra um divisor na primeira mensagem não lida, e a
     sidebar mostra a contagem de não lidas por canal.
  5. Indicação de "fulano está digitando" aparece durante a digitação e some
     sozinha depois de um tempo sem eventos.
**Plans**: 6 plans

Plans:
- [x] 05-01 — Schema (messages, channelReadState, typing) + envio e listagem (TDD)
- [x] 05-02 — Não lidas no backend: abrir canal, divisor e contagem (TDD)
- [x] 05-03 — Digitando no backend, sem TTL de servidor por decisão (TDD)
- [x] 05-04 — Lista de mensagens, âncora de scroll e badge de não lidas
- [ ] 05-05 — Indicador de digitando
- [ ] 05-07 — Posição inicial do scroll ao abrir um canal (defeito encontrado na verificação)
- [ ] 05-06 — Verificação com duas contas no Windows, com método de medir os 500 ms

### Fase 6: Amigos e DMs
**Goal**: Usuário encontra amigos pela identidade única do app e conversa em
privado com eles, fora de qualquer servidor.
**Depends on**: Fase 2 (não depende de F3 nem F4 — pode rodar junto de F4)
**Requirements**: SOCIAL-01, SOCIAL-02, SOCIAL-03, SOCIAL-04, SOCIAL-05, SOCIAL-06
**Success Criteria** (o que precisa ser verdade):
  1. Usuário encontra outro pelo identificador `USER#123` e envia pedido de
     amizade.
  2. Destinatário vê o pedido e aceita ou recusa.
  3. Lista de amigos mostra status online/offline de cada um.
  4. Usuário abre uma conversa direta com um amigo e troca mensagens com ele.
  5. Usuário remove uma amizade existente.
**Plans**: 8 plans

Plans:
- [x] 06-01 — Schema (5 tabelas) + busca por USER#123
- [x] 06-02 — Pedidos de amizade: enviar, aceitar, recusar (TDD)
- [x] 06-03 — Lista de amigos com presença + remoção
- [x] 06-04 — Canal e mensagens de DM (TDD)
- [x] 06-05 — Listagem e paginação de DMs
- [x] 06-06 — Navegação Home + painel de amigos
- [x] 06-07 — Conversa direta
- [ ] 06-08 — Verificação com duas contas no Windows (checkpoint)

### Fase 7: Voz
**Goal**: Dez pessoas ficam num canal de voz por tempo real de uso (30+ min)
com áudio estável, controles completos, e o estado do canal nunca mente sobre
quem está realmente conectado.
**Depends on**: Fase 1, Fase 4
**Requirements**: VOICE-01, VOICE-02, VOICE-03, VOICE-04, VOICE-05, VOICE-06,
VOICE-07, VOICE-08, VOICE-09, VOICE-10, VOICE-11, VOICE-12, VOICE-13, VOICE-14,
VOICE-15, VOICE-16, VOICE-17
**Success Criteria** (o que precisa ser verdade):
  1. Usuário entra num canal de voz e ouve os outros participantes; dez pessoas
     permanecem no mesmo canal por 30+ minutos com áudio estável.
  2. Usuário sai do canal e some da lista para os outros; se o app cair à força
     (matar processo, perda de rede) o usuário também some do canal em
     segundos — via reconciliação dos webhooks do LiveKit
     (`participant_left`/`participant_connection_aborted`/`room_finished`)
     corrigindo `voiceStates`, não por ação do cliente. Nenhum usuário-fantasma
     sobrevive a esse teste.
  3. Sidebar mostra quem está em cada canal de voz mesmo para quem não entrou;
     mute e deafen de cada participante são visíveis aos outros pelo ícone; o
     avatar de quem fala é destacado sem piscar em micropausas de fala.
  4. Usuário escolhe entre transmissão por detecção de voz (com limiar
     ajustável) e push-to-talk — que funciona mesmo com o app sem foco — e essa
     preferência persiste entre reinícios do app.
  5. Usuário troca microfone e dispositivo de saída sem precisar reconectar à
     sala; vê o próprio estado de conexão (conectando/conectado/reconectando) e
     a qualidade de conexão de cada participante; a captura tem cancelamento de
     eco e supressão de ruído ativos; sons de entrada/saída de canal existem e
     podem ser desligados.
**Plans**: 9 plans

Plans:
- [x] 07-00 — Credenciais do LiveKit no Convex (checkpoint humano)
- [x] 07-01 — Schema voiceStates + join/leave/mute/deafen com autorização (TDD)
- [ ] 07-02 — Webhook de reconciliação — o antídoto do usuário-fantasma (TDD)
- [ ] 07-03 — Conexão real do cliente LiveKit
- [ ] 07-04 — Presença de participantes, indicador de fala e qualidade de conexão
- [ ] 07-05 — VAD, seleção de dispositivo e preferências persistentes
- [ ] 07-06 — Push-to-talk com uiohook-napi (módulo nativo)
- [ ] 07-07 — Sons de entrada e saída de canal
- [ ] 07-09 — Testador de microfone: nível de entrada, retorno local e volta pelo servidor
- [ ] 07-08 — Verificação final no Windows com 10 pessoas (checkpoint)

**Nota de dependência cruzada**: push-to-talk (VOICE-11) exige o módulo nativo
`uiohook-napi` no processo main, porque `globalShortcut` do Electron não expõe
`keydown`/`keyup` separados. Isso afeta o empacotamento em F9 — o instalador
precisa embutir o binário nativo certo para a arquitetura alvo, não só o
código JS. Validar em F7 que funciona em dev não garante que sobrevive ao
empacotamento; reverificar em F9.

### Fase 8: Compartilhamento de tela
**Goal**: Usuário compartilha tela com áudio de sistema, sem eco da própria
call, e o app se recupera de quedas do apresentador sem travar a experiência
dos outros. **Validável apenas em máquina Windows nativa — não em WSL2.**
**Depends on**: Fase 7
**Requirements**: SHARE-01, SHARE-02, SHARE-03, SHARE-04, SHARE-05, SHARE-06,
SHARE-07, SHARE-08
**Success Criteria** (o que precisa ser verdade — testado numa máquina Windows
nativa, nunca só no ambiente de desenvolvimento WSL2):
  1. Usuário escolhe qual tela ou janela compartilhar a partir de miniaturas
     (picker construído sobre `desktopCapturer`, já que o Electron não tem um
     nativo); os outros participantes veem a tela compartilhada.
  2. Áudio do sistema de quem compartilha é ouvido pelos outros, e a própria
     voz da call não retorna como eco pela track de compartilhamento — validado
     com Electron >= 43.4.0 e `restrictOwnAudio: true`, testado com 3+ máquinas
     reais (não 2), porque eco é o critério de sucesso #2 do projeto.
  3. Usuário para o compartilhamento, ou cancela o seletor de tela, e os outros
     voltam ao layout normal sem travar; uma nova tentativa de compartilhar na
     mesma sessão continua funcionando (handler chama `callback()` em 100% dos
     caminhos, incluindo cancelamento e lista de fontes vazia).
  4. Se quem compartilha cai ou fecha o app à força, os outros voltam ao
     layout normal sem frame congelado.
  5. Usuário escolhe entre priorizar fluidez ou nitidez ao compartilhar.
**Plans**: 7 plans

Plans:
- [ ] 08-01 — setSharing no Convex, estendendo o mesmo webhook da F7 (TDD)
- [ ] 08-02 — Núcleo mínimo de captura: desktopCapturer + handler defensivo + restrictOwnAudio
- [ ] 08-03 — Checkpoint Windows com 3+ máquinas: prova de áudio sem eco (antes de qualquer UI)
- [ ] 08-04 — Seletor de tela próprio, com miniaturas e tratamento de cancelamento
- [ ] 08-05 — Alternância de qualidade e sincronização de voiceStates.sharing
- [ ] 08-06 — Lado receptor: renderização do vídeo e indicadores de quem compartilha
- [ ] 08-07 — Checkpoint Windows final: SHARE-01..08 completo

### Fase 8.5: Repaginação da UI
**Goal**: A interface deixa de ser "layout correto" e passa a ser interface acabada:
responsiva, acessível e consistente nas convenções de composição.
**Depends on**: Fase 8 (toca os mesmos componentes que F4-F7 estão ligando a dado real)
**Requirements**: a definir no planejamento — o brief traz itens fora do v1 atual
**Brief**: `.planning/phases/08.5-repaginacao-da-ui/08.5-BRIEF.md`
**Cargos**: decidido em 2026-08-18 — ficam para o v2. Esta fase prepara a interface
estruturalmente para recebê-los, sem introduzir o conceito em schema, query, mutation
ou tipo. Ver o brief para o recorte exato entre preparar e construir.
**Plans**: TBD

### Fase 9: Polimento e empacotamento
**Goal**: Uma pessoa não-técnica instala o app com poucos cliques, e o roteiro
completo (login → servidor → chat → voz → screenshare) funciona numa instalação
limpa, do zero, incluindo os módulos nativos empacotados.
**Depends on**: Fase 0 até Fase 8 (todas)
**Requirements**: APP-03, AUTH-07
**Success Criteria** (o que precisa ser verdade):
  1. Instalador Windows roda com poucos cliques numa máquina limpa, sem exigir
     conhecimento técnico nem passos manuais de configuração.
  1b. Ao concluir o login, a aba do navegador mostra uma página de confirmação
     dizendo que pode ser fechada, em vez de deixar o usuário olhando para a
     página interna do provedor de autenticação sem saber se deu certo.
  2. Push-to-talk (VOICE-11) continua funcionando no executável empacotado —
     `uiohook-napi` compilado e embutido corretamente para a arquitetura alvo,
     não só validado em modo dev.
  3. O roteiro fixo completo (login com Google, criar/entrar em servidor,
     trocar mensagens, entrar em canal de voz com 10 pessoas, compartilhar
     tela com áudio) passa de ponta a ponta numa instalação limpa.
**Plans**: 3 plans

Plans:
- [ ] 09-01 — postinstall do binário do Electron, asarUnpack do módulo nativo, NSIS, checagem de vazamento de segredo
- [ ] 09-02 — AUTH-07: página de conclusão de login via HTTP action do Convex, e correção do throw em escopo de módulo do convex-client
- [ ] 09-03 — Checkpoints: config no WorkOS, instalador em máquina limpa, e regressão final com 10 pessoas

## Progress

**Execution Order:**
Fases executam em ordem numérica: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
(respeitando as ondas de paralelismo descritas acima quando executadas por
implementadores distintos).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Bootstrap do repo | 4/4 | Complete | 2026-08-18 |
| 1. LiveKit na VPS | 2/2 | Complete | 2026-08-18 |
| 2. Convex + auth WorkOS | 9/9 | Complete | 2026-08-18 |
| 3. Shell da UI | 5/5 | Complete | 2026-08-18 |
| 4. Servidores e canais | 7/8 | Aguardando verificação humana | - |
| 5. Chat em tempo real | 5/7 | In progress | - |
| 6. Amigos e DMs | 7/8 | Aguardando verificação humana | - |
| 7. Voz | 3/10 | In progress | - |
| 8. Compartilhamento de tela | 0/7 | Planned | - |
| 8.5. Repaginação da UI | 0/TBD | Brief registrado | - |
| 9. Polimento e empacotamento | 0/3 | Planned | - |

---
*Roadmap created: 2026-08-18*
