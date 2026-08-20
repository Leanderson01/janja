import { describe, expect, it } from 'vitest'
import {
  DISPLAY_NAME_MAX_LENGTH,
  USERNAME_FALLBACK,
  USERNAME_MAX_LENGTH,
  deriveIdentity,
  emailLocalPart,
  humanizeUsername,
  slugifyUsername,
  usernameTakenError,
  validateDisplayName,
  validateTag,
  validateUsername
} from './identity'

describe('slugifyUsername', () => {
  it('remove acento e baixa a caixa', () => {
    expect(slugifyUsername('João Silva')).toBe('joao.silva')
    expect(slugifyUsername('Ángel Muñoz')).toBe('angel.munoz')
  })

  it('colapsa separadores repetidos e apara as bordas', () => {
    expect(slugifyUsername('.joao..silva.')).toBe('joao.silva')
    expect(slugifyUsername('__leo__')).toBe('leo')
    expect(slugifyUsername('joao   silva')).toBe('joao.silva')
  })

  it('preserva ponto, hífen e sublinhado simples', () => {
    expect(slugifyUsername('joao-silva')).toBe('joao-silva')
    expect(slugifyUsername('joao_silva')).toBe('joao_silva')
  })

  it('devolve string vazia quando não sobra nada aproveitável', () => {
    expect(slugifyUsername('🎉🎉')).toBe('')
    expect(slugifyUsername('...')).toBe('')
  })
})

describe('humanizeUsername', () => {
  it('vira palavras com inicial maiúscula', () => {
    expect(humanizeUsername('joao.silva')).toBe('Joao Silva')
    expect(humanizeUsername('leo')).toBe('Leo')
    expect(humanizeUsername('g_william-nn')).toBe('G William Nn')
  })
})

describe('emailLocalPart', () => {
  it('corta no "@"', () => {
    expect(emailLocalPart('joao.silva@gmail.com')).toBe('joao.silva')
  })

  it('devolve o texto inteiro quando não há "@"', () => {
    expect(emailLocalPart('joao')).toBe('joao')
  })
})

describe('deriveIdentity', () => {
  it('prefere o nome do provedor ao e-mail', () => {
    expect(deriveIdentity({ name: 'João Silva', email: 'jsilva123@gmail.com' })).toEqual({
      username: 'joao.silva',
      displayName: 'João Silva'
    })
  })

  it('cai para o givenName quando não há nome completo', () => {
    expect(deriveIdentity({ givenName: 'Leo', email: 'x@y.com' })).toEqual({
      username: 'leo',
      displayName: 'Leo'
    })
  })

  it('usa a parte antes do "@" quando não há nome do provedor', () => {
    expect(deriveIdentity({ email: 'gwilliam.nn@gmail.com' })).toEqual({
      username: 'gwilliam.nn',
      displayName: 'Gwilliam Nn'
    })
  })

  it('NUNCA usa o subject do WorkOS: sem nome e sem e-mail cai em "usuario"', () => {
    const derived = deriveIdentity({})

    expect(derived.username).toBe(USERNAME_FALLBACK)
    expect(derived.displayName).toBe('Usuario')
    expect(derived.username).not.toMatch(/^user_/)
  })

  it('um subject passado como e-mail malformado ainda não vira username opaco', () => {
    // Regressão direta do defeito: o valor que apareceu na tela do Leo.
    const derived = deriveIdentity({ name: '', givenName: null, email: '' })
    expect(derived.username).toBe(USERNAME_FALLBACK)
  })

  it('e-mail de uma letra é curto demais e cai no fallback', () => {
    expect(deriveIdentity({ email: 'a@b.com' }).username).toBe(USERNAME_FALLBACK)
  })

  it('trunca no limite sem deixar separador na borda', () => {
    const longName = 'abcdefghij.klmnopqrst.uvwxyzabcd.efgh'
    const derived = deriveIdentity({ name: longName })

    expect(derived.username.length).toBeLessThanOrEqual(USERNAME_MAX_LENGTH)
    expect(derived.username.endsWith('.')).toBe(false)
    expect(validateUsername(derived.username).ok).toBe(true)
  })

  it('nome de provedor longo é cortado no limite do displayName', () => {
    const derived = deriveIdentity({ name: 'A'.repeat(80) })
    expect(derived.displayName.length).toBe(DISPLAY_NAME_MAX_LENGTH)
  })

  it('nome só de emoji não produz username vazio', () => {
    const derived = deriveIdentity({ name: '🎉🎉', email: '' })
    expect(derived.username).toBe(USERNAME_FALLBACK)
  })

  it('o que sai da derivação sempre passa na validação', () => {
    const casos = [
      { name: 'João Silva' },
      { email: 'gwilliam.nn@gmail.com' },
      {},
      { name: '  Leo  ' },
      { email: 'UPPER.CASE@Example.COM' }
    ]
    for (const caso of casos) {
      const derived = deriveIdentity(caso)
      expect(validateUsername(derived.username)).toEqual({ ok: true, value: derived.username })
      expect(validateDisplayName(derived.displayName).ok).toBe(true)
    }
  })
})

describe('validateUsername', () => {
  it('canoniza em vez de recusar o que a pessoa digitou com maiúscula ou acento', () => {
    expect(validateUsername('João')).toEqual({ ok: true, value: 'joao' })
    expect(validateUsername('  Leo  ')).toEqual({ ok: true, value: 'leo' })
    expect(validateUsername('Joao Silva')).toEqual({ ok: true, value: 'joao.silva' })
  })

  it('recusa vazio com mensagem em português', () => {
    const result = validateUsername('   ')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('Escolha um nome de usuário')
  })

  it('recusa um único caractere', () => {
    const result = validateUsername('a')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('ao menos 2')
  })

  it('recusa acima de 32 caracteres', () => {
    const result = validateUsername('a'.repeat(33))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('no máximo 32')
  })

  it('recusa texto sem letra nem número', () => {
    const result = validateUsername('🎉')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('letras ou números')
  })

  it('aceita ponto, hífen e sublinhado no meio', () => {
    expect(validateUsername('jo-ao_si.lva')).toEqual({ ok: true, value: 'jo-ao_si.lva' })
  })
})

describe('validateTag', () => {
  it('aceita exatamente 4 dígitos, inclusive com zero à esquerda', () => {
    expect(validateTag('0001')).toEqual({ ok: true, value: '0001' })
    expect(validateTag(' 9999 ')).toEqual({ ok: true, value: '9999' })
  })

  it('recusa menos ou mais de 4 dígitos e qualquer não-dígito', () => {
    for (const bad of ['1', '123', '12345', '12a4', '#0001']) {
      const result = validateTag(bad)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain('4 dígitos')
    }
  })

  it('recusa vazio', () => {
    const result = validateTag('')
    expect(result.ok === false && result.error).toBe('Escolha uma tag')
  })
})

describe('validateDisplayName', () => {
  it('aceita acento, espaço e maiúscula sem canonizar', () => {
    expect(validateDisplayName('  João Silva  ')).toEqual({ ok: true, value: 'João Silva' })
  })

  it('recusa vazio e acima de 32', () => {
    expect(validateDisplayName('   ').ok).toBe(false)
    expect(validateDisplayName('a'.repeat(33)).ok).toBe(false)
  })
})

describe('usernameTakenError', () => {
  it('cita o par exato que colidiu', () => {
    expect(usernameTakenError('joao', '0001')).toBe(
      'joao#0001 já está em uso. Escolha outro nome ou outra tag.'
    )
  })
})
