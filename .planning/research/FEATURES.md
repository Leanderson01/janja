# Feature Research

**Domain:** Cliente desktop de chat + voz estilo Discord, para grupo fechado de ~10 pessoas
**Researched:** 2026-08-18
**Confidence:** MEDIUM-HIGH (capacidades do LiveKit verificadas em docs.livekit.io; semântica de UX do Discord é conhecimento de comunidade/observação, não documentação oficial — marcado caso a caso)

> Este arquivo cobre o que **construir** e como categorizar. Para armadilhas de
> implementação (eco, ghost user em voiceStates, debounce de "falando",
> `WDA_EXCLUDEFROMCAPTURE`, etc.) ver `.planning/research/PITFALLS.md` — não
> duplicado aqui, apenas referenciado onde relevante.

## Feature Landscape

### Table Stakes (Users Expect These)

Estas são as features cujo comportamento fino é o que o grupo vai notar no
primeiro dia de uso — não a existência da feature, mas o **detalhe de
comportamento** dela. Faltar o detalhe é pior do que faltar a feature inteira,
porque parece bug em vez de "ainda não implementado".

| Feature | Comportamento esperado | Complexidade | Dependências |
|---------|------------------------|------------|-------|
| **Push-to-talk (PTT)** | Tecla global (funciona com app sem foco), keydown ativa mic imediatamente, keyup desativa. **Electron `globalShortcut` não expõe keydown/keyup separado** — só dispara um callback no press completo, inadequado para "segurar para falar" (verificado: [Electron docs](https://www.electronjs.org/docs/latest/api/global-shortcut), issues #26301/#8491). Precisa de hook nativo de teclado (`uiohook-napi`, expõe `keydown`/`keyup` reais) rodando no processo main. | HIGH | Electron main (native hook) + LiveKit (`localParticipant.setMicrophoneEnabled`) |
| **Voice Activity Detection (VAD) com sensibilidade** | Alternativa ao PTT: mic ativa sozinho ao detectar voz, com slider de limiar (threshold) ajustável — mic ruim ou ambiente barulhento precisa de limiar mais alto. LiveKit expõe `audioLevel` (0–1.0) por participante via `Participant`, mas o **limiar é decisão do app**, não vem pronto — implementar com `Web Audio API` (`AnalyserNode`) sobre o `MediaStreamTrack` local, comparando contra o threshold antes de habilitar a track. Sem essa opção, quem tem ventilador/teclado mecânico barulhento ativa o mic sem querer o tempo todo — é o motivo nº1 de reclamação em apps de voz. | HIGH | Renderer (Web Audio API) + LiveKit (track publish/mute) |
| **Toggle PTT vs VAD, persistente por usuário** | Configuração local (não faz sentido guardar no Convex — é preferência de hardware/ambiente da máquina), sobrevive a reinício do app. | LOW | Electron (armazenamento local, `electron-store` ou similar) |
| **Cancelamento de eco + supressão de ruído básicos** | WebRTC entrega isso nativamente via `echoCancellation`, `noiseSuppression`, `autoGainControl` em `AudioCaptureOptions` — **grátis, sem plugin, mas precisa ser setado explicitamente** ao publicar a track de áudio (não é ligado por padrão em todo contexto). Confirmado em [docs.livekit.io — Noise & echo cancellation](https://docs.livekit.io/transport/media/noise-cancellation/): "built-in outbound noise and echo cancellation based on the WebRTC implementations". Suficiente para o grupo de 10 amigos; qualidade "boa o bastante", não "estúdio". | LOW | LiveKit (client SDK, `AudioCaptureOptions`) |
| **Indicador visual de "está falando"** | Anel/glow no avatar de quem está falando, atualizado com latência baixa (~100–300ms), sem "piscar" a cada micropausa. LiveKit expõe `ActiveSpeakersChanged` (room) e `IsSpeakingChanged` (participant), calculado a partir do `audioLevel`. **Debounce necessário** — ver `PITFALLS.md` (UX Pitfalls, linha 1: indicador pisca sem debounce). | MEDIUM | LiveKit (eventos) |
| **Mute e deafen com semântica correta** | Convenção estabelecida pelo Discord (conhecimento de comunidade, não doc oficial — MEDIUM confidence): **deafen implica mute** — ao ensurdecer, o próprio mic também é desabilitado, e os outros veem os dois ícones (mutado + ensurdecido) simultaneamente. Destravar o mic sozinho (unmute) enquanto ainda ensurdecido é um estado válido em algumas implementações mas confuso (fala sem ouvir ninguém) — **decisão de design explícita necessária**: recomenda-se que unmute enquanto deafened também remova o deafen (evita o estado "falando no vácuo"). Os outros participantes só veem o ícone de **mute**, nunca sabem se alguém está deafened (é estado local/privado). | MEDIUM | Convex (`voiceStates.muted/deafened`) + LiveKit (track enable/disable local) — ver `PITFALLS.md` sobre reconciliar estado após reconexão |
| **Estados de conexão de voz visíveis** | Mínimo: Conectando → Conectado → Reconectando → (Falhou/Desconectado). LiveKit `ConnectionState` enum expõe exatamente isso: `Connecting`, `Connected`, `Reconnecting`, `Disconnected`, `SignalReconnecting` (confirmado em [RoomEvent docs](https://docs.livekit.io/home/client/events/)). Sem esse feedback, usuário não sabe se o silêncio é "rede caiu" ou "ninguém está falando" — ambíguo e frustrante. | MEDIUM | LiveKit (`Room.on(RoomEvent.ConnectionStateChanged)`) |
| **Indicador de qualidade de conexão por participante** | LiveKit `ConnectionQualityChanged` reporta valores qualitativos: `Excellent`, `Good`, `Poor`, `Lost`, `Unknown` (derivado de perda de pacote, latência e jitter — confirmado em docs). **Não existe "ping em ms" pronto** como no Discord — para número exato em ms seria preciso puxar `roundTripTime` de `VideoSenderStats` via `getStats()` de baixo nível, manualmente. Recomendação: usar os 4 níveis qualitativos (barras de sinal) em vez de tentar replicar o número em ms do Discord — mais simples e já cobre o caso de uso ("minha conexão está ruim?"). | MEDIUM | LiveKit (`ConnectionQuality` enum) |
| **Seleção de dispositivo de entrada (microfone)** | Listar via `Room.getLocalDevices('audioinput')`, trocar com `room.switchActiveDevice('audioinput', deviceId)` — troca a track ativa sem precisar desconectar/reconectar da sala. Confirmado no client SDK JS. | LOW-MEDIUM | LiveKit (client SDK) |
| **Seleção de dispositivo de saída (fone/alto-falante)** | Mesma API cobre isso (`switchActiveDevice('audiooutput', ...)`), mas a limitação real é do **browser/Chromium**: elementos `<audio>` precisam de `setSinkId()` individualmente — não é automático para toda track remota já renderizada. Precisa garantir que todo elemento de áudio criado pelo app respeita o dispositivo selecionado, inclusive quando um novo participante entra depois da troca de dispositivo. | MEDIUM | LiveKit (client SDK) + renderer (gerenciar elementos `<audio>`) |
| **Sons de entrar/sair de canal de voz** | Toca só para quem já está no canal (não para o servidor todo), distingue "eu entrei" de "alguém entrou", tem toggle para desligar (irritante em uso prolongado), e não deve repetir em loop se a reconexão automática entrar/sair rapidamente (relacionado ao ghost-user de `PITFALLS.md` Pitfall 3 — reconciliar antes de disparar som). | LOW | Convex (`voiceStates` reativo, diff de entrada/saída) + Electron/renderer (tocar áudio) |
| **Scrollback com paginação e "jump to bottom"** | Ao rolar para cima lendo histórico, novas mensagens **não** devem auto-scrollar a tela (perde o lugar de leitura); em vez disso, mostrar botão flutuante "novas mensagens ↓" / pílula de contagem. Auto-scroll só se o usuário já estava no fim. Ver `PITFALLS.md` (Performance Traps: paginação reativa "pulando" com `usePaginatedQuery`) — o mesmo mecanismo de paginação usado para carregar histórico é o que causa esse bug se mal tratado. | MEDIUM | Convex (`usePaginatedQuery`, índice `by_channel`) |
| **Divisor de mensagens não lidas** | Marca visual ("─── NOVAS MENSAGENS ───") na primeira mensagem não lida ao reabrir um canal. **Gap de schema identificado**: o schema atual do Convex (ver `PROJECT.md` §5 / design §5) não tem tabela de "último lido por usuário por canal" — só existe `messages` e `channels`. Para implementar esse divisor (ou badge de não-lidos no sidebar) é necessário **adicionar uma tabela nova** (ex: `channelReadState: channelId·, userId·, lastReadAt/lastReadMessageId`), não é extensão trivial de uma tabela existente. Sinalizar para a fase de schema/roadmap. | MEDIUM-HIGH | Convex (schema novo, não coberto no design atual) |
| **Indicador de "está digitando"** | Efêmero, expira sozinho após alguns segundos de inatividade mesmo sem evento explícito de "parou de digitar" (mesma classe de problema do ghost-user em voz — cliente pode crashar no meio de "digitando", ver `PITFALLS.md` Pitfall 3 por analogia). Padrão comum: mutation de "estou digitando" com TTL curto, ou reaproveitar padrão de heartbeat como o de presença (`@convex-dev/presence`, já citado em `PITFALLS.md` Performance Traps). | LOW-MEDIUM | Convex (mutation efêmera ou componente de presence) |
| **Screenshare: presenter sai/desconecta** | Quando quem compartilha sai (crash, fecha app, para o compartilhamento), os outros clientes devem **voltar ao layout normal automaticamente**, não ficar com o último frame congelado. LiveKit emite `TrackUnpublished`/`ParticipantDisconnected` para isso — mas o `voiceStates.sharing` no Convex também precisa ser reconciliado (mesma classe de problema do Pitfall 3: se só o LiveKit souber que a track sumiu e o Convex não for atualizado, a UI que lê `voiceStates` mostra "compartilhando" indefinidamente). | MEDIUM | LiveKit (eventos) + Convex (reconciliar `voiceStates.sharing`) |
| **Escolha de tela/janela para compartilhar (picker)** | Electron **não** tem um seletor nativo de tela/janela — diferente do browser, que mostra o picker do próprio SO. `desktopCapturer.getSources({types: ['screen','window'], thumbnailSize})` retorna a lista com thumbnails; a UI do picker precisa ser **construída do zero** dentro do app (confirmado: [Electron docs — desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer), "doesn't provide a desktop picker dialog"). Isso é usado dentro do `setDisplayMediaRequestHandler` (ver `PITFALLS.md` Pitfall 2, sobre cancelamento travando a próxima tentativa). | MEDIUM-HIGH | Electron main (`desktopCapturer`) + renderer (UI custom) |
| **Qualidade/framerate do screenshare** | Bandwidth caseiro brasileiro é risco identificado no próprio design (`design.md` §10). LiveKit usa `VideoPresets` predefinidos (resolução + framerate + bitrate combinados) — expor como toggle simples ("Fluida" ~15fps vs "Nítida" ~30fps) em vez de sliders técnicos crus. `max_bitrate`/`max_framerate` devem ser setados juntos (exigido pela API, já citado em `PITFALLS.md` Performance Traps). | MEDIUM | LiveKit (`TrackPublishOptions`, `VideoPresets`) |
| **Sidebar de voz mostrando quem está em qual canal** | Assinatura visual do layout Discord (o design já decide clonar esse layout): lista de canais de voz mostra avatares dos participantes atuais aninhados sob o nome do canal, mesmo para quem não entrou ainda — permite decidir "entro ou não" antes de conectar. Depende só de `voiceStates` já ser reativo (sem custo extra de mídia). | LOW-MEDIUM | Convex (`voiceStates` subscription) |
| **Link/código de convite para servidor** | PROJECT.md lista "criar servidores e entrar por convite" como requisito, mas **o schema atual não tem tabela de convites** (`servers`, `serverMembers` existem; não há `invites: code·, serverId, createdBy, expiresAt?, maxUses?`). Decisão de comportamento necessária: convite permanente vs expira vs uso único — Discord por padrão usa convites que expiram em 7 dias e têm limite de usos opcional; para 10 amigos fixos, **convite permanente de uso único por vínculo administrativo é suficiente** (ninguém precisa gerenciar múltiplos convites ativos). Recomenda-se o caminho mais simples: um único convite reutilizável e revogável por servidor. | LOW-MEDIUM | Convex (schema novo) |

### Differentiators (Competitive Advantage)

Não são esperadas por padrão vindo do Discord, mas fazem sentido dado o
contexto específico (grupo pequeno, self-hosted, sem custo de licença) e podem
ser adicionadas sem redesenhar nada.

| Feature | Value Proposition | Complexidade | Notas |
|---------|-------------------|------------|-------|
| **Supressão de ruído avançada (Krisp / `@livekit/krisp-noise-filter`)** | Muito melhor que `noiseSuppression` nativo do WebRTC para ruído não estacionário (teclado, cachorro latindo, trânsito) — adiciona ~15–25ms de latência de processamento (confirmado em docs.livekit.io). | MEDIUM | **Tensão com a constraint de budget do projeto** (`PROJECT.md`: "nenhum serviço pago novo") — a doc do LiveKit cita explicitamente que o Krisp "incurs licensing fees". Avaliar custo real antes de adotar; sem confirmação de preço para uso self-hosted em baixo volume, tratar como diferenciador condicional, não commitment de roadmap. |
| **Volume individual por usuário** | Slider "abaixar o volume só dessa pessoa" sem mutá-la — útil quando alguém tem mic mais alto que os outros. Discord tem isso; não é difícil de implementar (`GainNode` por track remota via Web Audio API), mas não é bloqueante para o grupo trocar do Discord no dia 1. | LOW-MEDIUM | Renderer (Web Audio API sobre track remota do LiveKit) |
| **Preview da tela antes de compartilhar** | Já que os thumbnails do `desktopCapturer` são obtidos de qualquer forma para o picker (linha acima), mostrar preview ampliado é praticamente grátis a mais. | LOW | Reaproveita `desktopCapturer` |
| **Status "ausente" automático (idle)** | Presença hoje é binário online/offline por `lastSeen` (decisão já tomada no design, `PROJECT.md` §Modelo de dados). Detectar inatividade do SO (`powerMonitor.getSystemIdleTime()` do Electron) e marcar "ausente" depois de N minutos é aditivo, não quebra nada existente. | LOW-MEDIUM | Electron main (`powerMonitor`) + Convex (`presence`) |
| **Badge de não-lidos por canal/servidor** | Complementa o divisor de não-lidos (já listado como table stakes) — mesma dependência de schema novo (`channelReadState`). Uma vez que a tabela existe, o badge é praticamente grátis. | LOW (depois do schema) | Convex |
| **Ping numérico em ms (não só qualidade)** | Puxar `roundTripTime` de `getStats()` de baixo nível por participante — mais fiel ao "ping" que gamers reconhecem do Discord, mas exige polling manual de stats WebRTC, API mais crua que `ConnectionQuality`. | MEDIUM-HIGH | LiveKit (`getStats()`, não documentado como API de alto nível) |
| **@menção com autocomplete e destaque** | Chat de grupo fechado ainda se beneficia de "fulano, olha isso" com destaque visual, mesmo sem sistema de notificação push (fora de escopo). Autocomplete de username é o que dá trabalho; destaque de texto puro é barato. | MEDIUM | Convex (parse simples de `@username`) + renderer |

### Anti-Features (Commonly Requested, Often Problematic)

Estas existem no Discord real e parecem "óbvias de ter", mas para um grupo
fechado de ~10 amigos que já se conhecem, custam esforço de implementação e
superfície de teste sem entregar valor proporcional — ou ativamente atrapalham
o objetivo central (mídia estável).

| Feature | Por que parece necessária | Por que é problemática aqui | Alternativa |
|---------|---------------|-----------------|-------------|
| **Roles e permissões granulares** | Discord "de verdade" tem cargos, permissões por canal, hierarquia | Já excluído no `PROJECT.md`. Grupo de 10 amigos não precisa de hierarquia — o dono do servidor administra tudo. Construir isso multiplica a superfície de teste de autorização (cada mutation do Convex precisaria checar role, não só membership) sem nenhum usuário pedindo. | `ownerId` no servidor + "é membro ou não" já resolve tudo que o grupo precisa |
| **Limite de usuários por canal de voz ("canal cheio")** | Discord permite configurar limite por canal | O objetivo central do produto é justamente "10 pessoas no mesmo canal" — adicionar um limite configurável por canal introduz um caso de erro (canal cheio) que não serve a nenhum cenário real do grupo. | Nenhum limite — ou, se necessário por capacidade de infra, um limite global fixo de 10, não configurável por canal |
| **Webcam / vídeo de rosto** | Discord tem chamada de vídeo além de screenshare | Já excluído no `PROJECT.md`: "o grupo compartilha tela, não rosto". Adicionaria uma segunda track de vídeo simultânea (câmera + tela), dobrando a complexidade de publish/subscribe e o custo de banda da VPS, para algo que o grupo não pediu. | Screenshare com áudio do sistema já cobre o caso de uso real |
| **Arrastar usuário entre canais de voz (mover à força)** | Discord permite admin mover alguém de canal | Ferramenta de moderação — só faz sentido em comunidades com atrito/moderação ativa. Entre 10 amigos, "muda de canal você mesmo" é suficiente e evita construir uma ação privilegiada sobre `voiceStates` de outro usuário. | Cada usuário entra/sai do canal que quiser |
| **Markdown rico / formatação de texto** | Discord suporta negrito, itálico, blocos de código, spoiler | Já excluído no `PROJECT.md`. Exige parser + renderer + sanitização (superfície de XSS se malfeito) para um grupo que hoje manda texto simples. | Texto puro no MVP; markdown é aditivo depois, sem mudar arquitetura |
| **Busca de mensagens** | Discord indexa histórico inteiro | Já excluído no `PROJECT.md`. Full-text search decente exige índice dedicado (Convex não tem full-text nativo tão rico quanto Elasticsearch/Algolia) — investimento desproporcional para 10 pessoas que lembram o contexto da própria conversa. | Scroll manual no histórico (já é table stakes acima) |
| **Notificações push (SO)** | Discord notifica mesmo com app fechado | Já excluído no `PROJECT.md`: "o app fica aberto durante o uso". Notificação push exige serviço externo (APNs/FCM-equivalente para Windows, ou polling em background) — custo de infra e complexidade para um app que já fica aberto. | Notificação in-app (som + badge) enquanto o app está aberto é suficiente |
| **Simulcast completo (3 camadas) no screenshare para 10 participantes** | Boa prática geral de WebRTC em produção com público heterogêneo | Com um SFU self-hosted numa VPS de 2 vCPU e um grupo de 10 pessoas conhecidas (não público anônimo com downlinks imprevisíveis), o ganho de simulcast completo é marginal frente à complexidade extra e ao consumo de CPU do SFU gerando múltiplas camadas simultâneas. LiveKit já habilita simulcast por padrão nas SDKs — não é preciso *desabilitar*, mas também não vale investir esforço extra em *tunar* camadas customizadas no MVP. | Usar o simulcast default (`videoSimulcastLayers`/`screenshareSimulcastLayers` com presets padrão) e só revisitar se o risco de upload doméstico ruim (já mapeado no design) se confirmar na prática |
| **Rich Presence ("jogando X há 20 min")** | Discord integra com jogos para mostrar atividade | Exige integração por jogo (RPC do Discord por título) ou detecção heurística de processos — trabalho considerável para um dado decorativo que o grupo já sabe informalmente ("bora, tô de boa"). | Nenhuma — presença online/offline já é suficiente conforme decidido no design |
| **Múltiplos servidores com descoberta pública** | Discord é multi-tenant com servidores públicos | Fora de escopo do produto (`PROJECT.md`: "federação... não é produto"). Construir descoberta/listagem pública de servidores implica moderação de conteúdo, que não existe e não deveria existir aqui. | Convite direto por link, servidor sempre privado |

## Feature Dependencies

```
Autenticação (WorkOS) ──requires──> nada (F2, primeira peça viva)
   └──enables──> Identidade USER#123 ──enables──> Adicionar amigos ──enables──> DMs

Servidores + canais (schema) ──requires──> Autenticação
   └──enables──> Chat em tempo real (canais de texto)
   └──enables──> Voz (canais de voz) ──requires também──> LiveKit na VPS (F1, paralelo)

voiceStates (Convex) ──requires──> Servidores + canais + LiveKit
   └──enables──> Indicador de "está falando"      (requer também: LiveKit ActiveSpeakers)
   └──enables──> Mute/deafen                        (requer também: LiveKit track enable/disable)
   └──enables──> Sons de entrar/sair                (diff reativo sobre voiceStates)
   └──enables──> Sidebar mostrando quem está em qual canal
   └──enables──> Screenshare                        (requer também: desktopCapturer + setDisplayMediaRequestHandler)
        └──requires cuidado──> reconciliar voiceStates.sharing quando presenter sai (LiveKit event + Convex mutation)

Push-to-talk ──requires──> hook nativo de teclado (uiohook-napi) no processo main
VAD ──requires──> Web Audio API no renderer sobre a track local
PTT e VAD ──conflicts (mutuamente exclusivos por usuário)──> só um modo ativo por vez, mas ambos coexistem no produto como opção

Scrollback + paginação ──requires──> índice by_channel em messages (já no schema)
Jump-to-bottom ──enhances──> Scrollback
Divisor de não-lidos ──requires──> tabela nova channelReadState (NÃO existe no schema atual)
Badge de não-lidos ──requires──> mesma tabela channelReadState

Convite de servidor ──requires──> tabela nova invites (NÃO existe no schema atual)
```

### Dependency Notes

- **Push-to-talk e VAD dependem de camadas diferentes do stack** (Electron main
  com hook nativo vs renderer com Web Audio API) — não é a mesma linha de
  código estendida, são duas implementações paralelas que convergem no mesmo
  resultado (`localParticipant.setMicrophoneEnabled`). Isso os torna
  candidatos a fases/tarefas separadas mesmo estando na mesma "feature" do
  ponto de vista do usuário.
- **Divisor de não-lidos e badge de não-lidos exigem uma tabela de schema que
  não está no design atual** (`PROJECT.md` §Modelo de dados só lista as
  tabelas já decididas). Isso deveria ser decidido explicitamente na fase de
  schema/roadmap, não descoberto tarde durante o desenvolvimento do chat —
  é o tipo de gap que "parece pronto" com scroll funcionando, mas falta o
  marcador de onde parar de ler.
- **Convite de servidor tem o mesmo tipo de gap** — `PROJECT.md` lista
  "entrar em servidores por convite" como requisito ativo, mas a tabela
  `invites` não existe no schema do design. Vale resolver a semântica
  (permanente vs expira vs uso único) antes de escrever o schema, não depois.
- **Screenshare "presenter sai" depende de reconciliar dois sistemas**: o
  evento vem do LiveKit (`TrackUnpublished`), mas o estado que a UI de fato lê
  é `voiceStates.sharing` no Convex — mesma classe de risco do "ghost user"
  documentado em `PITFALLS.md` Pitfall 3, aplicada a um campo diferente da
  mesma tabela.

## MVP Definition

O MVP já está escopado em `PROJECT.md`. Esta seção mapeia os **detalhes de
comportamento table stakes acima** para dentro/fora desse escopo já definido —
não propõe reabrir o escopo.

### Launch With (v1) — dentro do escopo já definido em PROJECT.md

- [ ] PTT com hook nativo de teclado — sem isso, "voz" existe mas é
      desconfortável o bastante para o grupo preferir o Discord de volta
- [ ] VAD com sensibilidade ajustável — alternativa ao PTT, ambos table stakes
      juntos (grupo tem gente que prefere cada modo)
- [ ] Cancelamento de eco/ruído nativo do WebRTC (grátis, sem Krisp)
- [ ] Indicador de "está falando" com debounce
- [ ] Mute/deafen com semântica decidida explicitamente (não just "copiar
      Discord de memória" — documentar a decisão)
- [ ] Estados de conexão de voz visíveis (Conectando/Conectado/Reconectando)
- [ ] Indicador de qualidade de conexão (4 níveis, não ping em ms)
- [ ] Seleção de dispositivo de entrada e saída de áudio
- [ ] Sons de entrar/sair de canal (com toggle para desligar)
- [ ] Scrollback com jump-to-bottom que respeita a posição de leitura
- [ ] Indicador de digitação com expiração automática
- [ ] Screenshare: presenter sai → outros voltam ao layout normal
      automaticamente (sem frame congelado)
- [ ] Picker custom de tela/janela para compartilhar (com thumbnails)
- [ ] Escolha simples de qualidade do screenshare (2 níveis, não sliders crus)
- [ ] Sidebar com participantes de cada canal de voz visível antes de entrar

### Add After Validation (v1.x)

- [ ] Divisor + badge de mensagens não lidas — **precisa de decisão de schema
      antes** (tabela nova), então não é "adicionar depois" trivial; se o
      grupo sentir falta logo, tratar como v1.x prioritário, não v2
- [ ] Volume individual por usuário
- [ ] Preview de tela antes de compartilhar
- [ ] Status "ausente" automático
- [ ] Convite de servidor com semântica final decidida (mesma nota de schema)

### Future Consideration (v2+)

- [ ] Krisp/supressão de ruído avançada — depender de confirmar custo real,
      tensiona com a constraint de "nenhum serviço pago novo"
- [ ] Ping numérico em ms — `ConnectionQuality` qualitativo já resolve o caso
      de uso; só vale o esforço extra se o grupo pedir especificamente
- [ ] @menção com autocomplete — chat de 10 pessoas raramente precisa

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Push-to-talk (hook nativo) | HIGH | HIGH | P1 |
| VAD com sensibilidade | HIGH | HIGH | P1 |
| Eco/ruído nativo WebRTC | HIGH | LOW | P1 |
| Indicador "está falando" + debounce | HIGH | MEDIUM | P1 |
| Mute/deafen com semântica correta | HIGH | MEDIUM | P1 |
| Estados de conexão de voz visíveis | HIGH | MEDIUM | P1 |
| Qualidade de conexão (4 níveis) | MEDIUM | MEDIUM | P1 |
| Seleção de dispositivo entrada/saída | HIGH | MEDIUM | P1 |
| Sons de entrar/sair | MEDIUM | LOW | P1 |
| Scrollback + jump-to-bottom | HIGH | MEDIUM | P1 |
| Indicador de digitação | MEDIUM | LOW-MEDIUM | P1 |
| Screenshare: presenter sai (cleanup) | HIGH | MEDIUM | P1 |
| Picker custom de tela/janela | HIGH | MEDIUM-HIGH | P1 |
| Qualidade/framerate do screenshare | MEDIUM | MEDIUM | P1 |
| Sidebar com participantes por canal | MEDIUM | LOW-MEDIUM | P1 |
| Divisor de não-lidos | MEDIUM | MEDIUM-HIGH | P2 |
| Convite de servidor (schema novo) | HIGH | LOW-MEDIUM | P1 (bloqueia "entrar por convite" do MVP) |
| Volume individual por usuário | MEDIUM | LOW-MEDIUM | P2 |
| Preview de tela antes de compartilhar | LOW | LOW | P3 |
| Status ausente automático | LOW | LOW-MEDIUM | P3 |
| Krisp (supressão avançada) | LOW-MEDIUM | MEDIUM (+ custo $) | P3 |
| Ping em ms | LOW | MEDIUM-HIGH | P3 |
| @menção com autocomplete | LOW | MEDIUM | P3 |

**Nota sobre "Convite de servidor":** embora listado como P1 (está no MVP do
`PROJECT.md`), a tabela `invites` não existe no schema atual do design — é
prioridade alta de *valor* mas descoberta tardia de *schema*. Sinalizar para
quem for desenhar o schema definitivo da fase de servidores/canais.

## Competitor Feature Analysis

Comparação não é "Discord vs concorrente" (não há concorrente comercial aqui),
mas sim onde o comportamento fino do Discord real deve ser copiado
deliberadamente vs onde vale simplificar para o contexto de 10 amigos fechados.

| Comportamento | Discord real | Abordagem recomendada no janja |
|---------|--------------|--------------|
| Deafen | Deafen sempre implica mute; unmute enquanto deafened tem histórico de comportamento inconsistente reportado por usuários (fontes de comunidade, não doc oficial) | Decidir explicitamente: deafen implica mute; unmute enquanto deafened também remove o deafen (evita estado "fala no vácuo") |
| Ping de voz | Número em ms, calculado internamente (não documentado publicamente) | Usar `ConnectionQuality` qualitativo do LiveKit (Excellent/Good/Poor/Lost) — mais simples, mesma utilidade prática |
| Convites | Múltiplos convites simultâneos, com expiração configurável, contagem de usos, canal de destino | Um único convite reutilizável e revogável por servidor — suficiente para 10 amigos fixos |
| Limite de canal de voz | Configurável por canal (2 a 99, ou ilimitado) | Sem limite configurável — o produto inteiro é sobre "10 pessoas juntas" |
| Screenshare picker | Overlay nativo do SO (browser usa API padrão do navegador) | Electron não tem isso pronto — picker custom com `desktopCapturer`, já contabilizado como MEDIUM-HIGH acima |
| Simulcast de vídeo | 3 camadas completas, público heterogêneo e imprevisível em escala | Simulcast default do LiveKit (já ligado), sem tuning extra — grupo pequeno e conhecido não precisa do investimento adicional |

## Sources

**LiveKit (verificado em docs.livekit.io — HIGH confidence):**
- [Noise & echo cancellation](https://docs.livekit.io/transport/media/noise-cancellation/) — Krisp vs WebRTC nativo, custo de licença do Krisp, latência adicional
- [Webhooks & events / RoomEvent](https://docs.livekit.io/home/client/events/) — `ActiveSpeakersChanged`, `IsSpeakingChanged`, `ConnectionQualityChanged`, `Reconnecting`/`Reconnected`, `TrackMuted`/`TrackUnmuted`, `ParticipantConnected`/`Disconnected`
- [ConnectionQuality enum](https://docs.livekit.io/reference/client-sdk-js/enums/ConnectionQuality.html) — valores Excellent/Good/Poor/Lost/Unknown
- [Codecs and more / TrackPublishOptions](https://docs.livekit.io/transport/media/advanced/) — simulcast default, `videoSimulcastLayers`/`screenshareSimulcastLayers`, VideoPresets
- [VideoSenderStats](https://docs.livekit.io/reference/client-sdk-js/interfaces/VideoSenderStats.html) — `roundTripTime` via `getStats()` de baixo nível

**Electron (doc oficial — HIGH confidence, já citado em PITFALLS.md, reconfirmado aqui no contexto de features):**
- [globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut) + issues [#26301](https://github.com/electron/electron/issues/26301) e [#8491](https://github.com/electron/electron/issues/8491) — ausência de keydown/keyup separado, inviabiliza PTT nativo do Electron
- [desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) — ausência de picker nativo, necessidade de UI custom com thumbnails

**Comunidade (MEDIUM confidence, cruzado com múltiplas fontes):**
- [uiohook-napi (npm)](https://www.npmjs.com/package/uiohook-napi) — alternativa nativa para keydown/keyup global, usada por outros clientes de voz em Electron
- Discussões de suporte do Discord sobre semântica de deafen/mute ([Discord support community](https://support.discord.com/hc/en-us/community/posts/360051360774-Unable-to-deafen-myself-without-also-getting-muted)) — comportamento observado, não documentação oficial da API do Discord (Discord não expõe doc pública desse comportamento de UX)

**Projeto (fonte primária para escopo e schema atual):**
- `/home/leo/workspace/janja/.planning/PROJECT.md` — requisitos ativos, out of scope, modelo de dados de alto nível
- `/home/leo/workspace/janja/docs/superpowers/specs/2026-08-18-janja-discord-clone-design.md` — schema completo do Convex, arquitetura de voz/screenshare
- `/home/leo/workspace/janja/.planning/research/PITFALLS.md` — armadilhas técnicas relacionadas (eco, ghost-user, debounce), referenciadas e não duplicadas

---
*Feature research for: cliente desktop de chat + voz estilo Discord, grupo fechado de ~10 pessoas*
*Researched: 2026-08-18*
