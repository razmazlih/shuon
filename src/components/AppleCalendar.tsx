import { useEffect, useState, type FormEvent } from 'react'
import { getApp } from 'firebase/app'
import type { User } from 'firebase/auth'
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions'
import { TimeRange } from './TimeRange'

type EventTimes = { title: string; start: string; end: string }
type Review = {
  id: string
  left: EventTimes | null
  right: EventTimes | null
  status: string | null
  invalidBreaks: boolean
  overlap: boolean
  revision: string | null
}
type Status = {
  connected: boolean
  lastSync?: string
  error?: string
  unsupported?: number
  reviews: Review[]
}
const emulated = new WeakSet<Functions>()
const formatted = new Intl.DateTimeFormat('he-IL', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Jerusalem',
})

function callable(name: string, data?: unknown) {
  const functions = getFunctions(getApp(), 'europe-west1')
  if (import.meta.env.VITE_FIREBASE_EMULATORS === 'true' && !emulated.has(functions)) {
    connectFunctionsEmulator(functions, '127.0.0.1', 5001)
    emulated.add(functions)
  }
  return httpsCallable(functions, name, { timeout: 300_000 })(data)
}
function errorMessage(error: unknown) {
  if (error instanceof Error && /[א-ת]/.test(error.message)) return error.message
  return 'שירות היומן אינו זמין כרגע. אפשר לנסות שוב לאחר בדיקת החיבור.'
}
function eventSummary(event: EventTimes | null) {
  return event ? (
    <>
      {event.title} ·{' '}
      <TimeRange start={formatted.format(new Date(event.start))} end={formatted.format(new Date(event.end))} />
    </>
  ) : (
    'המשמרת נמחקה'
  )
}
function AccountCalendar() {
  const [status, setStatus] = useState<Status>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    callable('getAppleCalendarStatus')
      .then((result) => {
        if (current) setStatus(result.data as Status)
      })
      .catch((reason) => {
        if (current) setError(errorMessage(reason))
      })
      .finally(() => {
        if (current) setBusy(false)
      })
    return () => {
      current = false
    }
  }, [])

  async function act(name: string, data?: unknown) {
    setBusy(true)
    setError('')
    try {
      if (name !== 'getAppleCalendarStatus') await callable(name, data)
      if (name === 'connectAppleCalendar' || name === 'resolveAppleCalendar')
        await callable('syncAppleCalendar')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      try {
        setStatus((await callable('getAppleCalendarStatus')).data as Status)
      } catch (reason) {
        setError((previous) => previous || errorMessage(reason))
      }
      setBusy(false)
    }
  }
  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const data = { email: values.get('email'), password: values.get('app-password') }
    const password = form.elements.namedItem('app-password')
    if (password instanceof HTMLInputElement) password.value = ''
    void act('connectAppleCalendar', data)
  }
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {!status &&
        (busy ? (
          <p role="status">בודק את החיבור ליומן…</p>
        ) : (
          <button type="button" onClick={() => void act('getAppleCalendarStatus')}>
            בדיקה חוזרת
          </button>
        ))}
      {status && (
        <>
          {status.error && status.error !== error && <p role="status">{status.error}</p>}
          {status.connected ? (
            <>
              <p>היומן ״המשמרות שלי״ מחובר. הסנכרון פועל בשני הכיוונים מדי 15 דקות.</p>
              {status.lastSync && (
                <p>
                  סנכרון אחרון ב־<bdi>{formatted.format(new Date(status.lastSync))}</bdi>
                </p>
              )}
              {Boolean(status.unsupported) && (
                <p>
                  {status.unsupported} אירועים לא סונכרנו. היומן תומך במשמרות חד־פעמיות עם שעות התחלה וסיום.
                </p>
              )}
              <div className="calendar-actions">
                <button type="button" disabled={busy} onClick={() => void act('syncAppleCalendar')}>
                  סנכרון עכשיו
                </button>
                <button type="button" disabled={busy} onClick={() => void act('disconnectAppleCalendar')}>
                  ניתוק החיבור
                </button>
              </div>
              {status.reviews.length > 0 && (
                <div className="calendar-reviews">
                  <h3>שינויים הממתינים לאישור</h3>
                  {status.reviews.map((review) => (
                    <fieldset key={review.id} disabled={busy}>
                      <legend>
                        {review.status === 'completed' ? 'שינוי במשמרת שהושלמה' : 'שינויים בשני הצדדים'}
                      </legend>
                      <p>במערכת · {eventSummary(review.left)}</p>
                      <p>ביומן Apple · {eventSummary(review.right)}</p>
                      {review.overlap && <p>שעות היומן חופפות למשמרת אחרת. יש לעדכן את השעות ולסנכרן שוב.</p>}
                      {review.invalidBreaks && (
                        <p>השעות ביומן אינן כוללות את כל ההפסקות. יש לעדכן אותן לפני האישור.</p>
                      )}
                      <div className="calendar-actions">
                        <button
                          type="button"
                          onClick={() => void act('resolveAppleCalendar', { ...review, choice: 'local' })}
                        >
                          שמירת הגרסה שבמערכת
                        </button>
                        <button
                          type="button"
                          disabled={review.invalidBreaks || review.overlap}
                          onClick={() => void act('resolveAppleCalendar', { ...review, choice: 'remote' })}
                        >
                          אישור הגרסה שביומן
                        </button>
                      </div>
                    </fieldset>
                  ))}
                </div>
              )}
            </>
          ) : (
            <form className="calendar-form" onSubmit={connect}>
              <p>
                החיבור ייצור ב־iCloud יומן בשם ״המשמרות שלי״. כותרת המשמרת ושעותיה יתעדכנו בשני הכיוונים.
                אירוע חדש ביומן יתווסף כמשמרת, ומצבה ייקבע לפי שעת הסיום.
              </p>
              <label>
                כתובת Apple Account
                <input name="email" type="email" dir="ltr" autoComplete="username" required maxLength={254} />
              </label>
              <label>
                סיסמה ייעודית לאפליקציה
                <input
                  name="app-password"
                  type="password"
                  dir="ltr"
                  autoComplete="off"
                  required
                  placeholder="xxxx-xxxx-xxxx-xxxx"
                  pattern="[A-Za-z]{4}(-[A-Za-z]{4}){3}"
                />
              </label>
              <p>
                הסיסמה הייעודית נשמרת מוצפנת לצורך הסנכרון ונמחקת בעת הניתוק.{' '}
                <a href="https://support.apple.com/he-il/102654" target="_blank" rel="noreferrer">
                  יצירת סיסמה ייעודית ב־Apple
                </a>
              </p>
              <button type="submit" disabled={busy}>
                חיבור ליומן Apple
              </button>
            </form>
          )}
          {busy && <p role="status">מעדכן את החיבור…</p>}
        </>
      )}
    </>
  )
}
export default function AppleCalendar({ user }: { user: User | null }) {
  const enabled =
    import.meta.env.VITE_ICLOUD_SYNC_ENABLED === 'true' || import.meta.env.VITE_FIREBASE_EMULATORS === 'true'
  return (
    <section className="apple-calendar" aria-label="יומן Apple" dir="rtl">
      <h2>יומן Apple</h2>
      {!enabled ? (
        <p>סנכרון אוטומטי עם iCloud אינו פעיל בגרסה החינמית המתארחת כאן. המשמרות שלך זמינות ביומן שבאתר.</p>
      ) : user ? (
        <AccountCalendar key={user.uid} />
      ) : (
        <p>סנכרון עם iCloud זמין לאחר כניסה לחשבון ענן. במצב המקומי הנתונים נשמרים במכשיר.</p>
      )}
    </section>
  )
}
