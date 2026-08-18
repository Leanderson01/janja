# Fase 1 — Research: LiveKit na VPS

**Pesquisado em:** 2026-08-18
**Fontes:** docs.livekit.io (via WebFetch), `config-sample.yaml` bruto do repo
`livekit/livekit` (via `curl` direto no raw.githubusercontent.com — mais confiável
que o resumo do WebFetch, que corta seções), `docs.livekit.io/deploy/vm`,
Docker Hub (`livekit/livekit-server` tags).
**Nível de discovery:** 2 (infra conhecida — Docker Compose + Caddy — mas duas
decisões de configuração exigiam confirmação contra a doc oficial antes de
planejar: como TURN/TLS convive com a porta 443, e como o range de portas UDP
50000-60000 deve ser publicado no Docker).

## 1. O pacote self-hosted oficial: `livekit/generate`

A LiveKit mantém uma ferramenta oficial, `docker run livekit/generate`, que
pergunta interativamente (domínio, e-mail, se quer Ingress/Egress) e devolve uma
pasta pronta com `caddy.yaml`, `docker-compose.yaml`, `livekit.yaml`,
`redis.conf` e um script de instalação (`init_script.sh` ou
`cloud_init.xxxx.yaml`). A própria doc diz: **"This script should be run on
your development machine"** — ou seja, mesmo a LiveKit trata isso como um
passo manual/interativo, não como algo para automatizar cegamente.

O `caddy.yaml` gerado por essa ferramenta multiplexa TURN/TLS **na mesma porta
443** que a sinalização WSS, usando o plugin `caddy-l4` (roteamento por SNI/ALPN
sem terminar TLS duas vezes) — mecanismo real, mas não documentado
publicamente em detalhe suficiente para reimplementar à mão com confiança (a
doc não expõe o conteúdo do `caddy.yaml`, só o comportamento observável:
firewall final lista `443` para "primary HTTPS and TURN/TLS", sem porta 5349
separada).

**Decisão para este projeto:** não reimplementar o multiplexing de `caddy-l4`
à mão — é exatamente o tipo de coisa que a seção "Don't Hand-Roll" existe para
evitar (mecanismo real, mas comprovadamente delicado o bastante para a própria
LiveKit empacotar como ferramenta interativa em vez de documentar como
receita). Em vez disso, o Caddyfile deste projeto usa **TURN/TLS numa porta
dedicada (5349)**, separada da 443 — ver §3. Isso é uma configuração
oficialmente suportada (`turn.cert_file`/`key_file`, ver `config-sample.yaml`
§3.1) e já era a decisão original do design (`docs/superpowers/specs/...md`
§7 lista `5349/TCP (TURN/TLS)` como porta própria). A única desvantagem real de
não multiplexar em 443 é não atravessar firewalls corporativos que permitem
*apenas* saída na porta 443 — cenário fora do critério de sucesso desta fase
(que testa hotspot 4G/CGNAT, não firewall corporativo). Se isso um dia virar
requisito, revisitar com `docker run livekit/generate` como caminho completo.

## 2. Portas — lista final confirmada

Fonte: `docs.livekit.io/deploy/vm` (seção Firewall, texto completo obtido via
WebFetch) + `config-sample.yaml` (comentários por campo).

| Porta | Protocolo | Papel | Observação |
|---|---|---|---|
| 443 | TCP | WSS (sinalização + API) | Servida pelo Caddy (ou proxy existente); é a ÚNICA coisa nessa porta neste projeto — TURN não multiplexa aqui (ver §1) |
| 80 | TCP | Emissão/renovação de certificado TLS (HTTP-01) | Só precisa estar aberta durante emissão/renovação, não durante uso normal |
| 5349 | TCP | TURN sobre TLS | Porta dedicada, decisão deste projeto (ver §1 e §3) |
| 3478 | UDP | TURN sobre UDP (servidor STUN embutido) | Habilitado junto com `turn.enabled: true` |
| 7881 | TCP | Fallback WebRTC sobre TCP quando UDP falha | `rtc.tcp_port`; "cannot be behind load balancer or TLS, must be exposed on the node" |
| 50000-60000 | UDP | Mídia RTP (ICE/UDP) | `rtc.port_range_start`/`port_range_end`; ver §4 sobre `network_mode: host` |

Confirmado também: **"Both primary and TURN domains must point to the IP
address of your instance"** — no setup oficial multiplexado existem
potencialmente dois nomes DNS. Como este projeto usa porta dedicada para TURN
(não multiplexada), **um único nome DNS basta**: `livekit.usesenju.com`
resolve para o IP da VPS, e tanto a 443 (WSS) quanto a 5349 (TURN/TLS) usam o
mesmo certificado desse único domínio.

## 3. Estratégia de certificado — compartilhado via certbot, não via storage interno do Caddy

**Problema:** a 443 (WSS, terminada pelo Caddy) e a 5349 (TURN/TLS, terminada
pelo processo `livekit-server` diretamente — `turn.cert_file`/`key_file`)
precisam do **mesmo certificado válido** para `livekit.usesenju.com`. Se o
Caddy usar HTTPS automática (comportamento padrão), o certificado fica dentro
do armazenamento interno dele (`/data/caddy/certificates/...`) — um caminho
cujo formato exato não é uma garantia pública estável o bastante para outro
processo depender dele com confiança total (varia por CA/tipo de chave).

**Decisão:** usar `certbot` em modo standalone (desafio HTTP-01 na porta 80,
rodado uma vez por um container efêmero, depois via cron/timer de renovação)
para emitir o certificado num caminho **padrão e documentado por certbot**:
`/etc/letsencrypt/live/livekit.usesenju.com/{fullchain.pem,privkey.pem}`.
Esse caminho é montado, somente leitura, tanto no container do Caddy (que usa
a diretiva estática `tls <cert> <key>`, não a automática) quanto no container
do `livekit-server` (`turn.cert_file`/`key_file`). Um único certificado, uma
única fonte da verdade, sem depender do layout interno do Caddy.

Isso também resolve, de graça, o Pitfall documentado em `PITFALLS.md`
("Integration Gotchas — LiveKit self-hosted"): `docker-compose down` apaga o
volume onde o Caddy guardaria o certificado se ele fosse automático. Com
certbot emitindo para `/etc/letsencrypt` no host (bind mount, não volume
Docker nomeado), o certificado sobrevive a qualquer operação do Compose,
incluindo `down` — o runbook ainda assim instrui a nunca usar `down` para
manutenção de rotina, mas o certificado deixa de ser o motivo para evitá-lo.

**Caminho B (proxy já existe na 443):** se a VPS já roda Nginx/Traefik com
certbot próprio, o caminho do certificado já existe
(tipicamente o mesmo `/etc/letsencrypt/live/<domínio>/`) — reaproveitar em vez
de rodar um segundo certbot para o mesmo domínio (evita bater no rate limit do
Let's Encrypt, 5 falhas/hora por domínio).

## 4. `rtc` — `use_external_ip` e o range de portas UDP

Confirmado em `config-sample.yaml`:

```yaml
rtc:
  port_range_start: 50000
  port_range_end: 60000
  tcp_port: 7881
  use_external_ip: true
```

`use_external_ip: true` faz o LiveKit descobrir o IP público via STUN e
anunciá-lo nos candidatos ICE — sem isso, numa VPS cloud, os candidatos
anunciam o IP interno da interface de rede e nenhum cliente externo alcança a
mídia (INFRA-03, e Pitfall 6 do `PITFALLS.md`).

**Publicação de portas no Docker — `network_mode: host` para o serviço
`livekit-server`.** Publicar individualmente 10.001 portas UDP
(`-p 50000-60000:50000-60000/udp`) via o proxy userland/iptables padrão do
Docker é uma operação pesada (uma regra DNAT por porta) e um modo de falha
conhecido de deploys self-hosted de LiveKit em containers — o padrão
recomendado na comunidade e implicitamente no gerador oficial (que usa
containers privilegiados/host networking para o serviço principal) é rodar o
container `livekit-server` com `network_mode: host`: todas as portas
(7880, 7881, 5349, 3478, 50000-60000) ficam diretamente no host, sem NAT do
Docker, e `use_external_ip: true` também funciona de forma mais direta (sem
uma camada extra de NAT do Docker entre o processo e a interface real).
Consequência prática: com `network_mode: host`, a seção `ports:` do
`livekit-server` no compose fica vazia (as portas já são as do host), e o
Caddy alcança o LiveKit via `127.0.0.1:7880` (mesmo namespace de rede).

## 5. `keys` — API key/secret

Confirmado em `config-sample.yaml`:

```yaml
keys:
  key1: secret1
```

Um par arbitrário `chave: segredo` (o "nome" da chave, ex. `key1`, é livre —
funciona como um identificador). Não existe comando `generate-keys` na CLI
`lk` — o padrão observado nos exemplos oficiais (`lk room join --api-key devkey
--api-secret secret`) é o desenvolvedor definir a string diretamente. Para
produção, gerar dois valores aleatórios de alta entropia (ex.
`openssl rand -hex 32`) e colocá-los em `.env` (nunca commitados) — o
`docker-compose.yml` referencia via `${LIVEKIT_API_KEY}`/`${LIVEKIT_API_SECRET}`
quando possível, e o `livekit.yaml` (que não suporta interpolação de env var
nativamente por ser um arquivo estático montado) recebe os mesmos valores
copiados manualmente pelo humano durante o deploy — documentado explicitamente
no runbook para não divergir dos dois lugares.

Esses `api_key`/`api_secret` são os mesmos que o Convex (em fases futuras, F7)
vai usar como variável de ambiente de backend para assinar os JWTs de sala —
nunca expostos ao cliente/renderer (`Security Mistakes` do `PITFALLS.md`).

## 6. Webhooks — fora de escopo desta fase, mas o campo já existe

`config-sample.yaml` confirma a seção:

```yaml
webhook:
  api_key: <api_key>
  urls:
    - https://your-host.com/handler
```

Não é usada em F1 (não há Convex ainda) — mas o campo comentado fica reservado
no `livekit.yaml` deste projeto com uma nota `# preenchido em F7`, para que o
humano que voltar a esse arquivo em F7 não precise redescobrir a sintaxe.
Confirmado também (para uso futuro, `PITFALLS.md` já documentava isso): a
verificação de assinatura do webhook exige o corpo bruto da requisição
(`WebhookReceiver.receive(rawBody, authHeader)`), não o JSON já parseado.

## 7. Validação — como provar que TURN/relay funciona sem escrever código do app

**Sinalização (WSS conecta) — CLI oficial `lk`:**

```shell
curl -sSL https://get.livekit.io/cli | bash
lk room join \
  --url wss://livekit.usesenju.com \
  --api-key <key> --api-secret <secret> \
  --publish-demo --identity test-bot \
  test-room
```

Confirma que a porta 443/WSS aceita conexão e autentica o JWT. **Não** prova
TURN/relay — o `lk` é um cliente Go (pion/webrtc), não um browser, e não
aparece em `chrome://webrtc-internals`.

**Geração de token para teste em browser:**

```shell
lk token create \
  --api-key <key> --api-secret <secret> \
  --join --room test-room --identity browser-tester \
  --valid-for 1h
```

**Candidato `relay` selecionado (SC2 da fase) — precisa de um cliente browser
real.** Não há confirmação de que a página hospedada `meet.livekit.io` aceite
um servidor customizado via UI (WebFetch não conseguiu confirmar isso contra a
doc oficial — tratar como não garantido). Caminho confiável: clonar
`livekit-examples/meet` (app Next.js de referência, open source) e rodar
localmente:

```shell
git clone https://github.com/livekit-examples/meet
cd meet && pnpm install
LIVEKIT_URL=wss://livekit.usesenju.com \
LIVEKIT_API_KEY=<key> LIVEKIT_API_SECRET=<secret> \
pnpm dev
```

Abrir `http://localhost:3000` no Chrome **a partir de um hotspot 4G/CGNAT**
(não da rede de casa), entrar na sala, abrir `chrome://webrtc-internals` numa
segunda aba, e conferir no painel de ICE que o par selecionado usa candidato
`relay` (não `srflx`/`host`) — evidência de que o tráfego passou pelo TURN.

**Teste de reboot (INFRA-04):** `sudo reboot`, esperar a VPS voltar, rodar de
novo o `lk room join` de sinalização — deve responder sem nenhum comando
manual de start (depende de `restart: unless-stopped` no compose + Docker
habilitado no boot, `systemctl is-enabled docker` deve retornar `enabled`).

## 8. Don't Hand-Roll

| Problema | Não construir | Usar em vez disso | Por quê |
|---|---|---|---|
| Multiplexar WSS + TURN/TLS na mesma porta 443 | Config `caddy-l4` escrita à mão, roteamento por SNI/ALPN | Porta dedicada 5349 para TURN (decisão §1); se um dia virar requisito real, usar `docker run livekit/generate` (ferramenta oficial) em vez de replicar o mecanismo à mão | Mecanismo real mas indocumentado em detalhe suficiente; a própria LiveKit trata como ferramenta interativa, não como receita de config estática |
| Gerar/renovar certificado confiando no storage interno do Caddy | Referenciar `/data/caddy/certificates/<issuer>/<domínio>/...` a partir de outro processo | `certbot` standalone emitindo para o caminho padrão `/etc/letsencrypt/live/<domínio>/` | Caminho de certbot é estável e documentado; caminho interno do Caddy varia por CA/algoritmo de chave |
| Descobrir se a instância tem candidato `relay` sem browser real | Inferir pelo log do `lk room join` (cliente Go, não browser) | `chrome://webrtc-internals` com um cliente browser real (app `meet` de referência) | `lk` não usa engine de browser — não reflete o comportamento real do Electron/Chromium do app |

## 9. Sources

- [LiveKit — Deploy to a VM](https://docs.livekit.io/deploy/vm) — HIGH (conteúdo completo obtido via WebFetch, citado quase literalmente em §1/§2)
- [`config-sample.yaml` — livekit/livekit@master](https://raw.githubusercontent.com/livekit/livekit/master/config-sample.yaml) — HIGH (arquivo bruto, obtido via `curl` direto, não resumido)
- [LiveKit — Ports & Firewall](https://docs.livekit.io/home/self-hosting/ports-firewall/) — HIGH (doc oficial)
- [LiveKit — Webhooks](https://docs.livekit.io/home/server/webhooks/) — HIGH (doc oficial)
- [LiveKit CLI setup — reference/developer-tools/livekit-cli](https://docs.livekit.io/reference/developer-tools/livekit-cli/) — MEDIUM (WebFetch retornou só trechos; comandos citados aqui foram os que vieram completos e consistentes com o padrão conhecido da CLI)
- [`livekit-examples/meet` — GitHub](https://github.com/livekit-examples/meet) — MEDIUM (referência de app de teste; não foi possível confirmar via WebFetch se aceita servidor customizado via UI hospedada, por isso o runbook usa o clone local como caminho garantido)
- Docker Hub `livekit/livekit-server` tags (`v1.13.5` mais recente confirmada) — HIGH (consulta direta à API do Docker Hub)
- `docker run livekit/generate` — MEDIUM (comportamento e lista de arquivos gerados confirmados pela doc oficial; conteúdo exato do `caddy.yaml`/multiplexing interno não pôde ser inspecionado — por isso tratado como "não hand-rolar", não como receita a copiar)

---
*Research da Fase 1 para: infraestrutura de mídia LiveKit self-hosted (janja)*
*Pesquisado em: 2026-08-18*
