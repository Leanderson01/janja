# Fase 1 — Verificação dos critérios de sucesso

**Data:** 2026-08-18
**Resultado:** aprovada, 4/4 critérios cumpridos

| Req | Critério | Evidência |
|---|---|---|
| INFRA-01 | TLS válido em `wss://livekit.usesenju.com` | Certificado Let's Encrypt `CN=livekit.usesenju.com`, válido até 2026-11-16, verificado externamente via `openssl s_client`. Endpoint responde HTTP 200 com `ssl_verify_result=0` |
| INFRA-02 | Candidato `relay` de rede restritiva | `livekit.io/connection-test` a partir de 5G real, **todas as linhas verdes**, incluindo "Can connect via TURN" |
| INFRA-03 | Candidatos ICE com IP público | Log do servidor: `found external IP via STUN {"externalIP": "72.60.4.119"}` e `nodeIP: 72.60.4.119` |
| INFRA-04 | Sobrevive a reboot | `sudo reboot` executado; `uptime -p` = "up 1 minute" e serviço respondendo HTTP 200 sem intervenção |

## Risco residual — não se materializou

`01-RESEARCH.md` §6 registrou que a doc oficial do LiveKit recomenda
`turn.tls_port: 443`, impossível aqui porque o Traefik do Coolify ocupa 443/tcp
e 443/udp. O TURN ficou na 5349, com o risco de operadoras filtrarem portas
não-padrão.

**O teste real em 5G passou.** O risco fica documentado como conhecido, não como
pendência: se no futuro alguém do grupo não conseguir áudio de uma rede
específica (corporativa, universitária), esta é a primeira hipótese a checar —
e a mitigação exigiria multiplexação SNI/ALPN na 443, que continua descartada.

## Desvios em relação ao runbook, já corrigidos no repositório

1. **Passo 3 (firewall) era vazio** — a VPS tem `ufw` inativo, e o Docker publica
   portas contornando as regras do `ufw` de qualquer forma. Nada a abrir.
2. **Passo 8 eliminado.** As chaves saíram do `livekit.yaml` estático e passaram
   para a env var `LIVEKIT_KEYS`, que sobrevive a redeploy. O passo original
   exigia reeditar um arquivo no checkout do Coolify após todo redeploy, com
   falha silenciosa quando esquecido.
3. **"Preserve Repository During Deployment" é obrigatório.** Sem ele o Coolify
   descarta tudo menos o compose, e o bind mount de `livekit.yaml` vira um
   diretório vazio. Erro observado: `read /etc/livekit.yaml: is a directory`.
4. **Buffer UDP do kernel.** O LiveKit avisou `UDP receive buffer is too small`
   (425 KB contra 5 MB recomendados). Corrigido via `/etc/sysctl.d/99-livekit.conf`.
   Não é cosmético: com 10 pessoas em call e screenshare, o kernel descartaria
   pacotes e o sintoma seria áudio picotando de forma intermitente.
5. **Restart pós-renovação automatizado.** O runbook deixava como lembrete manual
   mensal; virou `renew-and-restart.sh`, agendado no cron.
