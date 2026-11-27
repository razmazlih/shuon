import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareShiftWrites } from '../src/data/shift-writes'
import { shiftStatusAt, type WorkShift } from '../src/data/model'

const now = Date.parse('2026-11-26T15:00:00Z')
const at = (hour: number) => '2026-11-26T' + String(hour).padStart(2, '0') + ':00:00Z'
function row(id: string, start: number, end: number, status: WorkShift['status'] = 'planned'): WorkShift {
  return { id, title: id, status, start: at(start), end: at(end), updatedAt: at(6) }
}

test('ordinary shifts count as worked at their end instant and running timers stay active', () => {
  const shift = row('overnight', 20, 23)
  shift.end = '2026-11-27T05:00:00+02:00'
  const end = Date.parse(shift.end)
  assert.equal(shiftStatusAt(shift, end - 1), 'planned')
  assert.equal(shiftStatusAt(shift, end), 'completed')
  assert.equal(shiftStatusAt({ ...shift, status: 'completed' }, end - 1), 'planned')
  assert.equal(shiftStatusAt({ ...shift, status: 'active' }, end + 1), 'active')
})

test('new or moved shifts cannot overlap a concurrently added shift; adjacent periods are valid', () => {
  const other = row('other', 10, 12)
  assert.throws(() => prepareShiftWrites([row('new', 9, 11)], [], [], now).validate([other], now), /חפיפה/)
  assert.doesNotThrow(() => prepareShiftWrites([row('new', 12, 13)], [], [], now).validate([other], now))
  const original = row('move', 8, 9)
  assert.throws(
    () =>
      prepareShiftWrites([{ ...original, end: at(11) }], [], [original], now).validate(
        [other, original],
        now,
      ),
    /חפיפה/,
  )
})

test('a losing timer start leaves the original open, and stopping a timer revalidates its final interval', () => {
  const clock = row('clock', 13, 13, 'active')
  assert.throws(
    () => prepareShiftWrites([row('second', 15, 15, 'active')], [], [], now).validate([clock], now),
    /כבר פועל/,
  )
  assert.throws(() => prepareShiftWrites([row('work', 14, 16)], [], [], now).validate([clock], now), /חפיפה/)
  const stop = { ...clock, end: at(15), status: 'completed' as const }
  assert.throws(
    () => prepareShiftWrites([stop], [], [clock], now).validate([clock, row('import', 14, 15)], now),
    /חפיפה/,
  )
})

test('all batch rows are tested together, while deletions can repair legacy conflicting rows', () => {
  const a = row('a', 8, 12),
    b = row('b', 10, 13)
  assert.throws(() => prepareShiftWrites([a, b], [], [], now).validate([], now), /חפיפה/)
  assert.doesNotThrow(() => prepareShiftWrites([b], ['a'], [a], now).validate([a], now))
  assert.doesNotThrow(() => prepareShiftWrites([], ['a'], [a, b], now).validate([a, b], now))
})

test('edits and deletes detect concurrent edits, deletion and addition of the same ID, even in the same millisecond', () => {
  const a = { ...row('a', 8, 12), updatedAt: new Date(now).toISOString() }
  const update = prepareShiftWrites([{ ...a, title: 'חדש' }], [], [a], now)
  assert.equal(Date.parse(update.writes[0].updatedAt), now + 1)
  assert.throws(() => update.validate(update.writes, now), /השתנתה/)
  assert.throws(() => update.validate([], now), /השתנתה/)
  assert.throws(() => prepareShiftWrites([], [a.id], [a], now).validate(update.writes, now), /השתנתה/)
  assert.throws(() => prepareShiftWrites([a], [], [], now).validate([a], now), /השתנתה/)
})
