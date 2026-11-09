import { Download, File, FileX } from 'lucide-react'
import { useState } from 'react'

import { ImageLightbox } from '@/components/shell/ImageLightbox'
import { Button } from '@/components/ui/button'
import {
  formatBytes,
  isAudio,
  isImage,
  isVideo,
  mosaicColumns,
  type MessageAttachment
} from '@/lib/attachments'
import { cn } from '@/lib/utils'

// Anexos de uma mensagem. Caminhos, na ordem de decisão:
//
// 1. `url === null` — o arquivo sumiu do storage. Bloco discreto com o nome e
//    "Arquivo indisponível". NUNCA `<img src={null}>` nem link morto: dariam
//    imagem quebrada ou aba em branco, e o usuário acharia que o app tem defeito.
// 2. Imagem — botão "Abrir {nome}" que abre a tela cheia; várias viram mosaico.
// 3. Vídeo / áudio — player nativo no chat.
// 4. Qualquer outra coisa (inclusive SVG, de propósito — ver `isImage`) —
//    cartão com ícone, nome, tamanho e botão de baixar.

type Available = MessageAttachment & { url: string }

function Unavailable({ attachment }: { attachment: MessageAttachment }): React.JSX.Element {
  return (
    <div className="flex w-fit max-w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-muted-foreground">
      <FileX className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate text-sm">{attachment.name}</span>
      <span className="shrink-0 text-xs">Arquivo indisponível</span>
    </div>
  )
}

function ImageTile({
  attachment,
  single
}: {
  attachment: Available
  single: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={`Abrir ${attachment.name}`}
        onClick={() => setOpen(true)}
        className={cn(
          'block cursor-zoom-in overflow-hidden rounded-lg',
          single ? 'w-fit max-w-full' : 'size-full'
        )}
      >
        <img
          src={attachment.url}
          alt={attachment.name}
          loading="lazy"
          className={cn(
            'rounded-lg',
            single ? 'max-h-[350px] max-w-[550px] object-contain' : 'h-40 w-full object-cover'
          )}
        />
      </button>
      <ImageLightbox
        src={attachment.url}
        name={attachment.name}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

function FileCard({ attachment }: { attachment: Available }): React.JSX.Element {
  return (
    <div className="flex w-fit max-w-full items-center gap-3 rounded-lg border border-border bg-card p-3">
      <File className="size-8 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-col">
        <a
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className="text-link truncate text-sm hover:underline"
        >
          {attachment.name}
        </a>
        <span className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</span>
      </div>
      <Button asChild variant="ghost" size="icon" className="shrink-0">
        <a
          href={attachment.url}
          download={attachment.name}
          aria-label={`Baixar ${attachment.name}`}
          title="Baixar"
        >
          <Download aria-hidden="true" />
        </a>
      </Button>
    </div>
  )
}

export function AttachmentGallery({
  attachments
}: {
  attachments: MessageAttachment[]
}): React.JSX.Element | null {
  if (attachments.length === 0) return null

  const images = attachments.filter((a): a is Available => a.url !== null && isImage(a.contentType))
  const columns = mosaicColumns(images.length)
  const rest = attachments.filter((a) => !images.includes(a as Available))

  return (
    <div className="mt-1 flex flex-col gap-2">
      {images.length > 0 ? (
        <div
          data-mosaic=""
          data-columns={columns}
          className={cn(
            'grid max-w-[550px] gap-1',
            columns === 1 && 'w-fit grid-cols-1',
            columns === 2 && 'grid-cols-2',
            columns === 3 && 'grid-cols-3'
          )}
        >
          {images.map((a, i) => (
            <ImageTile key={`${a.storageId}-${i}`} attachment={a} single={images.length === 1} />
          ))}
        </div>
      ) : null}
      {rest.map((a, i) => {
        const key = `${a.storageId}-${i}`
        if (a.url === null) return <Unavailable key={key} attachment={a} />
        const available = a as Available
        if (isVideo(a.contentType)) {
          return (
            <video
              key={key}
              src={available.url}
              controls
              preload="metadata"
              className="max-h-[350px] max-w-[550px] rounded-lg"
            />
          )
        }
        if (isAudio(a.contentType)) {
          return (
            <div
              key={key}
              className="flex w-fit max-w-full flex-col gap-1 rounded-lg border border-border bg-card p-3"
            >
              <span className="truncate text-sm text-foreground">{a.name}</span>
              <audio src={available.url} controls preload="metadata" />
            </div>
          )
        }
        return <FileCard key={key} attachment={available} />
      })}
    </div>
  )
}
