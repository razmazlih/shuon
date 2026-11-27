import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkShift } from '../src/data/model'
import { formatWorkDuration, shiftWorkMillis, weeklyWorkHours, workMillisOnDay } from '../src/data/shift-hours'
import { HOUR_MS, localToInstant } from '../src/domain/time'

function shift(day: string, start: string, endDay: string, end: string): WorkShift {
  return {
    id: 'shift',
    title: 'משמרת עבודה',
    status: 'completed',
    start: localToInstant(day, start),
    end: localToInstant(endDay, end),
    updatedAt: localToInstant(day, start),
  }
}

test('the full shift is split at local midnight regardless of legacy metadata', () => {
  const first = '2026-11-30'
  const second = '2026-12-01'
  const overnight = {
    ...shift(first, '22:00', second, '06:00'),
    breaks: [{ start: localToInstant(first, '23:45'), end: localToInstant(second, '00:15') }],
  }
  const now = Date.parse(overnight.end)
  assert.equal(formatWorkDuration(workMillisOnDay(overnight, first, now)), '2:00')
  assert.equal(formatWorkDuration(workMillisOnDay(overnight, second, now)), '6:00')
  assert.equal(formatWorkDuration(shiftWorkMillis(overnight, now)), '8:00')
  assert.equal(workMillisOnDay(overnight, '2026-12-02', now), 0)
})

test('work duration uses elapsed time on daylight-saving transition days', () => {
  for (const [day, hours] of [['2026-03-27', 6], ['2026-10-25', 8]] as const) {
    const row = shift(day, '00:00', day, '07:00')
    assert.equal(workMillisOnDay(row, day, Date.parse(row.end)), hours * HOUR_MS)
  }
})

test('active shifts count through now even with legacy clock metadata', () => {
  const day = '2026-11-26'
  const active = { ...shift(day, '08:00', day, '08:00'), status: 'active' as const }
  const now = Date.parse(localToInstant(day, '11:35'))
  assert.equal(formatWorkDuration(workMillisOnDay(active, day, now)), '3:35')
  const legacy = { ...active, openBreak: localToInstant(day, '10:10') }
  assert.equal(formatWorkDuration(workMillisOnDay(legacy, day, now)), '3:35')
})

test('weekly chart includes only the hours falling inside each displayed day and week', () => {
  const carry = shift('2026-11-21', '22:00', '2026-11-22', '06:00')
  const planned = { ...shift('2026-11-27', '22:00', '2026-11-28', '06:00'), status: 'planned' as const }
  const nextWeek = shift('2026-11-29', '08:00', '2026-11-29', '16:00')
  const active = { ...shift('2026-11-26', '08:00', '2026-11-26', '12:00'), status: 'active' as const }

  const result = weeklyWorkHours([carry, planned, nextWeek, active], '2026-11-22')
  assert.deepEqual(result.map((day) => day.actual), [6, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(result.map((day) => day.planned), [0, 0, 0, 0, 0, 2, 6])
})
