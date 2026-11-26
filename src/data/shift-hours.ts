import { addDays, localToInstant } from '../domain/time'
import type { WorkShift } from './model'

function workWithin(shift: WorkShift, now: number, from: number, until: number) {
  const shiftEnd =
    shift.status === 'active'
      ? Math.min(now, shift.openBreak ? Date.parse(shift.openBreak) : now)
      : Date.parse(shift.end)
  const start = Math.max(from, Date.parse(shift.start))
  const end = Math.min(until, shiftEnd)
  if (end <= start) return 0
  const unpaid = shift.breaks.reduce((total, pause) => {
    if (pause.paid) return total
    const overlapStart = Math.max(start, Date.parse(pause.start))
    const overlapEnd = Math.min(end, Date.parse(pause.end))
    return total + Math.max(0, overlapEnd - overlapStart)
  }, 0)
  return Math.max(0, end - start - unpaid)
}

export function shiftWorkMillis(shift: WorkShift, now: number): number {
  return workWithin(shift, now, -Infinity, Infinity)
}

export function workMillisOnDay(shift: WorkShift, day: string, now: number): number {
  const start = Date.parse(localToInstant(day, '00:00'))
  const end = day === '9999-12-31' ? Infinity : Date.parse(localToInstant(addDays(day, 1), '00:00'))
  return workWithin(shift, now, start, end)
}

export function formatWorkDuration(millis: number): string {
  const minutes = Math.round(millis / 60_000)
  return Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0')
}
