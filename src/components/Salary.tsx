import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { payrollRules2026, salaryReport } from '../domain/net'
import type {
  AdjustmentKind,
  PayrollAdjustment,
  PayrollMonth,
  PayrollProfile,
  SalaryInput,
} from '../domain/net'
import { grossCoverage, type PayBand } from '../domain/gross'
import { hourCount } from '../data/model'
import './salary.css'

type SalaryProps = {
  month: string
  actual: SalaryInput
  actualBands?: PayBand[]
  forecastBands?: PayBand[]
  planned: SalaryInput
  profile: PayrollProfile
  adjustments: PayrollAdjustment[]
  onProfileChange: (profile: PayrollProfile) => Promise<void>
  onAdjustmentsChange: (items: PayrollAdjustment[]) => Promise<void>
}

const shekels = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})
const money = (sum: number | null) => (sum === null ? '—' : shekels.format(sum))
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(month + '-15T12:00:00Z'),
  )
const types: Record<AdjustmentKind, string> = {
  wage: 'תוספת שכר מבוטחת',
  absence: 'דמי חופשה, מחלה או חג',
  taxable: 'תוספת חייבת ללא פנסיה',
  benefit: 'שווי הטבה לצורכי מס',
  reimbursement: 'החזר הוצאות פטור',
  deduction: 'ניכוי מהנטו',
}
const explanations: Record<AdjustmentKind, string> = {
  wage: 'הסכום מצטרף לברוטו ולבסיס ההפרשה לפנסיה.',
  absence:
    'יש להזין את השכר עבור ההיעדרות לפי הזכאות או התלוש, ולוודא שהשעות אינן רשומות גם כעבודה. הזכאות לחג תלויה בוותק ובימי העבודה, ולמחלה ביתרה הצבורה וברצף ההיעדרות.',
  taxable: 'הסכום מתווסף לברוטו וחייב במס ובדמי ביטוח. אפשר לרשום כאן נסיעות החייבות במס.',
  benefit: 'לדוגמה, שווי ארוחות או רכב. הסכום מגדיל את הבסיס למס ולדמי ביטוח בלבד.',
  reimbursement: 'להחזר שמופיע בתלוש כפטור ממס ומדמי ביטוח. הוא מתווסף ישירות לנטו.',
  deduction: 'לדוגמה, החזר מקדמה, חלק העובד בקרן השתלמות או דמי ועד. הסכום יורד ישירות מהנטו.',
}

function NumberField({
  name,
  title,
  value,
  max,
  min = 0,
  required = false,
  step = '0.01',
  hint,
}: {
  name: string
  title: string
  value?: number | null
  min?: number | null
  max?: number
  required?: boolean
  step?: string
  hint?: string
}) {
  return (
    <label className="salary-field">
      <span>{title}</span>
      <input
        type="number"
        name={name}
        min={min ?? undefined}
        max={max}
        step={step}
        required={required}
        inputMode="decimal"
        defaultValue={value ?? ''}
        placeholder={hint}
      />
    </label>
  )
}

function readNumber(data: FormData, key: string) {
  const value = data.get(key)
  return value === null || value === '' ? null : Number(value)
}

export function PayrollSettings({
  month,
  profile,
  onProfileChange,
}: Pick<SalaryProps, 'month' | 'profile' | 'onProfileChange'>) {
  const monthData = profile.months?.[month] || {}
  const [usePrior, setUsePrior] = useState(Boolean(monthData.prior))
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
        creditPoints: readNumber(data, 'creditPoints'),
        pensionPercent: readNumber(data, 'pensionPercent'),
        capPension: data.has('capPension'),
        months: { ...profile.months, [month]: settings },
      })
      setStatus('פרטי השכר נשמרו')
    } catch {
      setStatus('שמירת פרטי השכר נכשלה. אפשר לנסות שוב.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <form key={JSON.stringify(profile)} className="salary-form" onSubmit={submit}>
      <p className="salary-help">אפשר להעתיק את שני הערכים מהתלוש האחרון. הם ישמשו את החישוב בכל החודשים.</p>
      <div className="salary-grid">
        <NumberField name="creditPoints" title="נקודות זיכוי" value={profile.creditPoints} hint="לפי התלוש" />
        <NumberField
          name="pensionPercent"
          title="הפרשת עובד לפנסיה (%)"
          value={profile.pensionPercent}
          max={100}
          hint="לפי התלוש"
        />
      </div>
      <label className="salary-check">
        <input type="checkbox" name="capPension" defaultChecked={profile.capPension} /> החלת תקרת פנסיית חובה
        (13,769 ₪ בחודש בשנת 2026)
      </label>
      <details className="salary-inner-details">
        <summary>נתוני תלוש לחודש {monthLabel(month)}</summary>
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
      </details>
      <div className="salary-actions">
        <button className="salary-primary" type="submit" disabled={saving}>
          {saving ? 'בשמירה…' : 'שמירת פרטי שכר'}
        </button>
        <span role="status">{status}</span>
      </div>
    </form>
  )
}

function Adjustments({
  month,
  adjustments,
  onAdjustmentsChange,
}: Pick<SalaryProps, 'month' | 'adjustments' | 'onAdjustmentsChange'>) {
  const [editing, setEditing] = useState<PayrollAdjustment | 'new' | null>(null)
  const [kind, setKind] = useState<AdjustmentKind>('wage')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const labelInput = useRef<HTMLInputElement>(null)
  const rows = adjustments.filter((item) => item.month === month)
  const old = editing && editing !== 'new' ? editing : null
  function edit(row: PayrollAdjustment | 'new') {
    setKind(row === 'new' ? 'wage' : row.kind)
    setEditing(row)
    setStatus('')
    requestAnimationFrame(() => labelInput.current?.focus())
  }
  async function persist(next: PayrollAdjustment[], message: string) {
    setBusy(true)
    setStatus('')
    try {
      await onAdjustmentsChange(next)
      setEditing(null)
      setStatus(message)
    } catch {
      setStatus('שמירת השינוי נכשלה. אפשר לנסות שוב.')
    } finally {
      setBusy(false)
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const label = String(data.get('label')).trim()
    if (!label) {
      setStatus('יש להזין שם לרכיב השכר')
      labelInput.current?.focus()
      return
    }
    const row: PayrollAdjustment = {
      id: old?.id ?? crypto.randomUUID(),
      month,
      label,
      amount: Number(data.get('amount')),
      kind,
      planned: data.has('planned'),
    }
    const next = old ? adjustments.map((item) => (item.id === row.id ? row : item)) : [...adjustments, row]
    await persist(next, 'רכיב השכר נשמר')
  }
  return (
    <section className="salary-card">
      <div className="salary-section-head">
        <h2>רכיבי שכר נוספים</h2>
        <button type="button" className="salary-secondary" disabled={busy} onClick={() => edit('new')}>
          + הוספת רכיב
        </button>
      </div>
      {rows.length === 0 && !editing && (
        <p className="salary-help">כאן אפשר להוסיף דמי חג, החזרי נסיעות, בונוסים וניכויים מהתלוש.</p>
      )}
      {rows.length > 0 && (
        <ul className="salary-items">
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.label}</strong>
                <small>
                  {types[row.kind]} · {row.planned ? 'מתוכנן' : 'בפועל'}
                </small>
              </div>
              <bdi>{money(row.amount)}</bdi>
              <button
                type="button"
                className="salary-link"
                disabled={busy}
                aria-label={'עריכת ' + row.label}
                onClick={() => edit(row)}
              >
                עריכה
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <form key={old?.id ?? 'new'} onSubmit={submit} className="salary-form salary-adjust-form">
          <div className="salary-grid">
            <label className="salary-field">
              שם הרכיב
              <input
                ref={labelInput}
                autoComplete="off"
                name="label"
                required
                maxLength={80}
                defaultValue={old?.label}
                placeholder="למשל, דמי חג"
              />
            </label>
            <label className="salary-field">
              סוג הרכיב
              <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)}>
                {Object.entries(types).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="salary-help">{explanations[kind]}</p>
          <div className="salary-grid">
            <NumberField name="amount" title="סכום (₪)" min={0.01} value={old?.amount} required />
            <label className="salary-check">
              <input type="checkbox" name="planned" defaultChecked={old?.planned ?? false} /> רכיב מתוכנן
              לתחזית בלבד
            </label>
          </div>
          <div className="salary-actions">
            <button disabled={busy} className="salary-primary">
              שמירת רכיב
            </button>
            <button
              type="button"
              className="salary-secondary"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              ביטול
            </button>
            {old && (
              <button
                type="button"
                className="salary-link"
                disabled={busy}
                onClick={() =>
                  void persist(
                    adjustments.filter((row) => row.id !== old.id),
                    'רכיב השכר הוסר',
                  )
                }
              >
                הסרת רכיב
              </button>
            )}
          </div>
        </form>
      )}
      <p className="salary-live" role="status">
        {status}
      </p>
    </section>
  )
}

function BreakdownRow({ title, value }: { title: string; value: number | null }) {
  return (
    <div>
      <dt>{title}</dt>
      <dd>
        <bdi>{money(value)}</bdi>
      </dd>
    </div>
  )
}

export function Salary(props: SalaryProps) {
  const { month, actual, planned, profile, adjustments } = props
  const [view, setView] = useState<'actual' | 'forecast'>('forecast')
  const report = salaryReport(month, actual, planned, profile, adjustments)
  const current = report[view]
  const settings = useRef<HTMLDetailsElement>(null)
  const settingsId = useId()
  const configured = current.missing.length === 0
  return (
    <div className="salary-report">
      <div className="salary-section-head">
        <div className="salary-views" aria-label="תקופת הדוח" role="group">
          <button type="button" aria-pressed={view === 'forecast'} onClick={() => setView('forecast')}>
            תחזית לסוף החודש
          </button>
          <button type="button" aria-pressed={view === 'actual'} onClick={() => setView('actual')}>
            בפועל עד כה
          </button>
        </div>
      </div>
      <div className="salary-stats">
        <div className="salary-figure salary-figure-gross">
          <span>שכר ברוטו {view === 'forecast' ? 'צפוי' : 'שנצבר'}</span>
          <strong>
            <bdi>{money(current.cashGross)}</bdi>
          </strong>
          <small>
            {view === 'forecast' ? 'משמרות שבוצעו ומתוכננות בחודש' : 'משמרות ורכיבים שסומנו כבוצעו'}
          </small>
        </div>
        <div className="salary-figure">
          <span>נטו משוער</span>
          <strong>
            <bdi>{money(current.net)}</bdi>
          </strong>
          {!configured && month.startsWith('2026-') ? (
            <button
              type="button"
              className="salary-link"
              aria-controls={settingsId}
              onClick={() => {
                if (settings.current) {
                  settings.current.open = true
                  settings.current.scrollIntoView({ block: 'center' })
                  settings.current.querySelector('input')?.focus()
                }
              }}
            >
              השלמת פרטים לחישוב הנטו
            </button>
          ) : (
            <small>{configured ? 'לאחר מס, ביטוח, פנסיה ורכיבים אישיים' : current.missing[0]}</small>
          )}
        </div>
      </div>
      <section className="salary-card">
        <h2>פירוט החישוב</h2>
        <dl className="salary-breakdown">
          <BreakdownRow title="ברוטו לתשלום" value={current.cashGross} />
          <BreakdownRow title="שכר חייב במס ובדמי ביטוח" value={current.taxable} />
          <BreakdownRow title="שכר מבוטח לפנסיה" value={current.pensionBase} />
          <BreakdownRow title="מס הכנסה לאחר זיכויים" value={current.incomeTax} />
          {current.contributions ? (
            <>
              <BreakdownRow title="ביטוח לאומי" value={current.contributions.national} />
              <BreakdownRow title="ביטוח בריאות" value={current.contributions.health} />
            </>
          ) : (
            <BreakdownRow title="ביטוח לאומי ובריאות" value={current.insurance} />
          )}
          <BreakdownRow title="הפרשת עובד לפנסיה" value={current.pension} />
          {current.reimbursements !== 0 && (
            <BreakdownRow title="החזרים פטורים" value={current.reimbursements} />
          )}
          {current.otherDeductions !== 0 && (
            <BreakdownRow title="ניכויים נוספים" value={current.otherDeductions} />
          )}
          <BreakdownRow title="נטו משוער לתשלום" value={current.net} />
        </dl>
        {current.missing.length > 0 && (
          <p className="salary-help">
            {month.startsWith('2026-') ? 'פרטים להשלמת האומדן — ' : ''}
            {current.missing.join(' · ')}.
          </p>
        )}
      </section>
      <details className="salary-card salary-settings" ref={settings} id={settingsId}>
        <summary>פרטי שכר וניכויים</summary>
        <PayrollSettings
          key={month}
          month={month}
          profile={profile}
          onProfileChange={props.onProfileChange}
        />
      </details>
      <Adjustments key={month} {...props} />
      <details className="salary-card salary-method">
        <summary>השעות המרכיבות את הברוטו</summary>
        {(view === 'forecast' ? props.forecastBands : props.actualBands)
          ?.filter((b) => b.hours > 0)
          .map((b) => (
            <div className="ledger-line" key={b.kind}>
              <span>
                {
                  {
                    regular: 'שעות רגילות',
                    overtime125: 'שעות נוספות 125%',
                    overtime150: 'שעות נוספות 150%',
                    rest150: 'מנוחה או חג 150%',
                    rest175: 'מנוחה ושעות נוספות 175%',
                    rest200: 'מנוחה ושעות נוספות 200%',
                  }[b.kind]
                }{' '}
                · {hourCount(b.hours)} שעות
              </span>
              <b>{money(b.amount)}</b>
            </div>
          ))}
        <p>
          {grossCoverage.scope} {grossCoverage.limitations}
        </p>
        <a href={grossCoverage.sources[0]} target="_blank" rel="noreferrer">
          צו קיצור שבוע העבודה
        </a>
      </details>
      <details className="salary-card salary-method">
        <summary>איך מחושב האומדן?</summary>
        <p>
          כללי 2026 חלים על שכר עבודה ממעסיק עיקרי אחד, לתושב ישראל מגיל 18 ועד גיל הפרישה. התחזית כוללת את
          המשמרות והרכיבים שהוזנו לחודש. סכומים ידניים מחליפים את החישוב בשתי התצוגות.
        </p>
        <p>
          מס הכנסה מחושב במדרגות, בניכוי נקודות זיכוי וזיכוי להפקדה מוכרת לפנסיה. בסיס הפנסיה האוטומטי כולל
          שכר יסוד של שעות רגילות ורכיבים מבוטחים שהוספת. בנתוני התלוש אפשר לשנות את הבסיס לפי ההסכם האישי.
        </p>
        <p>
          לשכר משתנה אפשר להזין נתונים מצטברים מהתלוש הקודם. במשרה נוספת, בתיאום מס, בזכאות להטבת מס למשמרות
          בתעשייה או בהסדר ביטוח מיוחד, אפשר להזין את סכומי הניכוי לחודש מאישור או מתלוש.
        </p>
        <div className="salary-sources">
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
      </details>
    </div>
  )
}
