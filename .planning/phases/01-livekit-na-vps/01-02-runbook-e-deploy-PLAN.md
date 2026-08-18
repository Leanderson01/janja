---
phase: 01-livekit-na-vps
plan: 02
type: execute
wave: 2
depends_on: ["01-01"]
files_modified:
  - infra/livekit/DEPLOY-RUNBOOK.md
autonomous: false

must_haves:
  truths:
    - "O runbook começa por um passo de diagnóstico que descobre se a porta 443 da VPS já está ocupada, antes de decidir qual dos dois docker-compose usar"
    - "O runbook cobre DNS, firewall, emissão de certificado, deploy (nos dois caminhos) e os 4 testes de validação, cada um com o comando exato e o resultado esperado"
    - "Os 4 testes de validação do runbook mapeiam 1:1 para os 4 success criteria da Fase 1 (TLS válido sem aviso; candidato relay de rede CGNAT; IP externo nos candidatos ICE; sobrevive a reboot)"
    - "O runbook documenta explicitamente para nunca usar 'docker-compose down' em manutenção de rotina (usar stop/start/restart)"
    - "O dono da VPS executou o runbook e os 4 success criteria da fase foram confirmados (ou as exceções encontradas foram registradas)"
  artifacts:
    - path: "infra/livekit/DEPLOY-RUNBOOK.md"
      provides: "Checklist executável por humano, passo a passo, do estado atual (VPS desconhecida) até os 4 success criteria da fase comprovados"
      contains: "chrome://webrtc-internals"
  key_links:
    - from: "infra/livekit/DEPLOY-RUNBOOK.md (passo de deploy)"
      to: "infra/livekit/docker-compose.own-caddy.yml e docker-compose.existing-proxy.yml"
      via: "comando docker compose -f <arquivo> up -d, escolhido pelo resultado do diagnóstico de porta 443"
      pattern: "docker compose -f"
    - from: "infra/livekit/DEPLOY-RUNBOOK.md (passo de certificado)"
      to: "infra/livekit/certbot-init.sh"
      via: "chamada direta do script antes do primeiro up"
      pattern: "certbot-init.sh"
---

<objective>
Escrever o runbook que leva o dono da VPS — que tem acesso que este ambiente
de execução não tem — do estado atual (não se sabe nem se a porta 443 está
livre) até os 4 critérios de sucesso da Fase 1 comprovados, e então pausar
para que ele execute isso de fato na VPS.

Purpose: É a metade "(b)" do critical constraint da fase: tudo que só um
humano com SSH/DNS/firewall pode fazer. Sem este runbook sendo executado de
verdade, a Fase 1 não está pronta — os artefatos do plano `01-01` sozinhos não
provam nada sobre TURN, TLS ou reboot.
Output: `infra/livekit/DEPLOY-RUNBOOK.md` + confirmação humana de que os 4
success criteria da fase foram testados e passaram (ou registro do que
faltou).
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
@.planning/phases/01-livekit-na-vps/01-01-config-livekit-PLAN.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Escrever DEPLOY-RUNBOOK.md</name>
  <files>infra/livekit/DEPLOY-RUNBOOK.md</files>
  <action>
    Escrever `infra/livekit/DEPLOY-RUNBOOK.md` como checklist numerado, cada
    passo com o comando exato e o resultado esperado (o padrão "JUST RIGHT" de
    especificidade, não "configure o firewall"). Estrutura mínima, na ordem:

    **0. Diagnóstico — a porta 443 já está ocupada?**
    Rodar na VPS:
    ```
    sudo ss -tlnp | grep -E ':443|:80'
    ```
    Se não retornar nada em `:443`: seguir **Caminho A** (Caddy próprio) no
    resto do runbook. Se retornar um processo (nginx, traefik, etc.): seguir
    **Caminho B** (proxy existente) — anotar qual processo é, vai precisar
    editar a config dele no passo 5B.

    **1. DNS**
    Criar registro `A` para `livekit.usesenju.com` apontando pro IP público da
    VPS, no provedor de DNS do domínio `usesenju.com`. Validar:
    ```
    dig +short livekit.usesenju.com
    ```
    deve imprimir o IP da VPS (pode levar minutos a propagar).

    **2. Firewall — portas exatas** (referenciar a tabela de `01-RESEARCH.md`
    §2): abrir 443/tcp, 80/tcp (só durante emissão/renovação de cert),
    5349/tcp, 3478/udp, 7881/tcp, 50000-60000/udp. Dar o comando exato tanto
    pra `ufw` quanto pra `firewall-cmd` (a doc oficial já lista os dois
    conjuntos de comando — reaproveitar de `01-RESEARCH.md`/doc do provedor),
    e lembrar de checar TAMBÉM o firewall do painel do provedor da VPS (nuvem
    costuma ter firewall próprio além do do SO).

    **3. Preparar `.env` e `livekit.yaml` com valores reais**
    ```
    cd infra/livekit
    cp .env.example .env
    openssl rand -hex 32   # rodar 2x, uma pra LIVEKIT_API_KEY, outra pra LIVEKIT_API_SECRET
    ```
    Preencher `.env` com os valores gerados + `CERTBOT_EMAIL`. **Copiar os
    mesmos dois valores** para a seção `keys` de `livekit.yaml` (o arquivo é
    montado estático, não lê `.env` — reforçar isso, é a armadilha mais fácil
    de esquecer: os dois arquivos precisam bater).

    **4. Certificado**
    ```
    DOMAIN=livekit.usesenju.com EMAIL=<seu-email> ./certbot-init.sh
    ```
    Confirma sucesso se listar `fullchain.pem`/`privkey.pem` em
    `/etc/letsencrypt/live/livekit.usesenju.com/`.

    **5A. Deploy — Caminho A (Caddy próprio, 443 livre)**
    ```
    docker compose -f docker-compose.own-caddy.yml up -d
    docker compose -f docker-compose.own-caddy.yml logs -f
    ```
    Esperado nos logs: LiveKit reporta start sem erro de bind de porta; Caddy
    não reporta erro de TLS (já que o cert é estático, não deve nem tentar
    emitir).

    **5B. Deploy — Caminho B (atrás de proxy existente, 443 ocupada)**
    ```
    docker compose -f docker-compose.existing-proxy.yml up -d
    ```
    Editar a config do proxy já existente (nginx: novo `server` block; Traefik:
    novo router/service) para `livekit.usesenju.com` → `proxy_pass
    http://127.0.0.1:7880` (nginx) com upgrade de WebSocket
    (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection
    "upgrade";` — sem isso a conexão WSS não sobe, é a causa mais comum de
    "conecta mas cai na hora"), ou o equivalente em Traefik. Recarregar o
    proxy existente.

    **6. Validação — os 4 success criteria da fase**

    a) TLS válido (SC1): instalar `lk` (`curl -sSL https://get.livekit.io/cli
    | bash`), rodar
    ```
    lk room join --url wss://livekit.usesenju.com \
      --api-key <LIVEKIT_API_KEY> --api-secret <LIVEKIT_API_SECRET> \
      --publish-demo --identity test-bot test-room
    ```
    Esperado: conecta sem erro de certificado.

    b) TURN/relay de rede restritiva (SC2) — o teste que mais importa:
    ```
    lk token create --api-key <key> --api-secret <secret> \
      --join --room test-room --identity browser-tester --valid-for 1h
    git clone https://github.com/livekit-examples/meet && cd meet && pnpm install
    LIVEKIT_URL=wss://livekit.usesenju.com \
    LIVEKIT_API_KEY=<key> LIVEKIT_API_SECRET=<secret> pnpm dev
    ```
    Abrir `http://localhost:3000` no Chrome **a partir de um hotspot 4G real
    (celular com CGNAT), não da rede de casa**. Entrar na sala usando o token
    gerado. Abrir `chrome://webrtc-internals` numa segunda aba, achar a
    conexão ativa, e no par de candidato selecionado (`selected candidate
    pair`) confirmar que o tipo é `relay` (não `srflx` nem `host`).

    c) IP externo nos candidatos (SC3): na mesma sessão de
    `chrome://webrtc-internals`, nos candidatos ICE locais anunciados pelo
    servidor, confirmar que aparecem com o IP público da VPS (não um IP
    `10.x`/`172.x`/`192.168.x` privado).

    d) Sobrevive a reboot (SC4):
    ```
    sudo reboot
    ```
    Esperar a VPS voltar (1-2 min), rodar de novo só o teste (a) — deve
    responder sem nenhum comando manual de `docker compose up`. Confirmar:
    ```
    systemctl is-enabled docker   # deve responder "enabled"
    docker compose -f docker-compose.own-caddy.yml ps   # containers "Up"
    ```

    **7. Manutenção — nunca `docker-compose down`**
    Anotar bem visível: para reiniciar/atualizar, usar `docker compose
    restart` ou `stop`/`start`, nunca `down` (apaga o volume nomeado do Caddy,
    que hoje só guarda cache/estado dele — não o certificado, que vive em
    `/etc/letsencrypt` no host — mas ainda assim evitar `down` como hábito de
    rotina).
  </action>
  <verify>
    `grep -n "chrome://webrtc-internals" infra/livekit/DEPLOY-RUNBOOK.md`,
    `grep -n "ss -tlnp" infra/livekit/DEPLOY-RUNBOOK.md` e `grep -n "sudo
    reboot" infra/livekit/DEPLOY-RUNBOOK.md` retornam linha. O arquivo cobre,
    nesta ordem, diagnóstico → DNS → firewall → .env/keys → certificado →
    deploy (dois caminhos) → 4 validações → aviso sobre `down`.
  </verify>
  <done>DEPLOY-RUNBOOK.md existe, cobre todos os passos na ordem certa, com comando exato e resultado esperado em cada um; os 4 testes de validação mapeiam para os 4 success criteria da fase.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <what-built>
    `infra/livekit/DEPLOY-RUNBOOK.md` — roteiro completo, com comando exato
    em cada passo, cobrindo diagnóstico de porta, DNS, firewall, certificado,
    deploy (nos dois caminhos possíveis) e os 4 testes de validação da fase.
    Este ambiente de execução não tem acesso SSH, DNS ou firewall da VPS —
    nenhuma automação é possível a partir daqui para os passos que seguem.
  </what-built>
  <how-to-verify>
    1. Abrir `infra/livekit/DEPLOY-RUNBOOK.md` e executar cada passo, na
       ordem, na VPS real (Brasil, 2 vCPU / 8 GB / 1 TB).
    2. Prestar atenção especial ao passo 0 (diagnóstico de porta 443) — ele
       decide se o resto segue pelo Caminho A ou B.
    3. No passo 6b (TURN/relay), usar uma rede de verdade com CGNAT — hotspot
       4G do celular, não a rede de casa nem a rede da própria VPS.
    4. Confirmar os 4 resultados esperados: TLS sem aviso; candidato `relay`
       selecionado no `chrome://webrtc-internals`; candidatos ICE com IP
       público da VPS; serviço volta sozinho após `sudo reboot`.
  </how-to-verify>
  <resume-signal>
    Descreva o resultado: "aprovado" se os 4 critérios passaram, ou detalhe
    qual passo falhou (incluindo o output do comando, se der erro) para virar
    um plano de fechamento de gap.
  </resume-signal>
</task>

</tasks>

<verification>
- `infra/livekit/DEPLOY-RUNBOOK.md` existe e cobre, em ordem, os 8 blocos descritos no Task 1.
- Cada um dos 4 success criteria da Fase 1 tem um passo de validação correspondente no runbook, com comando exato.
- O checkpoint humano foi executado e o resultado (aprovado ou gap) está registrado no SUMMARY deste plano.
</verification>

<success_criteria>
1. Cliente WebRTC conecta em `wss://livekit.usesenju.com` com TLS válido, sem aviso.
2. De hotspot 4G/CGNAT real, candidato `relay` aparece selecionado em `chrome://webrtc-internals`.
3. Candidatos ICE anunciados usam o IP público da VPS.
4. Depois de `sudo reboot`, o LiveKit volta a responder sozinho.
</success_criteria>

<output>
After completion, create `.planning/phases/01-livekit-na-vps/01-02-SUMMARY.md`.
Registrar no SUMMARY o resultado real do checkpoint humano (os 4 critérios
passaram? algum gap ficou pendente para um plano de fechamento?) — é o
critério de "Fase 1 pronta" de verdade, não só "arquivos existem".
</output>
