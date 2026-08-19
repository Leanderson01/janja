import { useAction, useQuery } from 'convex/react'
import { useEffect, useRef, useState } from 'react'

import { Card } from '@/components/ui/card'

import { api } from '../../../../../convex/_generated/api'

// Prévia de link (CHAT-15). A metade visível do que o Plano 08.5-15 construiu
// no servidor.
//
// Quem busca a metadata é a `action` do Convex, NUNCA este componente: se cada
// leitor buscasse, um link postado num canal de 10 pessoas entregaria o IP das
// 10 ao dono daquele site a cada rolagem do histórico. Aqui só se LÊ o cache
// (`getPreview`) e, quando ele está frio, se PEDE uma vez que o servidor vá
// buscar (`fetchPreview`). A subscription da query entrega o resultado sozinha
// quando a action grava — não há polling, não há `await` na renderização.
//
// CSP: a imagem vem de domínio de terceiro, e `img-src` do
// `src/renderer/index.html` já aceita `https:` (conferido, não afrouxado —
// mesma checagem que o Plano 08.5-14 fez para o anexo). Uma `og:image` servida
// em `http://` é recusada pelo Chromium; o `onError` abaixo esconde a imagem, e
// o cartão continua válido com título e descrição.

/** URLs que já pediram busca NESTA sessão do renderer.
 *
 * O `useRef` de dentro do componente não basta: a lista de mensagens remonta
 * linhas ao paginar e ao trocar de canal, e um componente remontado começa com
 * o ref zerado. Enquanto a action ainda não gravou nada, o cache continua
 * `null` — e sem esta guarda de módulo cada remontagem dispararia a busca de
 * novo, que é exatamente o abuso que o cache do servidor existe para evitar.
 *
 * Uma URL só sai daqui quando o app é recarregado. Isso é de propósito: se a
 * action falhou, ela mesma já gravou `status: 'failed'` no servidor, e insistir
 * daqui seria re-sondar um site quebrado a cada render. */
const requestedUrls = new Set<string>()

export function LinkPreviewCard({ url }: { url: string }): React.JSX.Element | null {
  // `undefined` = a query ainda não respondeu; `null` = respondeu e não há
  // cache; documento = há cache (que pode ser `ok` OU `failed`).
  const preview = useQuery(api.linkPreviews.getPreview, { url })
  const fetchPreview = useAction(api.linkPreviews.fetchPreview)
  const requestedRef = useRef<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    // Só o cache comprovadamente vazio dispara busca. `undefined` é
    // "ainda não sei" e disparar ali faria toda mensagem com link pedir busca
    // no primeiro frame, antes de a query dizer que o dado já existia.
    if (preview !== null) return
    if (requestedRef.current === url) return
    if (requestedUrls.has(url)) {
      requestedRef.current = url
      return
    }

    // As duas marcas são feitas ANTES da chamada, nunca no `.then`: guarda que
    // só marca sucesso não protege o caminho de falha (lição nº 3 do
    // HANDOFF.md — foi assim que nasceu a conexão duplicada ao LiveKit). Se a
    // action rejeitar, o pedido continua marcado como feito.
    requestedRef.current = url
    requestedUrls.add(url)
    void fetchPreview({ url }).catch(() => {
      // Silêncio proposital. O servidor grava `failed` no cache e a UI
      // simplesmente não mostra cartão; quem está lendo a conversa não tem
      // nada a fazer sobre um site de terceiro fora do ar.
    })
  }, [preview, url, fetchPreview])

  // Nada de esqueleto, placeholder ou altura reservada enquanto não há dado. A
  // lista de mensagens tem lógica de scroll sensível a altura (CHAT-04/CHAT-14,
  // já verificadas com usuário real): um bloco que aparece e depois muda de
  // tamanho empurra o histórico debaixo do cursor de quem está lendo.
  if (preview === undefined || preview === null) return null

  // `failed` é o caso NORMAL, não a exceção: site fora do ar, página sem
  // og:title, URL que caiu na guarda de destino privado ou numa cadeia de
  // redirect recusada. Todos chegam aqui iguais, e todos não viram cartão.
  // O motivo da recusa não vai para a tela de propósito — quem descobre por
  // que um endereço foi recusado aprende sobre a rede interna do servidor.
  if (preview.status !== 'ok') return null

  // Cinto de segurança: o servidor nunca grava `ok` sem título (é regra escrita
  // em convex/linkPreviews.ts). Se um dia gravar, o certo é não mostrar nada em
  // vez de um retângulo vazio no meio da conversa.
  const title = preview.title
  if (title === undefined || title.length === 0) return null

  const showImage = preview.imageUrl !== undefined && !imageFailed

  return (
    <Card className="mt-1 w-fit max-w-md gap-0 border-border py-0 shadow-none">
      {/* `target="_blank"` + `rel="noreferrer"`: o `setWindowOpenHandler` do
          processo main manda link externo para `shell.openExternal`, então o
          site abre no navegador padrão e não numa janela do Electron. */}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex flex-col gap-1 rounded-xl px-3 py-2 hover:bg-accent/50"
      >
        {preview.siteName !== undefined && preview.siteName.length > 0 ? (
          <span className="text-xs text-muted-foreground">{preview.siteName}</span>
        ) : null}
        <span className="line-clamp-2 font-medium text-foreground">{title}</span>
        {preview.description !== undefined && preview.description.length > 0 ? (
          <span className="line-clamp-3 text-sm text-muted-foreground">{preview.description}</span>
        ) : null}
        {showImage ? (
          // `alt=""` de propósito: a imagem é decorativa: o título logo acima já
          // é o texto acessível do link, e um `alt` com o nome do site faria o
          // leitor de tela repetir a mesma informação duas vezes.
          //
          // `onError` some com a imagem: site que entregou `og:image` morta (ou
          // servida em http, recusada pela CSP) não pode virar ícone de imagem
          // quebrada dentro da conversa.
          <img
            src={preview.imageUrl}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="mt-1 max-h-40 w-full rounded-md object-cover"
          />
        ) : null}
      </a>
    </Card>
  )
}
