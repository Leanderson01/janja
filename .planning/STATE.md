# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-18)

**Core value:** Dez pessoas conseguem entrar num canal de voz e compartilhar
tela com áudio, de forma estável o bastante para o grupo abandonar o Discord.
**Current focus:** Fase 0 — Bootstrap do repo

## Current Position

Phase: 2 (Convex + auth) — Fases 0, 1 e 3 concluídas
Plan: 1 of 5 concluído na Fase 3
Status: Fase 3 onda 2 em execução
Last activity: 2026-08-18 — Roadmap criado (10 fases, 59/59 requisitos mapeados)

Progress: [███░░░░░░░] 33%

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

### Pending Todos

Nenhum ainda.

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

- [Processo] **Escrita concorrente em arquivos compartilhados.** Três
  planejadores paralelos editaram `ROADMAP.md` ao mesmo tempo e a entrada da
  Fase 0 foi sobrescrita e perdida — problema independente do incidente acima.
  Agentes paralelos escrevem SOMENTE nos próprios diretórios de fase; o
  orquestrador consolida `ROADMAP.md` e `STATE.md` sequencialmente depois.

## Session Continuity

Last session: 2026-08-18
Stopped at: Fases 1 (2 plans) e 3 (5 plans) planejadas e commitadas.
Fase 0 sendo replanejada após o incidente registrado em Blockers/Concerns.
Repo sincronizado com origin/main, working tree limpo, cobertura de
requisitos reverificada em 59/59 após a recuperação.
Próximo passo: executar Fase 0, depois Fase 3.
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
