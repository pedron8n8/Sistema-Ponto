export type Segment = { type: 'work' | 'break' | 'ot'; start: Date; end: Date }

export type JourneyEntry = {
  clockIn: string
  clockOut?: string | null
  overtimeMinutes?: number | null
  breaks?: { start: string; end: string }[] | null
}

// Monta a jornada de UM ponto: trabalho / pausa / OT com janelas exatas.
// Pausas vêm de entry.breaks; a janela de OT é derivada (últimos overtimeMinutes de trabalho).
export const buildTimeline = (entry: JourneyEntry): Segment[] => {
  if (!entry.clockOut) return []
  const clockIn = new Date(entry.clockIn)
  const clockOut = new Date(entry.clockOut)

  const breaks = (entry.breaks || [])
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
    .filter((b) => b.end > b.start && b.start >= clockIn && b.end <= clockOut)
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const raw: Segment[] = []
  let cursor = clockIn
  for (const b of breaks) {
    if (b.start > cursor) raw.push({ type: 'work', start: cursor, end: b.start })
    raw.push({ type: 'break', start: b.start, end: b.end })
    cursor = b.end
  }
  if (clockOut > cursor) raw.push({ type: 'work', start: cursor, end: clockOut })

  let otMin = entry.overtimeMinutes || 0
  if (otMin <= 0) return raw

  // Caminha de trás p/ frente pulando pausas até acumular os minutos de OT.
  let otStart = clockOut
  for (let i = raw.length - 1; i >= 0 && otMin > 0; i--) {
    const seg = raw[i]
    if (seg.type !== 'work') continue
    const segMin = (seg.end.getTime() - seg.start.getTime()) / 60000
    if (segMin <= otMin) {
      otStart = seg.start
      otMin -= segMin
    } else {
      otStart = new Date(seg.end.getTime() - otMin * 60000)
      otMin = 0
    }
  }

  // Reclassifica o trabalho dentro de [otStart, clockOut] como OT.
  const result: Segment[] = []
  for (const seg of raw) {
    if (seg.type === 'work' && seg.end > otStart) {
      if (seg.start < otStart) {
        result.push({ type: 'work', start: seg.start, end: otStart })
        result.push({ type: 'ot', start: otStart, end: seg.end })
      } else {
        result.push({ type: 'ot', start: seg.start, end: seg.end })
      }
    } else {
      result.push(seg)
    }
  }
  return result
}
