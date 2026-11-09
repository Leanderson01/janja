import { describe, expect, it } from 'vitest'

import { typingText } from './typing-text'

describe('typingText', () => {
  it('ninguém', () => expect(typingText([])).toBeNull())
  it('uma pessoa', () => expect(typingText(['Drexx'])).toBe('Drexx está digitando…'))
  it('duas pessoas', () => expect(typingText(['Drexx', 'VM'])).toBe('Drexx e VM estão digitando…'))
  it('três ou mais', () =>
    expect(typingText(['a', 'b', 'c'])).toBe('Várias pessoas estão digitando…'))
})
