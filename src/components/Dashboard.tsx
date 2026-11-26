import { useEffect, useState } from 'react'
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
import { TimeRange } from './TimeRange'
import { addDays, localDate, localTime, weekday } from '../domain/time'
import { dateLabel, formatMoney, hourCount, type WorkShift } from '../data/model'

type Props = {
  today: string
  shifts: WorkShift[]
  active?: WorkShift
  scheduled?: WorkShift
  previousMonth: string
  previousGross: number | null
  currentNet: number | null
  forecastNet: number | null
  workedHours: number | null
  overtimeHours: number | null
  plannedCount: number | null
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
    (sum, b) => sum + (b.paid ? 0 : Date.parse(b.end) - Date.parse(b.start)),
    0,
  )
  return Math.max(0, Math.floor((end - Date.parse(shift.start) - breaks) / 1000))
}
function Clock({ active, scheduled, busy, onTimer }: Pick<Props, 'active' | 'scheduled' | 'busy' | 'onTimer'>) {
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
    <article className="clock-card">
      <Forest />
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
        <div className="clock-state">
          <span className={'status-light ' + (active ? 'running' : '')} />
          {active ? (active.openBreak ? 'בהפסקה' : 'המשמרת בפעילות') : scheduled ? 'משמרת מתוכננת עכשיו' : 'אין משמרת פעילה'}
        </div>
        {!active && scheduled && (
          <div className="clock-scheduled">
            <strong>{scheduled.title}</strong>
            <TimeRange start={localTime(scheduled.start)} end={localTime(scheduled.end)} />
          </div>
        )}
        <div className="timer-actions">
          {active ? (
            <>
              <button className="btn primary" disabled={busy} onClick={() => onTimer('stop')}>
                <Square size={15} fill="currentColor" />
                סיום משמרת
              </button>
              {active.openBreak && (
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
function Weekly({ today, shifts, onCalendar }: Pick<Props, 'today' | 'shifts' | 'onCalendar'>) {
  const start = addDays(today, -weekday(today))
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index)
    const rows = shifts.filter((s) => localDate(s.start) === date && s.status !== 'active')
    const hours = (s: WorkShift) =>
      Math.max(
        0,
        (Date.parse(s.end) -
          Date.parse(s.start) -
          s.breaks.reduce((n, b) => n + (b.paid ? 0 : Date.parse(b.end) - Date.parse(b.start)), 0)) /
          3600000,
      )
    return {
      date,
      actual: rows.filter((s) => s.status === 'completed').reduce((n, s) => n + hours(s), 0),
      planned: rows.filter((s) => s.status === 'planned').reduce((n, s) => n + hours(s), 0),
    }
  })
  const max = Math.max(8, ...days.map((d) => d.actual + d.planned))
  const total = days.reduce((n, d) => n + d.actual + d.planned, 0)
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
        <b>{hourCount(total)} שעות</b>
        <span>·</span>
        {dateLabel(start, { day: 'numeric', month: 'short' })} עד{' '}
        {dateLabel(addDays(start, 6), { day: 'numeric', month: 'short' })}
      </div>
      <div className="week-chart">
        {days.map((d) => (
          <button
            key={d.date}
            className={'day-column ' + (d.date === today ? 'is-today' : '')}
            onClick={() => onCalendar(d.date)}
            aria-label={
              dateLabel(d.date, { weekday: 'long', day: 'numeric', month: 'long' }) +
              ' — ' +
              hourCount(d.actual + d.planned) +
              ' שעות'
            }
          >
            <div className="bar-area">
              <span className="bar-label">
                {d.actual + d.planned > 0 ? hourCount(d.actual + d.planned) : '–'}
              </span>
              <div
                className="bar stacked-bar"
                style={{ height: Math.max(2, ((d.actual + d.planned) / max) * 62) + 'px' }}
              >
                {d.planned > 0 && <i className="legend-planned" style={{ flex: d.planned }} />}
                {d.actual > 0 && <i className="legend-worked" style={{ flex: d.actual }} />}
              </div>
            </div>
            <span className="day-name">{['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'][weekday(d.date)]}</span>
          </button>
        ))}
      </div>
      <div className="chart-legend">
        <span>
          <i className="legend-worked" />
          בוצעו
        </span>
        <span>
          <i className="legend-planned" />
          מתוכננות
        </span>
      </div>
    </article>
  )
}
export function Dashboard(p: Props) {
  const upcoming = p.shifts
    .filter((s) => s.status === 'planned')
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 3)
  const month = dateLabel(p.today, { month: 'long' })
  const lastMonth = dateLabel(p.previousMonth + '-01', { month: 'long', year: 'numeric' })
  const metrics = [
    { label: 'שעות עבודה', value: p.workedHours, icon: Clock3 },
    { label: 'מתוכן שעות נוספות', value: p.overtimeHours, icon: ChartNoAxesColumnIncreasing },
    { label: 'משמרות מתוכננות', value: p.plannedCount, icon: CalendarDays },
  ]
  return (
    <>
      <div className="dashboard-top">
        <Clock active={p.active} scheduled={p.scheduled} busy={p.busy} onTimer={p.onTimer} />
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
              <div>
                <dt>נצבר עד כה</dt>
                <dd>{p.currentNet === null ? '—' : formatMoney(p.currentNet)}</dd>
              </div>
              <div>
                <dt>צפוי כולל משמרות מתוכננות</dt>
                <dd>{p.forecastNet === null ? '—' : formatMoney(p.forecastNet)}</dd>
              </div>
            </dl>
          </div>
        </article>
      </div>
      <section className="summary-strip" aria-labelledby="month-summary-title">
        <h2 id="month-summary-title">המשמרות שלי · {month}</h2>
        <dl className="summary-metrics">
          {metrics.map(({ label, value, icon: Icon }) => (
            <div key={label}>
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
        <Weekly today={p.today} shifts={p.shifts} onCalendar={p.onCalendar} />
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
