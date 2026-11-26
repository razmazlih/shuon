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

test('ordinary days use an eight-hour cap and daily overtime does not count toward 42 weekly hours', () => {
  const week = Array.from({ length: 5 }, (_, i) =>
    shift(addDays('2026-11-22', i), '08:00', '16:00'),
  )
  week[0].end = localToInstant('2026-11-22', '19:00') // 2 hours of daily overtime
  week.push(shift('2026-11-27', '07:00', '11:00'))
  const pay = calculateGross(week.reverse(), settings)
  assert.equal(pay.gross, 42 * 50 + 4 * 62.5 + 75)
  assert.equal(pay.regularHours, 42)
  assert.equal(pay.overtimeHours, 5)
  assert.equal(pay.pensionable, 2100)
  assert.deepEqual(pay.shifts[0].bands, [
    { kind: 'regular', amount: 400, hours: 8 },
    { kind: 'overtime125', amount: 125, hours: 2 },
    { kind: 'overtime150', amount: 75, hours: 1 },
  ])
  assert.deepEqual(pay.shifts.at(-1)?.bands, [
    { kind: 'regular', amount: 100, hours: 2 },
    { kind: 'overtime125', amount: 125, hours: 2 },
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
  // July 1, 2026 falls on Wednesday. The 42-hour threshold is reached at noon Friday.
  const week = Array.from({ length: 5 }, (_, i) =>
    shift(addDays('2026-06-28', i), '08:00', '16:00'),
  )
  week.push(shift('2026-07-03', '10:00', '15:00'))
  const pay = calculateGross(week, settings, '2026-07')
  assert.equal(pay.shifts.length, 3)
  assert.equal(pay.shifts.at(-1)?.gross, 375)
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
  assert.equal(pay.shifts[1].bands.find((b) => b.kind === 'rest200')?.hours, 1)
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

test('Jewish calendar identifies the nine Israeli holidays, including observed Independence Day', () => {
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
  assert.equal(israelHolidayName('2026-03-03'), undefined) // Purim
  assert.equal(israelHolidayName('2026-12-06'), undefined) // Hanukkah
})

test('Independence Day uses its own 20:00-to-20:00 window on the observed date', () => {
  const work = [shift('2026-04-21', '19:00', '21:00'), shift('2026-04-22', '19:00', '21:00')]
  const pay = calculateGross(work, settings)
  assert.deepEqual(pay.shifts.map((row) => row.restHours), [1, 1])
  assert.equal(pay.gross, 250)
})

test('holiday rates and overtime apply to existing profiles without holiday settings', () => {
  const work = shift('2026-04-02', '06:00', '18:00')
  const pay = calculateGross([work], settings, '2026-04')
  assert.deepEqual(pay.shifts[0].bands, [
    { kind: 'rest150', hours: 8, amount: 600 },
    { kind: 'rest175', hours: 2, amount: 175 },
    { kind: 'rest200', hours: 2, amount: 200 },
  ])
  assert.equal(pay.gross, 975)
  assert.equal(calculateGross([work], { ...settings, holidayCalendar: 'manual' }).restHours, 0)
  assert.equal(
    calculateGross([work], { ...settings, holidayCalendar: 'manual', holidays: ['2026-04-02'] }).gross,
    975,
  )
  assert.equal(calculateGross([shift('2026-04-05', '08:00', '16:00')], settings).restHours, 0)
})

test('automatic entry and exit replace saved defaults, while custom clocks and exact dates retain precedence', () => {
  const eve = shift('2026-04-01', '17:00', '20:00')
  const closing = shift('2026-04-02', '18:00', '21:00')
  const saved: PaySettings = { ...settings, holidayCalendar: 'israel-jewish', holidayStart: '18:00', holidayEnd: '19:00' }
  const automatic = calculateGross([eve, closing], settings)
  // Jerusalem entry is 18:18 on April 1 and exit is 19:36 on April 2.
  assert.deepEqual(automatic.shifts.map((row) => row.restHours), [102 / 60, 96 / 60])
  assert.deepEqual(calculateGross([eve, closing], saved), automatic)
  assert.deepEqual(
    calculateGross([eve, closing], { ...saved, holidayTimeMode: 'fixed' }).shifts.map((row) => row.restHours),
    [2, 1],
  )
  assert.equal(calculateGross([eve], { ...saved, holidayStart: '18:30' }).restHours, 1.5)
  assert.deepEqual(
    calculateGross([eve, closing], { ...saved, holidayStart: '18:30', holidayTimeMode: 'automatic' }),
    automatic,
  )
  const exact = { start: localToInstant('2026-04-01', '18:30'), end: localToInstant('2026-04-02', '19:30') }
  assert.deepEqual(
    calculateGross([eve, closing], { ...settings, holidayWindows: [exact] }).shifts.map((row) => row.restHours),
    [1.5, 1.5],
  )
})

test('Rosh Hashanah remains a continuous holiday across both days and the weekly rest overlap', () => {
  const overnight = {
    ...shift('2026-09-12', '16:00', '02:00', '2026-09-13'),
    breaks: [{ start: localToInstant('2026-09-12', '19:00'), end: localToInstant('2026-09-12', '19:30') }],
  }
  const pay = calculateGross([overnight], settings)
  assert.equal(pay.restHours, 9.5)
  assert.deepEqual(calculateGross([overnight], { ...settings, restDay: 3 }), pay)
  assert.deepEqual(pay.bands.map(({ kind, hours }) => ({ kind, hours })), [
    { kind: 'rest150', hours: 7 },
    { kind: 'rest175', hours: 2 },
    { kind: 'rest200', hours: 0.5 },
  ])
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
