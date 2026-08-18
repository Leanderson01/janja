# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-18)

**Core value:** Dez pessoas conseguem entrar num canal de voz e compartilhar
tela com áudio, de forma estável o bastante para o grupo abandonar o Discord.
**Current focus:** Fase 0 — Bootstrap do repo

## Current Position

Phase: 0 of 9 (Bootstrap do repo)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-08-18 — Roadmap criado (10 fases, 59/59 requisitos mapeados)

Progress: [░░░░░░░░░░] 0%

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

## Session Continuity

Last session: 2026-08-18
Stopped at: ROADMAP.md e STATE.md criados; REQUIREMENTS.md atualizado com
traceability completa (59/59 requisitos mapeados). Próximo passo:
`/gsd:plan-phase 0`.
Resume file: None
