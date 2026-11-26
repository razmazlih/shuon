import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { CalendarDays, Check, Cloud, Settings2 } from 'lucide-react'
import { appleApiConfigured, appleRequest } from '../lib/appleCalendarApi'
import { AppleCalendarWizard, PasswordGuide, TravelField, appleError, travelLabel, type CalendarSelection } from './AppleCalendarWizard'
import { Dialog } from './Dialog'
import { TimeRange } from './TimeRange'
import './apple-calendar.css'

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
  calendarName?: string
  travelMinutes?: number
  dedicated?: boolean
  connected: boolean
  lastSync?: string
  error?: string
  unsupported?: number
  reviews: Review[]
}
const formatted = new Intl.DateTimeFormat('he-IL', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Jerusalem',
})

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

const demoKey = 'shuon.demo.apple-calendar.v1'
const disconnected: Status = { connected: false, reviews: [] }
function readDemo(): Status {
  try {
    const value = JSON.parse(localStorage.getItem(demoKey) ?? 'null') as Status | null
    if (value?.connected && typeof value.calendarName === 'string' && Number.isInteger(value.travelMinutes)) {
      return { ...disconnected, calendarName: value.calendarName, connected: true, dedicated: value.dedicated,
        travelMinutes: value.travelMinutes, lastSync: value.lastSync }
    }
  } catch { /* Storage can be unavailable in private browsing. */ }
  return disconnected
}

export default function AppleCalendar({ user, onSignIn }: { user: User | null; onSignIn: () => void }) {
  const demo = !user && /^\/demo\/?$/.test(location.pathname)
  const available = demo || Boolean(user && appleApiConfigured)
  const [status, setStatus] = useState<Status | undefined>(() => demo ? readDemo() : undefined)
  const [panel, setPanel] = useState<'wizard' | 'travel' | null>(null)
  const [minutes, setMinutes] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    if (user) setStatus(await appleRequest<Status>(user, 'getAppleCalendarStatus'))
  }, [user])
  useEffect(() => {
    if (!user || !available) return
    let current = true
    let sequence = 0
    const refreshMounted = () => {
      const request = ++sequence
      void appleRequest<Status>(user, 'getAppleCalendarStatus').then(value => {
        if (current && request === sequence) { setStatus(value); setError('') }
      }).catch(reason => { if (current && request === sequence) setError(appleError(reason)) })
    }
    const onSync = (event: Event) => {
      if ((event as CustomEvent<{uid?: string}>).detail?.uid === user.uid) refreshMounted()
    }
    refreshMounted()
    window.addEventListener('shuon-apple-sync-complete', onSync)
    return () => { current = false; window.removeEventListener('shuon-apple-sync-complete', onSync) }
  }, [user, available])

  function updateDemo(value: Status) {
    setStatus(value)
    try { localStorage.setItem(demoKey, JSON.stringify(value)) } catch { /* Keep the in-memory demo usable. */ }
  }
  async function act(name: string, data?: unknown) {
    if (busy) return
    setError('')
    setBusy('מעדכן את היומן…')
    try {
      if (user) {
        await appleRequest(user, name, data)
        if (name === 'resolveAppleCalendar' || name === 'updateAppleCalendarPreferences') {
          await appleRequest(user, 'syncAppleCalendar')
        }
      } else if (demo) {
        if (name === 'disconnectAppleCalendar') updateDemo(disconnected)
        else if (status) updateDemo({ ...status, travelMinutes: name === 'updateAppleCalendarPreferences' ? minutes : status.travelMinutes,
          lastSync: new Date().toISOString() })
      }
      setPanel(null)
    } catch (reason) { setError(appleError(reason)) }
    finally {
      try { await refresh() } catch (reason) { setError(previous => previous || appleError(reason)) }
      setBusy('')
    }
  }

  function activate(selection: CalendarSelection) {
    setPanel(null)
    const value = { ...selection, reviews: [], connected: true }
    if (demo) updateDemo({ ...value, lastSync: new Date().toISOString() })
    else {
      setStatus(value)
      void act('syncAppleCalendar')
    }
  }
  return (
    <section className="apple-calendar" aria-label="יומן Apple" dir="rtl">
      <h2>יומן Apple</h2>
      {!available ? <>
        <p>{user ? 'שירות החיבור ל־iCloud טרם הוגדר באתר הזה.' : 'היכנסו לשועון כדי לחבר את יומן Apple שלכם.'}</p>
        <PasswordGuide />
      </> : !status ? <>
        {!error && <p role="status">מתחבר לשירות היומן…</p>}
        {error && <button type="button" onClick={() => { setError(''); void refresh().catch(reason => setError(appleError(reason))) }}>בדיקה חוזרת</button>}
      </> : status.connected ? <>
        <div className="apple-connected">
          <span className="apple-connected-icon"><Check size={20} /></span>
          <div><strong>{status.calendarName || 'המשמרות שלי'}</strong>
            <small>{demo ? 'חיבור לדוגמה בדפדפן הזה' : 'מחובר ל־iCloud'}</small></div>
        </div>
        <dl className="apple-info">
          <div><dt>זמן נסיעה</dt><dd>{travelLabel(status.travelMinutes ?? 0)}</dd></div>
          <div><dt>סנכרון אחרון</dt><dd>{status.lastSync ? <bdi>{formatted.format(new Date(status.lastSync))}</bdi> : 'ממתין לסנכרון ראשון'}</dd></div>
        </dl>
        <p>{demo ? 'ההדגמה משתמשת בלוחות לדוגמה. לחיבור יומן אישי נכנסים לחשבון בשועון.' : 'המשמרות מתעדכנות בשמירה ובפתיחת האתר. השירות בודק שינויים גם ברקע מדי 15 דקות, בכפוף לזמינות השירות ולמכסה החינמית.'}</p>
        {Boolean(status.unsupported) && <p>{status.unsupported} אירועים דולגו. נתמכות משמרות חד־פעמיות עם שעות התחלה וסיום.</p>}
        <div className="apple-actions">
          <button type="button" disabled={Boolean(busy)} onClick={() => void act('syncAppleCalendar')}><Cloud size={16}/>סנכרון עכשיו</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => { setMinutes(status.travelMinutes ?? 0); setError(''); setPanel('travel') }}><Settings2 size={16}/>עריכת זמן נסיעה</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => void act('disconnectAppleCalendar')}>ניתוק החיבור</button>
        </div>
        {status.reviews.length > 0 && (
          <div className="calendar-reviews">
            <h3>שינויים הממתינים לאישור</h3>
            {status.reviews.map((review) => (
              <fieldset key={review.id} disabled={Boolean(busy)}>
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
      </> : <>
        <p>הוסיפו משמרות ליומן שלכם ב־iCloud ובחרו לאיזה לוח לשייך אותן וכמה זמן להקצות לנסיעה.</p>
        <div className="apple-actions">
          <button className="apple-primary" type="button" onClick={() => { setError(''); setPanel('wizard') }}><CalendarDays size={17}/>חיבור ל־iCloud</button>
          {demo && <button type="button" onClick={onSignIn}>כניסה לחיבור יומן אישי</button>}
        </div>
        {demo && <p className="apple-note">בדמו מתנסים עם לוחות לדוגמה.</p>}
      </>}
      {(error || status?.error) && panel !== 'travel' && <p role="alert" className="apple-error">{error || status?.error}</p>}
      {busy && <p role="status">{busy}</p>}
      {panel === 'wizard' && <AppleCalendarWizard user={user} onClose={() => setPanel(null)} onActivated={activate} />}
      {panel === 'travel' && <Dialog title="עריכת זמן נסיעה" className="apple-dialog" closeDisabled={Boolean(busy)} onClose={() => setPanel(null)}>
        <form onSubmit={e => { e.preventDefault(); void act('updateAppleCalendarPreferences', { travelMinutes: minutes }) }}>
          <p>משך הנסיעה יתעדכן באירועים של משמרות עתידיות.</p>
          <TravelField value={minutes} onChange={setMinutes} />
          {error && <p className="apple-error" role="alert">{error}</p>}
          <div className="apple-actions"><button className="apple-primary" type="submit" disabled={Boolean(busy)}>{busy || 'שמירת זמן נסיעה'}</button></div>
        </form>
      </Dialog>}
    </section>
  )
}
