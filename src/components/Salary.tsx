import { useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Calculator, ChevronDown, Clock, ReceiptText, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { payrollRules2026, salaryReport } from '../domain/net'
import type {
  PayrollAdjustment,
  PayrollMonth,
  PayrollProfile,
  SalaryInput,
} from '../domain/net'
import { grossCoverage, type GrossResult, type PayBand } from '../domain/gross'
import { WorkDuration, workHourBands } from './WorkHours'
import { NumberField, readNumber } from './PayrollNumberField'
import './salary.css'

type SalaryProps = {
  month: string
  actual: SalaryInput
  actualWork: Pick<GrossResult, 'hours' | 'bands'>
  forecastWork: Pick<GrossResult, 'hours' | 'bands'>
  planned: SalaryInput
  profile: PayrollProfile
  adjustments: PayrollAdjustment[]
  onProfileChange: (profile: PayrollProfile) => Promise<void>
}

const shekels = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})
const money = (sum: number) => shekels.format(sum)
function PayslipForm({
  month,
  profile,
  onProfileChange,
}: Pick<SalaryProps, 'month' | 'profile' | 'onProfileChange'>) {
  const monthData = profile.months?.[month] || {}
  const [priorDraft, setUsePrior] = useState<boolean | null>(null)
  const usePrior = priorDraft ?? Boolean(monthData.prior)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const settings: PayrollMonth = {
      pensionBase: readNumber(data, 'pensionBase'),
      incomeTax: readNumber(data, 'incomeTax'),
      insurance: readNumber(data, 'insurance'),
    }
    if (usePrior) {
      settings.prior = {
        months: Number(data.get('months')),
        taxableIncome: Number(data.get('taxableIncome')),
        incomeTaxPaid: Number(data.get('incomeTaxPaid')),
        pensionTaxCredit: Number(data.get('pensionTaxCredit')),
      }
    }
    setSaving(true)
    setStatus('')
    try {
      await onProfileChange({
        ...profile,
        months: { ...profile.months, [month]: settings },
      })
      setUsePrior(null)
      setStatus('נתוני התלוש נשמרו')
    } catch {
      setStatus('שמירת נתוני התלוש נכשלה. אפשר לנסות שוב.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <form className="salary-form" onSubmit={submit}>
      <p className="salary-help">
        השדות הבאים מחליפים את האומדן האוטומטי לחודש שנבחר. אפשר להזין אפס או להשאיר שדה ריק לחישוב אוטומטי.
      </p>
      <div className="salary-grid salary-grid-three">
        <NumberField name="pensionBase" title="שכר מבוטח בפועל (₪)" value={monthData.pensionBase} />
        <NumberField name="incomeTax" min={null} title="מס הכנסה בתלוש (₪)" value={monthData.incomeTax} />
        <NumberField name="insurance" title="ביטוח לאומי ובריאות (₪)" value={monthData.insurance} />
      </div>
      {Number(month.slice(5)) > 1 && (
        <label className="salary-check">
          <input type="checkbox" checked={usePrior} onChange={(e) => setUsePrior(e.target.checked)} /> חישוב
          מס מצטבר בעזרת התלוש הקודם
        </label>
      )}
      {usePrior && (
        <>
          <p className="salary-help">
            יש להזין סכומים עד סוף החודש הקודם באותה שנת מס. החישוב מניח שמספר נקודות הזיכוי היה קבוע
            בתקופה.
          </p>
          <div className="salary-grid">
            <NumberField
              name="months"
              title="חודשי חישוב קודמים"
              value={monthData.prior?.months}
              min={1}
              max={Number(month.slice(5)) - 1}
              step="1"
              required
            />
            <NumberField
              name="taxableIncome"
              title="שכר חייב מצטבר (₪)"
              value={monthData.prior?.taxableIncome}
              required
            />
            <NumberField
              name="incomeTaxPaid"
              title="מס הכנסה שנוכה במצטבר (₪)"
              value={monthData.prior?.incomeTaxPaid}
              required
            />
            <NumberField
              name="pensionTaxCredit"
              title="זיכוי פנסיה מצטבר (₪)"
              value={monthData.prior?.pensionTaxCredit}
              required
            />
          </div>
        </>
      )}
      <div className="salary-actions">
        <button className="salary-primary" type="submit" disabled={saving}>
          {saving ? 'בשמירה…' : 'שמירת נתוני התלוש'}
        </button>
        <span role="status">{status}</span>
      </div>
    </form>
  )
}

function SalaryComparison({ title, children }: { title: string; children: ReactNode }) {
  return (
    <table className="salary-table" aria-label={title}>
      <thead>
        <tr>
          <th scope="col">רכיב</th>
          <th scope="col">עד עכשיו</th>
          <th scope="col">סוף החודש</th>
        </tr>
      </thead>
      {children}
    </table>
  )
}

function ComparisonRow({ title, forecast, actual, shared }: {
  title: string
  forecast: ReactNode
  actual: ReactNode
  shared?: boolean
}) {
  return (
    <tr>
      <th scope="row">{title}</th>
      {shared ? (
        <td colSpan={2}><span className="sr-only">עד עכשיו ובסוף החודש </span>{actual}</td>
      ) : (
        <><td>{actual}</td><td>{forecast}</td></>
      )}
    </tr>
  )
}

function SalaryAmount({ value }: { value: number | null }) {
  return value === null ? <span className="salary-unknown">לא ידוע</span> : <bdi>{money(value)}</bdi>
}

function PayBandValue({ band }: { band?: PayBand }) {
  return (
    <>
      <WorkDuration hours={band?.hours ?? 0} />
      {band && <small><SalaryAmount value={band.amount} /></small>}
    </>
  )
}

function MonthlyWorkHours({ actualWork, forecastWork }: Pick<SalaryProps, 'actualWork' | 'forecastWork'>) {
  const bands = workHourBands.flatMap(([kind, label]) => {
    const actual = actualWork.bands.find((band) => band.kind === kind && band.hours > 0)
    const forecast = forecastWork.bands.find((band) => band.kind === kind && band.hours > 0)
    return actual || forecast ? [{ kind, label, actual, forecast }] : []
  })
  const showForecast = actualWork.hours !== forecastWork.hours ||
    bands.some(({ actual, forecast }) => actual?.hours !== forecast?.hours)

  return (
    <section className="salary-card salary-work-hours">
      <h2><Clock size={19} aria-hidden="true" /> שעות עבודה בחודש</h2>
      {bands.length === 0 ? <p>אין שעות עבודה בחודש הזה.</p> : (
        <table className="salary-table" aria-label="שעות עבודה ושכר לפי סוג">
          <thead>
            <tr>
              <th scope="col">סוג שעות</th>
              <th scope="col">בוצעו</th>
              {showForecast && <th scope="col">צפי לסוף החודש</th>}
            </tr>
          </thead>
          <tbody>
            <tr className="salary-work-total">
              <th scope="row">סך שעות העבודה</th>
              <td><WorkDuration hours={actualWork.hours} /></td>
              {showForecast && <td><WorkDuration hours={forecastWork.hours} /></td>}
            </tr>
            {bands.map(({ kind, label, actual, forecast }) => (
              <tr key={kind}>
                <th scope="row">{label}</th>
                <td><PayBandValue band={actual} /></td>
                {showForecast && <td><PayBandValue band={forecast} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

type Estimate = ReturnType<typeof salaryReport>['actual']
type Amount = (estimate: Estimate) => number | null

function SalarySummary({ earned, forecast }: { earned: Estimate; forecast: Estimate }) {
  const sameNet = earned.net === forecast.net
  const sameGross = earned.cashGross === forecast.cashGross
  return (
    <section className="salary-summary" aria-label="סיכום השכר לחודש">
      <div className="salary-summary-net">
        <div className="salary-earned">
          <Wallet size={22} className="salary-wallet" aria-hidden="true" />
          <h2>נטו משוער שנצבר</h2>
          {earned.net === null ? <strong className="salary-unavailable">אין עדיין אומדן</strong> : (
            <strong className="salary-total"><SalaryAmount value={earned.net} /></strong>
          )}
          {sameNet && earned.net !== null && <p>הצפי לסוף החודש זהה</p>}
        </div>
        {!sameNet && (
          <div className="salary-forecast">
            <h2>צפי נטו לסוף החודש</h2>
            <strong>{forecast.net === null ? 'אין עדיין אומדן' : <SalaryAmount value={forecast.net} />}</strong>
            <p>כולל מה שבוצע ומה שמתוכנן</p>
          </div>
        )}
      </div>
      <div className="salary-gross">
        <h2>לפני ניכויים</h2>
        <dl>
          {sameGross ? (
            <div><dt>עד עכשיו וגם בסוף החודש</dt><dd><SalaryAmount value={earned.cashGross} /></dd></div>
          ) : (
            <>
              <div><dt>עד עכשיו</dt><dd><SalaryAmount value={earned.cashGross} /></dd></div>
              <div><dt>צפי לסוף החודש</dt><dd><SalaryAmount value={forecast.cashGross} /></dd></div>
            </>
          )}
        </dl>
      </div>
    </section>
  )
}

function DisclosureLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <summary className="salary-disclosure-label">
      <Icon className="salary-disclosure-icon" size={19} aria-hidden="true" />
      <span>{children}</span>
      <ChevronDown size={18} className="salary-disclosure-chevron" aria-hidden="true" />
    </summary>
  )
}

export function Salary(props: SalaryProps) {
  const { month, actual, planned, profile, adjustments, actualWork, forecastWork } = props
  const { forecast, actual: earned } = salaryReport(month, actual, planned, profile, adjustments)
  const payslip = useRef<HTMLDetailsElement>(null)
  const payslipId = useId()
  const missing = [...new Set([...earned.missing, ...forecast.missing])]
  const hasPayrollRules = month.startsWith('2026-')
  const monthData = profile.months?.[month]
  const hasSalaryData = forecastWork.hours > 0 ||
    [actual.gross, actual.pensionable, planned.gross, planned.pensionable].some((value) => value !== 0) ||
    adjustments.some((item) => item.month === month) ||
    [monthData?.pensionBase, monthData?.incomeTax, monthData?.insurance, monthData?.prior].some((value) => value != null)

  function amountRow(title: string, amount: Amount, hideZero = false) {
    const actualAmount = amount(earned)
    const forecastAmount = amount(forecast)
    if (hideZero && actualAmount === 0 && forecastAmount === 0) return null
    return (
      <ComparisonRow
        key={title}
        title={title}
        actual={<SalaryAmount value={actualAmount} />}
        forecast={<SalaryAmount value={forecastAmount} />}
        shared={actualAmount === forecastAmount}
      />
    )
  }

  const deductions = [
    amountRow('מס הכנסה לאחר זיכויים', (estimate) => estimate.incomeTax, true),
    ...(forecast.contributions && earned.contributions ? [
      amountRow('ביטוח לאומי', (estimate) => estimate.contributions?.national ?? null, true),
      amountRow('ביטוח בריאות', (estimate) => estimate.contributions?.health ?? null, true),
    ] : [amountRow('ביטוח לאומי ובריאות', (estimate) => estimate.insurance, true)]),
    amountRow('הפרשת עובד לפנסיה', (estimate) => estimate.pension, true),
    amountRow('החזרים פטורים', (estimate) => estimate.reimbursements, true),
    amountRow('ניכויים נוספים', (estimate) => estimate.otherDeductions, true),
  ].filter((row) => row !== null)

  return (
    <div className="salary-report">
      {hasSalaryData ? <SalarySummary earned={earned} forecast={forecast} /> : (
        <section className="salary-card salary-empty">
          <Wallet size={22} className="salary-wallet" aria-hidden="true" />
          <h2>אין עדיין נתוני שכר לחודש הזה</h2>
        </section>
      )}
      <MonthlyWorkHours actualWork={actualWork} forecastWork={forecastWork} />
      {hasSalaryData && missing.length > 0 && (
        <div className="salary-card salary-estimate-note">
          <p>
            {hasPayrollRules ? 'להשלמת אומדן הנטו חסרים הפרטים הבאים: ' : ''}
            {missing.join(' · ')}.
          </p>
          {hasPayrollRules && (
            <>
              <a className="salary-link" href="#settings">עדכון הגדרות השכר</a>
              <button
                type="button"
                className="salary-link"
                aria-controls={payslipId}
                onClick={() => {
                  if (payslip.current) {
                    payslip.current.open = true
                    payslip.current.scrollIntoView({ block: 'center' })
                    payslip.current.querySelector('input')?.focus()
                  }
                }}
              >
                השלמה לפי תלוש
              </button>
            </>
          )}
        </div>
      )}
      <details className="salary-card salary-disclosure">
        <DisclosureLabel icon={Calculator}>איך חושב השכר</DisclosureLabel>
        {hasSalaryData && (
          <SalaryComparison title="בסיסי החישוב והניכויים">
            <tbody>
              {amountRow('שכר חייב במס ובביטוח', (estimate) => estimate.taxable)}
              {amountRow('שכר מבוטח לפנסיה', (estimate) => estimate.pensionBase)}
            </tbody>
            {deductions.length > 0 && (
              <tbody>
                <tr className="salary-group"><th scope="rowgroup" colSpan={3}>ניכויים והחזרים</th></tr>
                {deductions}
              </tbody>
            )}
          </SalaryComparison>
        )}
        {hasSalaryData ? (
          <details className="salary-method">
            <summary>כללי החישוב ומקורות</summary>
            <SalaryMethod />
          </details>
        ) : <div className="salary-method"><SalaryMethod /></div>}
      </details>
      <details className="salary-card salary-disclosure salary-settings" ref={payslip} id={payslipId}>
        <DisclosureLabel icon={ReceiptText}>עדכון לפי תלוש</DisclosureLabel>
        <PayslipForm key={month} month={month} profile={profile} onProfileChange={props.onProfileChange} />
      </details>
    </div>
  )
}

function SalaryMethod() {
  return (
    <>
      <p>
        כללי 2026 חלים על שכר עבודה ממעסיק עיקרי אחד, לתושב ישראל מגיל 18 ועד גיל הפרישה. התחזית כוללת את
        המשמרות והרכיבים שהוזנו לחודש. סכומים ידניים מחליפים את החישוב בפועל ובתחזית.
      </p>
      <p>
        מס הכנסה מחושב במדרגות, בניכוי נקודות זיכוי וזיכוי להפקדה מוכרת לפנסיה. בסיס הפנסיה האוטומטי כולל
        שכר יסוד של שעות רגילות ורכיבים מבוטחים שנשמרו בעבר. בנתוני התלוש אפשר לשנות את הבסיס לפי ההסכם האישי.
      </p>
      <p>
        לשכר משתנה אפשר להזין נתונים מצטברים מהתלוש הקודם. במשרה נוספת, בתיאום מס, בזכאות להטבת מס למשמרות
        בתעשייה או בהסדר ביטוח מיוחד, אפשר להזין את סכומי הניכוי לחודש מאישור או מתלוש.
      </p>
      <p>{grossCoverage.scope} {grossCoverage.limitations}</p>
      <div className="salary-sources">
        <a href={grossCoverage.sources[0]} target="_blank" rel="noreferrer">
          צו קיצור שבוע העבודה
        </a>
        <a href={payrollRules2026.sources.tax} target="_blank" rel="noreferrer">
          מדרגות מס הכנסה לשנת 2026
        </a>
        <a href={payrollRules2026.sources.insurance} target="_blank" rel="noreferrer">
          דמי ביטוח לשכירים
        </a>
        <a href={payrollRules2026.sources.deductions} target="_blank" rel="noreferrer">
          לוחות ניכויים וזיכויים
        </a>
        <a href={payrollRules2026.sources.pension} target="_blank" rel="noreferrer">
          ביטוח פנסיוני
        </a>
      </div>
    </>
  )
}
