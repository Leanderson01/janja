---
phase: 01-livekit-na-vps
plan: 02
subsystem: infra
tags: [livekit, coolify, traefik, docker-compose, certbot-dns-multi, hostinger, turn, webrtc, runbook]

# Dependency graph
requires:
  - phase: 01-livekit-na-vps (01-01-SUMMARY.md)
    provides: "artefatos versionados (livekit.yaml, docker-compose.yml, .env.example, dns-multi.ini.example, turn-cert-init.sh) que este runbook consome"
  - phase: 01-livekit-na-vps (01-RESEARCH.md)
    provides: "decisões de arquitetura (Coolify Docker Compose Resource, mux de porta única, DNS-01 pro cert do TURN) e o risco residual §6 citados no runbook"
provides:
  - "infra/livekit/DEPLOY-RUNBOOK.md — checklist executável por humano, do estado atual (Coolify instalado, nada do LiveKit configurado) até os 4 success criteria da Fase 1"
affects: ["01-02 (o próprio checkpoint humano deste plano, ainda pendente)", "qualquer plano de fechamento de gap que resulte da execução real do runbook"]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - infra/livekit/DEPLOY-RUNBOOK.md
  modified: []

key-decisions:
  - "Runbook escrito para não assumir nenhum conhecimento prévio das docs de planejamento — cada passo é autocontido, com comando exato e resultado esperado"
  - "Passo 8 (corrigir keys no checkout do Coolify) marcado com aviso destacado e reforçado no passo 10 e na seção 12 (Manutenção) — é o gap mais fácil de reintroduzir silenciosamente após um redeploy"
  - "Teste de relay (INFRA-02) exige explicitamente hotspot 4G real com CGNAT, não wifi de casa, com nota direta para 01-RESEARCH.md §6 como suspeito primário se falhar"

# Metrics
duration: ~10min
completed: 2026-08-18
---

# Fase 01 Plano 02: Runbook de Deploy Summary

**`infra/livekit/DEPLOY-RUNBOOK.md` escrito e commitado (12 seções numeradas, comando exato + resultado esperado em cada passo) — mas o deploy real na VPS NÃO foi executado, e a Fase 1 permanece não comprovada, porque este ambiente de execução não tem acesso SSH/DNS/Coolify.**

## O que foi feito

A única tarefa autônoma deste plano — escrever
`infra/livekit/DEPLOY-RUNBOOK.md` — foi concluída e commitada
(`85dcb7d`). O runbook cobre, nesta ordem exata:

1. Token de API da Hostinger
2. Registro DNS (`livekit.usesenju.com` → IP da VPS, validado com `dig`)
3. Firewall (5349/tcp, 3478/udp, 7881/tcp, 7882/udp — SO + painel de nuvem)
4. Certificado do TURN via DNS-01 (`turn-cert-init.sh`, credenciais em
   `/etc/letsencrypt/dns-multi.ini` com `chmod 0600`, aviso explícito contra
   `export VAR=secret` no shell)
5. Cron de renovação mensal + lembrete de restart manual pós-renovação
6. `.env` local + geração das duas chaves (`openssl rand -hex 32`) +
   cópia para `keys:` de `livekit.yaml`
7. Criação do recurso Docker Compose no Coolify (Base Directory
   `/infra/livekit`, Docker Compose Location `docker-compose.yml`)
8. Correção do placeholder `keys` no checkout real do Coolify na VPS —
   com aviso destacado (blockquote) de que um redeploy futuro reverte esse
   valor, e instrução explícita de reconferir depois de qualquer redeploy
9. Domínio + variáveis na UI do Coolify
   (`https://livekit.usesenju.com:7880`)
10. Deploy pela UI, com nota sobre possível erro de bind mount absoluto
11. Os 4 testes de validação, cada um mapeado a um success criteria da
    fase (INFRA-01..04), incluindo a instrução explícita de usar hotspot
    4G real (não wifi de casa) no teste de relay e a referência direta a
    `01-RESEARCH.md` §6 como suspeito primário se esse teste falhar
12. Manutenção (sempre via UI do Coolify, nunca `docker compose down`
    manual; reconferir passo 8 após qualquer redeploy)

Não existe mais bifurcação "Caminho A / Caminho B" nem qualquer menção a
"porta 443 livre/ocupada" — confirmado por grep (`0` ocorrências). Todos os
outros greps de verificação do plano (`chrome://webrtc-internals`,
`dns-multi.ini`, `Base Directory`, `sudo reboot`) retornaram linha.

## O que NÃO foi feito — e por quê

**O deploy real na VPS não foi executado.** Este ambiente de execução não
tem acesso SSH à VPS, acesso à API/hPanel da Hostinger, acesso admin ao
Coolify, nem acesso ao firewall do provedor de nuvem. A tarefa seguinte do
plano é explicitamente um `checkpoint:human-action` — o próprio plano já
prevê que a execução autônoma para exatamente aqui, e que um humano com
acesso real à VPS precisa rodar o runbook de fato.

Consequentemente, **nenhum dos 4 success criteria da Fase 1 foi comprovado
nesta execução:**

1. TLS válido sem aviso em `wss://livekit.usesenju.com` — **não testado**
2. Candidato `relay` selecionado de rede CGNAT real (hotspot 4G) — **não
   testado**
3. Candidatos ICE com IP público da VPS — **não testado**
4. Sobrevive a `sudo reboot` — **não testado**

O risco residual documentado em `01-RESEARCH.md` §6 (TURN na porta 5349 em
vez da 443 recomendada, porque a 443 pertence ao Traefik do Coolify) **não
foi confirmado nem descartado** — só o teste real, rodado por quem tem
acesso à VPS e a uma rede móvel real, resolve essa pergunta.

## Deviations from Plan

Nenhuma. O plano previa exatamente este resultado para a Task 1 (escrever o
runbook) e uma pausa no checkpoint humano — que é o estado em que este
plano fica agora.

## Task Commits

1. **Task 1: Escrever DEPLOY-RUNBOOK.md** — `85dcb7d` (docs)

## Próximo passo — ação humana necessária

O dono da VPS precisa:

1. Abrir `infra/livekit/DEPLOY-RUNBOOK.md` e seguir os 12 passos na ordem,
   na VPS real.
2. Prestar atenção especial ao passo 8 (`keys` no checkout) e ao teste (b)
   de relay (usar hotspot 4G real, não wifi de casa).
3. Reportar o resultado: "aprovado" se os 4 critérios passaram, ou detalhar
   qual passo falhou (com o output/erro exato), especialmente se foi o
   risco residual de TURN fora da 443 (§6).

**Este plano (`01-02`) permanece em aberto até essa confirmação humana
chegar.** A Fase 1 não está pronta enquanto os 4 success criteria não
forem comprovados na VPS real — os artefatos (deste plano e do `01-01`)
sozinhos não provam nada sobre TURN, TLS ou reboot.

## Next Phase Readiness

**Bloqueio explícito para considerar a Fase 1 concluída:** falta a execução
humana do runbook e o registro do resultado real dos 4 testes de validação.
Nenhuma fase subsequente que dependa de LiveKit funcionando de fato deveria
avançar até esse checkpoint ser resolvido (aprovado ou com gap registrado).

---
*Phase: 01-livekit-na-vps*
*Completed (apenas a Task 1 autônoma): 2026-08-18*
*Checkpoint humano: pendente*
