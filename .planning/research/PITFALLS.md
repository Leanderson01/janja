# Pitfalls Research

**Domain:** Cliente desktop Electron de chat + voz (clone de Discord) — Convex + WorkOS AuthKit + LiveKit self-hosted, alvo Windows
**Researched:** 2026-08-18
**Confidence:** MEDIUM-HIGH (a maioria das afirmações foi verificada contra electronjs.org, docs.convex.dev, docs.livekit.io, RFC 8252 e issues oficiais do GitHub; itens sem verificação direta estão marcados LOW e precisam de spike antes da fase correspondente)

> Notação: **[EXCLUSIVO WINDOWS]** marca armadilhas que só se manifestam no alvo de produção e que o WSL2 não consegue reproduzir — validar sempre na máquina Windows nativa.

## Critical Pitfalls

### Pitfall 1: Eco do próprio áudio da call no compartilhamento de tela

**What goes wrong:**
Ao compartilhar tela com `audio: 'loopback'`, o WASAPI loopback do Windows captura *todo* o áudio que sai pelo dispositivo de saída padrão — incluindo o áudio dos outros participantes da call que o próprio LiveKit está reproduzindo no alto-falante/fone do apresentador. Esse áudio é republicado como parte da track de screenshare, e os demais participantes voltam a ouvir suas próprias vozes com atraso — eco/Larsen clássico, sem qualquer defeito de hardware envolvido.

**Why it happens:**
`setDisplayMediaRequestHandler` com `audio: 'loopback'` captura no nível do dispositivo de sistema, não no nível de aplicação — ele não sabe (por padrão) diferenciar "áudio que o próprio app está tocando" de "áudio de qualquer outro programa". O Electron histor­icamente não implementava o `restrictOwnAudio` do W3C Screen Capture spec dentro de `setDisplayMediaRequestHandler`: um bug conhecido (`getDisplayMedia({ audio: { restrictOwnAudio: true } })` sendo ignorado) só foi corrigido no **Electron 43.4.0**. Usar fones não resolve — o loopback capta o que é roteado ao dispositivo de saída, esteja ele conectado a caixas de som ou fone.

**How to avoid:**
- Fixar a versão mínima do Electron em **>= 43.4.0** no `package.json` antes de implementar F8, e passar `audio: { restrictOwnAudio: true }` explicitamente na configuração de `getDisplayMedia`/no handler.
- Validar em teste manual: entrar em call em duas máquinas, uma compartilha tela, e escutar se a voz da outra pessoa "ecoa" de volta através da track de screenshare.
- Se `restrictOwnAudio` não filtrar o suficiente na prática (não há garantia documentada de 100% de eficácia em todos os cenários), ter como plano B: silenciar localmente a reprodução do LiveKit enquanto captura o loopback e re-roteá-la só para o compartilhamento (mixagem manual de tracks), ou simplesmente documentar como limitação conhecida do MVP.

**Warning signs:**
Em teste com 3+ pessoas, alguém relata ouvir "eco" ou voz repetida assim que o compartilhamento de tela com áudio começa.

**Phase to address:**
F8 (Screenshare + áudio de sistema) — **[EXCLUSIVO WINDOWS]**, só testável na máquina nativa.

---

### Pitfall 2: `setDisplayMediaRequestHandler` sem tratamento de cancelamento trava a próxima tentativa de compartilhamento

**What goes wrong:**
Se o handler não chama `callback(...)` em todos os caminhos (por exemplo, quando `desktopCapturer.getSources()` retorna array vazio, ou quando o usuário fecha o seletor de tela customizado sem escolher nada), a Promise de `getDisplayMedia()` no renderer nunca resolve nem rejeita. Isso deixa a UI "carregando" para sempre, e problemas piores: uma `UnhandledPromiseRejectionWarning` pode surgir no processo main, e tentativas subsequentes de compartilhar tela lançam novos erros não tratados (comportamento documentado, ainda sem correção definitiva no Electron — issues #45517 e #47980, este último `blocked/need-repro`).

**Why it happens:**
A API é relativamente nova (desde Electron 22) e a superfície de erro não é totalmente coberta pelo framework — cabe ao app garantir que todo caminho do handler termine em `callback(...)`.

**How to avoid:**
```js
session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    if (sources.length === 0) {
      callback({}); // sinaliza cancelamento explícito, nunca passe video: undefined
      return;
    }
    // ... UI de seleção de fonte no renderer via IPC ...
    callback({ video: chosenSource, audio: 'loopback' });
  } catch (err) {
    callback({}); // nunca deixe uma exceção escapar sem chamar callback
  }
});
```
Sempre envolver em `try/catch` e garantir que `callback` seja chamado em 100% dos ramos, incluindo timeout se a escolha do usuário demorar demais.

**Warning signs:**
Segunda tentativa de "Compartilhar tela" na mesma sessão do app não abre o seletor, ou o botão fica em estado de loading indefinidamente.

**Phase to address:**
F8 (Screenshare) — implementar o handler defensivamente desde o primeiro spike, não como polimento tardio.

---

### Pitfall 3: Usuário-fantasma em canal de voz (voiceStates órfão)

**What goes wrong:**
O app fecha abruptamente (crash, Windows Update forçando restart, perda de energia, `Alt+F4` sem handler de saída, perda de rede) enquanto o usuário está em um canal de voz. Como o Convex é a fonte da verdade (`voiceStates`) e não o LiveKit, a linha de presença em voz nunca é removida — o usuário continua aparecendo "no canal" para todo mundo, mesmo tendo desconectado da mídia há muito tempo.

**Why it happens:**
O design (corretamente) evita consultar o LiveKit como fonte da verdade, mas isso significa que **nada limpa `voiceStates` automaticamente** a menos que exista uma segunda via de reconciliação. Confiar apenas em `leaveVoiceChannel()` chamado pelo cliente no `beforeunload`/cleanup do React é insuficiente — esse código não roda de forma confiável em crash, força-bruta de fechamento, ou perda abrupta de conexão.

**How to avoid:**
- Configurar **webhooks do LiveKit** (`participant_left`, `participant_connection_aborted`, `room_finished`) apontando para uma HTTP action do Convex (`convex/http.ts`), que roda `internal.voice.leaveByParticipant` para apagar a linha correspondente em `voiceStates`.
- **Atenção de implementação:** a verificação de assinatura do webhook (`WebhookReceiver.receive(body, authHeader)` do `livekit-server-sdk`) exige o **corpo bruto (raw) da requisição como string**, não o resultado de `request.json()`. Parsear o JSON antes de verificar quebra a validação HMAC/JWT silenciosamente (ou lança erro de assinatura inválida). Use `await request.text()`.
- Como camada extra, considerar um TTL curto reemitido no heartbeat de presença (Pitfall "presença" abaixo) que também sirva para expirar `voiceStates` obsoletos.

**Warning signs:**
Depois de um teste de "matar o processo Electron à força" com um usuário em canal de voz, o avatar dele continua na lista de participantes do canal em outra máquina, mesmo minutos depois.

**Phase to address:**
F7 (Voz) — a reconciliação via webhook deve ser parte do critério de aceite da fase, não um follow-up.

---

### Pitfall 4: Convex trava em `isAuthenticated: false` para sempre após o access token do WorkOS expirar

**What goes wrong:**
Existe um bug documentado na integração Convex + WorkOS AuthKit (relatado em `get-convex/convex-backend#259`): quando o access token expira, as queries reativas falham como esperado, o AuthKit renova o token automaticamente, o backend Convex volta a aceitar requisições — mas o client-side `useConvexAuth()`/`ConvexProviderWithAuth` **não se recupera**, ficando permanentemente em `isAuthenticated: false` até um reload completo da página/app. O access token padrão do WorkOS expira em **5 minutos**, o que torna esse bug fácil de disparar em qualquer sessão de uso real (uma call de voz de 30+ minutos vai atravessar múltiplas expirações).

**Why it happens:**
Falha na transição de estado do cliente Convex quando o `fetchAccessToken` do hook customizado é chamado em resposta a um erro 401, mas o cliente não reprocessa corretamente o novo token — comportamento ainda sob investigação pela equipe do Convex, sem causa raiz definitiva publicada.

**How to avoid:**
- Aumentar o TTL do access token do WorkOS no dashboard para **8–12 horas** em vez do padrão de 5 minutos — reduz drasticamente a frequência de expiração durante uma sessão de uso.
- Implementar o hook `useAuth` customizado (necessário de qualquer forma, ver design doc seção 4) com atenção redobrada ao `forceRefreshToken`, e adicionar telemetria/log local quando `isAuthenticated` cair para `false` inesperadamente, para detectar o bug em produção.
- Ter um fallback de UX: se `isAuthenticated` permanecer `false` por mais de N segundos após um token renovado ser detectado, forçar um reload silencioso da janela (`BrowserWindow.reload()`), já que essa é a mitigação confirmada.

**Warning signs:**
Usuário reporta "o app parou de atualizar mensagens" sem erro visível, geralmente depois de a janela ficar minimizada/em segundo plano por mais de alguns minutos.

**Phase to address:**
F2 (Convex + auth WorkOS) — validar com um teste manual de "deixar sessão aberta 10+ minutos com token curto (padrão) e observar se trava" antes de decidir o TTL final.

---

### Pitfall 5: Loopback OAuth implementado sem as garantias do RFC 8252 (porta fixa, sem PKCE, sem `SO_EXCLUSIVEADDRUSE`)

**What goes wrong:**
O design já decidiu por loopback HTTP (RFC 8252) em vez de custom protocol — nota-se que isso diverge do exemplo oficial da própria WorkOS (`@workos-inc/authkit-electron`, que usa `workos-auth://callback` via custom protocol/deep link, não loopback). Implementar loopback à mão sem seguir a RFC à risca abre falhas reais: porta fixa hardcoded falha em máquinas com a porta ocupada; ausência de `state` permite CSRF na resposta de autorização; e no Windows, sem `SO_EXCLUSIVEADDRUSE` no socket, outro processo pode—em teoria—se ligar à mesma porta loopback e interceptar o código de autorização.

**Why it happens:**
Como não há biblioteca pronta (o time optou por não usar `@workos-inc/authkit-electron`, que assume `authkit-react` gerenciando o token, e escreveu o fluxo de auth à mão), toda a responsabilidade de seguir a RFC cai sobre o código custom.

**How to avoid:**
- **PKCE é obrigatório**, não opcional — RFC 8252 §6 exige `code_verifier`/`code_challenge` para clientes públicos nativos. `@workos-inc/node` expõe utilitários para PKCE; confirmar o método antes de codar.
- **State obrigatório na prática**: gerar um valor aleatório de alta entropia por tentativa de login e validar no retorno.
- **Porta aleatória, não fixa**: usar porta `0` (o SO escolhe) e registrar no Google Cloud Console / WorkOS dashboard o redirect URI **sem número de porta** (`http://127.0.0.1`) — o Google exige que, se a porta não for especificada no client OAuth, qualquer porta seja aceita (comportamento documentado no guia de migração do Google para loopback).
- **[EXCLUSIVO WINDOWS]**: ao criar o socket do servidor HTTP efêmero no main process, setar a opção equivalente a `SO_EXCLUSIVEADDRUSE` (no Node.js isso normalmente significa usar `server.listen({ port: 0, exclusive: true })` — validar que o binding Node no Windows realmente aplica essa proteção; se não aplicar nativamente, é um gap conhecido a documentar).
- Encerrar o servidor HTTP loopback imediatamente após capturar o código (janela de exposição mínima).

**Warning signs:**
Login falha esporadicamente em máquinas com outro app ocupando portas altas; ou, em teste de segurança, outro processo local consegue "roubar" o código antes do app.

**Phase to address:**
F2 (Convex + auth WorkOS) — escrever teste manual de checklist RFC 8252 antes de considerar a fase concluída.

---

### Pitfall 6: WebRTC falha silenciosamente atrás de firewall corporativo/CGNAT sem TURN habilitado

**What goes wrong:**
A sala conecta via sinalização WSS (porta 443) normalmente — o app parece "conectado" —, mas nenhum áudio flui. Do lado do usuário isso se manifesta como "call muda, ninguém ouve ninguém", sem erro explícito, porque a camada de sinalização (WebSocket) e a camada de mídia (UDP/ICE) são independentes: a primeira quase sempre atravessa qualquer rede, a segunda é frequentemente bloqueada por firewalls corporativos, redes de faculdade/empresa ou CGNAT agressivo que não permite os candidatos ICE necessários.

**Why it happens:**
A configuração padrão do LiveKit self-hosted expõe a faixa UDP 50000–60000 e o fallback TCP na porta 7881, mas **sem um servidor TURN habilitado**, não existe rota de retransmissão quando tanto UDP quanto o TCP direto são bloqueados. Para uma rede doméstica típica brasileira isso raramente é um problema, mas para qualquer membro do grupo tentando entrar de uma rede corporativa, universitária ou 4G com CGNAT restritivo, a call falha sem aviso.

**How to avoid:**
- Configurar a seção `turn` do `livekit.yaml`: `enabled: true`, com `tls_port: 5349` (ou reaproveitar 443 se não usando HTTP/3/QUIC) e `domain` correspondente ao certificado TLS válido — TURN/TLS é o único caminho que atravessa quase qualquer firewall restritivo, porque parece tráfego HTTPS comum.
- Definir `use_external_ip: true` na seção `rtc` — essencial em VPS cloud onde o IP interno da interface de rede difere do IP público (o LiveKit descobre o IP externo via STUN); sem isso, os candidatos ICE anunciados usam o IP privado da VPS e nenhum cliente externo consegue alcançá-los.
- Diagnóstico: usar `chrome://webrtc-internals` (funciona no Chromium do Electron) durante uma tentativa de conexão para inspecionar os candidatos ICE gerados e qual par foi selecionado (ou se a negociação falhou). Ausência de candidato `relay` bem-sucedido quando `srflx`/`host` falham indica falta de TURN.
- Testar explicitamente de uma rede com NAT restritivo (hotspot 4G com CGNAT é um proxy razoável) antes de considerar F1 concluída.

**Warning signs:**
Um usuário específico nunca consegue ouvir ninguém em determinadas redes (trabalho, faculdade), mas funciona normalmente em casa.

**Phase to address:**
F1 (LiveKit na VPS) — configurar TURN desde o início mesmo que "provavelmente" não seja necessário para o grupo de 10 pessoas; o custo de configurar é baixo e o modo de falha é silencioso e difícil de depurar remotamente depois.

---

### Pitfall 7: `safeStorage` se torna irrecuperável e o app não tem plano de recuperação [EXCLUSIVO WINDOWS]

**What goes wrong:**
O refresh token é criptografado via `safeStorage`, que no Windows usa DPAPI vinculada às credenciais de login do usuário do SO. Se o usuário reinstalar o Windows, resetar a senha da conta de forma que invalide as chaves DPAPI, migrar para outra máquina, ou usar uma conta Microsoft diferente, os dados criptografados salvos anteriormente tornam-se **permanentemente ilegíveis** — não há como decifrar com uma nova credencial. Se o app tenta `decryptString` sobre esse blob e trata o erro de forma ingênua (crash, ou tela em branco), o usuário fica travado sem entender por quê.

**Why it happens:**
DPAPI é projetada assim por design de segurança — "typically, only a user with the same logon credential as the user who encrypted the data can typically decrypt the data" (documentação oficial do Electron). É comportamento esperado, não um bug do Electron, mas frequentemente ignorado até acontecer em produção.

**How to avoid:**
- Sempre envolver a leitura de dados de `safeStorage` em `try/catch`; se falhar, tratar como "sessão inválida" e cair de volta no fluxo de login (nunca travar a UI).
- Preferir a API assíncrona (`encryptStringAsync`/`decryptStringAsync`) — a documentação recomenda explicitamente por suportar rotação de chave e indisponibilidade temporária, e sinaliza que a API síncrona pode ser depreciada.
- Nunca chamar `safeStorage` antes do evento `app.whenReady()`.
- Não é necessário nenhum "plano de recuperação" de dados em si (o usuário só faz login de novo), mas é necessário garantir que a falha de decriptação nunca vire uma exceção não tratada que quebre o app inteiro.

**Warning signs:**
Usuário reporta "o app não abre mais" ou fica em tela branca depois de trocar de máquina, resetar Windows, ou (em ambientes corporativos) ter a conta gerenciada por Azure AD reprovisionada.

**Phase to address:**
F2 (Convex + auth WorkOS) para a implementação defensiva; F9 (polish) para o teste de UX do caminho de erro.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|-----------------|
| Confiar só em `leaveVoiceChannel()` chamado pelo cliente, sem webhook do LiveKit | Menos código em F7 | Usuários-fantasma acumulam em canais de voz após crashes (Pitfall 3) | Nunca — implementar reconciliação por webhook antes de considerar F7 pronta |
| Usar TTL padrão (5 min) do access token do WorkOS | Zero configuração extra | Sessões longas disparam o bug de `isAuthenticated` travado (Pitfall 4) com mais frequência | Só em spike/prototipagem inicial, nunca em uso real com o grupo |
| Não configurar TURN em F1 porque "o grupo é sempre de casa" | Setup mais rápido | Um único membro em rede restritiva nunca consegue usar voz, sem diagnóstico óbvio | Aceitável apenas se todos os 10 membros confirmarem que sempre usarão rede doméstica sem CGNAT — risco alto de quebrar a promessa central do produto |
| Emitir JWT do LiveKit com escopo amplo (sem restringir `room`) "para simplificar" | Menos parâmetros a validar | Um token vazado permite entrar/publicar em qualquer sala, não só na autorizada | Nunca |
| Pular `restrictOwnAudio`/tratamento de eco em F8 e "resolver depois" | Screenshare funciona mais cedo | Critério de sucesso #2 do projeto (áudio do sistema audível pelos demais) fica comprometido por eco irritante | Só como spike de validação técnica isolado, nunca na entrega da fase |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| WorkOS AuthKit + Electron | Seguir o exemplo oficial (`@workos-inc/authkit-electron`) que usa custom protocol `workos-auth://`, achando que é o único caminho suportado | O design já escolheu loopback (mais seguro que custom-protocol, que é sujeito a scheme hijacking no Windows); implementar manualmente seguindo RFC 8252 à risca (Pitfall 5), não copiar o exemplo oficial |
| LiveKit self-hosted | Rodar `docker-compose down` para reiniciar o stack | Isso remove o volume onde o Caddy guarda os certificados TLS, forçando reemissão via Let's Encrypt (que tem rate limit); usar `docker-compose stop`/`start` ou `restart` para manutenção de rotina |
| LiveKit webhooks → Convex | Chamar `request.json()` antes de validar a assinatura do webhook | Ler o corpo como texto bruto (`request.text()`) e passar exatamente essa string para `WebhookReceiver.receive(rawBody, authHeader)` — parsing prévio quebra a verificação HMAC |
| livekit-server-sdk em Convex actions | Assumir que a assinatura de JWT funciona no runtime padrão do Convex (V8/Workers-like) sem testar | Validar cedo (spike de 30 min) se a versão instalada do SDK (v2+ usa `jose`/Web Crypto, potencialmente compatível com o runtime padrão) roda sem `"use node"`; se precisar de Node runtime, isso quebra a atomicidade entre assinar o token e inserir a linha em `voiceStates` (duas chamadas separadas dentro da action, não uma transação única) — tratar a ordem de operações pensando no caso de falha parcial |
| Google OAuth (via WorkOS) | Registrar o redirect URI com uma porta fixa (`http://127.0.0.1:8734`) no console do Google | Registrar sem porta (`http://127.0.0.1`) para que o Google aceite qualquer porta efêmera escolhida pelo SO em tempo de execução |
| `desktopCapturer` no Windows | Assumir que toda janela pode ser capturada normalmente | Janelas com `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` (comum em apps de DRM, alguns gerenciadores de senha, certas apps corporativas) aparecem como retângulo preto na captura — não é bug do janja, é proteção do SO; documentar como limitação conhecida |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Query de mensagens usando `.filter()` em vez de `.withIndex("by_channel", ...)` | Lento ao rolar histórico, mais notável conforme o canal acumula mensagens | Sempre indexar por `channelId` e usar `withIndex`; nunca usar `.filter()` como substituto de índice para o campo principal de escopo | Convex avisa que full scans "ficam lentas" a partir de "muitos milhares" de documentos — com ~10 usuários ativos por meses isso é atingível em canais movimentados dentro de alguns meses |
| Paginação reativa (`usePaginatedQuery`) assumindo tamanho de página fixo para virtualização de lista | Lista de mensagens "pula"/redimensiona sozinha quando alguém envia mensagem enquanto a página está carregada | Tratar page size como variável (é documentado que páginas "podem crescer" com inserções concorrentes); projetar a UI de scroll/virtualização para tamanhos dinâmicos, não fixos | Em qualquer canal ativo com 2+ pessoas digitando simultaneamente durante o carregamento inicial do histórico |
| Presença escrevendo em `presence` a cada poucos segundos por usuário conectado | Tráfego de mutations desnecessário, mais invalidação de subscription do que o preciso | Usar o padrão de componente (`@convex-dev/presence`, baseado em `scheduled functions`) que evita reexecutar queries a cada heartbeat, notificando só quando alguém entra/sai; ou fazer heartbeat "piggyback" em qualquer outra mutation já disparada pelo usuário | Perceptível já com 10 usuários simultâneos mandando heartbeat ingênuo a cada 5s — é desperdício mesmo em baixa escala, vale corrigir de início |
| Screenshare publicado sem simulcast/bitrate configurado explicitamente | Tela compartilhada trava/pixela quando o upload do apresentador está instável, e não se adapta | Configurar `max_bitrate`/`max_framerate` juntos ao publicar (ambos são exigidos simultaneamente pela API) e habilitar simulcast para permitir que o SFU entregue camadas menores a quem tem downlink pior, sem depender só do upload do apresentador | Assim que um dos 10 participantes tiver upload doméstico abaixo do necessário para sustentar mic + vídeo de tela + áudio de sistema simultaneamente — screenshare é o primeiro a degradar, conforme o próprio risco já identificado no design |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Emitir o JWT do LiveKit no cliente (renderer) em vez de numa action do Convex | Vaza a API secret do LiveKit, permitindo qualquer pessoa forjar tokens para qualquer sala | API secret só existe como variável de ambiente do Convex, lida apenas dentro de actions/HTTP actions no backend; renderer nunca vê a secret, só recebe o JWT já assinado e escopado |
| Token do LiveKit sem `room` restrito ou com TTL longo demais | Token roubado/logado permite entrar em qualquer sala por tempo indefinido | Sempre setar `VideoGrant.room = channelId` no momento de assinar, e usar TTL curto (a documentação recomenda TTLs curtos como prática padrão para self-hosted) |
| Registrar custom protocol scheme como alternativa "mais simples" ao loopback | Qualquer outro app instalado no Windows pode registrar o mesmo scheme no registro e interceptar o código de autorização (RFC 8252 §9.1) | Manter a decisão já tomada de usar loopback + PKCE; se algum dia migrar para custom protocol, tratar como decisão de segurança explícita, não atalho de conveniência |
| Guardar o refresh token fora do `safeStorage` (ex: `localStorage` do renderer, arquivo texto) "para debugar mais fácil" | Token de sessão de longa duração exposto em texto plano, legível por qualquer processo com acesso ao disco do usuário | Refresh token só trafega main → `safeStorage`; renderer só recebe o access token de curta duração via IPC |
| Webhook do LiveKit aceito sem validar a assinatura (`Authorization` header) | Qualquer requisição forjada para o endpoint HTTP do Convex pode disparar `leaveVoiceChannel`/manipular `voiceStates` arbitrariamente | Sempre validar via `WebhookReceiver.receive()` com raw body antes de processar qualquer evento |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Indicador de "quem está falando" via `ActiveSpeakers` do LiveKit sem debounce | Ícone de "falando" pisca freneticamente a cada micro-pausa de fala | Aplicar um debounce/hold curto (algumas centenas de ms) antes de desligar o indicador visual |
| Mute/deafen não sincronizado entre `voiceStates` (Convex) e o estado real da track no LiveKit após reconexão | Usuário reabre o app depois de um crash e aparece "mutado" no Convex mas com o microfone realmente ativo no LiveKit (ou vice-versa) | Ao reconectar/entrar novamente no canal, reconciliar explicitamente o estado local (track enabled/disabled) a partir do documento `voiceStates`, não assumir que o estado anterior do LiveKit ainda é válido |
| Deep link / callback OAuth chega com o app fechado (cold start) e não é tratado | Login "não faz nada" na primeira tentativa depois de instalar o app | Mesmo usando loopback (não custom protocol), garantir que o app não seja finalizado enquanto aguarda o callback; tratar o caso de o usuário fechar a janela do app antes do fluxo de auth terminar |
| Compartilhar janela que tem `WDA_EXCLUDEFROMCAPTURE` mostra retângulo preto sem explicação | Usuário acha que o app quebrou ao tentar compartilhar certos apps (gerenciador de senha, DRM) | Detectar quando possível (ou pelo menos documentar/alertar na UI: "algumas janelas não podem ser compartilhadas por proteção do Windows") |
| Chat "quase certo mas irritante": ordenação otimista de mensagens enviadas offline/com latência não reconciliada com `createdAt` do servidor | Mensagens aparecem fora de ordem momentaneamente, ou "pulam" de posição quando o servidor confirma | Usar `createdAt` do servidor como fonte de verdade de ordenação desde o início, tratando o estado otimista como puramente visual/temporário, nunca como chave de ordenação definitiva |

## "Looks Done But Isn't" Checklist

- [ ] **Entrar em canal de voz:** parece completo quando conecta e toca áudio — mas verifique se a linha em `voiceStates` é removida em crash/perda de rede (Pitfall 3), não só em saída explícita.
- [ ] **Compartilhar tela com áudio:** parece completo quando a outra pessoa vê a tela e ouve algum áudio — verifique explicitamente se não há eco da própria voz de quem compartilha (Pitfall 1), testado com 3+ pessoas reais, não só 2.
- [ ] **Login com Google:** parece completo no happy path (rede boa, primeira tentativa) — verifique login com o app fechado por vários dias (refresh token expirado ou não), e com o Windows tendo trocado de conta de usuário (Pitfall 7).
- [ ] **Chat em tempo real:** parece completo com mensagens simples curtas — verifique paginação de histórico longo (Convex limita 32.000 documentos escaneados / 16 MiB lidos por transação) e comportamento da lista quando mensagens chegam durante o carregamento de páginas antigas.
- [ ] **Call de voz com 10 pessoas:** parece completo com 2-3 pessoas testando no mesmo Wi-Fi — verifique com pelo menos um participante em rede restritiva/CGNAT (Pitfall 6) e com upload doméstico limitado durante screenshare simultâneo.
- [ ] **Sessão persistente entre reinícios:** parece completo quando fecha e reabre o app rapidamente — verifique especificamente a expiração do access token do WorkOS em sessão longa (Pitfall 4).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|-----------------|
| Usuários-fantasma acumulados em `voiceStates` (antes de implementar webhook) | LOW | Mutation administrativa/script que zera `voiceStates` cujo `updatedAt`/heartbeat associado está além de um limiar (ex: 60s), executável manualmente até o webhook estar pronto |
| Certificado Caddy perdido por `docker-compose down` | LOW-MEDIUM | Re-emitir via Let's Encrypt (atenção a rate limits: até 5 falhas/hora por domínio); usar staging environment do Let's Encrypt durante testes de configuração para não gastar o limite de produção |
| `isAuthenticated` travado em `false` (Pitfall 4) em produção | LOW | Reload forçado da janela como mitigação imediata; considerar botão "Recarregar" visível na UI de erro em vez de forçar o usuário a fechar/reabrir o app inteiro |
| `safeStorage` irrecuperável após reset de máquina | LOW | Não há recuperação de dado — cair no fluxo de novo login; garantir que esse caminho não precise de suporte manual |
| Eco descoberto tarde demais em F8 já entregue | MEDIUM | Adicionar toggle de "mutar áudio de sistema ao compartilhar" como mitigação rápida enquanto se investiga fix definitivo via `restrictOwnAudio`/mixagem manual |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| Eco do próprio áudio no screenshare | F8 | Teste manual com 3 máquinas: uma compartilha tela+áudio, as outras confirmam ausência de eco/repetição de voz |
| `setDisplayMediaRequestHandler` sem tratamento de cancelamento | F8 | Cancelar o seletor de tela 3x seguidas e confirmar que a 2ª/3ª tentativa ainda funciona normalmente |
| Usuário-fantasma em canal de voz | F7 | Matar o processo Electron à força (Task Manager) com usuário em canal de voz; confirmar que `voiceStates` reflete a saída em segundos, via webhook |
| Convex trava não-autenticado após expiração de token | F2 | Deixar sessão aberta por período maior que o TTL do access token configurado e confirmar que queries reativas continuam funcionando sem reload manual |
| Loopback OAuth fora da RFC 8252 | F2 | Checklist manual: PKCE presente, `state` validado, porta dinâmica, redirect URI sem porta fixa no console do Google/WorkOS |
| WebRTC falha silenciosa atrás de firewall restritivo | F1 | Conectar de uma rede com NAT restritivo/CGNAT (ex: hotspot 4G) e confirmar áudio via candidato TURN relay em `chrome://webrtc-internals` |
| `safeStorage` irrecuperável | F2 (implementação defensiva) / F9 (UX do erro) | Simular corrupção do blob criptografado e confirmar que o app cai no fluxo de login em vez de travar |
| Full table scan em mensagens/voiceStates | F5 / F7 | Revisão de código: toda query com escopo (canal, servidor, usuário) usa `withIndex`, nunca `filter()` isolado como substituto |
| Paginação reativa quebrando UI de lista | F5 | Testar envio de mensagens por um segundo usuário enquanto o primeiro rola histórico antigo |
| Presença com heartbeat caro | F9 (ou desde F2 se presença for implementada cedo) | Verificar no dashboard do Convex o volume de mutations/segundo gerado só por presença com os 10 usuários conectados |
| Janela com `WDA_EXCLUDEFROMCAPTURE` aparecendo preta | F8 | Tentar compartilhar um gerenciador de senhas ou app com DRM conhecido e confirmar que a limitação é entendida/documentada, não tratada como bug |
| Docker compose down apagando certificados | F1 | Documentar no runbook de infra: usar `stop`/`start`, nunca `down`, para operações de rotina |

## Sources

- [Electron — setDisplayMediaRequestHandler / session API](https://www.electronjs.org/docs/latest/api/session) — HIGH (doc oficial)
- [Electron — desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) — HIGH (doc oficial)
- [Electron — safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) — HIGH (doc oficial)
- [Electron PR #30702 — introdução de setDisplayMediaRequestHandler (v22)](https://github.com/electron/electron/pull/30702) — HIGH (código-fonte oficial)
- [Electron issue #45517 — unhandled rejection em setDisplayMediaRequestHandler](https://github.com/electron/electron/issues/45517) — HIGH (issue oficial, com fix sugerido)
- [Electron issue #47980 — falta de tratamento de cancelamento/exceção](https://github.com/electron/electron/issues/47980) — MEDIUM (issue aberta, `blocked/need-repro`)
- [Electron issue #37293 — disable_local_echo / restrictOwnAudio](https://github.com/electron/electron/issues/37293) — HIGH (issue oficial, resolvida via PR #37315)
- [electron-audio-loopback — requisitos de versão](https://github.com/alectrocute/electron-audio-loopback) — MEDIUM (projeto comunitário, mas dados de versão cross-checados)
- [RFC 8252 — OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252.html) — HIGH (RFC oficial IETF)
- [Google — Loopback IP Address flow Migration Guide](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration) — HIGH (doc oficial Google)
- [WorkOS — electron-authkit-example / authkit-electron (custom protocol)](https://github.com/workos/electron-authkit-example) — MEDIUM (exemplo oficial WorkOS, mas via WebFetch de página secundária)
- [get-convex/convex-backend issue #259 — Convex trava não-autenticado após expiração de token WorkOS](https://github.com/get-convex/convex-backend/issues/259) — HIGH (issue oficial do repositório Convex)
- [Convex — Indexes and Query Performance](https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf) — HIGH (doc oficial)
- [Convex — Pagination](https://docs.convex.dev/database/pagination) — HIGH (doc oficial)
- [Convex — Limits](https://docs.convex.dev/production/state/limits) — HIGH (doc oficial)
- [Convex — Runtimes ("use node")](https://docs.convex.dev/functions/runtimes) — HIGH (doc oficial)
- [Convex — Actions](https://docs.convex.dev/functions/actions) — HIGH (doc oficial)
- [Convex — HTTP Actions](https://docs.convex.dev/functions/http-actions) — HIGH (doc oficial)
- [Convex — Custom Auth (ConvexProviderWithAuth)](https://docs.convex.dev/auth/advanced/custom-auth) — HIGH (doc oficial)
- [Convex Stack — Presence with Convex](https://stack.convex.dev/presence-with-convex) — MEDIUM (blog técnico oficial da equipe Convex)
- [LiveKit — Self-hosting ports/firewall](https://docs.livekit.io/home/self-hosting/ports-firewall/) — HIGH (doc oficial)
- [LiveKit — config-sample.yaml](https://github.com/livekit/livekit/blob/master/config-sample.yaml) — HIGH (fonte oficial do repositório)
- [LiveKit issue #3826 — TURN + use_external_ip misconfiguration](https://github.com/livekit/livekit/issues/3826) — MEDIUM (issue da comunidade, fechada sem fix oficial claro)
- [LiveKit — Webhooks](https://docs.livekit.io/home/server/webhooks/) — HIGH (doc oficial)
- [LiveKit — Tokens & grants (VideoGrant, TTL)](https://docs.livekit.io/frontends/reference/tokens-grants/) — HIGH (doc oficial)
- [LiveKit — publish/simulcast bitrate](https://docs.livekit.io/home/client/tracks/publish/) — MEDIUM (doc oficial, mas seção específica de bitrate limitada)
- [Microsoft Learn — SetWindowDisplayAffinity / WDA_EXCLUDEFROMCAPTURE](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity) — HIGH (doc oficial Microsoft)
- [Electron PR #31340 — janela preta em captura com content protection](https://github.com/electron/electron/pull/31340) — MEDIUM (PR do próprio Electron confirmando comportamento por versão do Windows)
- Velocidade média de upload residencial no Brasil (Ookla/Speedtest, ~103 Mbps em amostras 2025) — LOW (amostra enviesada para conexões testadas voluntariamente; não representativa de todos os planos residenciais, especialmente não-fibra); usar apenas como indicativo de que a variância entre membros do grupo pode ser grande, não como baseline de capacidade

---
*Pitfalls research for: cliente desktop Electron de chat + voz (Convex + WorkOS AuthKit + LiveKit self-hosted, Windows)*
*Researched: 2026-08-18*
