# 07-00 — Credenciais do LiveKit no Convex

**Status:** concluído (checkpoint humano)
**Data:** 2026-08-19

Três variáveis definidas no deployment do Convex via `npx convex env set`:
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` e `LIVEKIT_URL`.

Os valores vieram do `LIVEKIT_KEYS` do container na VPS — o mesmo par que o servidor
usa para validar tokens. Precisam bater exatamente: o LiveKit rejeita qualquer token
assinado com outro segredo, e a mensagem de erro não diz o motivo.

## Por que no Convex e não no app

É o Convex que assina os tokens de sala, depois de verificar que o chamador é membro do
servidor dono do canal. Se o segredo fosse para o Electron, iria empacotado no
instalador distribuído às dez pessoas — e quem o extraísse entraria em qualquer canal de
voz sem passar por login, sem ser membro de nada e sem deixar rastro.

É o segredo mais sensível do projeto: não é credencial de infraestrutura, é a chave da
privacidade das conversas do grupo.
