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
    - "O runbook cobre, nesta ordem: token da API da Hostinger, registro DNS, certificado do TURN via DNS-01, criação do recurso Docker Compose no Coolify, variáveis de ambiente e domínio na UI, cron de renovação, e os 4 testes de validação"
    - "O runbook NÃO assume porta 443 livre em nenhum momento — não existe mais bifurcação 'Caminho A / Caminho B' do plano anterior, porque sob Coolify a 443 sempre pertence ao Traefik"
    - "Os 4 testes de validação do runbook mapeiam 1:1 para os 4 success criteria da Fase 1 (TLS válido sem aviso; candidato relay de rede CGNAT; IP externo nos candidatos ICE; sobrevive a reboot)"
    - "O runbook documenta explicitamente o risco residual de TURN/TLS não estar na porta 443 (01-RESEARCH.md §6) e o que registrar se o teste de relay falhar por esse motivo"
    - "O dono da VPS executou o runbook e os 4 success criteria da fase foram confirmados (ou as exceções encontradas foram registradas)"
  artifacts:
    - path: "infra/livekit/DEPLOY-RUNBOOK.md"
      provides: "Checklist executável por humano, passo a passo, do estado atual (VPS com Coolify, nada configurado) até os 4 success criteria da fase comprovados"
      contains: "chrome://webrtc-internals"
  key_links:
    - from: "infra/livekit/DEPLOY-RUNBOOK.md (passo de certificado do TURN)"
      to: "infra/livekit/turn-cert-init.sh e infra/livekit/dns-multi.ini.example"
      via: "comando direto do script, precedido pela criação do arquivo de credenciais no formato do exemplo"
      pattern: "turn-cert-init.sh"
    - from: "infra/livekit/DEPLOY-RUNBOOK.md (passo de criação do recurso no Coolify)"
      to: "infra/livekit/docker-compose.yml"
      via: "New Resource -> Docker Compose, Base Directory /infra/livekit, Docker Compose Location docker-compose.yml"
      pattern: "Docker Compose"
---

<objective>
Escrever o runbook que leva o dono da VPS — que tem acesso admin ao Coolify
e acesso SSH/Docker que este ambiente de execução não tem — do estado atual
(Coolify instalado, nada do LiveKit configurado) até os 4 critérios de
sucesso da Fase 1 comprovados, e então pausar para que ele execute isso de
fato na VPS.

Purpose: É a metade "(b)" do critical constraint da fase: tudo que só um
humano com acesso à VPS/Coolify/DNS pode fazer. Sem este runbook sendo
executado de verdade, a Fase 1 não está pronta — os artefatos do plano
`01-01` sozinhos não provam nada sobre TURN, TLS ou reboot.
Output: `infra/livekit/DEPLOY-RUNBOOK.md` + confirmação humana de que os 4
success criteria da fase foram testados e passaram (ou registro do que
faltou, incluindo o risco residual de `01-RESEARCH.md` §6 se for o caso).
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
    passo com o comando exato e o resultado esperado (o padrão "JUST RIGHT"
    de especificidade, não "configure o DNS"). Estrutura mínima, na ordem:

    **1. Token de API da Hostinger**
    hPanel -> configurações da conta -> API (o caminho exato do menu pode
    variar; procurar por "API") -> criar token com permissão de gerenciar
    zona DNS. Guardar o valor — vai ser usado no passo 4, não no Coolify.

    **2. DNS**
    Criar registro `A` para `livekit.usesenju.com` apontando pro IP público
    da VPS, na Hostinger (mesmo painel de DNS de `usesenju.com`). Validar:
    ```
    dig +short livekit.usesenju.com
    ```
    deve imprimir o IP da VPS (pode levar minutos a propagar; DNS-01 no
    passo 4 precisa que isso já tenha propagado no resolver que o
    `certbot-dns-multi` consulta, mas na prática ele consulta a própria API
    da Hostinger, não depende de propagação pública pra emitir).

    **3. Firewall — portas exatas** (referenciar a tabela de
    `01-RESEARCH.md` §4): abrir 5349/tcp, 3478/udp, 7881/tcp, 7882/udp. A
    443/tcp, 443/udp e 80/tcp já devem estar abertas (são do próprio
    Coolify/Traefik — não mexer nelas). Checar tanto o firewall do SO
    (`ufw`/`firewall-cmd`) quanto o firewall do painel do provedor da VPS
    (nuvem costuma ter firewall próprio além do do SO).

    **4. Certificado do TURN (DNS-01, não usa a porta 80)**
    Na VPS, criar `/etc/letsencrypt/dns-multi.ini` com o conteúdo de
    `infra/livekit/dns-multi.ini.example`, substituindo
    `REPLACE_WITH_REAL_TOKEN` pelo token do passo 1:
    ```
    dns_multi_provider = hostinger
    HOSTINGER_API_TOKEN="<token real>"
    ```
    ```
    chmod 0600 /etc/letsencrypt/dns-multi.ini
    ```
    Rodar:
    ```
    cd infra/livekit
    DOMAIN=livekit.usesenju.com EMAIL=<seu-email> ./turn-cert-init.sh
    ```
    Confirma sucesso se listar `fullchain.pem`/`privkey.pem` em
    `/etc/letsencrypt/live/livekit.usesenju.com/`.

    **5. Cron de renovação**
    Adicionar ao crontab da VPS (`crontab -e`), renovação mensal (Let's
    Encrypt expira em 90 dias, margem confortável):
    ```
    0 3 1 * * cd /caminho/do/repo/infra/livekit && DOMAIN=livekit.usesenju.com EMAIL=<seu-email> ./turn-cert-init.sh renew >> /var/log/livekit-turn-cert-renew.log 2>&1
    ```
    Anotar: depois de uma renovação bem-sucedida, o `livekit-server` precisa
    ser **reiniciado** (Coolify UI -> Restart, ou `docker restart
    <container>` se preferir via SSH) pra carregar o certificado novo — o
    processo não recarrega sozinho. Considerar isso um passo manual mensal
    até virar gap-closure de automação, se necessário.

    **6. Preparar `.env` e `keys` de `livekit.yaml` com valores reais**
    ```
    cd infra/livekit
    cp .env.example .env
    openssl rand -hex 32   # rodar 2x, uma pra LIVEKIT_API_KEY, outra pra LIVEKIT_API_SECRET
    ```
    Preencher `.env` (referência local, não lido por nada automaticamente)
    com os valores gerados. **Copiar os mesmos dois valores** para a seção
    `keys` de `livekit.yaml`, no checkout que o Coolify vai usar — ver
    ressalva no passo 8.

    **7. Criar o recurso Docker Compose no Coolify**
    Na UI do Coolify: **New Resource -> Docker Compose** (ou o build pack
    "Docker Compose" dentro do fluxo de criação de aplicação) apontando pro
    repositório Git deste projeto. Se o repo for privado, configurar
    GitHub App ou Deploy Key (telas próprias do Coolify pra isso — seguir o
    wizard). Configurar:
    - **Base Directory:** `/infra/livekit`
    - **Docker Compose Location:** `docker-compose.yml`

    **8. Corrigir `keys` no checkout do Coolify (placeholder -> valores reais)**
    Depois que o Coolify clonar o repo (primeiro deploy, ainda vai falhar
    a autenticação até este passo), localizar o `livekit.yaml` no diretório
    de trabalho da aplicação na VPS (Coolify guarda em algo como
    `/data/coolify/applications/<uuid>/`) e substituir
    `REPLACE_WITH_API_KEY: REPLACE_WITH_API_SECRET` pelos valores reais do
    passo 6. **Atenção:** se o Coolify re-clonar o repositório num redeploy
    futuro (push novo, ou redeploy manual), esse arquivo volta pro
    placeholder do git — conferir sempre depois de qualquer redeploy, antes
    de assumir que a autenticação está funcionando.

    **9. Variáveis de ambiente e domínio na UI do Coolify**
    Na página do recurso: atribuir o domínio do serviço `livekit-server`
    como `https://livekit.usesenju.com:7880` (porta 7880 é onde o
    `livekit-server` escuta API+WS — o Coolify usa isso pra saber pra onde
    rotear internamente, e serve externamente na 443 normal). Isso é o que
    gera os labels do Traefik automaticamente — não editar Traefik à mão em
    nenhuma hipótese.

    **10. Deploy**
    Clicar em **Deploy** na UI do Coolify. Acompanhar os logs de build/start
    pela própria UI. Esperado: `livekit-server` sobe sem erro de bind de
    porta, sem erro de certificado (confirma que os arquivos em
    `/etc/letsencrypt` foram montados corretamente pelo bind mount absoluto
    — se der erro aqui, verificar se o Coolify aceitou o path absoluto
    `/etc/letsencrypt:/etc/letsencrypt:ro` no compose; se não aceitar, essa
    é uma exceção a registrar no SUMMARY, com o log de erro exato).

    **11. Validação — os 4 success criteria da fase**

    a) TLS válido (SC1/INFRA-01): instalar `lk`
    (`curl -sSL https://get.livekit.io/cli | bash`), rodar
    ```
    lk room join --url wss://livekit.usesenju.com \
      --api-key <LIVEKIT_API_KEY> --api-secret <LIVEKIT_API_SECRET> \
      --publish-demo --identity test-bot test-room
    ```
    Esperado: conecta sem erro de certificado.

    b) TURN/relay de rede restritiva (SC2/INFRA-02) — o teste que mais
    importa:
    ```
    lk token create --api-key <key> --api-secret <secret> \
      --join --room test-room --identity browser-tester --valid-for 1h
    git clone https://github.com/livekit-examples/meet && cd meet && pnpm install
    LIVEKIT_URL=wss://livekit.usesenju.com \
    LIVEKIT_API_KEY=<key> LIVEKIT_API_SECRET=<secret> pnpm dev
    ```
    Abrir `http://localhost:3000` no Chrome **a partir de um hotspot 4G
    real (celular com CGNAT), não da rede de casa**. Entrar na sala usando
    o token gerado. Abrir `chrome://webrtc-internals` numa segunda aba,
    achar a conexão ativa, e no par de candidato selecionado (`selected
    candidate pair`) confirmar que o tipo é `relay` (não `srflx` nem
    `host`). **Se esse teste falhar especificamente aqui** (sinalização
    conectou no teste (a), mas o relay não estabelece), ler
    `01-RESEARCH.md` §6 antes de investigar mais — o motivo mais provável é
    a rede móvel filtrando a porta 5349 (TURN não está na 443, e não há
    como colocar sob esta arquitetura Coolify sem reimplementar
    multiplexação SNI). Registrar esse resultado explicitamente no SUMMARY.

    c) IP externo nos candidatos (SC3/INFRA-03): na mesma sessão de
    `chrome://webrtc-internals`, nos candidatos ICE locais anunciados pelo
    servidor, confirmar que aparecem com o IP público da VPS (não um IP
    `10.x`/`172.x`/`192.168.x` privado, e não o IP interno da rede bridge
    do Docker/Coolify).

    d) Sobrevive a reboot (SC4/INFRA-04):
    ```
    sudo reboot
    ```
    Esperar a VPS voltar (1-2 min), rodar de novo só o teste (a) — deve
    responder sem nenhum comando manual de deploy/start (o Coolify
    supervisiona o container e o Docker inicia no boot). Confirmar:
    ```
    systemctl is-enabled docker   # deve responder "enabled"
    docker ps | grep livekit      # container "Up"
    ```

    **12. Manutenção**
    Reiniciar/atualizar sempre pela UI do Coolify (Restart/Redeploy) — não
    rodar `docker compose down` manualmente fora do fluxo do Coolify, já
    que ele gerencia o ciclo de vida da stack e um `down` fora de banda
    pode deixar o estado que o Coolify espera dessincronizado do estado
    real. Depois de qualquer redeploy, reconferir o passo 8 (`keys` pode
    ter voltado pro placeholder).
  </action>
  <verify>
    `grep -n "chrome://webrtc-internals" infra/livekit/DEPLOY-RUNBOOK.md`,
    `grep -n "dns-multi.ini" infra/livekit/DEPLOY-RUNBOOK.md`,
    `grep -n "Base Directory" infra/livekit/DEPLOY-RUNBOOK.md` e `grep -n
    "sudo reboot" infra/livekit/DEPLOY-RUNBOOK.md` retornam linha. `grep -ci
    "Caminho A\|Caminho B\|443 livre\|443 ocupada"
    infra/livekit/DEPLOY-RUNBOOK.md` retorna `0` (confirma que a bifurcação
    do plano anterior não sobreviveu). O arquivo cobre, nesta ordem, token
    Hostinger -> DNS -> firewall -> certificado TURN -> cron -> .env/keys
    -> criar recurso no Coolify -> corrigir keys -> domínio na UI -> deploy
    -> 4 validações -> manutenção.
  </verify>
  <done>DEPLOY-RUNBOOK.md existe, cobre todos os passos na ordem certa, com comando exato e resultado esperado em cada um, sem nenhuma bifurcação de "porta 443 livre/ocupada"; os 4 testes de validação mapeiam para os 4 success criteria da fase, incluindo a nota sobre o risco residual de §6 no teste de relay.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <what-built>
    `infra/livekit/DEPLOY-RUNBOOK.md` — roteiro completo, com comando exato
    em cada passo, cobrindo token da Hostinger, DNS, firewall, certificado
    do TURN via DNS-01, criação do recurso Docker Compose no Coolify,
    variáveis/domínio na UI, cron de renovação, e os 4 testes de validação
    da fase. Este ambiente de execução não tem acesso SSH, DNS, Coolify ou
    firewall da VPS — nenhuma automação é possível a partir daqui para os
    passos que seguem.
  </what-built>
  <how-to-verify>
    1. Abrir `infra/livekit/DEPLOY-RUNBOOK.md` e executar cada passo, na
       ordem, na VPS real (Coolify 4.1.2, Brasil, 2 vCPU / 8 GB / 1 TB).
    2. Prestar atenção especial ao passo 8 (corrigir `keys` no checkout do
       Coolify) e ao passo 6 do runbook — é o ponto mais fácil de esquecer
       e o mais fácil de silenciosamente quebrar num redeploy futuro.
    3. No teste de TURN/relay, usar uma rede de verdade com CGNAT —
       hotspot 4G do celular, não a rede de casa nem a rede da própria VPS.
       Se falhar, ler `01-RESEARCH.md` §6 antes de tratar como bug.
    4. Confirmar os 4 resultados esperados: TLS sem aviso; candidato
       `relay` selecionado no `chrome://webrtc-internals`; candidatos ICE
       com IP público da VPS; serviço volta sozinho após `sudo reboot`.
  </how-to-verify>
  <resume-signal>
    Descreva o resultado: "aprovado" se os 4 critérios passaram, ou detalhe
    qual passo falhou (incluindo o output do comando, se der erro, e se foi
    o risco residual de TURN fora da 443 documentado em §6) para virar um
    plano de fechamento de gap.
  </resume-signal>
</task>

</tasks>

<verification>
- `infra/livekit/DEPLOY-RUNBOOK.md` existe e cobre, em ordem, os 12 blocos descritos no Task 1, sem bifurcação de porta 443.
- Cada um dos 4 success criteria da Fase 1 tem um passo de validação correspondente no runbook, com comando exato.
- O checkpoint humano foi executado e o resultado (aprovado ou gap, incluindo se o gap foi o risco residual de §6) está registrado no SUMMARY deste plano.
</verification>

<success_criteria>
1. Cliente WebRTC conecta em `wss://livekit.usesenju.com` com TLS válido, sem aviso.
2. De hotspot 4G/CGNAT real, candidato `relay` aparece selecionado em `chrome://webrtc-internals`.
3. Candidatos ICE anunciados usam o IP público da VPS.
4. Depois de `sudo reboot`, o LiveKit volta a responder sozinho (via supervisão do Coolify).
</success_criteria>

<output>
After completion, create `.planning/phases/01-livekit-na-vps/01-02-SUMMARY.md`.
Registrar no SUMMARY o resultado real do checkpoint humano (os 4 critérios
passaram? o risco residual de TURN fora da 443 se materializou? algum outro
gap ficou pendente para um plano de fechamento?) — é o critério de "Fase 1
pronta" de verdade, não só "arquivos existem".
</output>
