import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import {
  ArrowLeft,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Clock3,
  FilePenLine,
  House,
  LogIn,
  Plus,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useAppleCalendarSync } from './lib/useAppleCalendarSync'
import { auth, login, logout } from './data/firebase'
import type { ManualShiftWrites } from './data/manual-shifts'
import {
  dateLabel,
  defaultPay,
  formatMoney,
  hourCount,
  shiftStatusAt,
  type WorkShift,
  type Workspace,
} from './data/model'
import { subscribeWorkspace, writeQuestionnaire, writeSetting, writeShifts } from './data/repository'
import { calculateShiftPay } from './data/shift-pay'
import { calculateGross, type BandKind, type ShiftPay } from './domain/gross'
import { addDays, addMonths, localDate, localTime, localToInstant } from './domain/time'
import { estimateSalary, salaryReport } from './domain/net'
import { Dashboard } from './components/Dashboard'
import { SleepingFox } from './components/SleepingFox'
import { SalaryMonthPicker } from './components/SalaryMonthPicker'
import { TimeRange } from './components/TimeRange'
import { ShiftGross } from './components/ShiftGross'
import { ShiftEditor } from './components/ShiftEditor'
import { Calendar } from './components/Calendar'
import { Onboarding, Settings } from './components/Settings'
import { Salary } from './components/Salary'
import { Dialog } from './components/Dialog'
import { Landing } from './components/Landing'

type Page = 'today' | 'calendar' | 'salary' | 'settings'
type Editor = { date: string; initial?: WorkShift; transitionFrom?: DOMRect }
const emptyShiftPay: ReadonlyMap<string, ShiftPay> = new Map()
const nav = [
  { id: 'today', label: 'היום', icon: House },
  { id: 'calendar', label: 'יומן', icon: CalendarDays },
  { id: 'salary', label: 'שכר', icon: ChartNoAxesColumnIncreasing },
] as const
const fromHash = (): Page => {
  const value = location.hash.slice(1)
  return ['today', 'calendar', 'salary', 'settings'].includes(value) ? (value as Page) : 'today'
}
const bandNames: Record<BandKind, string> = {
  regular: 'שעות רגילות',
  overtime125: 'שעות נוספות · 125%',
  overtime150: 'שעות נוספות · 150%',
  rest150: 'מנוחה או חג · 150%',
  rest175: 'מנוחה ושעות נוספות · 175%',
  rest200: 'מנוחה ושעות נוספות · 200%',
}
function errText(e: unknown) {
  const code = (e as { code?: string })?.code
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request')
    return 'חלון הכניסה נסגר. אפשר להתחבר שוב בכל זמן.'
  if (code === 'auth/popup-blocked') return 'הדפדפן חסם את חלון Google. יש לאפשר חלונות קופצים ולהתחבר שוב.'
  if (code === 'auth/unauthorized-domain')
    return 'הכתובת הנוכחית אינה מורשית לכניסה. אפשר להתחבר באתר shuon-shifts-il.web.app.'
  if (code === 'permission-denied') return 'אין הרשאה לנתונים. יש להתחבר מחדש.'
  if (code === 'unavailable' || code === 'auth/network-request-failed')
    return 'החיבור לשרת נכשל. יש לבדוק את החיבור לאינטרנט ולנסות שוב.'
  return e instanceof Error && /[א-ת]/.test(e.message) ? e.message : 'הפעולה לא הושלמה. אפשר לנסות שוב.'
}
function scheduledShiftAt(shifts: WorkShift[], now: number) {
  return shifts.find((shift) => shiftStatusAt(shift, now) === 'planned' && Date.parse(shift.start) <= now)
}
const isDemoPath = () => /^\/demo\/?$/.test(location.pathname)

export default function App() {
  const [identity, setIdentity] = useState<{ user: User | null } | null>(null)
  useEffect(() => {
    let wasSignedIn = false
    return onAuthStateChanged(auth, (user) => {
      if ((user && isDemoPath()) || (!user && wasSignedIn)) {
        history.replaceState(history.state, '', '/')
      }
      wasSignedIn = user !== null
      setIdentity({ user })
    })
  }, [])

  if (!identity) return <Loading />
  if (identity.user || isDemoPath()) {
    return <WorkspaceApp key={identity.user?.uid ?? 'demo'} user={identity.user} />
  }
  return <Landing describeError={errText} />
}
function Loading() {
  return (
    <div className="loading" role="status">
      <img src="/fox.svg" alt="" />
      טוען את שועון…
    </div>
  )
}
function WorkspaceApp({ user }: { user: User | null }) {
  useAppleCalendarSync(user)
  const uid = user?.uid
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [page, setPage] = useState<Page>(fromHash)
  const [statusTime, setStatusTime] = useState(Date.now)
  const today = localDate(statusTime)
  const [day, setDay] = useState(today)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [editor, setEditor] = useState<Editor | null>(null)
  const [detail, setDetail] = useState<{ id: string; justFinished?: boolean } | null>(null)
  const [foxReaction, setFoxReaction] = useState<'start' | 'stop' | null>(null)
  useEffect(() => {
    if (!foxReaction) return
    const timeout = window.setTimeout(() => setFoxReaction(null), 1200)
    return () => window.clearTimeout(timeout)
  }, [foxReaction])
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)
  const locked = useRef(false)
  useEffect(() => {
    setLoadError('')
    return subscribeWorkspace(uid, setWorkspace, (e) => setLoadError(errText(e)))
  }, [uid, retry])
  useEffect(() => {
    const sync = () => {
      setPage(fromHash())
      setDetail(null)
      setEditor(null)
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  useEffect(() => {
    const refreshTime = () => setStatusTime(Date.now())
    const resume = () => {
      if (document.visibilityState === 'visible') refreshTime()
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', refreshTime)
    return () => {
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', refreshTime)
    }
  }, [])
  useEffect(() => {
    if (!message) return
    const i = setTimeout(() => setMessage(''), 7000)
    return () => clearTimeout(i)
  }, [message])
  const theme = workspace?.profile.theme || 'light'
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => {
      media.removeEventListener('change', apply)
      delete document.documentElement.dataset.theme
    }
  }, [theme])
  useLayoutEffect(() => {
    window.scrollTo({ top: 0 })
  }, [page])
  const navigate = (next: Page) => {
    location.hash = next
    setPage(next)
    setDetail(null)
    setEditor(null)
  }
  const goCalendar = (date: string) => {
    setDay(date)
    navigate('calendar')
  }
  const workingMonth = page === 'salary' ? month : today.slice(0, 7)
  const storedShifts = workspace?.shifts
  useEffect(() => {
    let nextUpdate = Date.parse(localToInstant(addDays(today, 1), '00:00'))
    for (const shift of storedShifts || []) {
      if (shift.status === 'active') continue
      const start = Date.parse(shift.start)
      const end = Date.parse(shift.end)
      if (start > statusTime) nextUpdate = Math.min(nextUpdate, start)
      if (end > statusTime) nextUpdate = Math.min(nextUpdate, end)
    }
    const timer = window.setTimeout(() => setStatusTime(Date.now()), Math.max(0, nextUpdate - Date.now()))
    return () => window.clearTimeout(timer)
  }, [storedShifts, statusTime, today])
  const shifts = useMemo(
    () =>
      (storedShifts || []).map((shift) => {
        const status = shiftStatusAt(shift, statusTime)
        return shift.status === status ? shift : { ...shift, status }
      }),
    [storedShifts, statusTime],
  )
  const pay = workspace?.profile.pay
  const showShiftPay = page === 'today' || page === 'calendar'
  const showWage = workspace !== null && (page === 'today' || page === 'salary')
  const readShiftPay = useMemo(() => {
    let result: ReadonlyMap<string, ShiftPay> | undefined
    return () => result ??= pay ? calculateShiftPay(shifts, pay) : emptyShiftPay
  }, [shifts, pay])
  const shiftPayById = showShiftPay ? readShiftPay() : emptyShiftPay
  const payroll = workspace?.payroll
  const adjustments = workspace?.adjustments
  const previousMonth = addMonths(today, -1).slice(0, 7)
  const readPreviousGross = useMemo(() => {
    let result: number | null | undefined
    return () => {
      if (result !== undefined) return result
      if (!pay || !payroll || !adjustments) return null
      try {
        const completed = shifts.filter((shift) => shift.status === 'completed')
        const earnings = calculateGross(completed, pay, previousMonth)
        result = estimateSalary(previousMonth, earnings, payroll, adjustments.filter((item) => !item.planned))
          .cashGross
      } catch {
        result = null
      }
      return result
    }
  }, [pay, payroll, adjustments, shifts, previousMonth])
  const previousGross = page === 'today' ? readPreviousGross() : null
  const readWage = useMemo(() => {
    function calculate() {
      const settings = pay ?? defaultPay
      const rows = shifts.filter((s) => s.status !== 'active')
      const completed = rows.filter((s) => s.status === 'completed')
      try {
        const actual = calculateGross(completed, settings, workingMonth)
        const combined = completed.length === rows.length ? actual : calculateGross(rows, settings, workingMonth)
        return {
          actual,
          combined,
          issue: null,
          planned: {
            gross: combined.gross - actual.gross,
            pensionable: combined.pensionable - actual.pensionable,
          },
        }
      } catch (e) {
        return { issue: errText(e) }
      }
    }
    let result: ReturnType<typeof calculate> | undefined
    return () => result ??= calculate()
  }, [shifts, pay, workingMonth])
  const wage = showWage ? readWage() : null
  const dashboardPay = useMemo(() => {
    if (page !== 'today' || !wage?.actual || !payroll || !adjustments) return null
    const totals = salaryReport(workingMonth, wage.actual, wage.planned, payroll, adjustments)
    const plannedIds = new Set(shifts.filter((s) => s.status === 'planned').map((s) => s.id))
    return {
      currentNet: totals.actual.net,
      forecastNet: totals.forecast.net,
      workedHours: wage.actual.hours,
      overtimeHours: wage.actual.overtimeHours,
      plannedCount: wage.combined.shifts.filter((s) => plannedIds.has(s.id)).length,
    }
  }, [page, wage, payroll, adjustments, workingMonth, shifts])
  const showDetail = useCallback((s: WorkShift) => {
    setDetail({ id: s.id })
  }, [])
  const run = async (task: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true
    setWorking(true)
    try {
      await task()
    } catch (e) {
      setMessage(errText(e))
    } finally {
      locked.current = false
      setWorking(false)
    }
  }
  const signIn = () => void run(login)
  if (loadError)
    return (
      <div className="loading">
        <img src="/fox.svg" alt="" />
        <p role="alert">{loadError}</p>
        <button className="btn primary" onClick={() => setRetry((n) => n + 1)}>
          לנסות שוב
        </button>
        {user && (
          <button className="text-button" onClick={() => void logout()}>
            יציאה מהחשבון
          </button>
        )}
      </div>
    )
  if (!workspace) return <Loading />
  const w = workspace
  const active = w.shifts.find((s) => s.status === 'active')
  const openPay = () => {
    setMonth(today.slice(0, 7))
    navigate('salary')
  }
  const setting = <K extends Exclude<keyof Workspace, 'shifts'>>(key: K, value: Workspace[K]) =>
    writeSetting(uid, key, value, w[key])
  const saveQuestionnaire = (
    profile: Workspace['profile'],
    payroll: Workspace['payroll'],
    originalProfile: Workspace['profile'],
    originalPayroll: Workspace['payroll'],
  ) => writeQuestionnaire(uid, { profile, payroll }, { profile: originalProfile, payroll: originalPayroll })
  const originalsForEditor =
    editor?.initial
      ? [...w.shifts.filter((s) => s.id !== editor.initial!.id), editor.initial]
      : w.shifts
  const saveRows = async ({ rows, deleted, originals }: ManualShiftWrites) => {
    await writeShifts(uid, rows, deleted, originals)
    setMessage(rows.length === 1 ? 'המשמרת נשמרה' : 'המשמרות נשמרו')
  }
  const timer = (op: 'start' | 'stop') =>
    void run(async () => {
      const now = new Date().toISOString()
      if (op === 'start') {
        if (active || scheduledShiftAt(w.shifts, Date.parse(now))) return
        const shift: WorkShift = {
          id: crypto.randomUUID(),
          title: 'משמרת עבודה',
          status: 'active',
          start: now,
          end: now,
          updatedAt: now,
        }
        await writeShifts(uid, [shift], [], w.shifts)
        setFoxReaction('start')
        setMessage('שעון המשמרת התחיל לפעול')
        return
      }
      const shift = active ?? scheduledShiftAt(w.shifts, Date.parse(now))
      if (!shift || Date.parse(now) <= Date.parse(shift.start)) return
      const row: WorkShift = { ...shift, status: 'completed', end: now }
      if (w.shifts.some((s) => s.id !== row.id && row.start < s.end && row.end > s.start)) {
        setEditor({ initial: row, date: localDate(row.start) })
        setMessage('יש חפיפה עם משמרת רשומה. אפשר לתקן את השעות לפני השמירה.')
        return
      }
      await writeShifts(uid, [row], [], w.shifts)
      setStatusTime(Date.now())
      setDetail({ id: row.id, justFinished: true })
      setMessage('המשמרת הסתיימה ונשמרה')
    })
  const closeDetail = () => {
    if (detail?.justFinished) setFoxReaction('stop')
    setDetail(null)
  }
  const picked = detail && shifts.find((s) => s.id === detail.id)
  const dialogShift = editor ? editor.initial : picked
  const dialogDate = editor?.date ?? (picked && localDate(picked.start))
  const pickedPay = picked ? shiftPayById.get(picked.id) : undefined
  const title =
    page === 'today'
      ? 'היום שלי'
      : page === 'calendar'
        ? 'יומן המשמרות'
        : page === 'salary'
          ? 'השכר שלי'
          : 'הגדרות'
  const hint =
    page === 'today'
      ? dateLabel(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : page === 'calendar'
        ? 'תכנון חודשי ורישום שעות עבודה'
        : page === 'salary'
          ? null
          : 'העבודה, המראה והחיבורים שלי'
  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <a href="#today" className="brand" aria-label="שועון, מסך היום">
            <img src="/fox.svg" alt="" />
            <span>שועון</span>
          </a>
          <nav aria-label="ניווט ראשי" className="primary-nav">
            {nav.map(({ id, label, icon: Icon }) => (
              <a
                key={id}
                className={page === id ? 'selected' : ''}
                href={'#' + id}
                aria-current={page === id ? 'page' : undefined}
              >
                <Icon size={17} />
                {label}
              </a>
            ))}
          </nav>
          <div className="account">
            {user ? (
              <span className="user-tag">
                <span className="avatar">{(user.displayName || user.email || 'ש').slice(0, 1)}</span>
                <span>{user.displayName?.split(' ')[0] || 'החשבון שלי'}</span>
              </span>
            ) : (
              <button className="signin" onClick={signIn} disabled={working}>
                <LogIn size={16} />
                כניסה עם Google
              </button>
            )}
            <span className="header-rule" />
            <button
              className={'icon-btn settings-button ' + (page === 'settings' ? 'current' : '')}
              aria-label="הגדרות"
              onClick={() => navigate('settings')}
            >
              <Settings2 size={20} />
            </button>
          </div>
        </div>
      </header>
      <main className="shell">
        <div className={`page-heading ${page}-page-heading`}>
          <div>
            <div className="title-row">
              <h1>{title}</h1>
              {!user && (
                <span className="demo-mark" title="נתונים לדוגמה הנשמרים בדפדפן הזה">
                  נתוני הדגמה
                </span>
              )}
            </div>
            {hint && <p>{hint}</p>}
          </div>
          {(page === 'today' || page === 'calendar') && (
            <button
              className="btn add-shift"
              aria-label="הוספת משמרת"
              onClick={() => setEditor({ date: page === 'today' ? today : day })}
            >
              <Plus size={17} aria-hidden="true" /> <span>הוספת משמרת</span>
            </button>
          )}
          {page === 'salary' && <SalaryMonthPicker month={month} onChange={setMonth} />}
        </div>
        {wage?.issue && (
          <p className="warning" role="alert">
            חישוב השכר דורש תיקון. {wage.issue} <button onClick={() => goCalendar(day)}>פתיחת היומן</button>
          </p>
        )}
        {page === 'today' && (
          <Dashboard
            shiftPayById={shiftPayById}
            today={today}
            shifts={shifts}
            active={active}
            scheduled={scheduledShiftAt(shifts, statusTime)}
            previousMonth={previousMonth}
            previousGross={previousGross}
            currentNet={dashboardPay?.currentNet ?? null}
            forecastNet={dashboardPay?.forecastNet ?? null}
            workedHours={dashboardPay?.workedHours ?? null}
            overtimeHours={dashboardPay?.overtimeHours ?? null}
            plannedCount={dashboardPay?.plannedCount ?? null}
            busy={working}
            foxReaction={foxReaction}
            onTimer={timer}
            onSalary={openPay}
            onCalendar={goCalendar}
            onShift={showDetail}
          />
        )}
        {page === 'calendar' && (
          <Calendar
            shiftPayById={shiftPayById}
            shifts={shifts}
            date={day}
            today={today}
            onDate={setDay}
            onEdit={showDetail}
            onAdd={(date) => setEditor({ date })}
          />
        )}
        {page === 'salary' && wage?.actual && (
          <>
            <Salary
              key={workingMonth}
              month={workingMonth}
              actual={wage.actual}
              planned={wage.planned}
              actualBands={wage.actual.bands}
              forecastBands={wage.combined.bands}
              profile={w.payroll}
              adjustments={w.adjustments}
              onProfileChange={(v) => setting('payroll', v)}
            />
          </>
        )}
        {page === 'settings' && (
          <Settings
            profile={w.profile}
            payroll={w.payroll}
            onSaveQuestionnaire={saveQuestionnaire}
            onSavePayroll={(v) => setting('payroll', v)}
            onSave={(v) => setting('profile', v)}
            templates={w.templates}
            onTemplate={(t) => setting('templates', w.templates.some(item => item.id === t.id)
              ? w.templates.map(item => item.id === t.id ? t : item)
              : [...w.templates, t])}
            user={user}
            onSalary={openPay}
            onSignIn={signIn}
            onSignOut={logout}
          />
        )}
        <footer className="footer">
          <span>
            <img src="/fox.svg" alt="" /> שועון
          </span>
          <small>
            <ShieldCheck size={14} />
            {user ? 'חשבון אישי' : 'סביבת הדגמה אישית בדפדפן'}
          </small>
          {!user && <a href="/">חזרה לדף הפתיחה</a>}
        </footer>
      </main>
      {user && !w.profile.onboarded && (
        <Dialog title="הגדרת היומן בשועון" className="onboarding-screen">
          <Onboarding profile={w.profile} payroll={w.payroll} onSaveQuestionnaire={saveQuestionnaire} />
        </Dialog>
      )}
      {dialogDate && (
        <ShiftEditor
          key={dialogShift ? dialogShift.id + ':' + dialogShift.updatedAt : 'new'}
          date={dialogDate}
          initial={dialogShift ?? undefined}
          transitionFrom={editor?.transitionFrom}
          templates={w.templates}
          shifts={w.shifts}
          onSave={saveRows}
          onDelete={async (id) => {
            await writeShifts(uid, [], [id], originalsForEditor)
            setMessage('המשמרת נמחקה')
          }}
          onClose={editor ? () => setEditor(null) : closeDetail}
          preview={!editor && picked ? {
            title: picked.title,
            content: (
              <div className="shift-detail">
                <p className="detail-date">
                  {detail?.justFinished && <SleepingFox />}
                  {dateLabel(localDate(picked.start), {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
                <div className="detail-time">
                  <Clock3 size={19} />
                  <TimeRange
                    start={localTime(picked.start)}
                    end={picked.status === 'active' ? '…' : localTime(picked.end)}
                  />
                  <span>
                    {picked.status === 'active' ? 'פעילה' : picked.status === 'completed' ? 'בוצעה' : 'מתוכננת'}
                  </span>
                </div>
                {picked.status !== 'active' && (
                  <div className="detail-pay">
                    <ShiftGross status={picked.status} gross={pickedPay?.gross} />
                  </div>
                )}
                {pickedPay?.bands
                  .filter((b) => b.hours > 0)
                  .map((b) => (
                    <div className="ledger-line" key={b.kind}>
                      <span>
                        {bandNames[b.kind]} · {hourCount(b.hours)} שעות
                      </span>
                      <b>{formatMoney(b.amount, 2)}</b>
                    </div>
                  ))}
                {picked.note && <p>{picked.note}</p>}
                <div className="detail-actions">
                  {picked.status === 'active' ? (
                    <button className="btn primary" onClick={() => navigate('today')}>
                      לשעון המשמרת <ArrowLeft size={15} />
                    </button>
                  ) : (
                    <button
                      className="btn primary"
                      onClick={(event) => {
                        setEditor({
                          initial: picked,
                          date: localDate(picked.start),
                          transitionFrom: event.currentTarget.closest('dialog')?.getBoundingClientRect(),
                        })
                        setDetail(null)
                      }}
                    >
                      <FilePenLine size={16} />
                      עריכה
                    </button>
                  )}
                  <button className="btn secondary" onClick={closeDetail}>
                    סגירה
                  </button>
                </div>
              </div>
            ),
          } : undefined}
        />
      )}
      {message && (
        <div className="toast" role="status">
          {message}
          <button aria-label="סגירת הודעה" onClick={() => setMessage('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </>
  )
}
