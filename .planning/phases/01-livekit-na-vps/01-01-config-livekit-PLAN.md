---
phase: 01-livekit-na-vps
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - infra/livekit/livekit.yaml
  - infra/livekit/.env.example
  - infra/livekit/docker-compose.yml
  - infra/livekit/dns-multi.ini.example
  - infra/livekit/turn-cert-init.sh
autonomous: true

must_haves:
  truths:
    - "livekit.yaml tem rtc.udp_port: 7882 (mux de porta única, não port_range_start/end), rtc.use_external_ip: true, turn.enabled: true, turn.tls_port: 5349 e turn.domain igual a livekit.usesenju.com"
    - "docker-compose.yml não define network_mode: host nem uma seção networks: custom — usa a rede bridge padrão que o Coolify cria pra stack, compatível com o Traefik do Coolify rotear até o serviço"
    - "docker-compose.yml só publica em ports: as portas que não passam pelo Traefik (7881/tcp, 7882/udp, 3478/udp, 5349/tcp) — a porta 7880 (API/WS) fica de fora, porque é roteada pelo Traefik via domínio atribuído na UI do Coolify"
    - ".env.example e dns-multi.ini.example juntos listam toda variável/token que o humano precisa preencher (domínio, chaves da API do LiveKit, e-mail do certbot, token da API da Hostinger), cada um com comentário do que é e onde entra (Coolify UI vs arquivo na VPS)"
    - "turn-cert-init.sh obtém o certificado do TURN via desafio DNS-01 (certbot-dns-multi, provider hostinger) — não via HTTP-01/standalone, porque a porta 80 pertence ao Traefik do Coolify"
  artifacts:
    - path: "infra/livekit/livekit.yaml"
      provides: "Config do livekit-server: port 7880, rtc (use_external_ip, udp_port mux, tcp_port 7881), turn (enabled, tls_port 5349, udp_port 3478, domain, cert_file/key_file), keys, webhook comentado para F7"
      contains: "udp_port: 7882"
    - path: "infra/livekit/.env.example"
      provides: "Template de variáveis: DOMAIN, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, CERT_EMAIL, HOSTINGER_API_TOKEN — cada uma com nota de onde é usada (Coolify UI, livekit.yaml, ou dns-multi.ini)"
      contains: "DOMAIN="
    - path: "infra/livekit/docker-compose.yml"
      provides: "Stack única gerenciada pelo Coolify: livekit-server em rede bridge padrão, sem Caddy próprio (Coolify/Traefik cuida da 443), portas TURN/RTC publicadas diretamente"
      contains: "ports:"
    - path: "infra/livekit/dns-multi.ini.example"
      provides: "Template do arquivo de credenciais do certbot-dns-multi para o provider hostinger (dns_multi_provider, HOSTINGER_API_TOKEN)"
      contains: "dns_multi_provider = hostinger"
    - path: "infra/livekit/turn-cert-init.sh"
      provides: "Script que roda certbot-dns-multi via Docker (desafio DNS-01, sem precisar da porta 80) pra emitir e renovar o certificado do TURN"
      contains: "certbot-dns-multi"
  key_links:
    - from: "infra/livekit/docker-compose.yml"
      to: "infra/livekit/livekit.yaml"
      via: "bind mount somente leitura do arquivo de config pro container do livekit-server"
      pattern: "livekit\\.yaml"
    - from: "infra/livekit/livekit.yaml (turn.cert_file/key_file)"
      to: "/etc/letsencrypt/live/livekit.usesenju.com/fullchain.pem e privkey.pem"
      via: "bind mount somente leitura de /etc/letsencrypt no host, caminho gerado por turn-cert-init.sh"
      pattern: "letsencrypt"
    - from: "infra/livekit/turn-cert-init.sh"
      to: "infra/livekit/dns-multi.ini.example"
      via: "mesmo formato de credenciais (dns_multi_provider, HOSTINGER_API_TOKEN) documentado no exemplo e esperado pelo script em /etc/letsencrypt/dns-multi.ini"
      pattern: "dns-multi"
---

<objective>
Criar todos os artefatos de configuração do LiveKit self-hosted que podem ser
produzidos sem acesso à VPS, já desenhados para rodar como **recurso Docker
Compose do Coolify** (não como stack solta com Caddy próprio — ver
`01-RESEARCH.md`, que documenta por que o design anterior não se aplica mais
ao ambiente real): o `livekit.yaml` do servidor, o `docker-compose.yml`
único (sem Caddy — o Coolify/Traefik cuida da 443), o template de variáveis
de ambiente, o template de credenciais da Hostinger, e o script de emissão
do certificado do TURN via DNS-01. Nenhuma dessas tarefas toca a VPS — são
arquivos de texto versionados no repo, escritos a partir da pesquisa em
`01-RESEARCH.md`.

Purpose: Sem esses artefatos, o dono da VPS (que executa manualmente, fora
deste fluxo — ver plano `01-02`) não tem o que rodar. Este plano é a metade
"(a)" do critical constraint da fase: tudo que um agente sem SSH consegue
produzir sozinho.
Output: `infra/livekit/` completo — pronto para o Coolify consumir como
Docker Compose Resource (Base Directory `/infra/livekit`), e pronto para o
humano rodar o script de certificado do TURN na VPS, sem precisar escrever
nenhuma linha de YAML/config do zero durante o deploy.
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
    `01-RESEARCH.md` §3, §4, §5, §7 (não copiar do `config-sample.yaml`
    inteiro — só os campos relevantes, comentados o suficiente para o
    humano entender cada um, e explicando POR QUE cada escolha de rede
    difere do padrão "cloud VM" mais comum):

    ```yaml
    # Config estático do livekit-server, montado read-only no container pela
    # stack gerenciada pelo Coolify (ver docker-compose.yml). Domínio
    # hardcoded como livekit.usesenju.com — este arquivo não interpola
    # variáveis de ambiente, então qualquer troca de domínio exige editar
    # aqui também (mesma ressalva vale pro par de chaves em `keys`, abaixo).

    port: 7880

    rtc:
      # Mux de porta única em vez de rtc.port_range_start/port_range_end
      # (o range de 50000-60000 do deploy "cloud VM padrão" da doc oficial).
      # Necessário porque este container roda na rede bridge que o Coolify
      # cria pra cada stack (não network_mode: host) — o Traefik do Coolify
      # só enxerga containers nessa rede, e host networking tiraria o
      # container dela, quebrando o roteamento de domínio por completo.
      # Publicar um range de 10 mil portas UDP individualmente no Docker
      # geraria ~10 mil regras DNAT; um mux de porta única evita isso.
      # Oficialmente suportado (config-sample.yaml: "port_range_start & end
      # must not be set for this config to take effect"). Se a CPU virar
      # gargalo no futuro, considerar um range pequeno tipo 7882-7883 (uma
      # porta por vCPU) — nunca o range de 10 mil. Ver 01-RESEARCH.md §3.
      udp_port: 7882
      tcp_port: 7881
      use_external_ip: true

    turn:
      enabled: true
      domain: livekit.usesenju.com
      tls_port: 5349
      udp_port: 3478
      # Certificado PRÓPRIO do TURN, obtido via DNS-01 (certbot-dns-multi +
      # Hostinger, ver turn-cert-init.sh) — independente do certificado que
      # o Traefik/Coolify gerencia pra porta 443. NUNCA extrair do acme.json
      # do Coolify: é regenerado a cada renovação e o formato interno não é
      # um contrato estável. Ver 01-RESEARCH.md §5.
      cert_file: /etc/letsencrypt/live/livekit.usesenju.com/fullchain.pem
      key_file: /etc/letsencrypt/live/livekit.usesenju.com/privkey.pem
      # relay_range_start/relay_range_end (default 1024-30000) fica com o
      # valor padrão de propósito: é comunicação interna entre o processo
      # TURN embutido e o SFU, dentro do mesmo container — não precisa
      # constar em firewall nem em `ports:` do compose (confirmado: não
      # aparece na tabela oficial de portas expostas). Ver 01-RESEARCH.md §4.

    keys:
      # SUBSTITUIR pelos mesmos valores definidos nas env vars da stack no
      # Coolify (LIVEKIT_API_KEY / LIVEKIT_API_SECRET) — ver
      # DEPLOY-RUNBOOK.md. Este arquivo é montado estático no container,
      # não lê variável de ambiente diretamente. Gerar com:
      # openssl rand -hex 32 (rodar 2x, um valor por variável).
      # ATENÇÃO: se o Coolify re-clonar este repositório num redeploy
      # futuro, este valor placeholder volta — conferir sempre depois de
      # um redeploy (ver DEPLOY-RUNBOOK.md).
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

    Criar `infra/livekit/.env.example`:

    ```env
    # Nenhum arquivo deste diretório lê estas variáveis automaticamente —
    # este arquivo documenta quais valores preencher manualmente, e ONDE:
    # a maioria vai na UI do Coolify (Application -> Environment Variables)
    # e/ou em arquivos que só existem na VPS (nunca commitados). Ver
    # DEPLOY-RUNBOOK.md para o passo a passo completo.

    # Usado no domínio atribuído na UI do Coolify e em livekit.yaml (turn.domain)
    DOMAIN=livekit.usesenju.com

    # Gerar com: openssl rand -hex 32 (rodar 2x, um valor por variável).
    # Precisam ser copiados manualmente para infra/livekit/livekit.yaml
    # (seção `keys`) depois do deploy — ver DEPLOY-RUNBOOK.md.
    LIVEKIT_API_KEY=
    LIVEKIT_API_SECRET=

    # E-mail para avisos de expiração de certificado (Let's Encrypt),
    # usado como argumento do infra/livekit/turn-cert-init.sh
    CERT_EMAIL=

    # Token de API da Hostinger com permissão de gerenciar zona DNS (hPanel
    # -> configurações da conta -> API). NÃO entra na UI do Coolify — vai
    # direto em /etc/letsencrypt/dns-multi.ini na VPS (ver
    # infra/livekit/dns-multi.ini.example e DEPLOY-RUNBOOK.md).
    HOSTINGER_API_TOKEN=
    ```

    Conferir que a raiz do repo tem `.env`/`*.env` no `.gitignore` (não
    `.env.example`); se não tiver, adicionar.
  </action>
  <verify>
    `grep -n "udp_port: 7882" infra/livekit/livekit.yaml`,
    `grep -n "tls_port: 5349" infra/livekit/livekit.yaml`,
    `grep -n "enabled: true" infra/livekit/livekit.yaml` (seção turn),
    `grep -c "port_range_start" infra/livekit/livekit.yaml` (deve dar `0` —
    confirma que o range de 10 mil portas não voltou por engano) e
    `grep -n "DOMAIN=" infra/livekit/.env.example` retornam a linha
    esperada. `git check-ignore infra/livekit/.env` retorna o caminho
    (confirma que `.env` real cairia no gitignore), enquanto `.env.example`
    continua rastreável.
  </verify>
  <done>livekit.yaml existe com rtc (udp_port, não port_range)/turn/keys/logging corretos e comentário claro sobre webhook futuro; .env.example lista as 5 variáveis com comentário de onde cada uma é usada (Coolify UI vs arquivo na VPS).</done>
</task>

<task type="auto">
  <name>Task 2: docker-compose.yml, template de credenciais da Hostinger e script de certificado do TURN</name>
  <files>infra/livekit/docker-compose.yml, infra/livekit/dns-multi.ini.example, infra/livekit/turn-cert-init.sh</files>
  <action>
    Criar `infra/livekit/docker-compose.yml` — único caminho de deploy agora
    (o Coolify consome este arquivo como Docker Compose Resource; não há
    mais variação "443 livre / 443 ocupada", porque sob Coolify a 443
    **sempre** pertence ao Traefik):

    ```yaml
    services:
      livekit-server:
        image: livekit/livekit-server:v1.13.5
        command: --config /etc/livekit.yaml
        restart: unless-stopped
        # NÃO declarar "networks:" aqui — usar a rede bridge que o Coolify
        # já cria pra esta stack. Definir uma rede custom tira o container
        # dela e causa "504 Gateway Timeout" intermitente (issue conhecida
        # da própria doc do Coolify) — ver 01-RESEARCH.md §2.
        volumes:
          - ./livekit.yaml:/etc/livekit.yaml:ro
          - /etc/letsencrypt:/etc/letsencrypt:ro
        ports:
          # Só as portas que o Traefik NÃO deve mediar. A porta 7880
          # (API/WebSocket, sinalização WSS) fica de propósito fora daqui:
          # o domínio é atribuído pela UI do Coolify (ver
          # DEPLOY-RUNBOOK.md), que gera os labels do Traefik
          # automaticamente e roteia até o container pela rede interna —
          # nunca editar esses labels à mão.
          - "7881:7881"        # ICE/TCP fallback — doc oficial: "cannot be behind load balancer or TLS, must be exposed on the node"
          - "7882:7882/udp"    # ICE/UDP mux — mapeamento 1:1 com rtc.udp_port em livekit.yaml
          - "3478:3478/udp"    # TURN/UDP + STUN embutido
          - "5349:5349"        # TURN/TLS — cert próprio (ver turn-cert-init.sh), não passa pelo Traefik
    ```

    Pin de versão explícito (`v1.13.5`, a mais recente confirmada em
    `01-RESEARCH.md` §10) em vez de `:latest` — mesma lógica do pin do
    Electron em F0, evita upgrade silencioso quebrar produção.

    Criar `infra/livekit/dns-multi.ini.example`:

    ```ini
    # Copiar para /etc/letsencrypt/dns-multi.ini NA VPS (fora do repo —
    # nunca commitar o token real). Depois de copiar:
    #   chmod 0600 /etc/letsencrypt/dns-multi.ini
    #
    # Gerar o token em: Hostinger hPanel -> configurações da conta -> API
    # (o caminho exato do menu pode variar; procurar por "API" nas
    # configurações da conta). Precisa de permissão de gerenciar zona DNS.

    dns_multi_provider = hostinger
    HOSTINGER_API_TOKEN="REPLACE_WITH_REAL_TOKEN"
    ```

    Criar `infra/livekit/turn-cert-init.sh`:

    ```bash
    #!/usr/bin/env bash
    set -euo pipefail

    # Emite (ou renova) o certificado do TURN/TLS via desafio DNS-01
    # (certbot-dns-multi, provider hostinger) — NÃO usa a porta 80, então
    # não conflita com o Traefik do Coolify (que já ocupa 80/443). Depende
    # de /etc/letsencrypt/dns-multi.ini já existir na VPS (ver
    # dns-multi.ini.example e DEPLOY-RUNBOOK.md).
    #
    # Emitir pela primeira vez:
    #   DOMAIN=livekit.usesenju.com EMAIL=voce@exemplo.com ./turn-cert-init.sh
    # Renovar depois (mesmas env vars, subcomando "renew"):
    #   DOMAIN=livekit.usesenju.com EMAIL=voce@exemplo.com ./turn-cert-init.sh renew

    : "${DOMAIN:?defina DOMAIN=livekit.usesenju.com}"
    : "${EMAIL:?defina EMAIL=voce@exemplo.com}"

    CMD="${1:-certonly}"
    IMAGE="ghcr.io/alexzorin/certbot-dns-multi:5.3.1"

    if [ "$CMD" = "renew" ]; then
      docker run --rm -v /etc/letsencrypt:/etc/letsencrypt "$IMAGE" renew
      echo "Renovação concluída (se havia certificado próximo do vencimento)."
      echo "Reiniciar o serviço livekit-server no Coolify (UI -> Restart) pra"
      echo "ele carregar o certificado novo — é só reiniciar, nunca recriar"
      echo "a stack: o certificado é um bind mount de arquivo, não muda a"
      echo "imagem nem a config."
      exit 0
    fi

    docker run --rm -v /etc/letsencrypt:/etc/letsencrypt "$IMAGE" certonly \
      -a dns-multi --dns-multi-credentials /etc/letsencrypt/dns-multi.ini \
      --non-interactive --agree-tos -m "$EMAIL" \
      -d "$DOMAIN"

    echo "Certificado do TURN emitido em /etc/letsencrypt/live/$DOMAIN/"
    echo "Agendar renovação: cron mensal rodando '$0 renew' com as mesmas"
    echo "env vars (ver DEPLOY-RUNBOOK.md) — Let's Encrypt expira em 90 dias."
    ```

    Marcar como executável: `chmod +x infra/livekit/turn-cert-init.sh`.
  </action>
  <verify>
    `grep -c "network_mode: host" infra/livekit/docker-compose.yml` retorna
    `0`. `grep -c "^networks:" infra/livekit/docker-compose.yml` retorna
    `0` (confirma que não há seção `networks:` custom no nível raiz do
    compose). `grep -n "7880" infra/livekit/docker-compose.yml` **não**
    retorna nenhuma linha dentro de `ports:` (a porta 7880 não deve estar
    publicada — só aparece, se aparecer, em comentário). `grep -n
    "ghcr.io/alexzorin/certbot-dns-multi" infra/livekit/turn-cert-init.sh`
    retorna a linha. `test -x infra/livekit/turn-cert-init.sh && echo ok`
    imprime `ok`. `grep -n "dns_multi_provider = hostinger"
    infra/livekit/dns-multi.ini.example` retorna a linha.
  </verify>
  <done>docker-compose.yml existe, sem network_mode: host e sem networks: custom, publica só as 4 portas que devem contornar o Traefik; dns-multi.ini.example e turn-cert-init.sh existem, coerentes entre si (mesmo formato de credenciais), e o script usa DNS-01 (não standalone/porta 80).</done>
</task>

</tasks>

<verification>
- `infra/livekit/livekit.yaml` tem `udp_port: 7882` (não `port_range_start`/`port_range_end`), `use_external_ip: true`, `turn.enabled: true`, `turn.tls_port: 5349`.
- `infra/livekit/docker-compose.yml` não usa `network_mode: host` nem declara `networks:` custom; publica apenas 7881/tcp, 7882/udp, 3478/udp, 5349/tcp em `ports:`; não publica 7880.
- `infra/livekit/turn-cert-init.sh` usa `certbot-dns-multi` com desafio DNS-01 (provider hostinger), não `certbot standalone`.
- `infra/livekit/.env.example` e `infra/livekit/dns-multi.ini.example` existem e são consistentes entre si (mesmo conjunto de variáveis referenciadas: DOMAIN, LIVEKIT_API_KEY/SECRET, CERT_EMAIL, HOSTINGER_API_TOKEN).
</verification>

<success_criteria>
- Todos os artefatos de `infra/livekit/` necessários para o Coolify consumir como Docker Compose Resource existem no repo, sem exigir que o humano escreva YAML do zero.
- A decisão de rede (mux de porta única, sem `network_mode: host`, sem `networks:` custom) está implementada de um jeito compatível com o Traefik do Coolify rotear até o serviço — não só documentada em research.
- A decisão de certificado do TURN (DNS-01 via Hostinger, não HTTP-01/standalone) está implementada, coerente com a porta 80 pertencer ao Traefik.
</success_criteria>

<output>
After completion, create `.planning/phases/01-livekit-na-vps/01-01-SUMMARY.md`.
</output>
