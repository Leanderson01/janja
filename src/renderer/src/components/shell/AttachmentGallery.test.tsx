// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatBytes, type MessageAttachment } from '@/lib/attachments'

import { TooltipProvider } from '@/components/ui/tooltip'

import { AttachmentGallery } from './AttachmentGallery'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderGallery(attachments: MessageAttachment[]): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <AttachmentGallery attachments={attachments} />
    </TooltipProvider>
  )
}

function img(name: string): MessageAttachment {
  return {
    storageId: name as MessageAttachment['storageId'],
    name,
    size: 2048,
    contentType: 'image/png',
    url: `https://cdn.exemplo/${name}`
  }
}

describe('AttachmentGallery', () => {
  it('imagem abre em tela cheia', async () => {
    renderGallery([img('foto.png')])
    await userEvent.click(screen.getByRole('button', { name: 'Abrir foto.png' }))
    expect(screen.getByRole('dialog', { name: 'foto.png' })).toBeTruthy()
    expect(screen.getByText('Abrir original').closest('a')!.getAttribute('target')).toBe('_blank')
  })

  it('três imagens formam mosaico de 3 colunas', () => {
    const { container } = renderGallery([img('a.png'), img('b.png'), img('c.png')])
    expect(container.querySelector('[data-mosaic]')!.getAttribute('data-columns')).toBe('3')
  })

  it('vídeo toca no chat', () => {
    const { container } = renderGallery([{ ...img('v.mp4'), contentType: 'video/mp4' }])
    expect(container.querySelector('video[controls]')).toBeTruthy()
  })

  it('áudio toca no chat', () => {
    const { container } = renderGallery([{ ...img('a.ogg'), contentType: 'audio/ogg' }])
    expect(container.querySelector('audio[controls]')).toBeTruthy()
  })

  it('arquivo vira cartão com nome, tamanho e baixar', () => {
    renderGallery([{ ...img('doc.pdf'), contentType: 'application/pdf' }])
    expect(screen.getByText('doc.pdf')).toBeTruthy()
    expect(screen.getByText(formatBytes(2048))).toBeTruthy()
    const dl = screen.getByRole('link', { name: 'Baixar doc.pdf' })
    expect(dl.getAttribute('target')).toBe('_blank')
    expect(dl.getAttribute('rel')).toBe('noreferrer')
    expect(dl.hasAttribute('download')).toBe(true)
  })

  it('SVG cai no cartão, nunca vira imagem', () => {
    const { container } = renderGallery([{ ...img('x.svg'), contentType: 'image/svg+xml' }])
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-mosaic]')).toBeNull()
  })

  it('url nula mostra Arquivo indisponível', () => {
    const { container } = renderGallery([{ ...img('sumiu.png'), url: null }])
    expect(screen.getByText('Arquivo indisponível')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })
})
