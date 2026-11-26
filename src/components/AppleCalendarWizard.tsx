import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { ArrowLeft, CalendarDays, CarFront, Check, ChevronDown, ExternalLink, KeyRound, Plus } from 'lucide-react'
import { appleRequest } from '../lib/appleCalendarApi'
import { Dialog } from './Dialog'

type CalendarChoice = { id: string; name: string; color?: string }
type Discovery = { calendars: CalendarChoice[]; setupToken: string }
export type CalendarSelection = { calendarName: string; dedicated: boolean; travelMinutes: number }
const dedicated = { id: 'dedicated', name: 'המשמרות שלי', color: 'var(--green)' }
const samples = [
  { id: 'work', name: 'עבודה', color: '#4775b3' },
  { id: 'family', name: 'משפחה', color: '#ba6d42' },
]
const steps = ['חשבון Apple', 'בחירת לוח', 'זמן נסיעה']
const presets = [0, 15, 30, 45, 60]
export const travelLabel = (minutes: number) => minutes ? minutes + ' דקות' : 'ללא'
export function appleError(reason: unknown) {
  return reason instanceof Error && /[א-ת]/.test(reason.message)
    ? reason.message
    : 'החיבור לשירות היומן לא הושלם. אפשר לנסות שוב.'
}

export function PasswordGuide() {
  return (
    <details className="apple-guide">
      <summary><KeyRound size={17} /> איך מקבלים סיסמה מ־Apple? <ChevronDown size={16} /></summary>
      <ol>
        <li>פתחו את <a href="https://account.apple.com/" target="_blank" rel="noreferrer">חשבון Apple שלי <ExternalLink size={12} /></a> בכרטיסייה חדשה והתחברו לחשבון שבו נמצא היומן.</li>
        <li>תחת <strong>כניסה ואבטחה</strong> בחרו <strong>סיסמאות ספציפיות ליישום</strong> <bdi>(App-Specific Passwords)</bdi>. נדרש אימות בשני גורמים בחשבון.</li>
        <li>לחצו על <strong>יצירת סיסמה</strong> או על <bdi>+</bdi>, קראו לה <strong>שועון</strong> ואשרו.</li>
        <li>העתיקו את הסיסמה שנוצרה. חזרו לכאן, הזינו את כתובת הדוא״ל הראשית של חשבון Apple, הדביקו את הסיסמה ולחצו על <strong>הצגת לוחות השנה שלי</strong>.</li>
      </ol>
      <p>שינוי או איפוס סיסמת החשבון מבטל סיסמאות ייעודיות קודמות. במקרה כזה יוצרים סיסמה חדשה עבור שועון. <a href="https://support.apple.com/he-il/102654" target="_blank" rel="noreferrer">עזרה מ־Apple <ExternalLink size={12} /></a></p>
    </details>
  )
}

export function TravelField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [custom, setCustom] = useState(!presets.includes(value))
  const valid = Number.isInteger(value) && value >= 0 && value <= 1439
  const departure = new Date(Date.UTC(2020, 0, 2, 8) - (valid ? value : 0) * 60_000)
  return (
    <>
      <fieldset className="apple-travel">
        <legend>משך הנסיעה לעבודה</legend>
        <div className="apple-chips">
          {presets.map((minutes) => <label key={minutes}>
            <input type="radio" name="apple-travel" checked={!custom && value === minutes}
              onChange={() => { setCustom(false); onChange(minutes) }} />
            {minutes ? minutes + ' דק׳' : 'ללא'}
          </label>)}
          <label><input type="radio" name="apple-travel" checked={custom}
            onChange={() => { setCustom(true); onChange(value || 10) }} />מותאם אישית</label>
        </div>
        {custom && <label className="apple-custom">משך בדקות
          <input type="number" dir="ltr" min={1} max={1439} step={1} required
            value={Number.isFinite(value) ? value : ''} onChange={e => onChange(e.target.valueAsNumber)} />
        </label>}
      </fieldset>
      <div className="apple-preview">
        <CarFront size={22} aria-hidden="true" />
        <div><small>תצוגה מקדימה · משמרת בוקר</small>
          <strong>{valid && value > 0 && <><bdi>{departure.toISOString().slice(11, 16)}</bdi> יציאה{value > 480 && ' ביום הקודם'} · </>}<bdi>08:00</bdi> תחילת משמרת</strong>
        </div>
      </div>
    </>
  )
}

export function AppleCalendarWizard({ user, onClose, onActivated }: {
  user: User | null
  onClose: () => void
  onActivated: (selection: CalendarSelection) => void
}) {
  const [step, setStep] = useState(0)
  const [discovery, setDiscovery] = useState<Discovery>()
  const [calendarId, setCalendarId] = useState('dedicated')
  const [travelMinutes, setTravelMinutes] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const title = useRef<HTMLHeadingElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const choices = [dedicated, ...(discovery?.calendars ?? [])]
  const selected = choices.find(c => c.id === calendarId) ?? dedicated
  useEffect(() => { title.current?.focus() }, [step])

  async function next(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setError('')
    if (step === 1) { setStep(2); return }
    setBusy(true)
    try {
      if (step === 0) {
        const values = new FormData(e.currentTarget)
        const result = user
          ? await appleRequest<Discovery>(user, 'discoverAppleCalendars', {
              email: String(values.get('email') ?? '').trim(),
              password: String(values.get('password') ?? '').trim(),
            })
          : { calendars: samples, setupToken: '' }
        setDiscovery(result)
        setCalendarId('dedicated')
        setStep(1)
      } else {
        if (user) await appleRequest(user, 'connectAppleCalendar', { setupToken: discovery?.setupToken, calendarId, travelMinutes })
        onActivated({ calendarName: selected.name, dedicated: calendarId === 'dedicated', travelMinutes })
      }
    } catch (reason) {
      setError(appleError(reason))
      if (step === 0 && form.current) {
        const guide = form.current.querySelector('details')
        if (guide) guide.open = true
      }
    } finally { setBusy(false) }
  }
  return (
    <Dialog title={user ? 'חיבור ל־iCloud' : 'חיבור ל־iCloud · הדגמה'} onClose={onClose} closeDisabled={busy} className="apple-dialog">
      <ol className="apple-steps" aria-label="שלבי החיבור">
        {steps.map((name, i) => <li key={name} aria-current={i === step ? 'step' : undefined} data-done={i < step}>
          <span>{i < step ? <Check size={13} /> : i + 1}</span>{name}
        </li>)}
      </ol>
      <form ref={form} onSubmit={next}>
        <h3 ref={title} tabIndex={-1}>{['חיבור חשבון Apple', 'לאיזה לוח להוסיף את המשמרות?', 'כמה זמן לוקחת הנסיעה?'][step]}</h3>
        {step === 0 && <>
          <PasswordGuide />
          {user ? <>
            <label>כתובת הדוא״ל של חשבון Apple<input name="email" type="email" dir="ltr" autoComplete="username" placeholder="name@example.com" required maxLength={254} /></label>
            <label>הסיסמה שיצרתם עבור שועון<input name="password" type="password" dir="ltr" autoComplete="off" required
              placeholder="xxxx-xxxx-xxxx-xxxx" pattern="[a-zA-Z]{4}(-[a-zA-Z]{4}){3}" aria-describedby="apple-password-note" /></label>
            <p id="apple-password-note">קוד האימות בן שש הספרות מיועד לכניסה באתר Apple. כאן מדביקים את הסיסמה הייעודית. הסיסמה נשמרת מוצפנת לצורך הסנכרון ונמחקת בניתוק.</p>
          </> : <p>כאן אפשר לנסות את החיבור עם לוחות לדוגמה. לחיבור היומן האישי נכנסים קודם לחשבון בשועון.</p>}
        </>}
        {step === 1 && <>
          <fieldset className="apple-choices" aria-label="לוח השנה למשמרות">
            {choices.map(c => <label key={c.id}>
              <input type="radio" name="apple-calendar" checked={calendarId === c.id} onChange={() => setCalendarId(c.id)} />
              <span className="apple-choice-icon" style={{ color: c.color || 'var(--green)' }}>{c.id === 'dedicated' ? <Plus size={19} /> : <CalendarDays size={19} />}</span>
              <span>{c.id === 'dedicated' ? 'יצירת לוח ״המשמרות שלי״' : c.name}</span>
              {calendarId === c.id && <Check size={17} />}
            </label>)}
          </fieldset>
          <p>{calendarId === 'dedicated' ? 'בלוח הייעודי אפשר גם להוסיף אירוע ישירות ביומן Apple והוא יופיע בשועון כמשמרת.' : 'רק משמרות ששועון יוסיף ללוח הזה יסונכרנו. שאר האירועים בלוח יישארו פרטיים.'}</p>
        </>}
        {step === 2 && <>
          <p>זמן הנסיעה יופיע באירוע ביומן ״{selected.name}״. שעות המשמרת וחישוב השכר יישארו כפי שהוגדרו.</p>
          <TravelField value={travelMinutes} onChange={setTravelMinutes} />
        </>}
        {error && <p className="apple-error" role="alert">{error}</p>}
        {step === 2 && error && <button type="button" onClick={() => { setError(''); setDiscovery(undefined); setStep(0) }}>חזרה לחיבור החשבון</button>}
        {busy && <p role="status">מתחבר לשירות היומן…</p>}
        <div className="apple-actions">
          <button className="apple-primary" disabled={busy} type="submit">
            {step === 0 ? (user ? 'הצגת לוחות השנה שלי' : 'הצגת לוחות לדוגמה') : step === 1 ? 'המשך לזמן נסיעה' : (user ? 'הפעלת הסנכרון' : 'הפעלת סנכרון לדוגמה')}
            {step === 2 ? <Check size={16} /> : <ArrowLeft size={16} />}
          </button>
          {step > 0 && <button type="button" disabled={busy} onClick={() => { setError(''); setStep(step - 1) }}>חזרה</button>}
        </div>
      </form>
    </Dialog>
  )
}
