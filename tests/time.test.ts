import assert from 'node:assert/strict'
import test from 'node:test'
import { addMonths, monthDays } from '../src/domain/time'

test('monthly grids contain full Sunday–Saturday weeks with selectable adjacent dates', () => {
  const december = monthDays('2026-12-17')
  assert.equal(december.length, 35)
  assert.deepEqual(december.slice(0, 4), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'])
  assert.deepEqual(december.slice(-4), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])

  const leapFebruary = monthDays('2024-02-01')
  assert.equal(leapFebruary.length, 35)
  assert.ok(leapFebruary.includes('2024-02-29'))
  assert.equal(monthDays('2026-02-01').length, 28)
  assert.equal(monthDays('2026-08-01').length, 42)
})

test('navigation keeps the day where possible and clamps it in shorter months', () => {
  assert.equal(addMonths('2026-12-07', 1), '2027-01-07')
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonths('2024-03-30', -1), '2024-02-29')
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28')
})

test('calendar boundaries retain complete rows and keep navigation in supported years', () => {
  assert.deepEqual(monthDays('0001-01-01').slice(0, 2), [null, '0001-01-01'])
  assert.deepEqual(monthDays('9999-12-31').slice(-2), ['9999-12-31', null])
  assert.equal(addMonths('0001-01-01', -1), '0001-01-01')
  assert.equal(addMonths('9999-12-31', 1), '9999-12-31')
})
