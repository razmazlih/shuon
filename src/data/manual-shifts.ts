import { addDays, dateMs, localDate, localTime, localToInstant } from '../domain/time'
import type { WorkShift } from './model'

export type Wall = { time: string; fold: 'earlier' | 'later' }

export type DaySelection = {
  date: string
  replacement?: WorkShift
  removed: WorkShift[]
}

export type ManualShiftWrites = {
  rows: WorkShift[]
  deleted: string[]
  originals: WorkShift[]
}

const dayOffset = (from: string, to: string) => (dateMs(to) - dateMs(from)) / 86_400_000
const dateFormat = new Intl.DateTimeFormat('he-IL', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const formatDate = (day: string) => dateFormat.format(dateMs(day))

export const wall = (time: string): Wall => ({ time, fold: 'earlier' })

export function wallFromInstant(instant: string): Wall {
  const time = localTime(instant)
  const earlier = localToInstant(localDate(instant), time)
  return {
    time,
    fold:
      Math.floor(Date.parse(earlier) / 60_000) === Math.floor(Date.parse(instant) / 60_000)
        ? 'earlier'
        : 'later',
  }
}

function resolveClock(date: string, value: Wall, original?: string) {
  const result = localToInstant(date, value.time, value.fold)
  if (original && Math.floor(Date.parse(result) / 60_000) === Math.floor(Date.parse(original) / 60_000))
    return original
  return result
}

export function inferEndOffset(date: string, start: Wall, end: Wall) {
  if (!date || !start.time || !end.time || end.time >= start.time) return 0
  try {
    if (Date.parse(resolveClock(date, end)) > Date.parse(resolveClock(date, start))) return 0
  } catch {
    // An invalid wall time is reported when the draft is saved.
  }
  return 1
}

function matchesWall(value: Wall, instant: string) {
  const original = wallFromInstant(instant)
  return value.time === original.time && value.fold === original.fold
}

export function manualEndOffset(date: string, start: Wall, end: Wall, initial?: WorkShift) {
  if (
    initial &&
    date === localDate(initial.start) &&
    matchesWall(start, initial.start) &&
    matchesWall(end, initial.end)
  ) {
    return dayOffset(date, localDate(initial.end))
  }
  return inferEndOffset(date, start, end)
}

type ManualShiftDraft = {
  date: string
  start: Wall
  end: Wall
  note: string
  initial?: WorkShift
  duplicate?: boolean
  selections: DaySelection[]
  shifts: WorkShift[]
  now?: number
}

export function buildManualShiftWrites({
  date,
  start,
  end,
  note,
  initial,
  duplicate,
  selections,
  shifts,
  now = Date.now(),
}: ManualShiftDraft): ManualShiftWrites {
  dateMs(date)
  const edited = duplicate ? undefined : initial
  const originals = new Map<string, WorkShift>()
  const deleted: string[] = []
  const liveById = new Map(shifts.map((shift) => [shift.id, shift]))
  const selectedDates = new Set([date])
  if (edited) originals.set(edited.id, edited)

  for (const selection of selections) {
    const { date: day, replacement, removed } = selection
    if (selectedDates.has(day)) throw new Error('אותו תאריך נבחר יותר מפעם אחת.')
    selectedDates.add(day)
    for (const saved of replacement ? [replacement, ...removed] : removed) {
      const live = liveById.get(saved.id)
      if (!live || live.updatedAt !== saved.updatedAt || localDate(live.start) !== day)
        throw new Error(formatDate(day) + ' · המשמרת השתנתה. יש לבחור מחדש את הפעולות לתאריך הזה.')
      if (live.status === 'active' || saved.status === 'active')
        throw new Error(formatDate(day) + ' · משמרת פעילה נשארת בשעון הנוכחות.')
      if (originals.has(saved.id)) throw new Error('אותה משמרת נבחרה יותר מפעם אחת.')
      originals.set(saved.id, saved)
    }
    deleted.push(...removed.map((shift) => shift.id))
  }

  const build = (day: string, original?: WorkShift, editing?: WorkShift): WorkShift => {
    try {
      const shiftStart = resolveClock(day, start, original?.start)
      const shiftEnd = resolveClock(
        addDays(day, manualEndOffset(day, start, end, editing)),
        end,
        original?.end,
      )
      const begin = Date.parse(shiftStart)
      const finish = Date.parse(shiftEnd)
      if (finish <= begin) throw new Error('שעת הסיום צריכה להיות אחרי שעת ההתחלה.')
      return {
        ...original,
        id: original?.id ?? crypto.randomUUID(),
        title: original?.title ?? 'משמרת עבודה',
        start: shiftStart,
        end: shiftEnd,
        status: finish <= now ? 'completed' : 'planned',
        note: note.trim(),
        updatedAt: new Date(now).toISOString(),
      }
    } catch (reason) {
      if (reason instanceof Error) throw new Error(formatDate(day) + ' · ' + reason.message)
      throw reason
    }
  }

  const rows = [
    build(date, edited, edited),
    ...selections.map(({ date: day, replacement }) => build(day, replacement)),
  ]
  const remaining = shifts.filter((shift) => !originals.has(shift.id)).map((shift) => {
    const start = Date.parse(shift.start)
    const end = shift.status === 'active' ? Math.max(now, start + 1) : Date.parse(shift.end)
    return { start, end }
  })
  for (const row of rows) {
    const start = Date.parse(row.start)
    const end = Date.parse(row.end)
    if (remaining.some((other) => start < other.end && other.start < end)) {
      throw new Error(formatDate(localDate(row.start)) + ' · המשמרת חופפת למשמרת אחרת.')
    }
    remaining.push({ start, end })
  }
  return { rows, deleted, originals: [...originals.values()] }
}
