import { useState, type FormEvent, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import {
  Banknote,
  Bookmark,
  CalendarDays,
  ChevronLeft,
  Clock3,
  Laptop,
  LogIn,
  LogOut,
  Moon,
  Palette,
  Sprout,
  Sun,
  UserRound,
} from 'lucide-react'
import type { Template, UserProfile } from '../data/model'
import type { PaySettings } from '../domain/gross'
import { dateMs, localDate, localTime, localToInstant } from '../domain/time'
import AppleCalendar from './AppleCalendar'
import { TimeRange } from './TimeRange'
import './settings.css'

type SaveProfile = (profile: UserProfile) => Promise<void>
type SettingsProps = {
  profile: UserProfile
  onSave: SaveProfile
  templates: Template[]
  onTemplate: (template: Template) => Promise<void>
  user: User | null
  onSalary: () => void
  onSignIn: () => void
  onSignOut: () => Promise<void>
}

const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const themes = [
  { key: 'light', label: 'בהיר', Icon: Sun },
  { key: 'dark', label: 'כהה', Icon: Moon },
  { key: 'sage', label: 'מרווה', Icon: Sprout },
  { key: 'system', label: 'לפי המכשיר', Icon: Laptop },
] as const
const dateFormat = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const formatDate = (date: string) => dateFormat.format(dateMs(date))
const rateFormat = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})
const read = (form: FormData, key: string) => String(form.get(key) ?? '')
const dateTimeValue = (instant: string) => localDate(instant) + 'T' + localTime(instant)
const isoFromLocal = (value: string, end = false) => {
  const [date, time] = value.split('T')
  return localToInstant(date, time, end ? 'later' : 'earlier')
}
const clockPattern = '(?:[01][0-9]|2[0-3]):[0-5][0-9]'
const throughMidnightPattern = '(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00)'

function DayField({ title, name, value }: { title: string; name: string; value: number }) {
  return (
    <label className="prefs-field">
      {title}
      <select name={name} defaultValue={value}>
        {days.map((day, index) => (
          <option key={day} value={index}>
            {day}
          </option>
        ))}
      </select>
    </label>
  )
}

function ClockField({
  title,
  name,
  value,
  canEndAtMidnight = false,
}: {
  title: string
  name: string
  value: string
  canEndAtMidnight?: boolean
}) {
  return (
    <label className="prefs-field">
      {title}
      <input
        dir="ltr"
        type="text"
        name={name}
        defaultValue={value}
        maxLength={5}
        required
        pattern={canEndAtMidnight ? throughMidnightPattern : clockPattern}
        placeholder="HH:MM"
        title={canEndAtMidnight ? 'שעה בפורמט 00:00 עד 24:00' : 'שעה בפורמט 00:00 עד 23:59'}
      />
    </label>
  )
}

function SectionHeading({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <h2 className="prefs-heading">
      <span aria-hidden="true">{icon}</span>
      {children}
    </h2>
  )
}

export function Onboarding({ profile, onSave }: { profile: UserProfile; onSave: SaveProfile }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setError('')
    try {
      await onSave({
        ...profile,
        onboarded: true,
        pay: {
          ...profile.pay,
          hourlyRate: Number(form.get('hourlyRate')),
          workDays: Number(form.get('workDays')) as 5 | 6,
        },
      })
    } catch {
      setError('שמירת ההגדרות נכשלה. אפשר לנסות שוב.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <form className="prefs-form prefs-onboard" onSubmit={submit}>
      <p>כדי לחשב את שווי המשמרת הראשונה, צריך את שכר הבסיס לשעה ואת אורך שבוע העבודה במקום העבודה.</p>
      <label className="prefs-field">
        שכר בסיס לשעה (₪)
        <input
          name="hourlyRate"
          min=".01"
          step=".01"
          type="number"
          inputMode="decimal"
          placeholder="לפי הסכם העבודה"
          required
        />
      </label>
      <label className="prefs-field">
        שבוע העבודה במקום העבודה
        <select name="workDays" defaultValue={profile.pay.workDays}>
          <option value={5}>5 ימי עבודה</option>
          <option value={6}>6 ימי עבודה</option>
        </select>
      </label>
      <button type="submit" className="prefs-primary" disabled={saving}>
        {saving ? 'בשמירה…' : 'שמירה והתחלת העבודה'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}

type HolidayDate = { id: string; date: string }
type HolidayRange = { id: string; start: string; end: string }
type SavePay = (pay: PaySettings, section: string, message: string) => Promise<boolean>

function TimeSettings({ pay, busy, save }: { pay: PaySettings; busy: boolean; save: SavePay }) {
  const [holidays, setHolidays] = useState<HolidayDate[]>(() =>
    (pay.holidays ?? []).map((date, index) => ({ id: String(index), date })),
  )
  const [ranges, setRanges] = useState<HolidayRange[]>(() =>
    (pay.holidayWindows ?? []).map((range, index) => ({
      id: String(index),
      start: dateTimeValue(range.start),
      end: dateTimeValue(range.end),
    })),
  )
  const [workDays, setWorkDays] = useState(pay.workDays)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setError('')
    try {
      const restDay = Number(data.get('restDay')),
        restStartDay = Number(data.get('restStartDay'))
      const restStart = read(data, 'restStart'),
        restEnd = read(data, 'restEnd')
      if (restStartDay === restDay && restStart >= restEnd)
        throw new Error('כאשר המנוחה מתחילה ומסתיימת באותו יום, שעת הסיום צריכה להיות מאוחרת יותר.')
      const windows = ranges.map((range) => {
        const start = isoFromLocal(range.start),
          end = isoFromLocal(range.end, true)
        if (end <= start) throw new Error('בחלון חג, מועד הסיום צריך להיות אחרי מועד ההתחלה.')
        return { start, end }
      })
      const newHolidays = [...new Set(holidays.map((row) => row.date))].sort()
      newHolidays.forEach(dateMs)
      await save(
        {
          ...pay,
          workDays,
          shortDay: Number(data.get('shortDay') ?? pay.shortDay),
          restDay,
          restStartDay,
          restStart,
          restEnd,
          nightPremiumPercent: Number(data.get('nightPremiumPercent')),
          holidayCalendar: read(data, 'holidayCalendar') as PaySettings['holidayCalendar'],
          holidayEveHours: Number(data.get('holidayEveHours')) as 7 | 8,
          holidayStart: read(data, 'holidayStart'),
          holidayEnd: read(data, 'holidayEnd'),
          holidays: newHolidays,
          holidayWindows: windows,
        },
        'time',
        'הגדרות שבוע העבודה נשמרו',
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'יש לבדוק את הגדרות השעות.')
    }
  }
  return (
    <form className="prefs-form" onSubmit={submit}>
      <div className="prefs-grid">
        <label className="prefs-field">
          שבוע העבודה במקום העבודה
          <select
            name="workDays"
            value={workDays}
            onChange={(e) => setWorkDays(Number(e.target.value) as 5 | 6)}
          >
            <option value={5}>5 ימי עבודה</option>
            <option value={6}>6 ימי עבודה</option>
          </select>
        </label>
        {workDays === 5 && <DayField title="יום עבודה מקוצר" name="shortDay" value={pay.shortDay} />}
      </div>
      <details className="prefs-details">
        <summary>מנוחה שבועית ותוספת לילה</summary>
        <div className="prefs-form">
          <div className="prefs-grid">
            <DayField
              title="יום כניסת המנוחה"
              name="restStartDay"
              value={pay.restStartDay ?? (pay.restDay + 6) % 7}
            />
            <ClockField title="שעת כניסה" name="restStart" value={pay.restStart} />
            <DayField title="יום המנוחה השבועי וסיומו" name="restDay" value={pay.restDay} />
            <ClockField title="שעת יציאה" name="restEnd" value={pay.restEnd} canEndAtMidnight />
          </div>
          <p className="prefs-hint">לסיום בחצות בסוף היום אפשר להזין 24:00. השעות הן לפי שעון ישראל.</p>
          <label className="prefs-field">
            תוספת לילה לפי הסכם (%)
            <input
              type="number"
              name="nightPremiumPercent"
              min="0"
              step=".01"
              defaultValue={pay.nightPremiumPercent ?? 0}
              required
            />
          </label>
        </div>
      </details>
      <details className="prefs-details">
        <summary>חגים וערבי חג</summary>
        <div className="prefs-form">
          <div className="prefs-grid">
            <label className="prefs-field">
              לוח חגים
              <select name="holidayCalendar" defaultValue={pay.holidayCalendar ?? 'manual'}>
                <option value="israel-jewish">חגי ישראל ויום העצמאות</option>
                <option value="manual">בחירת תאריכים ידנית</option>
              </select>
            </label>
            <label className="prefs-field">
              שעות רגילות בערב חג
              <select name="holidayEveHours" defaultValue={pay.holidayEveHours ?? 7}>
                <option value={7}>7 שעות</option>
                <option value={8}>8 שעות</option>
              </select>
            </label>
            <ClockField name="holidayStart" title="שעת כניסה בערב החג" value={pay.holidayStart ?? '18:00'} />
            <ClockField
              name="holidayEnd"
              title="שעת יציאה ביום החג"
              value={pay.holidayEnd ?? '19:00'}
              canEndAtMidnight
            />
          </div>
          <fieldset className="prefs-collection">
            <legend>תאריכי חג נוספים</legend>
            {holidays.map((row) => (
              <div className="prefs-adder-row" key={row.id}>
                <label className="prefs-field">
                  תאריך החג
                  <input
                    type="date"
                    required
                    value={row.date}
                    onChange={(e) =>
                      setHolidays(holidays.map((h) => (h.id === row.id ? { ...h, date: e.target.value } : h)))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="prefs-text"
                  onClick={() => setHolidays(holidays.filter((h) => h.id !== row.id))}
                >
                  הסרה
                </button>
              </div>
            ))}
            <button
              type="button"
              className="prefs-secondary"
              onClick={() => setHolidays([...holidays, { id: crypto.randomUUID(), date: '' }])}
            >
              + הוספת תאריך
            </button>
          </fieldset>
          <fieldset className="prefs-collection">
            <legend>זמני חג בתאריך מסוים</legend>
            <p className="prefs-hint">
              הזמנים שהוגדרו כאן מחליפים את שעות הכניסה והיציאה הקבועות של החג המסתיים בתאריך הזה.
            </p>
            {ranges.map((row) => (
              <div className="prefs-adder-row" key={row.id}>
                <label className="prefs-field">
                  כניסה
                  <input
                    dir="ltr"
                    type="datetime-local"
                    required
                    value={row.start}
                    onChange={(e) =>
                      setRanges(ranges.map((r) => (r.id === row.id ? { ...r, start: e.target.value } : r)))
                    }
                  />
                </label>
                <label className="prefs-field">
                  יציאה
                  <input
                    dir="ltr"
                    type="datetime-local"
                    required
                    value={row.end}
                    onChange={(e) =>
                      setRanges(ranges.map((r) => (r.id === row.id ? { ...r, end: e.target.value } : r)))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="prefs-text"
                  onClick={() => setRanges(ranges.filter((r) => r.id !== row.id))}
                >
                  הסרה
                </button>
              </div>
            ))}
            <button
              type="button"
              className="prefs-secondary"
              onClick={() => setRanges([...ranges, { id: crypto.randomUUID(), start: '', end: '' }])}
            >
              + הוספת זמני חג
            </button>
          </fieldset>
        </div>
      </details>
      {error && (
        <p className="prefs-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="prefs-primary" disabled={busy}>
        שמירת הגדרות העבודה
      </button>
    </form>
  )
}

function RateSettings({ pay, busy, save }: { pay: PaySettings; busy: boolean; save: SavePay }) {
  const today = localDate(Date.now())
  const rates = [...(pay.rateHistory ?? [])].sort((a, b) => a.from.localeCompare(b.from))
  const current = rates.filter((row) => row.from <= today).at(-1)?.rate ?? pay.hourlyRate
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const element = event.currentTarget
    const form = new FormData(element)
    const from = read(form, 'from'),
      rate = Number(form.get('rate'))
    if (from < today) return
    const rateHistory = [...rates.filter((row) => row.from !== from), { from, rate }].sort((a, b) =>
      a.from.localeCompare(b.from),
    )
    if (await save({ ...pay, rateHistory }, 'rate', 'התעריף נשמר')) element.reset()
  }
  return (
    <>
      <div className="prefs-rate">
        <span>שכר בסיס נוכחי לשעה</span>
        <strong>
          <bdi>{rateFormat.format(current)}</bdi>
        </strong>
      </div>
      <form className="prefs-form" onSubmit={submit}>
        <div className="prefs-grid">
          <label className="prefs-field">
            תעריף חדש לשעה (₪)
            <input type="number" name="rate" step=".01" min=".01" required placeholder="שכר הבסיס החדש" />
          </label>
          <label className="prefs-field">
            בתוקף מתאריך
            <input type="date" name="from" min={today} defaultValue={today} required />
          </label>
        </div>
        <p className="prefs-hint">
          העדכון חל על שעות העבודה מתאריך התחולה שנבחר. תאריכים מוקדמים יותר מחושבים לפי התעריף הקודם.
        </p>
        <button className="prefs-primary" disabled={busy} type="submit">
          עדכון תעריף
        </button>
      </form>
      {rates.length > 0 && (
        <details className="prefs-history">
          <summary>היסטוריית תעריפים</summary>
          <ul>
            <li>
              <span>תעריף התחלתי</span>
              <bdi>{rateFormat.format(pay.hourlyRate)}</bdi>
            </li>
            {rates.map((row) => (
              <li key={row.from}>
                <span>{formatDate(row.from)}</span>
                <bdi>{rateFormat.format(row.rate)}</bdi>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function TemplateSettings({
  templates,
  busy,
  save,
  feedback,
}: {
  templates: Template[]
  busy: boolean
  save: (template: Template) => Promise<boolean>
  feedback: ReactNode
}) {
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const values = new FormData(form)
    const title = read(values, 'title').trim()
    const start = read(values, 'start')
    const end = read(values, 'end')

    if (!title || !start || !end || start === end) {
      setError('יש להזין שם לתבנית ושעות התחלה וסיום שונות.')
      return
    }
    if (templates.some((item) => item.title === title && item.start === start && item.end === end)) {
      setError('תבנית עם השם והשעות האלה כבר קיימת.')
      return
    }

    setError('')
    if (await save({ id: crypto.randomUUID(), title, start, end })) form.reset()
  }

  return (
    <>
      {templates.length > 0 && (
        <ul className="prefs-template-list" aria-label="תבניות שמורות">
          {templates.map((template) => (
            <li key={template.id}>
              <bdi>{template.title}</bdi>
              <span>
                <TimeRange start={template.start} end={template.end} />
                {template.end < template.start && ' למחרת'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="prefs-details">
        <summary>הוספת תבנית</summary>
        <form className="prefs-form" onSubmit={submit}>
          <label className="prefs-field">
            שם התבנית
            <input name="title" maxLength={120} placeholder="למשל, משמרת לילה" required disabled={busy} />
          </label>
          <div className="prefs-grid prefs-template-times">
            <label className="prefs-field">
              שעת התחלה
              <input name="start" type="time" dir="ltr" defaultValue="08:00" required disabled={busy} />
            </label>
            <label className="prefs-field">
              שעת סיום
              <input name="end" type="time" dir="ltr" defaultValue="16:00" required disabled={busy} />
            </label>
          </div>
          <button type="submit" className="prefs-primary" disabled={busy}>
            שמירת תבנית
          </button>
          {error ? (
            <p className="prefs-error" role="alert">
              {error}
            </p>
          ) : feedback}
        </form>
      </details>
    </>
  )
}

export function Settings({
  profile,
  onSave,
  templates,
  onTemplate,
  user,
  onSalary,
  onSignIn,
  onSignOut,
}: SettingsProps) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ area: '', text: '', error: false })
  async function act(section: string, fn: () => Promise<void>, message: string) {
    setBusy(true)
    setNotice({ area: '', text: '', error: false })
    try {
      await fn()
      setNotice({ area: section, text: message, error: false })
      return true
    } catch {
      setNotice({ area: section, text: 'השינוי לא נשמר. אפשר לנסות שוב.', error: true })
      return false
    } finally {
      setBusy(false)
    }
  }
  const savePay: SavePay = (pay, area, message) => act(area, () => onSave({ ...profile, pay }), message)
  const feedback = (area: string) =>
    notice.area === area && (
      <p className={notice.error ? 'prefs-error' : 'prefs-status'} role={notice.error ? 'alert' : 'status'}>
        {notice.text}
      </p>
    )
  return (
    <div className="prefs-layout">
      <section className="prefs-card">
        <SectionHeading icon={<Banknote />}>תעריף שעתי</SectionHeading>
        <RateSettings pay={profile.pay} busy={busy} save={savePay} />
        {feedback('rate')}
      </section>
      <section className="prefs-card">
        <SectionHeading icon={<Clock3 />}>שבוע העבודה</SectionHeading>
        <TimeSettings
          key={JSON.stringify({ ...profile.pay, rateHistory: null })}
          pay={profile.pay}
          busy={busy}
          save={savePay}
        />
        {feedback('time')}
      </section>
      <section className="prefs-card">
        <SectionHeading icon={<Bookmark />}>תבניות משמרת</SectionHeading>
        <TemplateSettings
          templates={templates}
          busy={busy}
          save={(template) => act('templates', () => onTemplate(template), 'התבנית נשמרה')}
          feedback={feedback('templates')}
        />
      </section>
      <section className="prefs-card">
        <SectionHeading icon={<Palette />}>מראה</SectionHeading>
        <div className="prefs-themes" role="group" aria-label="ערכת נושא">
          {themes.map(({ key, label, Icon }) => (
            <button
              key={key}
              aria-pressed={key === profile.theme}
              className="prefs-theme"
              disabled={busy}
              type="button"
              onClick={() => void act('theme', () => onSave({ ...profile, theme: key }), 'המראה עודכן')}
            >
              <span className={'prefs-theme-preview theme-preview-' + key} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>
                <Icon size={15} aria-hidden="true" /> {label}
              </span>
            </button>
          ))}
        </div>
        {feedback('theme')}
      </section>
      <section className="prefs-card">
        <SectionHeading icon={<UserRound />}>החשבון שלי</SectionHeading>
        {user ? (
          <>
            <p dir="auto" className="prefs-identity">
              {user.email || user.displayName || 'חשבון מחובר'}
            </p>
            <button
              type="button"
              className="prefs-secondary"
              disabled={busy}
              onClick={() => void act('account', onSignOut, 'יצאת מהחשבון')}
            >
              <LogOut /> יציאה מהחשבון
            </button>
          </>
        ) : (
          <>
            <p className="prefs-hint">הנתונים במצב המקומי נשמרים בדפדפן הזה.</p>
            <button type="button" className="prefs-secondary" onClick={onSignIn}>
              <LogIn /> כניסה לחשבון
            </button>
          </>
        )}
        {feedback('account')}
        <button type="button" className="prefs-route" onClick={onSalary}>
          <span>דוח שכר, נתוני פנסיה ונקודות זיכוי</span>
          <ChevronLeft aria-hidden="true" />
        </button>
      </section>
      <div className="prefs-card prefs-apple">
        <CalendarDays className="prefs-calendar-icon" aria-hidden="true" />
        <AppleCalendar user={user} />
      </div>
    </div>
  )
}
