# Runbook de Deploy — LiveKit na VPS (Coolify)

Este documento é um checklist executável, do zero até o LiveKit rodando de
verdade em `wss://livekit.usesenju.com`, atrás do Coolify. Cada passo tem o
comando exato e o resultado esperado. Você não precisa ter lido nenhum outro
documento do projeto para seguir isto — mas duas referências são citadas
quando um passo pode falhar de um jeito não óbvio:

- `01-RESEARCH.md` (na mesma pasta de fases deste projeto) — decisões de
  arquitetura e o risco residual do §6, citado no passo de validação (b).
- Os arquivos já versionados neste diretório (`livekit.yaml`,
  `docker-compose.yml`, `.env.example`, `dns-multi.ini.example`,
  `turn-cert-init.sh`) — este runbook consome todos eles, nenhum precisa ser
  escrito do zero.

## Pré-requisitos

Confira antes de começar:

- [ ] **DNS:** você controla a zona `usesenju.com` na Hostinger (pode já
      existir o registro `A` de `livekit.usesenju.com` — o passo 2 confirma).
- [ ] **Token de API da Hostinger** — criado no passo 1, se ainda não tiver.
- [ ] **Acesso admin ao Coolify** (a UI web, não precisa ser via SSH).
- [ ] **Acesso SSH à VPS** com permissão de rodar `docker`, editar
      `/etc/letsencrypt`, editar `crontab` e rodar `sudo reboot`.
- [ ] **Firewall:** acesso para abrir portas no firewall do SO (`ufw` ou
      `firewall-cmd`) e, se a VPS estiver atrás de um firewall de nuvem do
      provedor (painel da Hostinger/outro), acesso a esse painel também.
- [ ] Este repositório já está clonado/acessível no Git remoto que o Coolify
      vai usar (o Coolify clona ele mesmo — você só precisa saber a URL/
      credencial de acesso, se o repo for privado).

**Convenção de marcação:** cada passo abaixo diz **[uma vez]** (setup que só
se faz na primeira vez) ou **[repetível]** (algo que você vai rodar de novo,
ex. renovação de certificado, redeploy).

---

## 1. Token de API da Hostinger — **[uma vez]**

1. Acesse o hPanel da Hostinger → **configurações da conta → API** (o texto
   exato do menu pode variar entre versões da UI; procure por "API" nas
   configurações da conta, não nas configurações de um domínio específico).
2. Crie um token novo com permissão de **gerenciar zona DNS**.
3. Copie o valor do token e guarde num lugar seguro temporário (ex. seu
   gerenciador de senhas). Ele será colado num arquivo na VPS no passo 4 —
   **não** vai para o Coolify, e não deve ser colado em nenhum arquivo deste
   repositório.

**Resultado esperado:** você tem uma string de token em mãos (formato
opaco, geralmente 40+ caracteres).

---

## 2. Registro DNS — **[uma vez]**

1. No mesmo painel de DNS da Hostinger (zona `usesenju.com`), confirme ou
   crie um registro `A`:
   - **Nome:** `livekit`
   - **Tipo:** `A`
   - **Valor:** o IP público da sua VPS
   - **TTL:** padrão (não precisa ser baixo, DNS-01 no passo 4 não depende
     de propagação pública para funcionar — ele consulta a API da Hostinger
     diretamente).
2. Valide, de qualquer máquina com internet:
   ```
   dig +short livekit.usesenju.com
   ```
   **Resultado esperado:** imprime o IP público da VPS. Se vier vazio, pode
   ser propagação — espere alguns minutos e rode de novo. Se continuar
   vazio depois de ~15 min, revise o registro no painel (nome/tipo/valor).

---

## 3. Firewall — portas exatas — **[uma vez]**

Abrir, tanto no firewall do sistema operacional quanto no firewall do painel
do provedor da VPS (nuvens costumam ter um firewall próprio *além* do do
SO — checar os dois):

| Porta | Protocolo | Papel |
|---|---|---|
| 5349 | TCP | TURN/TLS |
| 3478 | UDP | TURN/UDP + STUN embutido |
| 7881 | TCP | Fallback ICE/TCP |
| 7882 | UDP | Mux de todo o tráfego ICE/UDP |

**Não mexer** em 443/tcp, 443/udp e 80/tcp — já estão abertas e são
gerenciadas pelo próprio Coolify/Traefik.

Exemplo com `ufw`:
```
sudo ufw allow 5349/tcp
sudo ufw allow 3478/udp
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw status
```
**Resultado esperado:** `ufw status` lista as 4 regras acima como `ALLOW`.
Se a VPS usa `firewall-cmd` em vez de `ufw`, o equivalente é
`firewall-cmd --permanent --add-port=5349/tcp` (repetir para as outras 3,
trocando protocolo/porta) seguido de `firewall-cmd --reload`.

Depois, confira o painel de firewall do provedor de nuvem (se existir) e
replique as mesmas 4 regras lá — um firewall de nuvem bloqueando por trás
das costas do `ufw` é uma causa comum e silenciosa do teste de TURN (passo
11b) falhar mesmo com tudo liberado no SO.

---

## 4. Certificado do TURN (DNS-01, não usa a porta 80) — **[uma vez]**

O `livekit-server` termina TLS ele mesmo na porta 5349 (TURN), com um
certificado próprio — independente do certificado que o Coolify/Traefik
gerencia para a porta 443. Como a porta 80 pertence ao Traefik, a emissão é
via desafio **DNS-01** (não HTTP-01), usando o script
`turn-cert-init.sh` já versionado neste diretório.

1. Na VPS, crie o arquivo de credenciais **fora do repositório git**:
   ```
   sudo mkdir -p /etc/letsencrypt
   sudo nano /etc/letsencrypt/dns-multi.ini
   ```
   Conteúdo (copie a estrutura de `infra/livekit/dns-multi.ini.example`,
   substituindo pelo token real do passo 1):
   ```ini
   dns_multi_provider = hostinger
   HOSTINGER_API_TOKEN="<token real do passo 1>"
   ```
2. Restrinja a permissão do arquivo (contém segredo):
   ```
   sudo chmod 0600 /etc/letsencrypt/dns-multi.ini
   ```
   **Resultado esperado:** `ls -l /etc/letsencrypt/dns-multi.ini` mostra
   `-rw-------`.

   > **Nunca** `export HOSTINGER_API_TOKEN=...` num shell interativo para
   > "testar rápido" — o valor fica gravado em texto puro no histórico do
   > shell (`~/.bash_history` ou equivalente) indefinidamente. Prefira
   > sempre escrever direto no arquivo `dns-multi.ini` com permissão
   > restrita, como acima, ou passar a env var inline só no momento exato
   > do comando (`VAR=valor comando`, sem `export`) — mesmo assim, para
   > este passo específico, o arquivo é o caminho documentado e mais
   > seguro.

3. Rode o script de emissão:
   ```
   cd infra/livekit
   DOMAIN=livekit.usesenju.com EMAIL=<seu-email> ./turn-cert-init.sh
   ```
4. Confirme o sucesso:
   ```
   sudo ls /etc/letsencrypt/live/livekit.usesenju.com/
   ```
   **Resultado esperado:** lista `fullchain.pem` e `privkey.pem`.

   **Se falhar:** o erro mais comum é o token do passo 1 sem permissão de
   DNS, ou o arquivo `dns-multi.ini` com sintaxe errada (confira contra o
   `.example`). O log do próprio comando mostra a causa (ex. `401
   Unauthorized` da API da Hostinger = token errado ou sem permissão).

---

## 5. Cron de renovação — **[uma vez]** (o próprio cron roda **[repetível]** depois)

Certificados Let's Encrypt expiram em 90 dias — uma renovação mensal dá
margem confortável.

1. Edite o crontab da VPS:
   ```
   crontab -e
   ```
2. Adicione a linha (troque `/caminho/do/repo` pelo caminho real onde este
   repositório está clonado na VPS):
   ```cron
   0 3 1 * * cd /caminho/do/repo/infra/livekit && DOMAIN=livekit.usesenju.com EMAIL=<seu-email> ./turn-cert-init.sh renew >> /var/log/livekit-turn-cert-renew.log 2>&1
   ```
3. Salve e confirme:
   ```
   crontab -l
   ```
   **Resultado esperado:** a linha acima aparece na listagem.

**Atenção — passo manual que o cron NÃO faz sozinho:** depois de uma
renovação bem-sucedida, o container `livekit-server` precisa ser
**reiniciado** para carregar o certificado novo (o processo não recarrega
sozinho). Reinicie pela UI do Coolify (**Restart** no recurso) ou, via SSH,
`docker restart <nome-do-container>`. Considere isso um lembrete mensal
manual — se virar incômodo recorrente, automatizar esse restart é um
gap-closure futuro, fora do escopo deste runbook.

---

## 6. Preparar `.env` local e `keys` de `livekit.yaml` com valores reais — **[uma vez]**

1. Copie o template de referência (não é lido automaticamente por nada —
   é só um lugar organizado para anotar os valores antes de colá-los nos
   lugares certos):
   ```
   cd infra/livekit
   cp .env.example .env
   ```
2. Gere as duas chaves:
   ```
   openssl rand -hex 32
   openssl rand -hex 32
   ```
   **Resultado esperado:** duas strings hexadecimais de 64 caracteres cada,
   diferentes entre si. A primeira vira `LIVEKIT_API_KEY`, a segunda
   `LIVEKIT_API_SECRET`.
3. Preencha esses dois valores no seu `.env` local (arquivo já ignorado
   pelo git — confirme com `git check-ignore infra/livekit/.env`; se não
   estiver ignorado, **não** o adicione ao git).
4. **Copie os mesmos dois valores** para a seção `keys:` de
   `infra/livekit/livekit.yaml`, substituindo a linha
   `REPLACE_WITH_API_KEY: REPLACE_WITH_API_SECRET` por
   `<seu-key-gerado>: <seu-secret-gerado>`.

   > Este arquivo (`livekit.yaml`) é o que o Coolify vai montar dentro do
   > container no passo 7 — mas o checkout que o Coolify usa é um clone
   > próprio do repositório Git, não necessariamente esta cópia local que
   > você acabou de editar. **O passo 8 trata isso explicitamente — não
   > pule para o passo 9 sem passar pelo 8.**

**Resultado esperado:** você tem os dois valores anotados em algum lugar
seguro (gerenciador de senhas), prontos para reusar nos passos 8 e 11.

---

## 7. Criar o recurso Docker Compose no Coolify — **[uma vez]**

1. Na UI do Coolify: **New Resource → Docker Compose** (ou o build pack
   "Docker Compose" dentro do fluxo padrão de criação de aplicação).
2. Aponte para o repositório Git deste projeto. Se o repositório for
   privado, o Coolify vai pedir para configurar um GitHub App ou Deploy
   Key — siga o assistente próprio da tela (não há comando de linha de
   comando aqui, é tudo na UI).
3. Configure os dois campos que dizem onde está o compose dentro do
   monorepo:
   - **Base Directory:** `/infra/livekit`
   - **Docker Compose Location:** `docker-compose.yml`
4. Salve.

**Resultado esperado:** o recurso aparece na lista de recursos do Coolify,
ainda sem deploy feito.

---

## 8. ~~Corrigir `keys` no checkout do Coolify~~ — **eliminado**

Este passo existia porque o `livekit.yaml` era montado estático e as chaves
precisavam ser editadas à mão no checkout que o Coolify clona. Isso tinha um
modo de falha ruim: **qualquer redeploy re-clonava o repositório e revertia a
edição**, derrubando a autenticação sem nenhum erro visível — o sintoma seria
"ninguém consegue entrar em call", meses depois, sem pista da causa.

Resolvido na origem: o `livekit-server` aceita a variável de ambiente
`LIVEKIT_KEYS` no formato `"chave: segredo"`. O bloco `keys:` foi removido do
`livekit.yaml`, o `docker-compose.yml` passa a env var, e o valor é definido
nas env vars da stack no Coolify — que **sobrevivem a redeploy**.

Não há nada a fazer neste passo. Vá para o 9, que agora define essa variável.

---

## 9. Variáveis de ambiente e domínio na UI do Coolify — **[uma vez]**

### 9.1 — Variável de ambiente das chaves

Na página do recurso, seção **Environment Variables**, adicione:

| Nome | Valor |
|---|---|
| `LIVEKIT_KEYS` | `<API_KEY>: <API_SECRET>` |

O formato importa: os dois valores do passo 6 **na mesma linha**, separados
por dois-pontos e um espaço. Exemplo de forma (não de valor):
`22f8fd…: 8844…`

Marque como secreta/build-time conforme a UI oferecer. Esta é a variável mais
sensível do projeto — quem a tem entra em qualquer canal de voz sem passar
por login.

Se a variável não estiver definida, o container falha ao subir com uma
mensagem explícita em vez de subir sem autenticação — proposital.

### 9.2 — Domínio

1. Na página do recurso criado no passo 7, localize a seção de domínio do
   serviço `livekit-server`.
2. Atribua o domínio:
   ```
   https://livekit.usesenju.com:7880
   ```
   (porta 7880 é onde o `livekit-server` escuta API + sinalização
   WebSocket — o Coolify usa isso para saber para onde rotear
   internamente; externamente continua servido na 443 normal, como
   qualquer outro recurso do Coolify.)
3. Salve.

**Resultado esperado:** o Coolify gera automaticamente os labels do Traefik
para esse domínio — você não edita nada do Traefik manualmente em nenhuma
hipótese (regra dura do projeto: configuração do Traefik gerenciada pelo
Coolify é regenerada por ele e edições manuais somem silenciosamente).

---

## 10. Deploy — **[repetível — é o próprio botão de redeploy]**

1. Na UI do Coolify, clique em **Deploy**.
2. Acompanhe os logs de build/start direto na UI.

**Resultado esperado:** `livekit-server` sobe sem erro de bind de porta e
sem erro de certificado (isso confirma que os arquivos de
`/etc/letsencrypt` foram montados corretamente pelo bind mount absoluto
declarado no `docker-compose.yml`).

**Se der erro de bind mount:** verifique se o Coolify aceitou o path
absoluto `/etc/letsencrypt:/etc/letsencrypt:ro` no compose. Alguns setups
de Coolify restringem bind mounts a caminhos relativos ao diretório da
aplicação — se for o caso aqui, essa é uma exceção a registrar (com o log
de erro exato) para virar um plano de fechamento de gap; não é algo que
este runbook consegue prever sem testar contra a VPS real.

> Lembrete: depois de **qualquer** deploy/redeploy a partir daqui, volte ao
> **passo 8** e confira se `keys:` ainda tem os valores reais.

---

## 11. Validação — os 4 critérios de sucesso da Fase 1

Cada teste abaixo mapeia 1:1 para um critério de sucesso (`INFRA-01` a
`INFRA-04`) da Fase 1. Rode todos, nesta ordem.

### a) TLS válido, sem aviso (INFRA-01)

1. Instale a CLI oficial do LiveKit (se ainda não tiver):
   ```
   curl -sSL https://get.livekit.io/cli | bash
   ```
2. Rode:
   ```
   lk room join --url wss://livekit.usesenju.com \
     --api-key <LIVEKIT_API_KEY> --api-secret <LIVEKIT_API_SECRET> \
     --publish-demo --identity test-bot test-room
   ```
   (use os valores reais gerados no passo 6.)

**Resultado esperado (pass):** conecta sem nenhum erro de certificado e sem
erro de autenticação. Se der erro de autenticação (não de certificado),
volte ao passo 8 — provavelmente o `keys:` no checkout da VPS ainda está
com o placeholder.

### b) Candidato `relay` de rede restritiva/CGNAT (INFRA-02) — o teste mais importante

Este é o teste que comprova que o TURN funciona de verdade, não só a
sinalização.

1. Gere um token de acesso à sala:
   ```
   lk token create --api-key <key> --api-secret <secret> \
     --join --room test-room --identity browser-tester --valid-for 1h
   ```
2. Clone e rode localmente o cliente de referência (não use o
   `meet.livekit.io` hospedado — não há confirmação de que ele aceite
   servidor customizado via UI):
   ```
   git clone https://github.com/livekit-examples/meet
   cd meet && pnpm install
   LIVEKIT_URL=wss://livekit.usesenju.com \
   LIVEKIT_API_KEY=<key> LIVEKIT_API_SECRET=<secret> pnpm dev
   ```
3. **Importante — a rede usada importa:** abra `http://localhost:3000` no
   Chrome a partir de um **hotspot 4G real de um celular com CGNAT** (dados
   móveis). **Não use a rede wifi de casa** — ela normalmente não filtra
   portas do jeito que uma rede móvel/corporativa filtra, então o teste não
   provaria nada nesse cenário.
4. Entre na sala usando o token gerado no passo 1.
5. Abra uma segunda aba: `chrome://webrtc-internals`.
6. Ache a conexão ativa (peer connection) referente à sessão que você
   acabou de abrir, e localize o par de candidato selecionado (`selected
   candidate pair`).

**Resultado esperado (pass):** o tipo do candidato selecionado é `relay`
(não `srflx` nem `host`).

**Se este teste falhar especificamente aqui** (o teste (a) conectou —
sinalização OK — mas o candidato `relay` não é o selecionado, ou a conexão
de mídia simplesmente não estabelece): **leia `01-RESEARCH.md` §6 antes de
investigar mais.** O motivo mais provável é a rede móvel filtrando a porta
5349 — porque, nesta arquitetura sob Coolify, o TURN roda na porta 5349 (não
na 443 recomendada pela doc oficial do LiveKit), já que a 443 pertence
inteiramente ao Traefik e não há como colocar TURN nela sem reimplementar
multiplexação SNI/ALPN por conta própria (decisão consciente, documentada
como risco residual, não um bug a caçar). **Registre esse resultado
explicitamente no SUMMARY deste plano** — se acontecer, vira insumo para um
plano de fechamento de gap, não algo para tentar resolver improvisando
dentro deste runbook.

### c) Candidatos ICE com IP externo/público da VPS (INFRA-03)

1. Na mesma sessão de `chrome://webrtc-internals` do teste (b), veja os
   candidatos ICE **locais** anunciados pelo servidor (não os do seu
   próprio navegador).

**Resultado esperado (pass):** os candidatos aparecem com o IP **público**
da VPS — não um IP privado (`10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`) e
não o IP interno da rede bridge do Docker/Coolify.

### d) Sobrevive a reboot (INFRA-04)

1. Reinicie a VPS:
   ```
   sudo reboot
   ```
2. Espere a VPS voltar (1-2 minutos costuma bastar).
3. Confirme que o Docker subiu sozinho no boot:
   ```
   systemctl is-enabled docker
   ```
   **Resultado esperado:** `enabled`.
4. Confirme que o container está de pé, sem nenhuma intervenção manual de
   start/deploy:
   ```
   docker ps | grep livekit
   ```
   **Resultado esperado:** aparece uma linha com o container do
   `livekit-server`, status `Up`.
5. Repita só o teste (a) (`lk room join ...`) para confirmar que o serviço
   está de fato respondendo, não só o container "de pé".

**Resultado esperado (pass):** o teste (a) responde sem que você tenha
rodado nenhum comando manual de deploy/start — o Coolify supervisiona o
container e o Docker inicia no boot como parte da própria instalação do
Coolify.

---

## 12. Manutenção — **[repetível, sempre que precisar reiniciar/atualizar]**

- Reiniciar ou atualizar o serviço **sempre pela UI do Coolify**
  (**Restart** / **Redeploy**). Não rode `docker compose down` manualmente
  fora do fluxo do Coolify — ele gerencia o ciclo de vida da stack, e um
  `down` fora de banda pode deixar o estado que o Coolify espera
  dessincronizado do estado real dos containers.
- **Depois de qualquer redeploy, reconfira o passo 8.** O placeholder de
  `keys:` pode ter voltado — é o gap mais fácil de reintroduzir sem
  perceber, porque o deploy em si não falha visivelmente quando isso
  acontece (só a autenticação da API, silenciosamente).
- Renovação de certificado do TURN é o cron do passo 5 — depois de cada
  renovação bem-sucedida, reiniciar o `livekit-server` (UI do Coolify →
  Restart) para carregar o certificado novo.
