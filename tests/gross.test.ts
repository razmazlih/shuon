import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateGross, israelHolidayName, type PaySettings, type Shift } from '../src/domain/gross'
import { addDays, localDate, localTime, localToInstant } from '../src/domain/time'

const settings: PaySettings = {
  hourlyRate: 50,
  workDays: 5,
  restDay: 6,
  shortDay: 4,
  restStart: '12:00',
  restEnd: '24:00',
}
function shift(date: string, start: string, end: string, endDate = date): Shift {
  return { id: date + '/' + start, start: localToInstant(date, start), end: localToInstant(endDate, end) }
}

test('all five daily thresholds accumulate exactly 42 ordinary hours; no daily overtime counted twice', () => {
  const week = Array.from({ length: 5 }, (_, i) =>
    shift(addDays('2026-11-22', i), '08:00', i === 4 ? '15:36' : '16:36'),
  )
  week[0].end = localToInstant('2026-11-22', '18:36') // 2 hours of daily overtime
  week.push(shift('2026-11-27', '08:00', '11:00'))
  const pay = calculateGross(week.reverse(), settings)
  assert.equal(pay.gross, 42 * 50 + 4 * 62.5 + 75)
  assert.equal(pay.regularHours, 42)
  assert.equal(pay.overtimeHours, 5)
  assert.equal(pay.pensionable, 2100)
  assert.deepEqual(pay.shifts.at(-1)?.bands, [
    { kind: 'overtime125', amount: 125, hours: 2 },
    { kind: 'overtime150', amount: 75, hours: 1 },
  ])
})

test('six-day profile, Friday short day, and partial minimum-rest overlap', () => {
  const pay = calculateGross([shift('2026-11-27', '05:00', '15:00')], { ...settings, workDays: 6 })
  assert.deepEqual(pay.bands, [
    { kind: 'regular', hours: 7, amount: 350 },
    { kind: 'rest175', hours: 2, amount: 175 },
    { kind: 'rest200', hours: 1, amount: 100 },
  ])
  assert.equal(pay.restHours, 3)
})

test('a weekly overtime threshold recognizes hours worked in the prior reporting month', () => {
  // July 1, 2026 falls on Wednesday. All 42 ordinary hours precede Friday.
  const week = Array.from({ length: 5 }, (_, i) =>
    shift(addDays('2026-06-28', i), '08:00', i === 4 ? '15:36' : '16:36'),
  )
  week.push(shift('2026-07-03', '12:00', '15:00'))
  const pay = calculateGross(week, settings, '2026-07')
  assert.equal(pay.shifts.length, 3)
  assert.equal(pay.shifts.at(-1)?.gross, 275)
  assert.equal(pay.restHours, 3)
})

test('overnight work earns daily overtime before or after the month boundary with date-effective rates', () => {
  const s = shift('2026-11-30', '22:00', '06:00', '2026-12-01')
  const profile = { ...settings, rateHistory: [{ from: '2026-12-01', rate: 60 }] }
  assert.equal(calculateGross([s], profile, '2026-11').gross, 100)
  const dec = calculateGross([s], profile, '2026-12')
  assert.equal(dec.gross, 375)
  assert.equal(dec.pensionable, 300)
  assert.equal(calculateGross([s], settings).gross, 412.5)
  assert.equal(calculateGross([s], { ...settings, nightPremiumPercent: 20 }).gross, 495)
})

test('night qualification honors unpaid breaks and the exact 120-minute boundary', () => {
  const s = shift('2026-11-23', '16:00', '00:00', '2026-11-24')
  const pause = { start: localToInstant('2026-11-23', '22:00'), end: localToInstant('2026-11-23', '22:01') }
  assert.equal(calculateGross([{ ...s, breaks: [{ ...pause, paid: true }] }], settings).gross, 412.5)
  const pay = calculateGross([{ ...s, breaks: [pause] }], settings)
  assert.equal(pay.overtimeHours, 0)
  assert.equal(pay.gross, 399.17)
})

test('same-day split shifts share daily counters; weekly rest and holiday overlap once', () => {
  const shifts = [shift('2026-11-28', '08:00', '14:00'), shift('2026-11-28', '15:00', '20:00')]
  const pay = calculateGross(shifts, { ...settings, holidays: ['2026-11-28'] })
  const profile = { ...settings, holidayCalendar: 'manual' as const }
  assert.equal(pay.gross, calculateGross(shifts, profile).gross)
  assert.equal(pay.shifts[1].bands.find((b) => b.kind === 'rest200')?.hours, 0.4)
})

test('Israel summer time skips one hour and winter time repeats one; inputs are independent of host timezone', () => {
  assert.throws(() => localToInstant('2026-03-27', '02:30'))
  const first = localToInstant('2026-10-25', '01:30')
  const second = localToInstant('2026-10-25', '01:30', 'later')
  assert.equal(Date.parse(second) - Date.parse(first), 3_600_000)
  assert.equal(localTime(first), '01:30')
  assert.equal(localDate(first), '2026-10-25')
  assert.equal(calculateGross([shift('2026-03-27', '00:00', '07:00')], settings).hours, 6)
  assert.equal(calculateGross([shift('2026-10-25', '00:00', '07:00')], settings).hours, 8)
  assert.throws(() => localToInstant('2026-02-30', '08:00'))
})

test('Jewish calendar offers nine days in Israel and honors checked holiday hours; intermediate days are ordinary', () => {
  for (const date of [
    '2026-04-02',
    '2026-04-08',
    '2026-04-22',
    '2026-05-22',
    '2026-09-12',
    '2026-09-13',
    '2026-09-21',
    '2026-09-26',
    '2026-10-03',
  ]) {
    assert.ok(israelHolidayName(date), date)
  }
  assert.equal(israelHolidayName('2026-04-05'), undefined)
  assert.equal(israelHolidayName('2025-05-01'), 'יום העצמאות')
  const profile: PaySettings = { ...settings, holidayCalendar: 'israel-jewish' }
  const eve = shift('2026-04-01', '17:00', '20:00')
  assert.equal(calculateGross([eve], profile).restHours, 2)
  const exact = { start: localToInstant('2026-04-01', '18:30'), end: localToInstant('2026-04-02', '19:30') }
  assert.equal(calculateGross([eve], { ...profile, holidayWindows: [exact] }).restHours, 1.5)
})

test('invalid and overlapping records fail before payment; fully unpaid shift remains a zero row', () => {
  const s = shift('2026-11-23', '08:00', '16:00')
  assert.throws(() => calculateGross([s, { ...s, id: 'second' }], settings), /חפיפה/)
  assert.throws(() => calculateGross([{ ...s, breaks: [shift('2026-11-23', '07:00', '09:00')] }], settings))
  assert.throws(() => calculateGross([{ ...s, end: s.start }], settings))
  assert.deepEqual(calculateGross([{ ...s, breaks: [s] }], settings).shifts[0], {
    id: s.id,
    gross: 0,
    pensionable: 0,
    hours: 0,
    regularHours: 0,
    overtimeHours: 0,
    restHours: 0,
    bands: [],
  })
})

test('exact holiday windows alone identify shortened holiday eves and the precise paid overlap', () => {
  const exact = { start: localToInstant('2026-11-23', '18:30'), end: localToInstant('2026-11-24', '19:30') }
  const s = shift('2026-11-23', '11:00', '20:00')
  const pay = calculateGross([s], { ...settings, holidayWindows: [exact] })
  assert.deepEqual(pay.bands, [
    { kind: 'regular', hours: 7, amount: 350 },
    { kind: 'overtime125', hours: 0.5, amount: 31.25 },
    { kind: 'rest175', hours: 1.5, amount: 131.25 },
  ])
})

test('a night supplement only applies to the qualifying shift even when a day shift shares the same date', () => {
  const work = [shift('2026-11-23', '08:00', '12:00'), shift('2026-11-23', '21:00', '00:00', '2026-11-24')]
  const pay = calculateGross(work, { ...settings, nightPremiumPercent: 20 })
  assert.equal(pay.shifts[0].gross, 200)
  assert.equal(pay.shifts[1].gross, 180)
})
