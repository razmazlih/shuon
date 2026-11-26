import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkShift } from '../src/data/model'
import { formatWorkDuration, shiftWorkMillis, workMillisOnDay } from '../src/data/shift-hours'
import { HOUR_MS, localToInstant } from '../src/domain/time'

function shift(day: string, start: string, endDay: string, end: string): WorkShift {
  return {
    id: 'shift',
    title: 'משמרת עבודה',
    status: 'completed',
    start: localToInstant(day, start),
    end: localToInstant(endDay, end),
    updatedAt: localToInstant(day, start),
    breaks: [],
  }
}

test('work is split at local midnight, and only unpaid time in each day is deducted', () => {
  const first = '2026-11-30'
  const second = '2026-12-01'
  const overnight = shift(first, '22:00', second, '06:00')
  overnight.breaks = [
    { start: localToInstant(first, '23:45'), end: localToInstant(second, '00:15') },
    { start: localToInstant(second, '02:00'), end: localToInstant(second, '03:00'), paid: true },
  ]
  const now = Date.parse(overnight.end)
  assert.equal(formatWorkDuration(workMillisOnDay(overnight, first, now)), '1:45')
  assert.equal(formatWorkDuration(workMillisOnDay(overnight, second, now)), '5:45')
  assert.equal(formatWorkDuration(shiftWorkMillis(overnight, now)), '7:30')
  assert.equal(workMillisOnDay(overnight, '2026-12-02', now), 0)
})

test('work duration uses elapsed time on daylight-saving transition days', () => {
  for (const [day, hours] of [['2026-03-27', 6], ['2026-10-25', 8]] as const) {
    const row = shift(day, '00:00', day, '07:00')
    assert.equal(workMillisOnDay(row, day, Date.parse(row.end)), hours * HOUR_MS)
  }
})

test('active shifts count time through now and stop accumulating during an open break', () => {
  const day = '2026-11-26'
  const active = { ...shift(day, '08:00', day, '08:00'), status: 'active' as const }
  const now = Date.parse(localToInstant(day, '11:35'))
  assert.equal(formatWorkDuration(workMillisOnDay(active, day, now)), '3:35')
  const paused = { ...active, openBreak: localToInstant(day, '10:10') }
  assert.equal(formatWorkDuration(workMillisOnDay(paused, day, now)), '2:10')
})
