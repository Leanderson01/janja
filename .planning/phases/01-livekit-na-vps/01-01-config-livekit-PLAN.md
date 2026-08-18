---
phase: 01-livekit-na-vps
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - infra/livekit/livekit.yaml
  - infra/livekit/.env.example
  - infra/livekit/docker-compose.own-caddy.yml
  - infra/livekit/docker-compose.existing-proxy.yml
  - infra/livekit/Caddyfile
  - infra/livekit/certbot-init.sh
autonomous: true

must_haves:
  truths:
    - "livekit.yaml tem rtc.use_external_ip: true, turn.enabled: true, turn.tls_port: 5349 e turn.domain igual ao domínio da VPS"
    - "O serviço livekit-server em ambos os docker-compose usa network_mode: host e restart: unless-stopped"
    - ".env.example lista toda variável que o humano precisa preencher (domínio, e-mail do certbot, api key/secret), cada uma com comentário do que é"
    - "Os dois caminhos de deploy (Caddy próprio na 443 / atrás de proxy já existente) existem como arquivos docker-compose separados, cada um coerente sozinho (nenhum assume um serviço que o outro não sobe)"
    - "O certificado TLS é obtido via certbot standalone no host (caminho padrão /etc/letsencrypt/live/<domínio>/), não via HTTPS automática do Caddy — para ser compartilhável entre a porta 443 (Caddy) e a 5349 (TURN/TLS do livekit-server) sem depender do storage interno do Caddy"
  artifacts:
    - path: "infra/livekit/livekit.yaml"
      provides: "Config do livekit-server: port 7880, rtc (use_external_ip, port_range 50000-60000, tcp_port 7881), turn (enabled, tls_port 5349, udp_port 3478, domain, cert_file/key_file), keys, webhook comentado para F7"
      contains: "use_external_ip: true"
    - path: "infra/livekit/.env.example"
      provides: "Template de variáveis: DOMAIN, CERTBOT_EMAIL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET"
      contains: "DOMAIN="
    - path: "infra/livekit/docker-compose.own-caddy.yml"
      provides: "Stack completa: livekit-server (network_mode host) + caddy (443/80, cert estático via certbot)"
      contains: "network_mode: host"
    - path: "infra/livekit/docker-compose.existing-proxy.yml"
      provides: "Stack sem Caddy: só livekit-server, bind 127.0.0.1:7880 para o proxy existente alcançar"
      contains: "127.0.0.1:7880"
    - path: "infra/livekit/Caddyfile"
      provides: "Vhost livekit.usesenju.com: tls estático (fullchain/privkey do certbot) + reverse_proxy para 127.0.0.1:7880"
      contains: "reverse_proxy"
    - path: "infra/livekit/certbot-init.sh"
      provides: "Script que roda certbot standalone (porta 80) uma vez, e imprime o comando de renovação/cron a configurar"
      contains: "certbot"
  key_links:
    - from: "infra/livekit/docker-compose.own-caddy.yml"
      to: "infra/livekit/livekit.yaml"
      via: "bind mount somente leitura do arquivo de config pro container do livekit-server"
      pattern: "livekit\\.yaml"
    - from: "infra/livekit/docker-compose.own-caddy.yml"
      to: "infra/livekit/Caddyfile"
      via: "bind mount do Caddyfile pro container caddy"
      pattern: "Caddyfile"
    - from: "infra/livekit/livekit.yaml (turn.cert_file/key_file)"
      to: "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem e privkey.pem"
      via: "bind mount somente leitura do diretório do certbot, mesmo caminho usado pelo Caddyfile"
      pattern: "letsencrypt"
---

<objective>
Criar todos os artefatos de configuração do LiveKit self-hosted que podem ser
produzidos sem acesso à VPS: o `livekit.yaml` do servidor, os dois
docker-compose possíveis (Caddy próprio na 443, ou atrás de um proxy já
existente), o `Caddyfile`, o template de variáveis de ambiente, e o script de
emissão do certificado TLS via certbot. Nenhuma dessas tarefas toca a VPS —
são arquivos de texto versionados no repo, escritos a partir da pesquisa em
`01-RESEARCH.md`.

Purpose: Sem esses artefatos, o dono da VPS (que executa manualmente, fora
deste fluxo — ver plano `01-02`) não tem o que rodar. Este plano é a metade
"(a)" do critical constraint da fase: tudo que um agente sem SSH consegue
produzir sozinho.
Output: `infra/livekit/` completo — pronto para copiar pra VPS e configurar
com valores reais (domínio, chaves), sem precisar escrever nenhuma linha de
YAML/config do zero durante o deploy.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/01-livekit-na-vps/01-RESEARCH.md
@.planning/research/PITFALLS.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: livekit.yaml e .env.example</name>
  <files>infra/livekit/livekit.yaml, infra/livekit/.env.example</files>
  <action>
    Criar `infra/livekit/livekit.yaml` a partir da estrutura confirmada em
    `01-RESEARCH.md` §2, §4, §5 e §6 (não copiar do `config-sample.yaml`
    inteiro — só os campos relevantes, comentados o suficiente para o humano
    entender cada um):

    ```yaml
    port: 7880

    rtc:
      port_range_start: 50000
      port_range_end: 60000
      tcp_port: 7881
      use_external_ip: true

    turn:
      enabled: true
      domain: livekit.usesenju.com
      tls_port: 5349
      udp_port: 3478
      cert_file: /etc/letsencrypt/live/livekit.usesenju.com/fullchain.pem
      key_file: /etc/letsencrypt/live/livekit.usesenju.com/privkey.pem

    keys:
      # SUBSTITUIR pelos mesmos valores gerados no .env (ver DEPLOY-RUNBOOK.md
      # passo 3) — este arquivo é montado estático no container, não lê .env
      # diretamente. Gerar com: openssl rand -hex 32
      REPLACE_WITH_API_KEY: REPLACE_WITH_API_SECRET

    logging:
      level: info

    # webhook:
    #   preenchido em F7 (voz) — aponta pra HTTP action do Convex que
    #   reconcilia voiceStates em participant_left/participant_connection_aborted/
    #   room_finished. Ver PITFALLS.md Pitfall 3. Corpo bruto (request.text()),
    #   nunca request.json() antes de validar assinatura.
    #   api_key: REPLACE_WITH_API_KEY
    #   urls:
    #     - https://<convex-deployment>.convex.site/livekit/webhook
    ```

    Domínio hardcoded como `livekit.usesenju.com` (não `${DOMAIN}` — este
    arquivo é montado estático, sem interpolação de env var; deixar isso
    explícito num comentário no topo do arquivo, apontando pro `.env.example`
    como a fonte que precisa ficar em sincronia manualmente).

    Criar `infra/livekit/.env.example`:

    ```env
    # Copiar para .env na VPS e preencher com valores reais antes do deploy.
    # Nunca commitar o .env real (já coberto por .gitignore na raiz do repo,
    # mas confirmar).

    DOMAIN=livekit.usesenju.com

    # E-mail usado pelo certbot para avisos de expiração do certificado
    CERTBOT_EMAIL=

    # Gerar com: openssl rand -hex 32 (rodar duas vezes, um valor pra cada)
    # Estes DOIS valores precisam ser copiados manualmente também para
    # infra/livekit/livekit.yaml (seção `keys`) — ver DEPLOY-RUNBOOK.md.
    LIVEKIT_API_KEY=
    LIVEKIT_API_SECRET=
    ```

    Conferir que a raiz do repo tem `.env`/`*.env` no `.gitignore` (não
    `.env.example`); se não tiver, adicionar.
  </action>
  <verify>
    `grep -n "use_external_ip: true" infra/livekit/livekit.yaml`,
    `grep -n "tls_port: 5349" infra/livekit/livekit.yaml`,
    `grep -n "enabled: true" infra/livekit/livekit.yaml` (seção turn) e
    `grep -n "DOMAIN=" infra/livekit/.env.example` retornam a linha esperada.
    `git check-ignore infra/livekit/.env` retorna o caminho (confirma que
    `.env` real cairia no gitignore), enquanto `.env.example` continua
    rastreável.
  </verify>
  <done>livekit.yaml existe com rtc/turn/keys/logging corretos e comentário claro sobre webhook futuro; .env.example lista as 4 variáveis com comentário de onde vêm.</done>
</task>

<task type="auto">
  <name>Task 2: docker-compose (dois caminhos), Caddyfile e script de certificado</name>
  <files>infra/livekit/docker-compose.own-caddy.yml, infra/livekit/docker-compose.existing-proxy.yml, infra/livekit/Caddyfile, infra/livekit/certbot-init.sh</files>
  <action>
    Criar `infra/livekit/docker-compose.own-caddy.yml` — caminho A, quando a
    porta 443 da VPS está livre:

    ```yaml
    services:
      livekit-server:
        image: livekit/livekit-server:v1.13.5
        command: --config /etc/livekit.yaml
        network_mode: host
        restart: unless-stopped
        volumes:
          - ./livekit.yaml:/etc/livekit.yaml:ro
          - /etc/letsencrypt:/etc/letsencrypt:ro

      caddy:
        image: caddy:2-alpine
        network_mode: host
        restart: unless-stopped
        volumes:
          - ./Caddyfile:/etc/caddy/Caddyfile:ro
          - /etc/letsencrypt:/etc/letsencrypt:ro
          - caddy_data:/data

    volumes:
      caddy_data:
    ```

    `network_mode: host` nos dois serviços (justificado em `01-RESEARCH.md`
    §4 — evita 10 mil regras DNAT do range UDP, e deixa o Caddy alcançar o
    LiveKit via `127.0.0.1:7880` sem rede Docker entre containers). Pin de
    versão explícito (`v1.13.5`, a mais recente confirmada em
    `01-RESEARCH.md` §9) em vez de `:latest` — mesma lógica do pin do
    Electron em F0, evita upgrade silencioso quebrar produção.

    Criar `infra/livekit/docker-compose.existing-proxy.yml` — caminho B,
    quando 443 já está ocupada por outro proxy na VPS:

    ```yaml
    services:
      livekit-server:
        image: livekit/livekit-server:v1.13.5
        command: --config /etc/livekit.yaml
        network_mode: host
        restart: unless-stopped
        volumes:
          - ./livekit.yaml:/etc/livekit.yaml:ro
          - /etc/letsencrypt:/etc/letsencrypt:ro
    ```

    Sem serviço Caddy — o `port: 7880` do `livekit.yaml`, com
    `network_mode: host`, já fica só em `127.0.0.1:7880` por padrão do
    próprio LiveKit quando não há necessidade de bind externo nessa porta
    (o proxy existente do humano é quem fala com o mundo na 443). As portas
    TURN/RTC (5349, 3478/udp, 7881, 50000-60000/udp) continuam expostas
    diretamente no host pelo `network_mode: host` — elas nunca passam pelo
    proxy existente, são conexão direta do cliente.

    Criar `infra/livekit/Caddyfile` (só usado no caminho A):

    ```
    livekit.usesenju.com {
      tls /etc/letsencrypt/live/livekit.usesenju.com/fullchain.pem /etc/letsencrypt/live/livekit.usesenju.com/privkey.pem

      reverse_proxy 127.0.0.1:7880
    }
    ```

    `tls` estático (não HTTPS automática do Caddy) — decisão de
    `01-RESEARCH.md` §3: o mesmo certificado do certbot é compartilhado com
    a porta 5349 do `livekit-server`, então não pode viver só dentro do
    storage interno do Caddy.

    Criar `infra/livekit/certbot-init.sh`:

    ```bash
    #!/usr/bin/env bash
    set -euo pipefail

    # Roda uma vez, na VPS, ANTES do primeiro `docker compose up -d`.
    # Emite o certificado inicial via desafio HTTP-01 standalone (porta 80
    # livre é obrigatória neste momento — parar qualquer serviço que já
    # esteja nela antes de rodar isto).
    #
    # Uso: DOMAIN=livekit.usesenju.com EMAIL=voce@exemplo.com ./certbot-init.sh

    : "${DOMAIN:?defina DOMAIN=livekit.usesenju.com}"
    : "${EMAIL:?defina EMAIL=voce@exemplo.com}"

    docker run --rm -p 80:80 \
      -v /etc/letsencrypt:/etc/letsencrypt \
      certbot/certbot certonly --standalone \
      --non-interactive --agree-tos \
      -m "$EMAIL" -d "$DOMAIN"

    echo "Certificado emitido em /etc/letsencrypt/live/$DOMAIN/"
    echo "Renovação: agendar 'certbot renew' via cron/systemd timer."
    echo "Após renovar, reiniciar os containers (nunca 'down'):"
    echo "  docker compose restart caddy livekit-server"
    ```

    Marcar como executável: `chmod +x infra/livekit/certbot-init.sh`.
  </action>
  <verify>
    `grep -n "network_mode: host" infra/livekit/docker-compose.own-caddy.yml
    infra/livekit/docker-compose.existing-proxy.yml` retorna linha em ambos.
    `grep -n "reverse_proxy 127.0.0.1:7880" infra/livekit/Caddyfile` retorna a
    linha. `test -x infra/livekit/certbot-init.sh && echo ok` imprime `ok`.
    `grep -c "caddy" infra/livekit/docker-compose.existing-proxy.yml` retorna
    `0` (confirma que o caminho B não sobe Caddy).
  </verify>
  <done>Os dois docker-compose existem, coerentes cada um sozinho; Caddyfile usa cert estático compartilhado; certbot-init.sh é executável e documenta a renovação sem `down`.</done>
</task>

</tasks>

<verification>
- `infra/livekit/livekit.yaml` tem `use_external_ip: true`, `turn.enabled: true`, `turn.tls_port: 5349`.
- `infra/livekit/docker-compose.own-caddy.yml` e `docker-compose.existing-proxy.yml` usam `network_mode: host` e `restart: unless-stopped` no `livekit-server`.
- `infra/livekit/Caddyfile` referencia o mesmo caminho de certificado (`/etc/letsencrypt/live/...`) que `livekit.yaml` usa em `turn.cert_file`/`key_file`.
- `infra/livekit/.env.example` e `infra/livekit/certbot-init.sh` existem e são consistentes entre si (mesmas variáveis `DOMAIN`/`EMAIL`/`CERTBOT_EMAIL`).
</verification>

<success_criteria>
- Todos os artefatos de `infra/livekit/` necessários para um deploy manual existem no repo, sem exigir que o humano escreva YAML do zero.
- Os dois caminhos de deploy (443 livre / 443 ocupada) estão cobertos por arquivos compose distintos e coerentes.
- Decisão de certificado (certbot compartilhado, não HTTPS automática do Caddy) está implementada, não só documentada em research.
</success_criteria>

<output>
After completion, create `.planning/phases/01-livekit-na-vps/01-01-SUMMARY.md`.
</output>
