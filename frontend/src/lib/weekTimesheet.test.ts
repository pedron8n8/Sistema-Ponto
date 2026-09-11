import { describe, it, expect } from 'vitest'
import {
  buildWeekDays,
  formatClockMinutes,
  resolveEntryMinutes,
  type TimesheetEntry,
} from './weekTimesheet'

const at = (iso: string) => new Date(iso).getTime()

const openEntry = (overrides: Partial<TimesheetEntry> = {}): TimesheetEntry => ({
  id: 'open-1',
  clockIn: '2026-09-11T09:00:00.000Z',
  clockOut: null,
  breakMinutes: 0,
  breakStartedAt: null,
  duration: null,
  ...overrides,
})

const closedEntry = (overrides: Partial<TimesheetEntry> = {}): TimesheetEntry => ({
  id: 'closed-1',
  clockIn: '2026-09-11T09:00:00.000Z',
  clockOut: '2026-09-11T13:00:00.000Z',
  breakMinutes: 0,
  breakStartedAt: null,
  duration: { totalMinutes: 240, formatted: '4h 0m 0s' },
  ...overrides,
})

describe('resolveEntryMinutes', () => {
  it('conta o tempo decorrido de um registro em aberto quando o dia esta ao vivo', () => {
    const minutes = resolveEntryMinutes(openEntry(), at('2026-09-11T11:30:00.000Z'), { allowLive: true })
    expect(minutes).toBe(150)
  })

  it('desconta a pausa gravada e a pausa em andamento do tempo ao vivo', () => {
    const entry = openEntry({ breakMinutes: 30, breakStartedAt: '2026-09-11T11:00:00.000Z' })
    const minutes = resolveEntryMinutes(entry, at('2026-09-11T11:30:00.000Z'), { allowLive: true })
    expect(minutes).toBe(90)
  })

  it('nao deixa o tempo ao vivo ficar negativo', () => {
    const minutes = resolveEntryMinutes(openEntry(), at('2026-09-11T08:00:00.000Z'), { allowLive: true })
    expect(minutes).toBe(0)
  })

  it('usa a duracao ja calculada pelo backend em registros fechados', () => {
    const minutes = resolveEntryMinutes(closedEntry(), at('2026-09-11T23:00:00.000Z'), { allowLive: true })
    expect(minutes).toBe(240)
  })

  it('calcula registros fechados sem duracao descontando a pausa gravada', () => {
    const entry = closedEntry({ duration: null, breakMinutes: 60 })
    const minutes = resolveEntryMinutes(entry, at('2026-09-11T23:00:00.000Z'), { allowLive: true })
    expect(minutes).toBe(180)
  })

  it('ignora um registro em aberto quando o dia nao esta ao vivo', () => {
    const minutes = resolveEntryMinutes(openEntry(), at('2026-09-11T11:30:00.000Z'), { allowLive: false })
    expect(minutes).toBe(0)
  })
})

describe('buildWeekDays', () => {
  const dateKeys = ['2026-09-10', '2026-09-11']

  it('soma o registro em aberto de hoje junto com os fechados', () => {
    const days = buildWeekDays({
      dateKeys,
      entries: [
        closedEntry({ id: 'a', clockIn: '2026-09-11T06:00:00.000Z', clockOut: '2026-09-11T08:00:00.000Z', duration: { totalMinutes: 120, formatted: '2h 0m 0s' } }),
        openEntry({ id: 'b', clockIn: '2026-09-11T09:00:00.000Z' }),
      ],
      timeZone: 'UTC',
      nowMs: at('2026-09-11T10:30:00.000Z'),
    })

    const today = days[1]
    expect(today.totalMinutes).toBe(210)
    expect(today.totalLabel).toBe('03:30')
    expect(today.hasLiveEntry).toBe(true)
    expect(today.entries[1].isLive).toBe(true)
    expect(today.entries[1].durationLabel).toBe('1h 30m')
  })

  it('nao acumula tempo em um ponto esquecido aberto ha mais de 24h', () => {
    const days = buildWeekDays({
      dateKeys,
      entries: [openEntry({ id: 'stale', clockIn: '2026-09-10T09:00:00.000Z' })],
      timeZone: 'UTC',
      nowMs: at('2026-09-11T10:30:00.000Z'),
    })

    expect(days[0].totalMinutes).toBe(0)
    expect(days[0].totalLabel).toBe('00:00')
    expect(days[0].hasLiveEntry).toBe(false)
    expect(days[0].entries[0].isLive).toBe(false)
  })

  it('continua contando ao vivo o turno que atravessa a meia-noite', () => {
    const days = buildWeekDays({
      dateKeys,
      entries: [openEntry({ id: 'night', clockIn: '2026-09-10T22:00:00.000Z' })],
      timeZone: 'UTC',
      nowMs: at('2026-09-11T01:00:00.000Z'),
    })

    expect(days[0].totalMinutes).toBe(180)
    expect(days[0].hasLiveEntry).toBe(true)
  })

  it('agrupa o registro pelo dia no fuso de visualizacao', () => {
    const days = buildWeekDays({
      dateKeys,
      entries: [openEntry({ id: 'late', clockIn: '2026-09-11T02:00:00.000Z' })],
      timeZone: 'America/Sao_Paulo',
      nowMs: at('2026-09-11T03:00:00.000Z'),
    })

    expect(days[0].dateKey).toBe('2026-09-10')
    expect(days[0].entries).toHaveLength(1)
    expect(days[0].entries[0].isLive).toBe(true)
    expect(days[0].totalMinutes).toBe(60)
    expect(days[1].entries).toHaveLength(0)
  })

  it('mantem dias sem registro zerados', () => {
    const days = buildWeekDays({ dateKeys, entries: [], timeZone: 'UTC', nowMs: at('2026-09-11T10:30:00.000Z') })
    expect(days).toHaveLength(2)
    expect(days.every((day) => day.totalLabel === '00:00' && day.entries.length === 0)).toBe(true)
  })
})

describe('formatClockMinutes', () => {
  it('formata minutos como HH:MM', () => {
    expect(formatClockMinutes(0)).toBe('00:00')
    expect(formatClockMinutes(65)).toBe('01:05')
    expect(formatClockMinutes(600)).toBe('10:00')
  })
})
