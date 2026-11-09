import { describe, expect, it } from 'vitest'

import { gridColumns } from './call-grid'

describe('gridColumns', () => {
  it('grade', () =>
    expect([1, 2, 3, 4, 5, 6, 7, 9, 10].map(gridColumns)).toEqual([1, 2, 2, 2, 3, 3, 3, 3, 4]))
  it('zero participantes usa uma coluna', () => expect(gridColumns(0)).toBe(1))
})
