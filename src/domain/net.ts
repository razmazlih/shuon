export type SalaryInput = { gross: number; pensionable: number }

export type AdjustmentKind = 'wage' | 'absence' | 'taxable' | 'benefit' | 'reimbursement' | 'deduction'
export type PayrollAdjustment = {
  id: string
  month: string
  label: string
  amount: number
  kind: AdjustmentKind
  planned: boolean
}

export type PayrollMonth = {
  pensionBase?: number | null
  incomeTax?: number | null
  insurance?: number | null
  prior?: {
    months: number
    taxableIncome: number
    incomeTaxPaid: number
    pensionTaxCredit: number
  }
}

export type PayrollProfile = {
  creditPoints: number | null
  pensionPercent: number | null
  capPension: boolean
  months: Record<string, PayrollMonth>
}

export function defaultPayrollProfile(): PayrollProfile {
  return { creditPoints: null, pensionPercent: null, capPension: true, months: {} }
}

export const payrollRules2026 = {
  version: 'IL-employment-2026.04',
  effectiveFrom: '2026-01-01',
  effectiveThrough: '2026-12-31',
  verifiedOn: '2026-11-26',
  sources: {
    tax: 'https://www.gov.il/BlobFolder/reports/press-income-tax-brackets/he/SalaryDataDetails_tax_bracket_2026.pdf',
    insurance: 'https://www.btl.gov.il/INSURANCE/RATES/Pages/לעובדים%20שכירים.aspx',
    deductions: 'https://www.gov.il/he/pages/pa110123-1',
    pension: 'https://www.gov.il/he/pages/pension-insurance',
  },
  creditPoint: 242,
  insuranceThreshold: 7703,
  insuranceCeiling: 51910,
  pensionSalaryCeiling: 13769,
  pensionTaxCreditSalaryCeiling: 9700,
  taxBands: [
    [7010, 0.1],
    [10060, 0.14],
    [19000, 0.2],
    [25100, 0.31],
    [46690, 0.35],
    [60130, 0.47],
    [Infinity, 0.5],
  ],
} as const

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const nonnegative = (value: number) => Math.max(0, value)
const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const provided = (value: number | null | undefined): value is number => finite(value) && value >= 0

/** Monthly brackets for earned income including the 3% surtax above the highest threshold. */
export function earnedIncomeTax2026(taxable: number): number {
  let tax = 0
  let lower = 0
  for (const [upper, rate] of payrollRules2026.taxBands) {
    tax += nonnegative(Math.min(taxable, upper) - lower) * rate
    if (taxable <= upper) break
    lower = upper
  }
  return tax
}

export function employeeInsurance2026(taxable: number) {
  const { insuranceThreshold, insuranceCeiling } = payrollRules2026
  const low = Math.min(nonnegative(taxable), insuranceThreshold)
  const high = nonnegative(Math.min(taxable, insuranceCeiling) - insuranceThreshold)
  return { national: cents(low * 0.0104 + high * 0.07), health: cents(low * 0.0323 + high * 0.0517) }
}

export function estimateSalary(
  month: string,
  earnings: SalaryInput,
  profile: PayrollProfile,
  adjustments: PayrollAdjustment[] = [],
) {
  let cashGross = earnings.gross
  let pensionBase = earnings.pensionable
  let taxableBenefit = 0
  let reimbursements = 0
  let otherDeductions = 0
  for (const item of adjustments.filter((row) => row.month === month)) {
    switch (item.kind) {
      case 'wage':
      case 'absence':
        cashGross += item.amount
        pensionBase += item.amount
        break
      case 'taxable':
        cashGross += item.amount
        break
      case 'benefit':
        taxableBenefit += item.amount
        break
      case 'reimbursement':
        reimbursements += item.amount
        break
      case 'deduction':
        otherDeductions += item.amount
        break
    }
  }
  const monthOptions = profile.months?.[month] || {}
  const supported = /^2026-(0[1-9]|1[0-2])$/.test(month)
  const taxable = nonnegative(cashGross + taxableBenefit)
  pensionBase = provided(monthOptions.pensionBase)
    ? monthOptions.pensionBase
    : Math.min(
        nonnegative(pensionBase),
        supported && profile.capPension ? payrollRules2026.pensionSalaryCeiling : Infinity,
      )
  const pension =
    supported && provided(profile.pensionPercent) && profile.pensionPercent <= 100
      ? cents((pensionBase * profile.pensionPercent) / 100)
      : null
  const pensionCredit =
    pension === null || !supported
      ? null
      : cents(
          0.35 *
            Math.min(pension, 0.07 * Math.min(pensionBase, payrollRules2026.pensionTaxCreditSalaryCeiling)),
        )
  const prior = monthOptions.prior
  const validPrior =
    !prior ||
    (Number.isInteger(prior.months) &&
      prior.months >= 1 &&
      prior.months < Number(month.slice(5)) &&
      [prior.taxableIncome, prior.incomeTaxPaid, prior.pensionTaxCredit].every(provided))
  const missing: string[] = []
  if (!supported) missing.push('טרם הוגדרו כללי שכר לשנה זו')
  if (supported && pension === null) missing.push('שיעור הפרשת העובד לפנסיה')
  if (supported && !finite(monthOptions.incomeTax) && !provided(profile.creditPoints))
    missing.push('מספר נקודות זיכוי')
  if (supported && !finite(monthOptions.incomeTax) && !validPrior)
    missing.push('נתונים מצטברים תקינים מהתלוש הקודם')
  let incomeTax: number | null = null
  if (supported && finite(monthOptions.incomeTax)) {
    incomeTax = monthOptions.incomeTax
  } else if (supported && provided(profile.creditPoints) && pensionCredit !== null && validPrior) {
    const periods = (prior?.months ?? 0) + 1
    const average = (taxable + (prior?.taxableIncome ?? 0)) / periods
    const pointsCredit = profile.creditPoints * payrollRules2026.creditPoint * periods
    const cumulativeTax = nonnegative(
      earnedIncomeTax2026(average) * periods - pointsCredit - pensionCredit - (prior?.pensionTaxCredit ?? 0),
    )
    incomeTax = cents(cumulativeTax - (prior?.incomeTaxPaid ?? 0))
  }
  const contributions = supported ? employeeInsurance2026(taxable) : null
  const insurance = !supported
    ? null
    : provided(monthOptions.insurance)
      ? monthOptions.insurance
      : cents(contributions!.national + contributions!.health)
  const net =
    pension === null || incomeTax === null || insurance === null
      ? null
      : cents(cashGross + reimbursements - pension - incomeTax - insurance - otherDeductions)
  return {
    cashGross: cents(cashGross),
    taxable: cents(taxable),
    pensionBase: cents(pensionBase),
    pension,
    pensionCredit,
    incomeTax,
    insurance,
    contributions: provided(monthOptions.insurance) ? null : contributions,
    net,
    reimbursements: cents(reimbursements),
    otherDeductions: cents(otherDeductions),
    missing,
  }
}

export function salaryReport(
  month: string,
  actual: SalaryInput,
  planned: SalaryInput,
  profile: PayrollProfile,
  items: PayrollAdjustment[],
) {
  return {
    actual: estimateSalary(
      month,
      actual,
      profile,
      items.filter((item) => !item.planned),
    ),
    forecast: estimateSalary(
      month,
      { gross: actual.gross + planned.gross, pensionable: actual.pensionable + planned.pensionable },
      profile,
      items,
    ),
  }
}
