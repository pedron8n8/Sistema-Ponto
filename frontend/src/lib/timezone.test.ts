import { describe, expect, it } from 'vitest'
import {
  addDaysToDateKey,
  endOfZonedDayUtc,
  getDateKeyWithTimeZone,
  startOfZonedDayUtc,
} from './timezone'

describe('startOfZonedDayUtc', () => {
  it('resolve meia-noite no fuso, nao em UTC', () => {
    // America/Chicago em setembro esta em CDT (UTC-5).
    expect(startOfZonedDayUtc('2026-09-06', 'America/Chicago').toISOString()).toBe(
      '2026-09-06T05:00:00.000Z'
    )
    // Em janeiro, CST (UTC-6).
    expect(startOfZonedDayUtc('2026-01-15', 'America/Chicago').toISOString()).toBe(
      '2026-01-15T06:00:00.000Z'
    )
    expect(startOfZonedDayUtc('2026-09-06', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-09-06T03:00:00.000Z'
    )
  })

  it('funciona para fuso a leste de UTC', () => {
    expect(startOfZonedDayUtc('2026-09-06', 'Asia/Tokyo').toISOString()).toBe(
      '2026-09-05T15:00:00.000Z'
    )
  })

  it('devolve data invalida para chave malformada', () => {
    expect(Number.isNaN(startOfZonedDayUtc('nao-e-data', 'UTC').getTime())).toBe(true)
  })
})

describe('endOfZonedDayUtc', () => {
  it('cobre o dia inteiro no fuso de visualizacao', () => {
    // O bug original: o backend cortava em 2026-09-13T00:00Z e perdia as
    // ultimas 5 horas de domingo em Chicago.
    expect(endOfZonedDayUtc('2026-09-12', 'America/Chicago').toISOString()).toBe(
      '2026-09-13T04:59:59.999Z'
    )
    expect(endOfZonedDayUtc('2026-09-12', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-09-13T02:59:59.999Z'
    )
  })

  it('inclui uma batida no ultimo minuto do dia local', () => {
    const lastPunch = new Date('2026-09-13T04:30:00.000Z') // 23:30 de 12/09 em Chicago
    expect(getDateKeyWithTimeZone(lastPunch, 'America/Chicago')).toBe('2026-09-12')
    expect(lastPunch.getTime()).toBeLessThanOrEqual(
      endOfZonedDayUtc('2026-09-12', 'America/Chicago').getTime()
    )
  })
})

describe('borda de horario de verao', () => {
  it('atravessa o spring forward sem perder nem duplicar o dia', () => {
    // 2026-03-08: EUA adiantam o relogio. O dia comeca em CST e termina em CDT.
    const start = startOfZonedDayUtc('2026-03-08', 'America/Chicago')
    const end = endOfZonedDayUtc('2026-03-08', 'America/Chicago')
    expect(start.toISOString()).toBe('2026-03-08T06:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-09T04:59:59.999Z')
    expect(getDateKeyWithTimeZone(start, 'America/Chicago')).toBe('2026-03-08')
    expect(getDateKeyWithTimeZone(end, 'America/Chicago')).toBe('2026-03-08')
  })

  it('atravessa o fall back sem perder nem duplicar o dia', () => {
    const start = startOfZonedDayUtc('2026-11-01', 'America/Chicago')
    const end = endOfZonedDayUtc('2026-11-01', 'America/Chicago')
    expect(getDateKeyWithTimeZone(start, 'America/Chicago')).toBe('2026-11-01')
    expect(getDateKeyWithTimeZone(end, 'America/Chicago')).toBe('2026-11-01')
  })
})

describe('addDaysToDateKey', () => {
  it('soma e subtrai sem depender do fuso do browser', () => {
    expect(addDaysToDateKey('2026-09-06', 6)).toBe('2026-09-12')
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysToDateKey('2024-03-01', -1)).toBe('2024-02-29')
  })
})
