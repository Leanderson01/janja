// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditProfileForm, previewUsername } from './EditProfileDialog'

// Por que `EditProfileForm` e não `EditProfileDialog`: o diálogo chama
// `useQuery`/`useMutation`, que fora de um `ConvexProvider` jogam "Could not
// find Convex client!". O formulário é exportado justamente para ser montado
// sozinho, com a mutation entrando por prop — mesma receita já documentada em
// `MemberList.test.tsx`.
//
// O que este arquivo NÃO prova (jsdom não faz layout nem pintura): que o
// diálogo cabe na janela, que o foco vai para o primeiro campo de verdade no
// Windows, e que o toast aparece por cima do overlay. Isso é olho humano.

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))
import { toast } from 'sonner'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const perfil = { username: 'joao.silva', tag: '0001', displayName: 'João Silva' }

describe('previewUsername', () => {
  it('mostra a canonização antes de salvar', () => {
    expect(previewUsername('João Silva')).toBe('joao.silva')
    expect(previewUsername('  Leo  ')).toBe('leo')
    expect(previewUsername('🎉')).toBe('')
  })
})

describe('EditProfileForm', () => {
  it('pré-preenche os três campos com o perfil atual', () => {
    render(<EditProfileForm profile={perfil} updateProfile={vi.fn()} onSaved={vi.fn()} />)

    expect((screen.getByLabelText('Nome de exibição') as HTMLInputElement).value).toBe('João Silva')
    expect((screen.getByLabelText('Nome de usuário') as HTMLInputElement).value).toBe('joao.silva')
    expect((screen.getByLabelText('Tag') as HTMLInputElement).value).toBe('0001')
  })

  it('Salvar começa desabilitado enquanto nada mudou', () => {
    render(<EditProfileForm profile={perfil} updateProfile={vi.fn()} onSaved={vi.fn()} />)

    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('mostra a prévia do identificador canonizado enquanto se digita', async () => {
    const user = userEvent.setup()
    render(<EditProfileForm profile={perfil} updateProfile={vi.fn()} onSaved={vi.fn()} />)

    const username = screen.getByLabelText('Nome de usuário')
    await user.clear(username)
    await user.type(username, 'João Neves')

    expect(screen.getByText('joao.neves#0001')).toBeTruthy()
  })

  it('a tag recusa qualquer coisa que não seja dígito e para em 4', async () => {
    const user = userEvent.setup()
    render(<EditProfileForm profile={perfil} updateProfile={vi.fn()} onSaved={vi.fn()} />)

    const tag = screen.getByLabelText('Tag') as HTMLInputElement
    await user.clear(tag)
    await user.type(tag, 'a1b2c3d4e5')

    expect(tag.value).toBe('1234')
  })

  it('envia o que foi digitado e avisa o sucesso pelo toast', async () => {
    const user = userEvent.setup()
    const updateProfile = vi.fn().mockResolvedValue({})
    const onSaved = vi.fn()
    render(<EditProfileForm profile={perfil} updateProfile={updateProfile} onSaved={onSaved} />)

    const displayName = screen.getByLabelText('Nome de exibição')
    await user.clear(displayName)
    await user.type(displayName, 'Leo')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1))
    expect(updateProfile).toHaveBeenCalledWith({
      username: 'joao.silva',
      tag: '0001',
      displayName: 'Leo'
    })
    expect(toast.success).toHaveBeenCalledWith('Perfil atualizado')
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('erro do servidor aparece legível no formulário, sem fechar o diálogo', async () => {
    const user = userEvent.setup()
    const updateProfile = vi
      .fn()
      .mockRejectedValue(
        new Error(
          '[CONVEX M(users:updateProfile)] [Request ID: abc123] Server Error\n' +
            'Uncaught Error: joao#0001 já está em uso. Escolha outro nome ou outra tag.\n' +
            '  at handler (../convex/users.ts:42:11)'
        )
      )
    const onSaved = vi.fn()
    render(<EditProfileForm profile={perfil} updateProfile={updateProfile} onSaved={onSaved} />)

    const username = screen.getByLabelText('Nome de usuário')
    await user.clear(username)
    await user.type(username, 'joao')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('joao#0001 já está em uso. Escolha outro nome ou outra tag.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('depois de um erro o botão volta a ficar clicável', async () => {
    const user = userEvent.setup()
    const updateProfile = vi.fn().mockRejectedValue(new Error('Uncaught Error: deu ruim'))
    render(<EditProfileForm profile={perfil} updateProfile={updateProfile} onSaved={vi.fn()} />)

    const displayName = screen.getByLabelText('Nome de exibição')
    await user.clear(displayName)
    await user.type(displayName, 'Leo')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await screen.findByRole('alert')
    const botao = screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement
    expect(botao.disabled).toBe(false)
  })

  it('remonta com valores frescos quando o diálogo reabre com outro perfil', () => {
    // O `DialogContent` do Radix desmonta ao fechar, então cada abertura
    // monta este formulário do zero — `key` aqui imita esse remonte. É por
    // isso que o componente NÃO tem efeito sincronizando os campos com a
    // prop (ver o comentário em EditProfileDialog.tsx).
    const { rerender } = render(
      <EditProfileForm key="a" profile={perfil} updateProfile={vi.fn()} onSaved={vi.fn()} />
    )

    rerender(
      <EditProfileForm
        key="b"
        profile={{ username: 'outro.nome', tag: '9999', displayName: 'Outro Nome' }}
        updateProfile={vi.fn()}
        onSaved={vi.fn()}
      />
    )

    expect((screen.getByLabelText('Nome de usuário') as HTMLInputElement).value).toBe('outro.nome')
    expect((screen.getByLabelText('Tag') as HTMLInputElement).value).toBe('9999')
  })
})
