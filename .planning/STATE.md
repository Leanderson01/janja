# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-18)

**Core value:** Dez pessoas conseguem entrar num canal de voz e compartilhar
tela com áudio, de forma estável o bastante para o grupo abandonar o Discord.
**Current focus:** Fase 0 — Bootstrap do repo

## Current Position

Phase: 5 e 6 em execução — Fases 0, 1, 2 e 3 concluídas; Fase 4 aguardando verificação humana; Fase 7 em execução (07-06 concluído); Fase 9 em execução (09-01 e 09-02 concluídos)
Plan: 1 of 5 concluído na Fase 3; 2 of 3 concluídos na Fase 9
Status: Fase 3 onda 2 em execução; Fase 7 com push-to-talk implementado no nível de código (07-06), aguardando verificação humana em Windows (07-08); Fase 9 com empacotamento (09-01) e página de conclusão de login/AUTH-07 (09-02) implementados e verificados no que dá para verificar em WSL2, aguardando o checkpoint humano de 09-03 em Windows (que inclui trocar o redirect URI no dashboard da WorkOS — ver ordem obrigatória em 09-02-SUMMARY.md)
Last activity: 2026-08-19 — Concluído 07-06-push-to-talk-PLAN.md (código, sem verificação de "sem foco" — pendente 07-08); concluído 09-01-empacotamento-binario-e-modulos-nativos-PLAN.md; concluído 09-02-pagina-de-conclusao-de-login-PLAN.md

Progress: [█████░░░░░] 56%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisões completas no PROJECT.md, tabela "Key Decisions". Decisões que afetam
diretamente o roadmap:

- [Roadmap]: F9 renomeada de "Presença, settings, packaging" (design §9) para
  "Polimento e empacotamento" — presença online/offline (APP-02, SOCIAL-04) é
  requisito v1 e foi movida para F4/F6, onde os requisitos realmente vivem.
- [Roadmap]: APP-04 (instância única) movida para F0 — é precondição técnica
  para AUTH-01 (retorno do OAuth via `second-instance` no Windows).
- [F2]: TTL do access token do WorkOS em 8-12h (não o padrão de 5 min) para
  evitar o bug conhecido `get-convex/convex-backend#259`.
- [F7]: Reconciliação de `voiceStates` por webhook do LiveKit é critério de
  aceite da fase, não um follow-up — evita usuário-fantasma após crash.
- [F9]: `uiohook-napi` (push-to-talk, VOICE-11) é dependência nativa
  implementada em F7 mas com risco de empacotamento verificado só em F9.
- [F3]: Larguras de coluna do shell (rail 72px, sidebar/membros 240px) são
  fixas, sem componente de resize arrastável — Discord real não permite
  arrastar essas bordas, e usar `Resizable` do shadcn introduziria risco de
  API sem ganho de UX. Ver `.planning/phases/03-shell-da-ui/03-RESEARCH.md`.
- [07-06]: hook global de teclado (`uiohook-napi`) só liga a captura nativa
  (`uIOhook.start()`) quando o renderer confirma que o modo de voz salvo é
  'ptt' (IPC `SET_PTT_MODE_ACTIVE`) — nunca captura teclado do SO à toa em
  modo VAD (o padrão). Extensão sobre o desenho original de
  `07-RESEARCH.md §7` (que previa o hook sempre rodando). Ver
  `07-06-SUMMARY.md`.
- [09-01]: `electron-builder install-app-deps` (usado no `postinstall`) quebra
  `npm install` em qualquer máquina sem toolchain C/C++ completo — achado novo,
  confirmado rodando o comando de verdade: `@electron/rebuild` não reconhece o
  nome de arquivo que `uiohook-napi` usa para seus prebuilds
  (`uiohook-napi.node`, não `node.napi.node`), então tenta recompilar via
  `node-gyp` e falha. `npmRebuild: false` no `electron-builder.yml` não evita
  isso (só é lido pelo pipeline de empacotamento real, não pelo comando
  standalone de postinstall). Isolado num wrapper
  (`scripts/postinstall-rebuild.mjs`) que nunca deixa essa falha abortar o
  `npm install`. Ver `09-01-SUMMARY.md`.
- [09-01]: confirmado por build real gerado em WSL2 (`electron-builder --win
  --dir`) que `uiohook-napi` sai do asar corretamente
  (`app.asar.unpacked/node_modules/uiohook-napi/prebuilds/win32-x64/
  uiohook-napi.node`, verificado com `asar list`/`asar extract-file`). O
  instalador NSIS completo (`.exe`) não roda em WSL2 por falta de `wine`
  (`spawn wine ENOENT`) — limitação de ambiente conhecida, prova final fica
  para o checkpoint humano do Plano 09-03.
- [09-02]: AUTH-07 implementado — rota `GET /auth/complete` nova em
  `convex/http.ts` (adicionada ao `httpRouter` já existente da Fase 7, sem
  tocar no webhook do LiveKit), servindo HTML autocontido que confirma o
  login e redireciona para `janja://callback`. `REDIRECT_URI` em
  `src/main/auth/auth.ts` passou de `janja://callback` direto para
  `${VITE_CONVEX_SITE_URL}/auth/complete`. Também fechado o crash de módulo
  remanescente em `src/renderer/src/lib/convex-client.ts` (mesma classe do
  achado #3 de `02-VERIFICACAO.md`, nunca corrigido aqui antes) — agora
  `isConvexConfigured` é estado, checado em `main.tsx` antes de montar o
  provider. **Pendente:** trocar o redirect URI no dashboard da WorkOS é um
  passo humano com ordem obrigatória (env var → deploy Convex → verificar
  rota no ar → build novo → só então dashboard) — inverter a ordem quebra o
  login de formas diferentes conforme o passo pulado; ver
  `09-02-SUMMARY.md` seção "User Setup Required" para o detalhamento
  completo, alocado ao checkpoint humano do Plano 09-03.

### Pending Todos

1 pendente:

- [F7/voz] Voz não sai no modo VAD (padrão) — usuário novo fica mudo até trocar
  para push-to-talk. `.planning/todos/pending/2026-08-19-voz-nao-sai-em-modo-vad-no-primeiro-uso.md`

### Blockers/Concerns

- [F1] Confirmar se a porta 443 da VPS já está ocupada (Nginx/Traefik
  existente) antes de configurar o Caddy do LiveKit.
- [F8] Validação exige máquina Windows nativa — não é testável no ambiente de
  desenvolvimento WSL2. Reservar tempo de acesso à máquina antes de fechar a
  fase.
- [F1] INFRA-02 precisa ser validado a partir de rede restritiva de verdade
  (hotspot 4G/CGNAT), não só da rede doméstica — modo de falha é silencioso.
- [Processo] **Incidente 2026-08-18 — perda de dados durante a Fase 0.** O agente
  executor rodou o scaffolder do electron-vite com `yes |` para evitar prompts
  interativos. O `yes` respondeu "y" a todos os prompts, incluindo o de nome do
  projeto (gerando `package.json` de 34 KB com `"name": "yyyy..."`) e o de
  "diretório não vazio, sobrescrever?" — apagando `.git`, `docs/`, `.claude/` e
  parte de `.planning/`. Recuperado por clone do remote, que tinha sido pushado
  minutos antes. Perda líquida: os 3 planos + research da Fase 0, que existiam
  apenas em commit local.

  Nota: um agente diagnosticou a causa como "janja não tem .git próprio dentro do
  umbrella /home/leo/workspace". **Esse diagnóstico está errado** — o janja tinha
  e tem `.git` próprio, funcionando e sincronizado com o GitHub. A causa foi o
  `yes |`. Registrado porque a recomendação derivada daquele diagnóstico
  (`git init` isolado) não teria evitado nada.

  Regras derivadas, obrigatórias daqui em diante:
  1. Scaffolder interativo NUNCA roda dentro do repo. Gera em diretório
     temporário vazio, confere, e só então copia para dentro.
  2. Proibido `yes |`, `--force` ou auto-confirmação cega contra qualquer
     ferramenta que rode no diretório do projeto.
  3. Após qualquer scaffold, verificar que `.git`, `.planning/`, `docs/` e
     `.claude/` continuam existindo antes de seguir.
  4. `git push` a cada commit de planejamento, não em lote — foi o push
     antecipado que salvou o projeto.

- [F9] `build:win` (o comando que gera o instalador Windows) só é testável de
  ponta a ponta numa máquina Windows nativa — WSL2 não tem `wine`, então a
  etapa de compilação do instalador NSIS (`.exe`) não roda aqui. `--win --dir`
  (sem NSIS) já foi verificado com sucesso neste ambiente. Ver `09-01-SUMMARY.md`.
- [Processo] **Escrita concorrente em arquivos compartilhados.** Três
  planejadores paralelos editaram `ROADMAP.md` ao mesmo tempo e a entrada da
  Fase 0 foi sobrescrita e perdida — problema independente do incidente acima.
  Agentes paralelos escrevem SOMENTE nos próprios diretórios de fase; o
  orquestrador consolida `ROADMAP.md` e `STATE.md` sequencialmente depois.

## Session Continuity

Last session: 2026-08-19
Stopped at: Concluído 09-02-pagina-de-conclusao-de-login-PLAN.md (AUTH-07 —
rota `/auth/complete` no Convex, `redirectUri` da WorkOS migrado para ela,
crash de módulo em `convex-client.ts` corrigido). Arquivos não commitados
(NO_GIT no prompt de execução) — orquestrador commita. 173 testes passam,
`npm run typecheck` e `npm run build` limpos. Antes disso: concluído
07-06-push-to-talk-PLAN.md (código de push-to-talk completo — hook global
de teclado no processo main, IPC, VoiceProvider reagindo aos eventos).
Verificação de "funciona sem foco" continua pendente do Plano 07-08
(Windows nativo).
Próximo passo: 09-03 (checkpoint humano em Windows — trocar redirect URI
no dashboard da WorkOS seguindo a ordem obrigatória documentada em
09-02-SUMMARY.md, testar login de ponta a ponta e o Brave); 07-07 (sons de
canal) e/ou 07-08 (verificação final humana
em Windows).
Resume file: None

## Decisão registrada — 2026-08-18

**AUTH-07: página de conclusão de login no navegador.**

Após o login, a aba do navegador fica parada na página interna do provedor de
autenticação. Não há como fechá-la a partir do app: a aba foi aberta pelo sistema
operacional a pedido do `shell.openExternal`, não por script, e navegadores
bloqueiam `window.close()` nesse caso por design. Comportamento idêntico ao de
Discord, Slack e Spotify.

O que **é** possível, e foi decidido fazer: servir uma página própria de conclusão,
que confirma o sucesso do login e instrui a fechar a aba.

**Caminho técnico sem infraestrutura nova:** uma HTTP action do Convex, servindo
HTML em `VITE_CONVEX_SITE_URL`. O redirect URI cadastrado no WorkOS passa a
apontar para essa página, que dispara o `janja://callback` e exibe a confirmação.
HTTP actions do Convex já fazem parte da stack — a Fase 7 depende delas para o
webhook de reconciliação do LiveKit.

**Alocado à Fase 9** (polimento), não à Fase 2: é melhoria de acabamento, não
bloqueia nenhum fluxo, e a Fase 2 já cumpre AUTH-01..06.

## Marco — 2026-08-19: voz provada ponta a ponta

O teste de ida e volta pelo servidor funcionou na máquina do Leo. Áudio saiu do
microfone, foi assinado por token do Convex, atravessou o SFU na VPS e voltou audível.

Isso prova a corrente inteira sem depender de uma segunda pessoa: autenticação →
autorização por participação → assinatura de token → conexão WebRTC → SFU self-hosted →
retorno. Era o risco central do projeto, e o motivo pelo qual a Fase 1 veio antes de
qualquer código de produto.

Verificado junto na mesma rodada: `CHAT-14` (posição inicial do scroll) e `VOICE-21`
(medidor de nível).

**Decisão do Leo:** remover a gravação/reprodução local do testador. O teste pelo
servidor faz tudo que ela fazia e prova mais. O medidor de nível fica — é o que torna o
slider de sensibilidade do VAD utilizável, e funciona sem rede.

**O que continua não provado:** duas pessoas se ouvindo. O testador prova que o caminho
existe e funciona; não prova que dois participantes distintos trocam áudio. Fase 07-08.

## Marco — 2026-08-19: duas pessoas se ouviram

Leo e um amigo entraram no mesmo canal de voz e trocaram áudio. É o core value do
projeto: tudo construído antes existia para sustentar isso.

Verificado no caminho: entrar em canal, sair, avatares dos participantes visíveis na
sidebar, e o áudio remoto de fato tocando — este último só passou a funcionar depois que
o plano 07-05 descobriu que nenhum plano anterior chamava `track.attach()`.

### Três defeitos de rede corrigidos até chegar aqui

1. **URL do Convex com barra no final** — o cliente concatenava e gerava `//api`, o
   servidor devolvia 404, e o app carregava para sempre depois do login. Normalizado no
   código, para não depender de todo mundo copiar certo.
2. **Coleta de candidatos ICE em interface morta** — o Chromium enumera todas as
   interfaces, incluindo adaptadores virtuais de VM, Docker e WSL. Restringido à rota
   padrão.
3. **DNS sobre HTTPS falhando** — o Chromium tenta DoH em modo automático mais consultas
   de tipo extra. Na rede do testador, servida por DNS IPv6, a resolução falhava só no
   módulo P2P, enquanto `nslookup` e todo o resto funcionavam. Desligado.

Nenhum dos três seria encontrado sem execução real em outra máquina. Os três eram
invisíveis para build, typecheck e os 173 testes.

### Risco em aberto — conexão duplicada ao LiveKit

Um log do testador mostrou DUAS conexões numa única entrada: dois tokens, dois
`connected to LiveKit Server`, um só `publishing track`. Mesma identidade nas duas, então
o SFU derruba a mais antiga e o áudio funciona ou não conforme qual sobreviveu.

A fila serializada de transições em `voice-context.tsx` deveria impedir isso, e na
máquina do Leo impediu. **A divergência não foi explicada.**

Foi adicionada uma barreira que checa `room.state` antes de conectar. No teste seguinte o
aviso da barreira NÃO apareceu — ou seja, a duplicação não ocorreu, e a barreira nem
chegou a agir. Isso não prova correção: prova que o timing daquela execução não disparou
a corrida.

### Resolvido em 2026-08-19 — causa raiz encontrada

A fila serializada funcionava: ela ordena as invocações corretamente, inclusive sob o
duplo disparo do StrictMode. O furo estava na guarda — `activeChannelRef` só é atribuído
no FIM de um join bem-sucedido.

Quando a primeira tentativa falhava antes de chegar lá — e na máquina do testador ela
falhava, por causa dos problemas de DNS e coleta de ICE corrigidos na mesma sessão — a
segunda invocação enfileirada via `activeChannelRef` diferente do alvo e refazia o join
inteiro: token novo, conexão nova.

Isso explica a divergência entre as duas máquinas, que era o dado que faltava: na do Leo
a primeira tentativa sucedia e a segunda saía pela guarda; na do amigo falhava, e a
segunda tentava de novo.

Lição: uma guarda que só marca sucesso não protege o caminho de falha. E o sintoma
aparecia longe da causa — dois tokens no LiveKit, por causa de um DNS que não resolvia.

~~**Fica registrado como risco conhecido, não como resolvido.**~~ Se o aviso
`conexão já em andamento ou ativa` aparecer em algum console, é a evidência que falta —
capturar o log inteiro daquele momento.

O cenário onde isso mais provavelmente volta é o da Fase 07-08: dez pessoas entrando e
saindo de canal ao mesmo tempo, que é exatamente quando timing deixa de ser previsível.
