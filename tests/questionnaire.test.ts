import test from 'node:test'
import assert from 'node:assert/strict'
import { freshWorkspace } from '../src/data/model'
import { estimateSalary } from '../src/domain/net'
import { calculateGross } from '../src/domain/gross'
import { localToInstant } from '../src/domain/time'
import {
  answerError,
  applyAnswers,
  initialAnswers,
  visibleQuestions,
  type Answers,
} from '../src/domain/questionnaire'

const { profile, payroll } = freshWorkspace()
const today = '2026-11-12'
const basic: Answers = {
  hourlyRate: '50',
  restDay: '6',
  holidayCalendar: 'israel-jewish',
  nights: 'no',
  onlyJob: 'yes',
  resident: 'yes',
  ageGroup: 'adult',
  sex: 'female',
  children: 'no',
  pension: 'yes',
}
const apply = (a: Answers) => applyAnswers(profile, payroll, a, today)
const ids = (a: Answers) => visibleQuestions(a).map((q) => q.id)

test('asks only relevant questions and does not guess a new employee’s pay or circumstances', () => {
  assert.deepEqual(initialAnswers(profile, payroll), {})
  assert.ok(!ids(basic).includes('workDays'))
  assert.ok(!ids(basic).includes('shortDay'))
  assert.ok(!ids(basic).includes('nightBonus'))
  assert.ok(!ids(basic).includes('childCount'))
  assert.ok(!ids({ ...basic, onlyJob: 'no' }).includes('sex'))
  assert.ok(!ids({ ...basic, ageGroup: 'minor' }).includes('children'))
  for (const q of visibleQuestions(basic)) assert.equal(answerError(q, basic), null)
  const changed = apply({ ...basic, shortDay: '0', nightPercent: '50', childYear1: '2020' })
  assert.equal(changed.payroll.creditPoints, 2.75)
  assert.equal(changed.payroll.pensionPercent, 6)
  assert.equal(changed.profile.pay.nightPremiumPercent, 0)
  assert.deepEqual(changed.profile.questionnaire, basic)
})

test('child credits use age during the tax year; unsupported circumstances preserve a partial estimate', () => {
  const family = {
    ...basic,
    children: 'yes',
    family: 'married',
    childCount: '2',
    childYear1: '2025',
    childYear2: '2008',
  }
  assert.equal(apply(family).payroll.creditPoints, 2.75 + 4.5 + 0.5)
  assert.equal(apply({ ...family, sex: 'male' }).payroll.creditPoints, 2.25 + 4.5)
  const switched = apply({ ...family, family: 'other' })
  assert.equal(switched.payroll.creditPoints, null)
  assert.ok(!('childYear1' in switched.profile.questionnaire))
  assert.throws(() => apply({ ...family, childYear1: '2027' }))
  for (const patch of [{ onlyJob: 'no' }, { resident: 'no' }, { ageGroup: 'minor' }]) {
    const outside = apply({ ...basic, ...patch })
    const net = estimateSalary('2026-11', { gross: 5000, pensionable: 5000 }, outside.payroll)
    assert.equal(net.net, null)
    assert.equal(net.insurance, null)
    assert.equal(net.cashGross, 5000)
  }
})

test('keeps legacy and manually corrected payslip values on unrelated changes', () => {
  const existing = { ...profile, onboarded: true, pay: { ...profile.pay, workDays: 6 as const } }
  const saved = { ...payroll, pensionPercent: 7, creditPoints: 5.25 }
  const answers = initialAnswers(existing, saved, today)
  assert.equal(answers.taxMode, 'saved')
  assert.equal(answers.pension, 'saved')
  const updated = applyAnswers(existing, saved, { ...answers, workDays: '5' }, today)
  assert.deepEqual(updated.payroll, saved)
  assert.equal(updated.profile.pay.workDays, 6)
  const configured = apply(basic)
  const manual = { ...configured.payroll, pensionPercent: null, creditPoints: null }
  assert.deepEqual(
    applyAnswers(configured.profile, manual, initialAnswers(configured.profile, manual, today), today)
      .payroll,
    manual,
  )
})

test('defaults older profiles to automatic Israeli holidays and preserves an explicit manual calendar', () => {
  const legacy = { ...profile, onboarded: true, pay: { ...profile.pay } }
  delete legacy.pay.holidayCalendar
  const initial = initialAnswers(legacy, payroll, today)
  assert.equal(initial.holidayCalendar, 'israel-jewish')
  assert.equal(applyAnswers(legacy, payroll, initial, today).profile.pay.holidayCalendar, 'israel-jewish')

  const manual = applyAnswers(legacy, payroll, { ...initial, holidayCalendar: 'manual' }, today)
  assert.equal(initialAnswers(manual.profile, manual.payroll, today).holidayCalendar, 'manual')
})

test('dated rates preserve previous shifts and a night supplement in shekels stays fixed across a raise', () => {
  const original = apply({ ...basic, nights: 'yes', nightBonus: 'amount', nightAmount: '10' })
  const raised = applyAnswers(
    original.profile,
    original.payroll,
    { ...original.profile.questionnaire, hourlyRate: '60' },
    today,
  )
  assert.equal(raised.profile.pay.hourlyRate, 50)
  assert.deepEqual(raised.profile.pay.rateHistory, [{ from: today, rate: 60 }])
  const shifts = ['2026-11-09', '2026-11-16'].map((date) => ({
    id: date,
    start: localToInstant(date, '02:00'),
    end: localToInstant(date, '04:00'),
  }))
  assert.deepEqual(
    calculateGross(shifts, raised.profile.pay).shifts.map((s) => s.gross),
    [120, 140],
  )
  const disabled = applyAnswers(
    raised.profile,
    raised.payroll,
    { ...raised.profile.questionnaire, nights: 'no' },
    today,
  )
  assert.equal(disabled.profile.pay.nightPremiumAmount, undefined)
})

test('asks about child allowance only where it changes the same-sex couple estimate; handles single parents', () => {
  const family = { ...basic, children: 'yes', family: 'sameSex', childCount: '1', childYear1: '2024' }
  assert.ok(!ids(family).includes('allowance'))
  assert.equal(apply(family).payroll.creditPoints, 2.75 + 4.5)
  const older = { ...family, childYear1: '2018' }
  assert.ok(ids(older).includes('allowance'))
  assert.equal(apply({ ...older, allowance: 'partner' }).payroll.creditPoints, 2.75 + 1)
  const single = { ...older, family: 'single', care: 'yes' }
  assert.equal(apply({ ...single, otherParent: 'yes' }).payroll.creditPoints, 2.75 + 1 + 2)
  assert.equal(apply({ ...single, otherParent: 'none' }).payroll.creditPoints, 2.75 + 1 + 3)
})

test('manual tax overrides keep family answers editable and survive unrelated saves and insurance changes', () => {
  const family: Answers = {
    ...basic,
    children: 'yes',
    family: 'married',
    childCount: '1',
    childYear1: '2019',
  }
  const configured = apply(family)
  const manual = { ...configured.payroll, creditPoints: 7.25 }
  const initial = initialAnswers(configured.profile, manual, today)
  assert.equal(initial.taxMode, 'saved')
  assert.ok(ids(initial).includes('childYear1'))
  const changedWork = applyAnswers(configured.profile, manual, { ...initial, hourlyRate: '61' }, today)
  assert.equal(changedWork.profile.questionnaire.childYear1, '2019')
  assert.equal(changedWork.payroll.creditPoints, 7.25)
  const changedFamily = applyAnswers(
    changedWork.profile,
    changedWork.payroll,
    { ...initial, childYear1: '2018' },
    today,
  )
  assert.equal(changedFamily.profile.questionnaire.childYear1, '2018')
  assert.equal(changedFamily.payroll.creditPoints, 7.25)
  const retired = applyAnswers(
    changedFamily.profile,
    changedFamily.payroll,
    { ...initial, ageGroup: 'retired' },
    today,
  )
  assert.equal(retired.payroll.regularInsurance, false)
  assert.equal(retired.payroll.creditPoints, 7.25)
  const returned = applyAnswers(
    changedFamily.profile,
    changedFamily.payroll,
    { ...initial, taxMode: 'questions' },
    today,
  )
  assert.equal(returned.payroll.creditPoints, 4.75)
  assert.equal(initialAnswers(returned.profile, returned.payroll, today).taxMode, undefined)
})

test('legacy employees can enter insurance and family facts while retaining existing manual credits', () => {
  const existing = { ...profile, onboarded: true, pay: { ...profile.pay, workDays: 6 as const } }
  const manual = { ...payroll, creditPoints: 8 }
  const initial = initialAnswers(existing, manual, today)
  assert.ok(ids(initial).includes('onlyJob'))
  const updated = applyAnswers(existing, manual, { ...initial, ...basic, onlyJob: 'no' }, today)
  assert.equal(updated.profile.questionnaire.onlyJob, 'no')
  assert.equal(updated.payroll.creditPoints, 8)
  assert.equal(updated.payroll.regularInsurance, false)
})
