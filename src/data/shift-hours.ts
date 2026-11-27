import { addDays, HOUR_MS, localToInstant } from '../domain/time'
import type { WorkShift } from './model'

function workWithin(shift: WorkShift, from: number, until: number, now = until) {
  const shiftEnd = shift.status === 'active' ? now : Date.parse(shift.end)
  const start = Math.max(from, Date.parse(shift.start))
  const end = Math.min(until, shiftEnd)
  return Math.max(0, end - start)
}

export function shiftWorkMillis(shift: WorkShift, now: number): number {
  return workWithin(shift, -Infinity, Infinity, now)
}

export function workMillisOnDay(shift: WorkShift, day: string, now: number): number {
  const start = Date.parse(localToInstant(day, '00:00'))
  const end = day === '9999-12-31' ? Infinity : Date.parse(localToInstant(addDays(day, 1), '00:00'))
  return workWithin(shift, start, end, now)
}

export function weeklyWorkHours(shifts: WorkShift[], firstDay: string) {
  const dates = Array.from({ length: 8 }, (_, offset) => addDays(firstDay, offset))
  const boundaries = dates.map((date) => Date.parse(localToInstant(date, '00:00')))
  const weekShifts = shifts.filter((shift) =>
    shift.status !== 'active' && Date.parse(shift.start) < boundaries[7] && Date.parse(shift.end) > boundaries[0],
  )
  return dates.slice(0, 7).map((date, index) => {
    let actual = 0
    let planned = 0
    for (const shift of weekShifts) {
      const hours = workWithin(shift, boundaries[index], boundaries[index + 1]) / HOUR_MS
      if (shift.status === 'completed') actual += hours
      else planned += hours
    }
    return { date, actual, planned }
  })
}

export function formatWorkDuration(millis: number): string {
  const minutes = Math.round(millis / 60_000)
  return Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0')
}
