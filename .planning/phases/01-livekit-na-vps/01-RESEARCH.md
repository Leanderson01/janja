# Fase 1 — Research: LiveKit na VPS

**Pesquisado em:** 2026-08-18 (revisão — pesquisa original também datada de
2026-08-18, mas partia de premissas erradas sobre o ambiente da VPS)
**Motivo da revisão:** a pesquisa original assumia uma VPS "nua", com a porta
443 livre e um Caddy próprio administrando TLS. A VPS real roda **Coolify
4.1.2**, cujo proxy (`coolify-proxy`, Traefik v3.6) já ocupa 80/tcp, 443/tcp e
443/udp (HTTP/3). Isso invalida a metade do design original — não o objetivo
(TURN/TLS funcionando de rede CGNAT), mas o *como* chegar lá.
**Fontes:** docs.livekit.io (via `curl .../*.md` — a doc oficial serve
markdown bruto por essa rota, mais confiável que o resumo do WebFetch),
`config-sample.yaml` bruto do repo `livekit/livekit` (via `curl` direto),
`coollabsio/coolify-docs` no GitHub (arquivos `.mdx` brutos, branch `v4.x` —
o site coolify.io/docs não expôs conteúdo técnico via WebFetch, o repo sim),
`alexzorin/certbot-dns-multi` (README bruto via GitHub), go-acme.github.io
(provider Hostinger do `lego`).
**Nível de discovery:** 2→3 — a decisão de rede (host vs bridge) e a divisão
de responsabilidade de certificado entre Coolify/Traefik e o processo
`livekit-server` têm impacto arquitetural direto (é o que determina se o
deploy funciona ou não sob Coolify), então tratada com o rigor de nível 3
mesmo a fase sendo nominalmente nível 2.

## 1. Ambiente confirmado — por que o plano original não serve mais

Fatos verificados na VPS real (não presunção):

- Coolify 4.1.2 self-hosted. `coolify-proxy` é `traefik:v3.6`, publica
  `80/tcp`, `443/tcp`, `443/udp` (HTTP/3) e `8080/tcp` (dashboard do Traefik).
- `coolify-db` é `postgres:15-alpine` (Coolify v4 — a v3 usava SQLite; não é
  relevante pra esta fase, mas confirma que é uma instalação v4 completa).
- Portas 80 e 443 estão **ocupadas** pelo `docker-proxy` do Traefik. Um
  `certbot standalone` (o que o plano original fazia) não consegue bindar a
  80 — é exatamente o path que quebra.
- Dono da VPS tem acesso admin ao Coolify e acesso SSH/Docker à VPS
  (confirmado: já rodou `docker exec -ti coolify sh -c "php artisan
  root:reset-password"`).
- DNS de `usesenju.com` fica na **Hostinger**. Domínio alvo:
  `livekit.usesenju.com`.

**Decisão do usuário:** rodar o LiveKit como **recurso Docker Compose do
Coolify** (não como stack solta fora do Coolify). Justificativa: Coolify já
gera os labels do Traefik e cuida do TLS da sinalização WSS de graça, e dá
INFRA-04 (sobreviver a reboot) sem esforço extra — Coolify supervisiona o
container e reinicia o Docker no boot como parte da própria instalação.

**Regra dura:** nunca editar à mão a configuração do Traefik gerenciado pelo
Coolify (arquivos em `/data/coolify/proxy/...`) — o Coolify os regenera e
edições manuais somem silenciosamente. Tudo passa pelo modelo do Coolify:
domínio atribuído pela UI, labels gerados automaticamente a partir disso.

## 2. Modelo de deploy — LiveKit como Docker Compose Resource do Coolify

Confirmado em `coollabsio/coolify-docs` (`content/docs/applications/build-packs/docker-compose.mdx`
e `content/docs/knowledge-base/docker/compose.mdx`, branch `v4.x`):

- Criar um **New Resource → Docker Compose** apontando pro repo Git deste
  projeto, com **Base Directory** = `/infra/livekit` e **Docker Compose
  Location** = `docker-compose.yml` (suporta monorepo — "specify a subfolder
  like `/backend`").
- O `docker-compose.y[a]ml` do repo é a **fonte única da verdade**: storage,
  variáveis, tudo que normalmente ficaria na UI do Coolify pra outros tipos
  de app, aqui vem do compose file.
- Coolify cria uma **rede bridge isolada** por stack (nome = UUID do
  recurso) e conecta o Traefik nela. **Nunca declarar `networks:` custom no
  compose** — a doc é explícita: isso causa "504 Gateway Timeout"
  intermitente, porque o container fica em duas redes (a do Coolify + a
  custom) e o Traefik escolhe não-deterministicamente qual IP usar
  (issues [#4483](https://github.com/coollabsio/coolify/issues/4483),
  [#6215](https://github.com/coollabsio/coolify/issues/6215),
  [#6153](https://github.com/coollabsio/coolify/issues/6153) documentadas no
  próprio repo da doc). Isso substitui qualquer decisão de rede do plano
  original — ver §3.
- **Atribuição de domínio:** depois que o Coolify carrega o compose, a UI
  lista os serviços e permite atribuir um domínio a cada um. Se o serviço
  escuta na porta 80, o domínio sozinho basta; senão, informar a porta junto
  — ex. `https://livekit.usesenju.com:7880` pro serviço `livekit-server`
  (porta 7880 é onde o `livekit-server` escuta API+WebSocket). O Coolify
  gera os labels do Traefik e o roteamento a partir **desse campo da UI**,
  não de labels escritas à mão no compose — é assim que a regra "nunca
  editar Traefik à mão" é respeitada: a única superfície de configuração é o
  campo de domínio da UI.
- **Portas que não devem passar pelo proxy** (TURN/TLS, TURN/UDP, ICE/TCP,
  ICE/UDP): usar o atributo `ports:` do compose pra publicar direto no host,
  contornando o Traefik por completo — mecanismo padrão do Docker Compose,
  documentado explicitamente na doc do Coolify ("Service Port Mapping").
- Variáveis de ambiente: Coolify detecta variáveis referenciadas no compose
  (`${VAR}`) e as expõe editáveis na UI. Não usamos esse mecanismo pro
  `livekit.yaml` (ver §5 do plano `01-01` — ele é montado estático, não lê
  env var), mas é o canal para as duas env vars que a stack realmente
  consome pela UI do Coolify: nenhuma, neste desenho — ver nota abaixo.

## 3. Rede — por que `network_mode: host` não serve mais, e o que usar no lugar

**O problema:** o plano original escolhia `network_mode: host` pro
`livekit-server` pra evitar publicar individualmente as ~10.001 portas do
range `50000-60000/udp` (uma regra DNAT por porta — operação pesada e modo
de falha conhecido de deploys self-hosted em container). Mas o Traefik do
Coolify roteia até os containers **pela rede bridge que ele mesmo
administra**, referenciando-os pelo nome/IP dentro dessa rede — um container
em `network_mode: host` não está nela, então o Traefik não o alcança, e o
`livekit-server` nunca teria domínio/TLS via Coolify (voltaríamos a precisar
de um Caddy próprio na 443, que não é mais uma opção com essa porta
ocupada).

**A saída: `rtc.udp_port` (mux de porta única) em vez de
`rtc.port_range_start`/`port_range_end`.** Confirmado no `config-sample.yaml`
bruto (`livekit/livekit@master`):

```yaml
# when set, LiveKit will attempt to use a UDP mux so all UDP traffic goes through
# listed port(s). To maximize system performance, we recommend using a range of ports
# greater or equal to the number of vCPUs on the machine.
# port_range_start & end must not be set for this config to take effect
# udp_port: 7882-7892
```

E confirmado também na tabela oficial de portas
(`docs.livekit.io/transport/self-hosting/ports-firewall`, texto completo via
`curl .../ports-firewall.md`):

| Porta | Default | Config | Exposta | Descrição |
|---|---|---|---|---|
| ICE/UDP Mux | 7882 | `rtc.udp_port` | sim | (opcional) É possível lidar com todo tráfego UDP numa porta única. Quando definido, `port_range_start`/`end` não são usados |

Ou seja: **`udp_port` é uma alternativa oficialmente suportada ao range**, não
um hack. Usando `udp_port: 7882` (uma porta só — suficiente pro volume desta
fase: MVP de chat+voz com poucos participantes simultâneos por sala), o
compose publica **uma porta UDP**, não dez mil. Isso é perfeitamente
compatível com a rede bridge padrão do Coolify: `ports: ["7882:7882/udp"]`
gera uma única regra DNAT, sem custo operacional relevante.

**Trade-off, documentado para não ser esquecido:** a mesma doc oficial
(`transport/self-hosting/deployment.md`) recomenda: *"If running in a
Dockerized environment, host networking should be used for optimal
performance."* Isso é uma recomendação de performance pra cenários de alta
escala (muitas salas/participantes simultâneos, onde distribuir tráfego por
múltiplas portas ajuda a paralelizar por vCPU), não um requisito funcional.
Abrir mão dela custa uma camada extra de NAT do proxy userland do Docker
nas poucas portas publicadas — aceitável no volume esperado desta fase (MVP,
VPS de 2 vCPU). Se algum dia a CPU virar gargalo real, o próprio comentário
do `config-sample.yaml` já indica o caminho: usar um range pequeno de portas
em vez de uma só (ex. `udp_port: 7882-7883`, uma por vCPU) — nunca voltar ao
range de 10 mil.

**Decisão final:** `livekit-server` roda em rede bridge padrão do Coolify
(sem `networks:` custom, sem `network_mode: host`), com:
- Porta 7880 (API/WS) **sem** entrada em `ports:` — alcançada pelo Traefik
  via rede interna, domínio atribuído na UI (§2).
- Portas 7881/tcp, 7882/udp, 3478/udp e 5349/tcp publicadas via `ports:` no
  compose, contornando o Traefik (§2, "Service Port Mapping").

## 4. Portas — lista final confirmada (revisada)

Fonte: `docs.livekit.io/transport/self-hosting/ports-firewall.md` (tabela
completa) + `config-sample.yaml`.

| Porta | Protocolo | Papel | Como é publicada nesta fase |
|---|---|---|---|
| 7880 | TCP | API + sinalização WSS | **Não publicada no host.** Roteada pelo Traefik do Coolify via rede interna; domínio+TLS atribuídos na UI (§2) |
| 7881 | TCP | Fallback ICE/TCP quando UDP falha | `ports:` — "cannot be behind load balancer or TLS, must be exposed on the node" (doc oficial) |
| 7882 | UDP | Mux de todo o tráfego ICE/UDP (substitui o range 50000-60000, ver §3) | `ports:` |
| 3478 | UDP | TURN/UDP + STUN embutido | `ports:` |
| 5349 | TCP | TURN/TLS | `ports:` — cert próprio, não passa pelo Traefik (ver §5) |
| 80 | TCP | HTTP-01 do Traefik (cert automático do Coolify pra 443) | Já ocupada e gerenciada pelo Coolify — nada a fazer aqui |
| relay_range (1024-30000, default) | UDP | Comunicação **interna** entre o processo TURN embutido e o SFU, mesmo binário/container | **Não precisa de firewall nem de `ports:`** — não consta na tabela oficial de portas expostas; é loopback dentro do container |

## 5. Certificado — responsabilidade dividida, confirmada contra a doc oficial

Duas superfícies TLS, dois certificados, dois mecanismos de emissão — **não
compartilhar o mesmo arquivo entre elas**:

### 5a. WSS na 443 — automático, cuidado do Coolify/Traefik

Confirmado em `coollabsio/coolify-docs` (`content/docs/knowledge-base/domains.mdx`):
ao cadastrar o domínio como `https://livekit.usesenju.com:7880` na UI, o
Coolify "aplica automaticamente a configuração necessária no proxy reverso
(Traefik) para servir a aplicação via HTTPS" e emite/renova via Let's
Encrypt sozinho — a porta 80 (HTTP-01) já está com o Traefik, então isso
**não exige nenhuma ação nossa**, nem token de DNS. É o caminho automático
padrão do Coolify, sem hand-roll nenhum.

**Nunca extrair esse certificado do `acme.json` do Coolify para reusar no
TURN** — decisão que já valia no plano original e continua valendo: esse
armazenamento é regenerado pelo Coolify a cada renovação (~90 dias) e
qualquer processo externo que dependa do caminho/formato exato quebra
silenciosamente.

### 5b. TURN/TLS na 5349 — próprio, via DNS-01 (Hostinger)

O `livekit-server` termina TLS ele mesmo em `turn.tls_port` lendo
`cert_file`/`key_file` do disco — não passa pelo Traefik (§3, §4). Como a
porta 80 está ocupada pelo Traefik, um desafio **HTTP-01** (que precisa
bindar a 80) está fora de cogitação para esse certificado — diferente do
plano original, que rodava `certbot standalone -p 80`.

**Solução: desafio DNS-01**, que não precisa de nenhuma porta aberta — só
consegue criar um registro TXT no provedor de DNS via API. Confirmado:

- **lego** (o client ACME usado por baixo dos panos por `certbot-dns-multi`
  e pelo próprio Traefik) suporta Hostinger como provider desde a **v4.27.0**
  (go-acme.github.io/lego/dns/hostinger/), variável de ambiente
  `HOSTINGER_API_TOKEN` (obrigatória). Timeout de propagação default: 60s.
- **`certbot-dns-multi`** (`alexzorin/certbot-dns-multi`, README bruto via
  GitHub) empacota o `lego` como plugin do certbot, com suporte a mais de
  100 providers incluindo Hostinger. Instalação via Docker (não precisa
  instalar Python/pip na VPS):
  ```bash
  docker run --rm -v /etc/letsencrypt:/etc/letsencrypt \
    ghcr.io/alexzorin/certbot-dns-multi:5.3.1 certonly \
    -a dns-multi --dns-multi-credentials /etc/letsencrypt/dns-multi.ini \
    --non-interactive --agree-tos -m "$EMAIL" -d livekit.usesenju.com
  ```
  Credenciais em `/etc/letsencrypt/dns-multi.ini` (permissão `0600`, **fora
  do repo**, nunca commitado):
  ```ini
  dns_multi_provider = hostinger
  HOSTINGER_API_TOKEN="<token real>"
  ```
- **Renovação:** mesmo comando com subcomando `renew` no lugar de
  `certonly ... -d ...` — certbot já sabe (via
  `/etc/letsencrypt/renewal/livekit.usesenju.com.conf`, gerado na primeira
  emissão) qual plugin e credenciais reusar. Certbot armazena o resultado no
  caminho padrão `/etc/letsencrypt/live/livekit.usesenju.com/` — mesmo
  caminho estável do plano original, só a forma de emitir que muda (DNS-01
  em vez de standalone HTTP-01). Como o certificado vive em bind mount no
  host (não em volume nomeado do Docker), sobrevive a qualquer operação do
  Compose, e o `livekit-server` só precisa ser **reiniciado** (não
  recriado) depois de uma renovação pra carregar o arquivo novo.
- **Único domínio necessário:** como TURN não multiplexa na 443 (decisão
  já tomada no plano original, ainda válida — ver §6), `livekit.usesenju.com`
  serve tanto pro domínio da sinalização (WSS, 443, cert do Coolify) quanto
  pro `turn.domain` (5349, cert próprio via DNS-01) — dois certificados
  *diferentes* pro *mesmo* nome, cada um emitido por um mecanismo
  independente.

**Pré-requisito humano:** criar um token de API na Hostinger (hPanel → área
de conta/API — o caminho exato do menu pode variar, procurar por "API" nas
configurações da conta) com permissão de gerenciar zona DNS. Tratado como
checklist no runbook, não algo que este ambiente de execução consegue
automatizar (sem acesso ao hPanel).

## 6. Risco residual — TURN/TLS fora da porta 443

A doc oficial menciona, em três lugares consistentes (`config-sample.yaml`,
`transport/self-hosting/deployment.md` e a tabela de
`ports-firewall.md`), uma recomendação forte: **se não há um load balancer
na frente, `turn.tls_port` deveria ser 443** — porque é o único porto que
praticamente qualquer rede restritiva (incluindo firewall corporativo que só
libera saída 443) deixa passar.

**Não é possível seguir essa recomendação aqui:** 443/tcp *e* 443/udp já
estão ocupadas pelo `coolify-proxy` (Traefik, incluindo HTTP/3). Não há
como "roubar" a porta do Traefik sem tirar TODOS os outros recursos do
Coolify do ar — fora de cogitação. A alternativa multiplexada (rotear TURN e
WSS pela mesma porta 443 via SNI/ALPN, o que o `docker run livekit/generate`
faz internamente com `caddy-l4`) já foi descartada no plano original por ser
mecanismo real mas indocumentado o bastante pra reimplementar à mão com
confiança — e continua descartada aqui pelo mesmo motivo (ver §7, Don't
Hand-Roll).

**Consequência prática, honesta:** `turn.tls_port: 5349` funciona para
qualquer rede que não filtre portas não-padrão — o que inclui a grande
maioria de redes domésticas/móveis, e é exatamente o que o critério
INFRA-02 desta fase testa (hotspot 4G/CGNAT real). CGNAT por si só (tradução
de endereço) não bloqueia portas — é um problema ortogonal a filtro de
porta. O risco real é um firewall de operadora ou rede pública que filtre
tudo *exceto* 80/443, cenário que só o teste real (chrome://webrtc-internals
com candidato `relay` selecionado, rodado do runbook) confirma ou descarta.

**Se o teste do runbook falhar especificamente no candidato `relay`** (TLS
da sinalização OK, mas TURN não conecta) — a causa mais provável é essa
porta. Não há mitigação de baixo esforço dentro da arquitetura Coolify atual
(qualquer solução real exigiria um proxy L4 por SNI na frente do próprio
Traefik, reimplementando o que o `caddy-l4` faz — trabalho de
fechamento-de-gap, não deste plano). Registrar esse resultado explicitamente
no SUMMARY do plano `01-02` se acontecer.

## 7. `keys` e webhook — sem mudança de decisão, só de mecanismo de entrega

Continua valendo do plano original: `keys:` é um par `chave: segredo`
arbitrário (`config-sample.yaml`), gerado com `openssl rand -hex 32`, e
`livekit.yaml` **não interpola variável de ambiente** — é montado estático,
então os valores reais têm que ser copiados manualmente para dentro dele
depois do deploy (documentado explicitamente no runbook, ver Pitfall
conhecido: esses dois lugares divergirem é o erro mais fácil de cometer,
principalmente se o Coolify re-clonar o repositório num redeploy futuro e
reverter os valores para os placeholders do git).

Webhook (`config-sample.yaml`, seção `webhook:`) continua fora de escopo
desta fase (sem Convex ainda) — campo comentado no `livekit.yaml`, mesma
nota `# preenchido em F7`. Verificação de assinatura ainda exige corpo bruto
da requisição (`WebhookReceiver.receive(rawBody, authHeader)`), não JSON já
parseado — já documentado em `PITFALLS.md`.

## 8. Validação — como provar TURN/relay funciona (sem mudança de método)

O método de validação não muda em relação ao plano original — só o alvo
(`wss://livekit.usesenju.com`, agora atrás do Coolify) continua o mesmo:

**Sinalização (CLI oficial `lk`, confirma TLS mas não TURN):**
```shell
curl -sSL https://get.livekit.io/cli | bash
lk room join --url wss://livekit.usesenju.com \
  --api-key <key> --api-secret <secret> \
  --publish-demo --identity test-bot test-room
```

**Candidato `relay` selecionado (SC2/INFRA-02) — precisa de browser real.**
Não há confirmação de que `meet.livekit.io` hospedado aceite servidor
customizado via UI — caminho confiável é clonar `livekit-examples/meet` e
rodar localmente:
```shell
git clone https://github.com/livekit-examples/meet
cd meet && pnpm install
LIVEKIT_URL=wss://livekit.usesenju.com \
LIVEKIT_API_KEY=<key> LIVEKIT_API_SECRET=<secret> pnpm dev
```
Abrir `http://localhost:3000` no Chrome **a partir de um hotspot 4G/CGNAT
real** (não da rede de casa), entrar na sala, abrir
`chrome://webrtc-internals` numa segunda aba e conferir que o par
selecionado usa candidato `relay` (não `srflx`/`host`).

**Reboot (INFRA-04):** com o LiveKit como recurso do Coolify, a
sobrevivência a reboot é responsabilidade do próprio Coolify (supervisiona o
container, reinicia o Docker no boot) — o teste é o mesmo (`sudo reboot`,
esperar a VPS voltar, rodar `lk room join` de novo sem nenhum comando manual
de start), mas a explicação de "por que funciona" mudou: não é mais
`restart: unless-stopped` sozinho (que continuamos declarando, defesa em
profundidade), é o Coolify supervisionando a stack.

## 9. Don't Hand-Roll (revisado)

| Problema | Não construir | Usar em vez disso | Por quê |
|---|---|---|---|
| Multiplexar WSS + TURN/TLS na mesma porta 443 | Proxy L4 por SNI/ALPN escrito à mão (na frente do próprio Traefik do Coolify, ainda mais arriscado que na frente de um Caddy próprio) | Porta dedicada 5349 para TURN (risco residual documentado em §6) | Mecanismo real (`caddy-l4`) mas indocumentado o bastante pra reimplementar; sob Coolify, colocaria um proxy extra na frente do proxy do Coolify — dobra a superfície de coisa pra quebrar |
| Emitir certificado do TURN via HTTP-01 | `certbot standalone -p 80` (o path do plano original) | `certbot-dns-multi` com provider `hostinger`, desafio DNS-01 | Porta 80 pertence ao Traefik do Coolify; não pode ser liberada sem tirar todo o Coolify do ar |
| Extrair certificado do TURN do armazenamento do Coolify/Traefik | Ler `/data/coolify/proxy/.../acme.json` de outro processo | Certificado próprio, emitido e renovado de forma independente | `acme.json` é regenerado pelo Coolify a cada renovação; formato interno não é contrato estável |
| Rodar `livekit-server` fora da rede do Coolify pra evitar range de porta | `network_mode: host` | `rtc.udp_port` (mux de porta única, oficialmente suportado) + rede bridge padrão do Coolify | `network_mode: host` tira o container da rede que o Traefik enxerga — quebra o roteamento de domínio por completo, não é uma troca aceitável |
| Gerar/editar labels do Traefik à mão no compose | Escrever `traefik.http.routers...` manualmente | Campo de Domínio na UI do Coolify (gera os labels automaticamente) | Regra dura do projeto: nunca editar config do Traefik gerenciado pelo Coolify à mão |

## 10. Sources

- [LiveKit — Ports & Firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall.md) — HIGH (markdown bruto via `curl`, tabela completa)
- [LiveKit — Virtual Machines](https://docs.livekit.io/transport/self-hosting/vm.md) — HIGH (markdown bruto)
- [LiveKit — Deploying LiveKit](https://docs.livekit.io/transport/self-hosting/deployment.md) — HIGH (markdown bruto; fonte da recomendação sobre `tls_port: 443` sem LB, e de "host networking recommended")
- [`config-sample.yaml` — livekit/livekit@master](https://raw.githubusercontent.com/livekit/livekit/master/config-sample.yaml) — HIGH (arquivo bruto via `curl`, não resumido — fonte de `udp_port`, `turn.relay_range_start/end`, `turn.external_tls`)
- [Coolify Docs — Docker Compose Build Pack](https://raw.githubusercontent.com/coollabsio/coolify-docs/v4.x/content/docs/applications/build-packs/docker-compose.mdx) — HIGH (arquivo bruto via GitHub, branch `v4.x`)
- [Coolify Docs — Knowledge Base: Docker Compose](https://raw.githubusercontent.com/coollabsio/coolify-docs/v4.x/content/docs/knowledge-base/docker/compose.mdx) — HIGH (arquivo bruto; fonte de "Service Port Mapping", regra de `networks:` custom, `content:`/`is_directory:` extensions, Magic Environment Variables)
- [Coolify Docs — Domains](https://raw.githubusercontent.com/coollabsio/coolify-docs/v4.x/content/docs/knowledge-base/domains.mdx) — HIGH (arquivo bruto; fonte do fluxo de HTTPS automático)
- [`alexzorin/certbot-dns-multi` README](https://raw.githubusercontent.com/alexzorin/certbot-dns-multi/main/README.md) — HIGH (arquivo bruto via GitHub; instalação, formato de credenciais, comando de emissão, imagem Docker)
- [lego — Hostinger DNS provider](https://go-acme.github.io/lego/dns/hostinger/) — HIGH (via WebFetch; variável `HOSTINGER_API_TOKEN`, versão mínima `v4.27.0`)
- Docker Hub `livekit/livekit-server` tags (`v1.13.5` confirmada como a mais recente estável, mesma versão do plano original — sem mudança) — HIGH (consulta direta à API do Docker Hub)
- GitHub tags `alexzorin/certbot-dns-multi` (`5.3.1` confirmada como a mais recente) — HIGH (API do GitHub)
- [`livekit-examples/meet` — GitHub](https://github.com/livekit-examples/meet) — MEDIUM (reaproveitado do research original; não foi re-verificado nesta revisão, decisão de usar o clone local em vez do `meet.livekit.io` hospedado continua a mesma)

---
*Research da Fase 1 (revisão) para: infraestrutura de mídia LiveKit self-hosted (janja), agora sob Coolify*
*Revisado em: 2026-08-18*
