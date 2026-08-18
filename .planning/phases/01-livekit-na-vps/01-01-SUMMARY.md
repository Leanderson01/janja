---
phase: 01-livekit-na-vps
plan: 01
subsystem: infra
tags: [livekit, coolify, traefik, docker-compose, certbot-dns-multi, hostinger, turn, webrtc]

# Dependency graph
requires:
  - phase: 01-livekit-na-vps (01-RESEARCH.md)
    provides: decisões de rede/certificado confirmadas contra o ambiente real (Coolify 4.1.2 + Traefik v3.6, DNS na Hostinger)
provides:
  - "infra/livekit/livekit.yaml completo (rtc mux de porta única, turn habilitado, keys placeholder, webhook reservado pra F7)"
  - "infra/livekit/docker-compose.yml pronto pra ser consumido como Coolify Docker Compose Resource (Base Directory /infra/livekit)"
  - "infra/livekit/.env.example e infra/livekit/dns-multi.ini.example documentando todas as variáveis/credenciais manuais"
  - "infra/livekit/turn-cert-init.sh (emissão/renovação de certificado do TURN via DNS-01, sem depender da porta 80)"
affects: ["01-02 (deploy manual na VPS, checkpoint humano)", "F7 (webhook do LiveKit pro Convex)"]

# Tech tracking
tech-stack:
  added: ["livekit/livekit-server:v1.13.5 (imagem Docker, pinada)", "ghcr.io/alexzorin/certbot-dns-multi:5.3.1"]
  patterns: ["rtc.udp_port mux de porta única em vez de port_range_start/end, pra compatibilidade com rede bridge do Coolify", "certificado do TURN emitido/renovado via DNS-01 independente do certificado da sinalização WSS (gerenciado pelo Traefik/Coolify)"]

key-files:
  created:
    - infra/livekit/livekit.yaml
    - infra/livekit/.env.example
    - infra/livekit/docker-compose.yml
    - infra/livekit/dns-multi.ini.example
    - infra/livekit/turn-cert-init.sh
  modified: []

key-decisions:
  - "livekit-server roda em rede bridge padrão do Coolify (sem network_mode: host, sem networks: custom) — necessário pro Traefik alcançar o container e rotear a porta 7880 (API/WS) via domínio atribuído na UI"
  - "rtc.udp_port: 7882 (mux de porta única) em vez do range 50000-60000 — oficialmente suportado, evita ~10 mil regras DNAT, trade-off de performance aceitável no volume desta fase (MVP)"
  - "Certificado do TURN (porta 5349) emitido via DNS-01 (certbot-dns-multi, provider hostinger) — HTTP-01/standalone descartado porque a porta 80 pertence ao Traefik do Coolify"
  - "Imagem do livekit-server pinada em v1.13.5 (não :latest), mesma lógica de pin usada em F0 pro Electron"

patterns-established:
  - "Config estática (livekit.yaml) montada read-only no container, sem interpolação de env var — valores reais de keys copiados manualmente pós-deploy, documentado no próprio arquivo"

# Metrics
duration: 5min
completed: 2026-08-18
---

# Fase 01 Plano 01: Config LiveKit (artefatos versionados) Summary

**5 artefatos versionados em `infra/livekit/` — livekit.yaml (rtc mux de porta única + turn DNS-01), docker-compose.yml sem `network_mode: host`/`networks:` custom pronto pro Coolify consumir como Docker Compose Resource, .env.example, dns-multi.ini.example e turn-cert-init.sh (certbot-dns-multi via Docker) — nenhum deles testado contra a VPS real, só escritos e verificados localmente por grep/estrutura.**

## Performance

- **Duration:** ~5 min (execução autônoma, sem checkpoints)
- **Completed:** 2026-08-18T19:38:00Z
- **Tasks:** 2/2
- **Files modified:** 5 criados, 0 modificados

## Accomplishments
- `livekit.yaml` completo: `rtc.udp_port: 7882` (mux, não range), `use_external_ip: true`, `turn.enabled: true` com `tls_port: 5349` e `domain: livekit.usesenju.com`, `keys` com placeholder documentado, `webhook` comentado e reservado pra F7
- `docker-compose.yml` desenhado especificamente pro modelo "Coolify Docker Compose Resource" (rede bridge padrão, sem custom `networks:`, sem `network_mode: host`), publicando só as 4 portas que devem contornar o Traefik (7881/tcp, 7882/udp, 3478/udp, 5349/tcp) — 7880 fica de fora de propósito
- `.env.example` e `dns-multi.ini.example` documentam, juntos, todas as 5 variáveis/credenciais que o humano precisa preencher manualmente, cada uma com nota de onde entra (UI do Coolify vs arquivo só na VPS)
- `turn-cert-init.sh` emite/renova o certificado do TURN via desafio DNS-01 (certbot-dns-multi, provider hostinger, imagem `ghcr.io/alexzorin/certbot-dns-multi:5.3.1`) — não usa a porta 80

## Task Commits

Each task was committed atomically:

1. **Task 1: livekit.yaml e .env.example** - `78d8291` (feat)
2. **Task 2: docker-compose.yml, template de credenciais da Hostinger e script de certificado do TURN** - `4e88000` (feat)

_Nota: o commit original da Task 2 (`e1704f4`) incluiu por engano um arquivo de outro agente (`src/renderer/src/data/mock-data.ts`) devido a uma corrida no índice compartilhado do git — corrigido no mesmo minuto com `git reset --soft HEAD~1` + `git restore --staged` do arquivo alheio, e recommitado como `4e88000` contendo só os 3 arquivos desta task. O arquivo do outro agente voltou ao estado untracked original e foi commitado por ele próprio depois, em `2db6d8b` (fora deste plano). Nenhum conteúdo foi perdido._

**Plan metadata:** (este commit de SUMMARY, feito a seguir)

## Files Created/Modified
- `infra/livekit/livekit.yaml` - Config estática do livekit-server (rtc, turn, keys, logging, webhook comentado)
- `infra/livekit/.env.example` - Template de variáveis (DOMAIN, LIVEKIT_API_KEY/SECRET, CERT_EMAIL, HOSTINGER_API_TOKEN)
- `infra/livekit/docker-compose.yml` - Stack única pro Coolify (livekit-server, rede bridge padrão, portas TURN/RTC publicadas)
- `infra/livekit/dns-multi.ini.example` - Template de credenciais do certbot-dns-multi pro provider hostinger
- `infra/livekit/turn-cert-init.sh` - Script de emissão/renovação do certificado do TURN via DNS-01 (executável)

## Decisions Made
- Nenhuma decisão nova além das já tomadas em `01-RESEARCH.md` — este plano só implementou o que a pesquisa já havia decidido (mux de porta única, rede bridge padrão do Coolify, DNS-01 pro cert do TURN, imagem pinada v1.13.5). Ver seção `key-decisions` no frontmatter para o resumo.

## Deviations from Plan

### Auto-fixed Issues

Nenhum deviation no sentido das Rules 1-4 (nenhum bug, funcionalidade crítica faltando, blocker ou mudança arquitetural encontrados durante a execução — o plano já vinha com o design correto do research).

### Nota sobre imprecisão do próprio comando de verificação do plano

O plano pede `grep -c "port_range_start" infra/livekit/livekit.yaml` → espera `0`. O
comando real retorna `2`, porque os comentários do próprio template do plano
(copiados verbatim, linhas 10 e 18 do `livekit.yaml`) mencionam
`port_range_start`/`port_range_end` explicando por que a config usa
`udp_port` no lugar deles — o grep literal conta essas menções em comentário,
não a chave YAML real. Confirmado com um grep mais preciso, restrito à chave
de config de fato (`^\s*port_range_(start|end):`), que retorna `0` — ou seja,
a intenção da verificação ("o range de 10 mil portas não voltou por engano")
está satisfeita; é o comando de grep do próprio plano que é impreciso demais
pra distinguir comentário de config real. Não alterei o texto do comentário
(foi ditado literalmente pelo plano e é documentação correta e valiosa) —
registrando aqui em vez de mascarar o resultado.

---

**Total deviations:** 0 auto-fixed via Rules 1-4. 1 nota de imprecisão de verificação (documentada acima, não é um problema no artefato).
**Impact on plan:** Nenhum impacto na substância dos artefatos. O plano foi executado como escrito.

## Issues Encountered
- Corrida de escrita no índice do git com o agente concorrente que executa a Fase 3 (UI shell): o segundo `git commit` da Task 2 capturou um arquivo alheio (`src/renderer/src/data/mock-data.ts`) que havia sido `git add`-ado por aquele outro agente entre meu `git status` e meu `git commit`. Detectado imediatamente ao inspecionar `git show --stat HEAD` logo após o commit, corrigido com `git reset --soft HEAD~1` seguido de `git restore --staged <arquivo alheio>` e recommit só dos meus 3 arquivos — sem `git checkout`/`reset --hard`/`clean`, sem tocar no conteúdo do outro agente. Working tree confirmado idêntico ao estado anterior (`git status --porcelain` voltou a mostrar `src/renderer/src/data/` como untracked). O outro agente commitou seu próprio arquivo depois, de forma independente (`2db6d8b`).

## User Setup Required

Nenhuma configuração de serviço externo *deste plano* especificamente — mas o
deploy real (plano `01-02`, fora do escopo desta execução) vai exigir, na
VPS, os passos documentados dentro dos próprios artefatos criados aqui:
1. Preencher `infra/livekit/.env.example` → copiar como referência (não como `.env` real: nenhum arquivo deste diretório lê env vars automaticamente)
2. Gerar `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` com `openssl rand -hex 32` e colar em `livekit.yaml` (`keys:`) e nas env vars da stack no Coolify
3. Copiar `dns-multi.ini.example` preenchido pra `/etc/letsencrypt/dns-multi.ini` na VPS (`chmod 0600`), fora do repo
4. Rodar `turn-cert-init.sh` na VPS pra emitir o certificado do TURN via DNS-01
5. Criar o recurso Docker Compose no Coolify apontando `Base Directory` = `/infra/livekit`

Nenhum desses passos foi executado nem verificado por mim — não tenho acesso
SSH à VPS. Ver `01-02-PLAN.md` (fora do escopo desta execução).

## Next Phase Readiness

**O que está pronto:** todos os 5 artefatos de `infra/livekit/` existem, com a
estrutura de config/rede/certificado que o `01-RESEARCH.md` confirmou ser
compatível com o ambiente real (Coolify 4.1.2 + Traefik v3.6 + DNS na
Hostinger). Verificado localmente por grep/inspeção de estrutura — todas as
condições do bloco `<verification>` do plano confirmadas (exceto a
imprecisão de grep documentada acima, cuja intenção real também foi
confirmada por um grep mais preciso).

**O que NÃO foi verificado (honestamente, porque não há como, sem SSH):**
- Se o `docker-compose.yml` sobe de fato como Coolify Docker Compose Resource
- Se o Traefik realmente roteia a porta 7880 via domínio atribuído na UI
- Se `turn-cert-init.sh` emite o certificado com sucesso contra a API real da
  Hostinger (token real, propagação de DNS)
- Se o candidato `relay` do WebRTC é de fato selecionado numa rede CGNAT real
  (INFRA-02, método descrito em `01-RESEARCH.md` §8)
- Se o serviço sobrevive a reboot da VPS supervisionado pelo Coolify (INFRA-04)

Tudo isso é escopo do plano `01-02` (checkpoint humano), que consome estes
artefatos mas exige acesso real à VPS.

**Bloqueios/preocupações a carregar para `01-02`:**
- Risco residual documentado em `01-RESEARCH.md` §6: `turn.tls_port: 5349`
  (não 443) pode falhar em redes que filtram tudo exceto 80/443 — só o teste
  real do runbook confirma ou descarta isso.
- Lembrete recorrente do próprio `livekit.yaml`: se o Coolify re-clonar o
  repo num redeploy futuro, o placeholder de `keys:` volta — conferir sempre
  depois de um redeploy.

---
*Phase: 01-livekit-na-vps*
*Completed: 2026-08-18*
