import assert from 'node:assert/strict'
import test from 'node:test'
import { buildManualShiftWrites, wall, wallFromInstant } from '../src/data/manual-shifts'
import { prepareShiftWrites } from '../src/data/shift-writes'
import { localDate, localToInstant } from '../src/domain/time'
import type { WorkShift } from '../src/data/model'

const date = '2026-11-26'
const extra = '2026-11-27'
const now = Date.parse('2026-11-26T12:00:00Z')

function row(id: string, start: string, end: string): WorkShift {
  return {
    id,
    title: 'משמרת קיימת',
    status: 'planned',
    start: localToInstant(extra, start),
    end: localToInstant(extra, end),
    note: 'הערה קודמת',
    breaks: [],
    updatedAt: new Date(now).toISOString(),
  }
}

const draft = { date, start: wall('08:00'), end: wall('16:00'), note: 'הערה חדשה', now }

test('a day can replace one shift, remove another and leave a third, in one validated write', () => {
  const target = row('replace', '09:00', '12:00')
  target.breaks = [{ start: localToInstant(extra, '10:00'), end: localToInstant(extra, '10:20') }]
  const removed = row('remove', '12:00', '14:00')
  const kept = row('keep', '17:00', '22:00')
  const shifts = [target, removed, kept]
  const selections = [{ date: extra, replacement: target, removed: [removed] }]
  const { rows, deleted, originals } = buildManualShiftWrites({ ...draft, shifts, selections })
  const replaced = rows.find((shift) => shift.id === target.id)
  assert.equal(replaced?.title, target.title)
  assert.equal(replaced?.note, draft.note)
  assert.deepEqual(replaced?.breaks, target.breaks)
  assert.deepEqual(deleted, [removed.id])
  const change = prepareShiftWrites(rows, deleted, originals, now)
  assert.doesNotThrow(() => change.validate(shifts, now))
  const changed = { ...target, updatedAt: new Date(now + 1).toISOString() }
  assert.throws(() => change.validate([changed, removed, kept], now), /השתנתה/)
  assert.throws(
    () => buildManualShiftWrites({ ...draft, shifts: [changed, removed, kept], selections }),
    /השתנתה/,
  )
})

test('adding alongside existing shifts validates overlaps and running shifts cannot be removed', () => {
  const later = row('later', '16:00', '22:00')
  const selections = [{ date: extra, removed: [] }]
  const { rows } = buildManualShiftWrites({ ...draft, shifts: [later], selections })
  assert.ok(rows.every((shift) => shift.id !== later.id))
  const overlapping = row('overlap', '12:00', '14:00')
  assert.throws(
    () => buildManualShiftWrites({ ...draft, shifts: [later, overlapping], selections }),
    /חופפת/,
  )
  const active = { ...later, status: 'active' as const }
  assert.throws(
    () => buildManualShiftWrites({ ...draft, shifts: [active], selections: [{ date: extra, removed: [active] }] }),
    /משמרת פעילה/,
  )
})

test('a note-only edit keeps exact legacy times and hours cannot discard a recorded break', () => {
  const initial = {
    ...row('legacy', '08:00', '16:00'),
    end: '2026-11-29T14:00:03.350Z',
    breaks: [{ start: localToInstant(extra, '09:00'), end: localToInstant(extra, '10:00'), paid: true }],
  }
  const input = { ...draft, date: extra, initial, shifts: [initial], selections: [] }
  const { rows: [edited] } = buildManualShiftWrites(input)
  assert.equal(edited.end, initial.end)
  assert.deepEqual(edited.breaks, initial.breaks)
  assert.throws(() => buildManualShiftWrites({ ...input, start: wall('10:30') }), /ההפסקה שנרשמה/)
  const { rows: [duplicate] } = buildManualShiftWrites({ ...input, date, duplicate: true })
  assert.equal(localDate(duplicate.end), date)
  assert.deepEqual(duplicate.breaks, [])
})

test('manual shifts infer an overnight end and respect the repeated hour', () => {
  const input = { ...draft, selections: [], shifts: [] }
  const { rows: [night] } = buildManualShiftWrites({ ...input, start: wall('22:00'), end: wall('06:00') })
  assert.equal(localDate(night.end), extra)
  const folded = localToInstant('2026-10-25', '01:15', 'later')
  const { rows: [repeated] } = buildManualShiftWrites({
    ...input,
    date: '2026-10-25',
    start: wall('01:30'),
    end: wallFromInstant(folded),
  })
  assert.equal(repeated.end, folded)
  assert.throws(
    () => buildManualShiftWrites({ ...input, date: '2026-03-27', start: wall('02:30') }),
    /המעבר לשעון קיץ/,
  )
})

test('Israeli clock changes preserve overnight wall times, elapsed pay and Apple calendar instants', async () => {
  const { calculateGross } = await import('../src/domain/gross')
  const { projectShift, serializeEvent, parseEvent } = await import('../functions/events.js')
  const { localTime } = await import('../src/domain/time')
  const settings = { hourlyRate: 50, workDays: 5, restDay: 6, shortDay: 4,
    restStart: '12:00', restEnd: '20:00' } as const
  for (const [date, next, startUtc, endUtc, hours, gross] of [
    ['2026-03-26', '2026-03-27', '20260326T200000Z', '20260327T030000Z', 7, 350],
    ['2026-10-24', '2026-10-25', '20261024T190000Z', '20261025T040000Z', 9, 475],
  ] as const) {
    const { rows: [shift] } = buildManualShiftWrites({ ...draft, date, selections: [], shifts: [],
      start: wall('22:00'), end: wall('06:00') })
    const pay = calculateGross([shift], settings)
    assert.equal(pay.hours, hours)
    assert.equal(pay.gross, gross)
    const ics = serializeEvent(shift.id, projectShift(shift))
    assert.ok(ics.includes('DTSTART:' + startUtc))
    assert.ok(ics.includes('DTEND:' + endUtc))
    const { value } = parseEvent(ics)
    assert.deepEqual([localDate(value.start), localTime(value.start), localDate(value.end), localTime(value.end)],
      [date, '22:00', next, '06:00'])
  }
})
