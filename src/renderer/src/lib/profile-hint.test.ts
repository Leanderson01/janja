import { describe, expect, it } from 'vitest'
import { toProfileHint } from './profile-hint'

describe('toProfileHint', () => {
  it('junta nome e sobrenome do Google num nome completo', () => {
    expect(
      toProfileHint({
        email: 'joao.silva@gmail.com',
        firstName: 'João',
        lastName: 'Silva',
        profilePictureUrl: 'https://lh3.googleusercontent.com/foto.jpg'
      })
    ).toEqual({
      name: 'João Silva',
      givenName: 'João',
      email: 'joao.silva@gmail.com',
      pictureUrl: 'https://lh3.googleusercontent.com/foto.jpg'
    })
  })

  it('OMITE campos vazios em vez de mandar string vazia', () => {
    const hint = toProfileHint({
      email: 'x@y.com',
      firstName: null,
      lastName: null,
      profilePictureUrl: null
    })

    expect(hint).toEqual({ email: 'x@y.com' })
    expect('name' in hint).toBe(false)
    expect('givenName' in hint).toBe(false)
    expect('pictureUrl' in hint).toBe(false)
  })

  it('só o primeiro nome já vira name e givenName', () => {
    expect(
      toProfileHint({ email: '', firstName: 'Leo', lastName: null, profilePictureUrl: null })
    ).toEqual({ name: 'Leo', givenName: 'Leo' })
  })

  it('espaços em branco não contam como valor', () => {
    expect(
      toProfileHint({ email: '  ', firstName: '   ', lastName: '  ', profilePictureUrl: null })
    ).toEqual({})
  })

  it('perfil ausente devolve dica vazia, sem lançar', () => {
    expect(toProfileHint(null)).toEqual({})
    expect(toProfileHint(undefined)).toEqual({})
  })
})
