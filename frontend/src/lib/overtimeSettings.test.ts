import { describe, expect, it } from 'vitest'
import { OVERTIME_BUFFER_MAX, parseBufferMinutes } from './overtimeSettings'

describe('parseBufferMinutes', () => {
  it('aceita inteiros de 0 ate o maximo', () => {
    expect(parseBufferMinutes('0')).toBe(0)
    expect(parseBufferMinutes(' 15 ')).toBe(15)
    expect(parseBufferMinutes(String(OVERTIME_BUFFER_MAX))).toBe(OVERTIME_BUFFER_MAX)
  })

  it('recusa vazio, fracao, negativo e acima do maximo', () => {
    expect(parseBufferMinutes('')).toBeNull()
    expect(parseBufferMinutes('1.5')).toBeNull()
    expect(parseBufferMinutes('-1')).toBeNull()
    expect(parseBufferMinutes(String(OVERTIME_BUFFER_MAX + 1))).toBeNull()
    expect(parseBufferMinutes('abc')).toBeNull()
  })
})
