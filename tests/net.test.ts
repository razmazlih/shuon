import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultPayrollProfile,
  earnedIncomeTax2026,
  employeeInsurance2026,
  estimateSalary,
  salaryReport,
} from '../src/domain/net'
import type { PayrollAdjustment, PayrollProfile } from '../src/domain/net'

const month = '2026-11'
const earnings = { gross: 10000, pensionable: 10000 }
const profile: PayrollProfile = { ...defaultPayrollProfile(), creditPoints: 2.25, pensionPercent: 6 }

test('2026 reference salary with basic credits and employee pension', () => {
  const result = estimateSalary(month, earnings, profile)
  assert.equal(result.pension, 600)
  assert.equal(result.pensionCredit, 210)
  assert.equal(result.incomeTax, 365.1)
  assert.equal(result.insurance, 608.46)
  assert.equal(result.net, 8426.44)
})

test('brackets apply progressively and national and health insurance stop at the cap', () => {
  assert.equal(earnedIncomeTax2026(7010), 701)
  assert.equal(earnedIncomeTax2026(19000), 2916)
  assert.equal(earnedIncomeTax2026(25100), 4807)
  assert.equal(earnedIncomeTax2026(60132) - earnedIncomeTax2026(60130), 1)
  assert.deepEqual(employeeInsurance2026(51910), employeeInsurance2026(100000))
  assert.deepEqual(employeeInsurance2026(7703), { national: 80.11, health: 248.81 })
})

test('unconfigured profile and unavailable tax year retain gross and indicate missing net', () => {
  const unknown = estimateSalary(month, earnings, defaultPayrollProfile())
  assert.equal(unknown.cashGross, 10000)
  assert.equal(unknown.missing.length, 2)
  assert.equal(unknown.net, null)
  assert.equal(estimateSalary('2027-01', earnings, profile).net, null)
  assert.equal(
    estimateSalary(month, earnings, { ...profile, creditPoints: 0, pensionPercent: 0 }).incomeTax,
    1119.6,
  )
})

test('pensionable salary and contribution credit have separate ceilings and month overrides take precedence', () => {
  const high = { gross: 30000, pensionable: 20000 }
  const capped = estimateSalary(month, high, profile)
  assert.equal(capped.pension, 826.14)
  assert.equal(capped.pensionCredit, 237.65)
  const full = estimateSalary(month, high, { ...profile, capPension: false })
  assert.equal(full.pension, 1200)
  const manual = estimateSalary(month, high, {
    ...profile,
    months: { [month]: { pensionBase: 15000, incomeTax: 0, insurance: 25 } },
  })
  assert.equal(manual.net, 29075)
  assert.equal(manual.contributions, null)
})

test('cumulative withholding can refund earlier tax and cannot refund more than tax previously paid', () => {
  const prior = { months: 1, taxableIncome: 10000, incomeTaxPaid: 365.1, pensionTaxCredit: 210 }
  const result = estimateSalary(
    '2026-02',
    { gross: 3000, pensionable: 3000 },
    { ...profile, months: { '2026-02': { prior } } },
  )
  assert.equal(result.incomeTax, -365.1)
  assert.equal(
    estimateSalary('2026-02', earnings, {
      ...profile,
      months: { '2026-02': { prior: { ...prior, months: 2 } } },
    }).net,
    null,
  )
})

test('confirmed and planned movements affect only selected period and taxation category', () => {
  const row = (kind: PayrollAdjustment['kind'], amount: number, planned = false): PayrollAdjustment => ({
    id: kind,
    month,
    label: kind,
    amount,
    kind,
    planned,
  })
  const items = [
    row('wage', 20),
    row('absence', 30),
    row('taxable', 50),
    row('benefit', 100),
    row('deduction', 10),
    row('reimbursement', 80),
    row('wage', 100, true),
    { ...row('wage', 900), month: '2026-10' },
  ]
  const result = salaryReport(
    month,
    { gross: 500, pensionable: 300 },
    { gross: 300, pensionable: 200 },
    profile,
    items,
  )
  assert.equal(result.actual.cashGross, 600)
  assert.equal(result.actual.taxable, 700)
  assert.equal(result.actual.pensionBase, 350)
  assert.equal(result.actual.net, 619.11)
  assert.equal(result.forecast.cashGross, 1000)
  assert.equal(result.forecast.pensionBase, 650)
})
