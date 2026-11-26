import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  CalendarRange,
  ChartNoAxesColumnIncreasing,
  ChevronLeft,
  CircleDollarSign,
  Clock3,
  Coffee,
  Moon,
  Play,
  Square,
  Sun,
  Sunrise,
  Timer,
} from 'lucide-react'
import { Forest } from './Forest'
import type { ShiftPay } from '../domain/gross'
import { ShiftGross } from './ShiftGross'
import { TimeRange } from './TimeRange'
import { addDays, localDate, localTime, weekday } from '../domain/time'
import { formatWorkDuration, shiftWorkMillis } from '../data/shift-hours'
import { dateLabel, formatMoney, hourCount, type WorkShift } from '../data/model'

type Props = {
  today: string
  shifts: WorkShift[]
  shiftPayById: ReadonlyMap<string, ShiftPay>
  active?: WorkShift
  scheduled?: WorkShift
  previousMonth: string
  previousGross: number | null
  currentNet: number | null
  forecastNet: number | null
  workedHours: number | null
  overtimeHours: number | null
  plannedCount: number | null
  foxReaction: 'start' | 'stop' | null
  busy: boolean
  onTimer: (op: 'start' | 'resume' | 'stop') => void
  onSalary: () => void
  onCalendar: (date: string) => void
  onShift: (s: WorkShift) => void
}
export function shiftIcon(s: WorkShift) {
  const hour = Number(localTime(s.start).slice(0, 2))
  return hour >= 20 || hour < 5 ? Moon : hour >= 12 ? Sunrise : Sun
}
function duration(shift: WorkShift) {
  const end = shift.openBreak ? Date.parse(shift.openBreak) : Date.now()
  const breaks = shift.breaks.reduce(
    (sum, b) => sum + (b.paid ? 0 : Math.max(0, Math.min(end, Date.parse(b.end)) - Date.parse(b.start))),
    0,
  )
  return Math.max(0, Math.floor((end - Date.parse(shift.start) - breaks) / 1000))
}
function Clock({ active, scheduled, scheduledGross, busy, foxReaction, onTimer }: Pick<Props, 'foxReaction' | 'active' | 'scheduled' | 'busy' | 'onTimer'> & { scheduledGross?: number }) {
  const displayedShift = active ?? scheduled
  const [, refresh] = useState(0)
  useEffect(() => {
    if (!displayedShift || displayedShift.openBreak) return
    const interval = window.setInterval(() => refresh((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [displayedShift])
  const seconds = displayedShift ? duration(displayedShift) : 0
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((n) =>
    String(n).padStart(2, '0'),
  )
  return (
    <article className="clock-card" data-fox-reaction={foxReaction ?? undefined}>
      <Forest alert={Boolean(displayedShift && !displayedShift.openBreak)} />
      <div className="clock-content">
        <div className="overline">
          <Timer size={17} /> שעון נוכחות
        </div>
        <div className="clock-readout" role="timer" aria-label={(scheduled && !active ? 'זמן מתחילת המשמרת המתוכננת ' : 'משך עבודה ') + parts.join(':')} dir="ltr">
          {parts[0]}
          <i>:</i>
          {parts[1]}
          <i>:</i>
          <span>{parts[2]}</span>
        </div>
        {(active || !scheduled) && (
          <div className="clock-state">
            <span className={'status-light ' + (active ? 'running' : '')} />
            {active ? (active.openBreak ? 'בהפסקה' : 'המשמרת בפעילות') : 'אין משמרת פעילה'}
          </div>
        )}
        {!active && scheduled && (
          <div className="clock-scheduled">
            <strong>{scheduled.title}</strong>
            <TimeRange start={localTime(scheduled.start)} end={localTime(scheduled.end)} />
            <ShiftGross status={scheduled.status} gross={scheduledGross} />
          </div>
        )}
        <div className="timer-actions">
          {displayedShift ? (
            <>
              <button className="btn primary" disabled={busy} onClick={() => onTimer('stop')}>
                <Square size={15} fill="currentColor" />
                סיום משמרת
              </button>
              {active?.openBreak && (
                <button className="btn clock-break" disabled={busy} onClick={() => onTimer('resume')}>
                  <Coffee size={16} />
                  חזרה מהפסקה
                </button>
              )}
            </>
          ) : (
            <button className="btn primary start-button" disabled={busy} onClick={() => onTimer('start')}>
              <Play size={15} fill="currentColor" />
              התחלת משמרת
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
function Weekly({ today, shifts, shiftPayById, onCalendar, onShift }: Pick<Props, 'today' | 'shifts' | 'shiftPayById' | 'onCalendar' | 'onShift'>) {
  const start = addDays(today, -weekday(today))
  const end = addDays(start, 6)
  const entries = useMemo(() =>
    shifts
      .map((shift) => ({ shift, date: localDate(shift.start) }))
      .filter(({ date }) => start <= date && date <= end)
      .sort((a, b) => Date.parse(a.shift.start) - Date.parse(b.shift.start)),
    [shifts, start, end],
  )
  const hasActive = entries.some(({ shift }) => shift.status === 'active')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!hasActive) return
    const refresh = () => setNow(Date.now())
    refresh()
    const timer = window.setInterval(refresh, 15_000)
    return () => window.clearInterval(timer)
  }, [hasActive])
  const rows = entries.map((entry) => ({ ...entry, millis: shiftWorkMillis(entry.shift, now) }))
  const total = rows.reduce((sum, row) => sum + row.millis, 0)
  const shortDate = { day: 'numeric', month: 'short' } as const

  return (
    <article className="panel weekly">
      <div className="panel-heading">
        <div className="section-title">
          <CalendarRange size={20} />
          <h2>השבוע שלי</h2>
        </div>
        <button className="text-button" onClick={() => onCalendar(today)}>
          ליומן <ArrowLeft size={14} />
        </button>
      </div>
      <div className="week-sub">
        <b><bdi dir="ltr">{formatWorkDuration(total)}</bdi> שעות</b>
        <span>·</span>
        {dateLabel(start, shortDate)} עד {dateLabel(end, shortDate)}
      </div>
      {rows.length === 0 ? <p className="week-empty">אין משמרות השבוע.</p> : (
        <ul className="week-shifts" aria-label="משמרות השבוע">
          {rows.map(({ shift, date, millis }) => (
            <li key={shift.id}>
              <button type="button" className="week-shift" onClick={() => onShift(shift)}>
                <span className="week-shift-name">
                  <strong>{shift.title || 'משמרת עבודה'}</strong>
                  <small>{dateLabel(date, { weekday: 'short', ...shortDate })}</small>
                </span>
                <span className="week-shift-totals">
                  <span><bdi dir="ltr">{formatWorkDuration(millis)}</bdi> שעות</span>
                  {shift.status === 'active'
                    ? <small>פעילה</small>
                    : <ShiftGross status={shift.status} gross={shiftPayById.get(shift.id)?.gross} compact />}
                </span>
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
export function Dashboard(p: Props) {
  const scheduledGross = p.scheduled ? p.shiftPayById.get(p.scheduled.id)?.gross : undefined
  const upcoming = p.shifts
    .filter((s) => s.status === 'planned')
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 3)
  const month = dateLabel(p.today, { month: 'long' })
  const lastMonth = dateLabel(p.previousMonth + '-01', { month: 'long', year: 'numeric' })
  const metrics = [
    { kind: 'worked', label: 'שעות עבודה', value: p.workedHours, icon: Clock3 },
    { kind: 'overtime', label: 'מתוכן שעות נוספות', value: p.overtimeHours, icon: ChartNoAxesColumnIncreasing },
    { kind: 'planned', label: 'משמרות מתוכננות', value: p.plannedCount, icon: CalendarDays },
  ]
  return (
    <>
      <div className="dashboard-top">
        <Clock foxReaction={p.foxReaction} active={p.active} scheduled={p.scheduled} scheduledGross={scheduledGross} busy={p.busy} onTimer={p.onTimer} />
        <article className="income-card">
          <div className="income-contours" aria-hidden="true" />
          <h2 className="overline">
            <CircleDollarSign size={18} /> השכר שלי
          </h2>
          <div className="income-body">
            <div>
              <span className="income-label">ברוטו בחודש שעבר</span>
              <span className="income-period">{lastMonth}</span>
            </div>
            <strong className="income-number">{p.previousGross === null ? '—' : formatMoney(p.previousGross)}</strong>
          </div>
          <div className="income-current">
            <div className="income-current-heading">
              <h3>אומדן נטו · {month}</h3>
              <button className="income-details" onClick={p.onSalary}>
                לדוח השכר <ArrowLeft size={14} />
              </button>
            </div>
            <dl className="income-estimates">
              <div className="income-earned">
                <dt>נצבר עד כה</dt>
                <dd><bdi>{p.currentNet === null ? '—' : formatMoney(p.currentNet)}</bdi></dd>
              </div>
              <div className="income-forecast">
                <dt>צפוי כולל משמרות מתוכננות</dt>
                <dd><bdi>{p.forecastNet === null ? '—' : formatMoney(p.forecastNet)}</bdi></dd>
              </div>
            </dl>
          </div>
        </article>
      </div>
      <section className="summary-strip" aria-labelledby="month-summary-title">
        <h2 id="month-summary-title">המשמרות שלי · {month}</h2>
        <dl className="summary-metrics">
          {metrics.map(({ kind, label, value, icon: Icon }) => (
            <div key={kind} data-metric={kind}>
              <dt>
                <Icon size={16} aria-hidden="true" />
                {label}
              </dt>
              <dd>{value === null ? '—' : hourCount(value)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="dashboard-bottom">
        <Weekly today={p.today} shifts={p.shifts} shiftPayById={p.shiftPayById} onCalendar={p.onCalendar} onShift={p.onShift} />
        <article className="panel upcoming">
          <div className="panel-heading">
            <div className="section-title">
              <CalendarDays size={20} />
              <h2>המשמרות הבאות</h2>
            </div>
          </div>
          {upcoming.length === 0 ? (
            <div className="empty-inline">
              אין עדיין משמרות מתוכננות.
              <button className="text-button" onClick={() => p.onCalendar(p.today)}>
                לתכנון השבוע <ArrowLeft size={14} />
              </button>
            </div>
          ) : (
            upcoming.map((s) => {
              const date = localDate(s.start)
              const Icon = shiftIcon(s)
              return (
                <button className="upcoming-row" key={s.id} onClick={() => p.onShift(s)}>
                  <span className="date-tile">
                    <strong>{Number(date.slice(-2))}</strong>
                    <small>{dateLabel(date, { month: 'short' })}</small>
                  </span>
                  <span className="row-info">
                    <b>{s.title}</b>
                    <small>
                      {dateLabel(date, { weekday: 'long' })} <i>·</i>{' '}
                      <TimeRange start={localTime(s.start)} end={localTime(s.end)} />
                    </small>
                    <ShiftGross status={s.status} gross={p.shiftPayById.get(s.id)?.gross} />
                  </span>
                  <Icon className="shift-kind" size={17} />
                  <ChevronLeft size={15} className="row-chevron" />
                </button>
              )
            })
          )}
        </article>
      </div>
    </>
  )
}
