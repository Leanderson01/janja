import { describe, expect, it } from 'vitest'
import { displayNameOf } from './display-name'

describe('displayNameOf', () => {
  it('usa o apelido quando existe', () => expect(displayNameOf({ nickname: 'Rei', displayName: 'VM', username: 'vm' })).toBe('Rei'))
  it('cai para o nome de exibição', () => expect(displayNameOf({ nickname: null, displayName: 'VM', username: 'vm' })).toBe('VM'))
  it('cai para o usuário quando o nome de exibição está vazio', () => expect(displayNameOf({ displayName: '', username: 'vm' })).toBe('vm'))
  it('nunca devolve #tag', () => expect(displayNameOf({ displayName: 'Leo', username: 'leo' })).not.toContain('#'))
})
