#!/usr/bin/env bash
set -euo pipefail

# Renova o certificado do TURN e reinicia o livekit-server para que ele
# releia o arquivo. Feito para rodar em cron, sem interação.
#
# Por que o restart faz parte deste script, e não é um lembrete manual:
# o livekit-server lê o certificado uma única vez, ao subir. Renovar sem
# reiniciar produz o pior tipo de falha — o certificado novo está no disco,
# o processo segue servindo o antigo, e 90 dias depois o TURN para de
# aceitar TLS. O sintoma que chega ao usuário é "às vezes ninguém ouve
# ninguém", sem erro em log nenhum.
#
# Uso no cron (mensal):
#   0 3 1 * * DOMAIN=livekit.usesenju.com EMAIL=voce@exemplo.com \
#     /opt/janja/infra/livekit/renew-and-restart.sh \
#     >> /var/log/livekit-turn-cert.log 2>&1

: "${DOMAIN:?defina DOMAIN=livekit.usesenju.com}"
: "${EMAIL:?defina EMAIL=voce@exemplo.com}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== $(date -Is) renovação do certificado do TURN ==="
DOMAIN="$DOMAIN" EMAIL="$EMAIL" "$HERE/turn-cert-init.sh" renew

# O nome do container carrega um sufixo que muda a cada deploy do Coolify,
# então filtramos por prefixo em vez de nome fixo.
CID="$(docker ps -q --filter name=livekit-server | head -1)"

if [ -z "$CID" ]; then
  echo "AVISO: nenhum container livekit-server em execução — nada a reiniciar."
  echo "O certificado foi renovado, mas o serviço precisa subir para usá-lo."
  exit 0
fi

echo "Reiniciando container $CID para recarregar o certificado."
docker restart "$CID"
echo "=== $(date -Is) concluído ==="
