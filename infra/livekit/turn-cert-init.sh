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
