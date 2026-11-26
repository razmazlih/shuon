import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { WorkShift } from '../data/model'
import { formatWorkDuration, shiftWorkMillis, workMillisOnDay } from '../data/shift-hours'
import { addDays, addMonths, dateMs, localDate, localTime, monthDays } from '../domain/time'
import { TimeRange } from './TimeRange'
import './monthly-calendar.css'

interface CalendarProps {
  shifts: WorkShift[]
  date: string
  today?: string
  onDate: (date: string) => void
  onEdit: (shift: WorkShift) => void
  onAdd: (date: string) => void
}

const dateLabel = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const monthLabel = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const weekdays = [
  ['א׳', 'ראשון'],
  ['ב׳', 'שני'],
  ['ג׳', 'שלישי'],
  ['ד׳', 'רביעי'],
  ['ה׳', 'חמישי'],
  ['ו׳', 'שישי'],
  ['ש׳', 'שבת'],
]
const statusLabels = { planned: 'מתוכננת', completed: 'בוצעה', active: 'פעילה' }
const statusKeys = ['planned', 'completed', 'active'] as const
const legendLabels = { ...statusLabels, mixed: 'משולב' }
const arrowSteps: Record<string, number> = { ArrowLeft: 1, ArrowRight: -1, ArrowUp: -7, ArrowDown: 7 }
const earliestDate = '0001-01-01'
const latestDate = '9999-12-31'

const panelMotion = { duration: 210, easing: 'cubic-bezier(0.2, 0.65, 0.3, 1)' }

function usePanelMotion(key: string) {
  const frame = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const pending = useRef<{ height: number; offset: number; outgoing: HTMLElement } | null>(null)
  const sizing = useRef<Animation | null>(null)
  const entering = useRef<Animation | null>(null)

  function prepare(offset: number) {
    if (!frame.current || !content.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const source = content.current
    const outgoing = source.cloneNode(true) as HTMLElement
    const current = window.getComputedStyle(source)
    outgoing.style.opacity = current.opacity
    outgoing.style.transform = current.transform
    outgoing.removeAttribute('id')
    outgoing.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
    outgoing.querySelectorAll('[data-date]').forEach((node) => node.removeAttribute('data-date'))
    pending.current = { height: frame.current.getBoundingClientRect().height, offset, outgoing }
  }

  useLayoutEffect(() => {
    const transition = pending.current
    const target = content.current
    if (!transition || !frame.current || !target || !layer.current) return
    const { height, offset, outgoing } = transition
    pending.current = null
    sizing.current?.cancel()
    entering.current?.cancel()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const nextHeight = target.getBoundingClientRect().height
    if (Math.abs(height - nextHeight) > 1) {
      sizing.current = frame.current.animate(
        [{ height: height + 'px' }, { height: nextHeight + 'px' }],
        panelMotion,
      )
    }
    layer.current.append(outgoing)
    outgoing
      .animate(
        [
          { opacity: outgoing.style.opacity, transform: outgoing.style.transform },
          { opacity: 0, transform: 'translateX(' + -offset + 'px)' },
        ],
        panelMotion,
      ).finished.then(() => outgoing.remove(), () => outgoing.remove())
    entering.current = target.animate(
      [{ opacity: 0, transform: 'translateX(' + offset + 'px)' }, { opacity: 1, transform: 'translateX(0)' }],
      panelMotion,
    )
  }, [key])

  useLayoutEffect(() => {
    const outgoing = layer.current
    return () => {
      sizing.current?.cancel()
      entering.current?.cancel()
      outgoing?.getAnimations({ subtree: true }).forEach((animation) => animation.cancel())
    }
  }, [])

  return { frame, content, layer, prepare }
}

export function Calendar({
  shifts,
  date,
  today: calendarToday,
  onDate,
  onEdit,
  onAdd,
}: CalendarProps) {
  const [now, setNow] = useState(Date.now)
  const hasActive = shifts.some((shift) => shift.status === 'active')

  useEffect(() => {
    if (!hasActive) return
    const update = () => setNow(Date.now())
    update()
    const timer = window.setInterval(update, 15_000)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
    }
  }, [hasActive])

  const today = calendarToday ?? localDate(now)
  const month = date.slice(0, 7)
  const first = month + '-01'
  const days = useMemo(() => monthDays(first), [first])
  const monthMotion = usePanelMotion(month)
  const agendaMotion = usePanelMotion(date)
  const monthHeadingId = useId()
  const agendaHeadingId = useId()
  const pendingFocus = useRef<{ date: string; preventScroll: boolean } | null>(null)
  const shiftDays = useMemo(
    () => shifts
      .map((shift) => ({
        shift,
        start: localDate(shift.start),
        end: shift.status === 'active' ? today : localDate(Date.parse(shift.end) - 1),
      }))
      .sort((a, b) => Date.parse(a.shift.start) - Date.parse(b.shift.start)),
    [shifts, today],
  )
  const shiftsOn = (day: string) => shiftDays.filter(({ start, end }) => start <= day && end >= day)
  const dayShifts = shiftsOn(date)
  const previousMonth = addMonths(date, -1)
  const nextMonth = addMonths(date, 1)

  useLayoutEffect(() => {
    const target = pendingFocus.current
    if (target?.date !== date) return
    pendingFocus.current = null
    monthMotion.content.current?.querySelector<HTMLButtonElement>('button[data-date="' + date + '"]')
      ?.focus({ preventScroll: target.preventScroll })
  }, [date, monthMotion.content])

  function changeDate(day: string, preventScroll?: boolean) {
    if (day === date) return
    const offset = day > date ? -10 : 10
    if (!day.startsWith(month)) monthMotion.prepare(offset)
    agendaMotion.prepare(offset)
    if (preventScroll !== undefined) pendingFocus.current = { date: day, preventScroll }
    onDate(day)
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const step = arrowSteps[event.key]
    if (!step || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const next = addDays(day, step)
    if (next >= earliestDate && next <= latestDate) changeDate(next, false)
  }

  return (
    <section className="shift-calendar" aria-label="יומן משמרות">
      <div className="cal-month">
        <div className="cal-month-toolbar">
          <div className="cal-month-navigation">
            <button
              type="button"
              className="icon-btn"
              aria-label="החודש הקודם"
              disabled={previousMonth === date}
              onClick={() => changeDate(previousMonth)}
            >
              <ChevronRight size={19} aria-hidden="true" />
            </button>
            <h2 id={monthHeadingId} aria-live="polite">
              {monthLabel.format(dateMs(first))}
            </h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="החודש הבא"
              disabled={nextMonth === date}
              onClick={() => changeDate(nextMonth)}
            >
              <ChevronLeft size={19} aria-hidden="true" />
            </button>
          </div>
          <div className="cal-jump">
            <button className="btn secondary" type="button" onClick={() => changeDate(today)}>
              היום
            </button>
            <label className="cal-picker" title="בחירת תאריך">
              <CalendarDays size={17} aria-hidden="true" />
              <span>בחירת תאריך</span>
              <input
                type="date"
                min={earliestDate}
                max={latestDate}
                value={date}
                aria-label="מעבר לתאריך"
                onChange={(event) => {
                  const next = event.target.value
                  if (next.length === 10 && next >= earliestDate && next <= latestDate) changeDate(next)
                }}
              />
            </label>
          </div>
        </div>
        <div className="cal-grid" role="grid" aria-labelledby={monthHeadingId}>
          <div className="cal-weekdays cal-row" role="row">
            {weekdays.map(([short, full]) => (
              <span role="columnheader" aria-label={full} key={short}>{short}</span>
            ))}
          </div>
          <div className="cal-motion-frame" ref={monthMotion.frame}>
            <div className="cal-motion-layer" ref={monthMotion.layer} aria-hidden="true" inert />
            <div className="cal-month-weeks cal-motion-content" ref={monthMotion.content} role="rowgroup">
              {Array.from({ length: days.length / 7 }, (_, index) => (
                <div className="cal-row" key={days[index * 7] ?? index} role="row">
                  {days.slice(index * 7, index * 7 + 7).map((day, column) => {
                    if (!day) return <div key={column} role="gridcell" />
                    const entries = shiftsOn(day)
                    const occupied = entries.length > 0
                    const statuses = statusKeys.filter((status) => entries.some(({ shift }) => shift.status === status))
                    const dayStatus = statuses.length > 1 ? 'mixed' : statuses[0]
                    const duration = occupied
                      ? formatWorkDuration(entries.reduce((sum, { shift }) => sum + workMillisOnDay(shift, day, now), 0))
                      : ''
                    const count = entries.length === 1 ? 'משמרת אחת' : entries.length + ' משמרות'
                    const summary = occupied
                      ? count + ', ' + duration + ' שעות עבודה, ' + statuses.map((status) => statusLabels[status]).join(', ')
                      : 'אין משמרות'
                    const selected = day === date
                    return (
                      <div key={day} className="cal-cell" role="gridcell" aria-selected={selected}>
                        <button
                          className="cal-day"
                          type="button"
                          data-date={day}
                          data-outside={!day.startsWith(month)}
                          data-work-status={dayStatus}
                          tabIndex={selected ? 0 : -1}
                          aria-current={day === today ? 'date' : undefined}
                          aria-label={dateLabel.format(dateMs(day)) + ', ' + summary}
                          onClick={() => changeDate(day, true)}
                          onKeyDown={(event) => moveFocus(event, day)}
                        >
                          <span className="cal-day-heading" aria-hidden="true">
                            <strong>{Number(day.slice(-2))}</strong>
                            {entries.length > 1 && <bdi className="cal-more" dir="ltr">+{entries.length - 1}</bdi>}
                          </span>
                          {occupied && (
                            <span className="cal-day-preview" aria-hidden="true">
                              <i className="cal-indicator" data-status={dayStatus} />
                              <bdi className="cal-day-duration" dir="ltr">{duration}</bdi>
                            </span>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="cal-legend-wrap">
          <span className="cal-legend-label" title="סך שעות העבודה ביום">שעות עבודה</span>
          <ul className="cal-legend" aria-label="מצבי משמרות">
            {([...statusKeys, 'mixed'] as const).map((status) => (
              <li key={status}>
                <i className="cal-indicator" data-status={status} aria-hidden="true" />
                {legendLabels[status]}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section className="cal-agenda" aria-labelledby={agendaHeadingId}>
        <div className="cal-motion-frame" ref={agendaMotion.frame}>
          <div className="cal-motion-layer" ref={agendaMotion.layer} aria-hidden="true" inert />
          <div className="cal-motion-content" ref={agendaMotion.content}>
            <div className="cal-agenda-heading">
              <h2 id={agendaHeadingId}>{dateLabel.format(dateMs(date))}</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="הוספת משמרת"
                title="הוספת משמרת"
                onClick={() => onAdd(date)}
              >
                <Plus size={20} aria-hidden="true" />
              </button>
            </div>
            {dayShifts.length === 0 ? (
              <div className="cal-empty">
                <CalendarDays aria-hidden="true" size={26} />
                <p>אין משמרות ביום הזה</p>
              </div>
            ) : (
              <ul className="cal-list">
                {dayShifts.map(({ shift, start }) => {
                  const crossDay = shift.status !== 'active' && start !== localDate(shift.end)
                  return (
                    <li key={shift.id}>
                      <button
                        className="cal-entry"
                        data-status={shift.status}
                        type="button"
                        onClick={() => onEdit(shift)}
                      >
                        <span className="cal-entry-main">
                          <span className="cal-entry-time">
                            <TimeRange
                              start={localTime(shift.start)}
                              end={shift.status === 'active' ? '…' : localTime(shift.end)}
                            />
                          </span>
                          <span className="cal-entry-caption">
                            <strong>{shift.title || 'משמרת עבודה'}</strong>
                            {crossDay && <small>חוצה חצות</small>}
                          </span>
                        </span>
                        <span className="cal-entry-meta">
                          <span className="cal-status">
                            <i className="cal-indicator" data-status={shift.status} aria-hidden="true" />
                            {statusLabels[shift.status]}
                          </span>
                          {shift.status !== 'active' && (
                            <span className="cal-length">
                              <bdi dir="ltr">{formatWorkDuration(shiftWorkMillis(shift, now))}</bdi> שעות
                            </span>
                          )}
                        </span>
                        <ChevronLeft className="cal-entry-arrow" size={16} aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </section>
    </section>
  )
}
