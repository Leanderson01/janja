// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatBytes, type MessageAttachment } from '@/lib/attachments'

import { AttachmentGallery } from './AttachmentGallery'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

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
    render(<AttachmentGallery attachments={[img('foto.png')]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir foto.png' }))
    expect(screen.getByRole('dialog', { name: 'foto.png' })).toBeTruthy()
    expect(screen.getByText('Abrir original').closest('a')!.getAttribute('target')).toBe('_blank')
  })

  it('três imagens formam mosaico de 3 colunas', () => {
    const { container } = render(
      <AttachmentGallery attachments={[img('a.png'), img('b.png'), img('c.png')]} />
    )
    expect(container.querySelector('[data-mosaic]')!.getAttribute('data-columns')).toBe('3')
  })

  it('vídeo toca no chat', () => {
    const { container } = render(
      <AttachmentGallery attachments={[{ ...img('v.mp4'), contentType: 'video/mp4' }]} />
    )
    expect(container.querySelector('video[controls]')).toBeTruthy()
  })

  it('áudio toca no chat', () => {
    const { container } = render(
      <AttachmentGallery attachments={[{ ...img('a.ogg'), contentType: 'audio/ogg' }]} />
    )
    expect(container.querySelector('audio[controls]')).toBeTruthy()
  })

  it('arquivo vira cartão com nome, tamanho e baixar', () => {
    render(
      <AttachmentGallery attachments={[{ ...img('doc.pdf'), contentType: 'application/pdf' }]} />
    )
    expect(screen.getByText('doc.pdf')).toBeTruthy()
    expect(screen.getByText(formatBytes(2048))).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Baixar doc.pdf' })).toBeTruthy()
  })

  it('SVG cai no cartão, nunca vira imagem', () => {
    const { container } = render(
      <AttachmentGallery attachments={[{ ...img('x.svg'), contentType: 'image/svg+xml' }]} />
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-mosaic]')).toBeNull()
  })

  it('url nula mostra Arquivo indisponível', () => {
    const { container } = render(
      <AttachmentGallery attachments={[{ ...img('sumiu.png'), url: null }]} />
    )
    expect(screen.getByText('Arquivo indisponível')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })
})
