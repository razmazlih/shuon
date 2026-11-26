import { useId, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Copy, Plus } from 'lucide-react'
import type { WorkShift } from '../data/model'
import { addDays, addMonths, dateMs, localDate, localTime, monthDays } from '../domain/time'
import './monthly-calendar.css'

interface CalendarProps {
  shifts: WorkShift[]
  date: string
  today?: string
  onDate: (date: string) => void
  onEdit: (shift: WorkShift) => void
  onAdd: (date: string) => void
  onDuplicate: (shift: WorkShift) => void
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
const arrowSteps: Record<string, number> = { ArrowLeft: 1, ArrowRight: -1, ArrowUp: -7, ArrowDown: 7 }
const earliestDate = '0001-01-01'
const latestDate = '9999-12-31'

function durationLabel(shift: WorkShift) {
  const elapsed = Date.parse(shift.end) - Date.parse(shift.start)
  const unpaid = shift.breaks.reduce(
    (total, b) => total + (b.paid ? 0 : Date.parse(b.end) - Date.parse(b.start)),
    0,
  )
  const minutes = Math.round((elapsed - unpaid) / 60_000)
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return hours + ':' + String(remainder).padStart(2, '0')
}

export function Calendar({ shifts, date, today = localDate(Date.now()), onDate, onEdit, onAdd, onDuplicate }: CalendarProps) {
  const month = date.slice(0, 7)
  const first = month + '-01'
  const days = monthDays(first)
  const monthHeadingId = useId()
  const agendaHeadingId = useId()
  const gridRef = useRef<HTMLDivElement>(null)
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
    gridRef.current?.querySelector<HTMLButtonElement>('button[data-date="' + date + '"]')
      ?.focus({ preventScroll: target.preventScroll })
  }, [date])

  function selectDate(day: string, preventScroll: boolean) {
    if (day === date) return
    pendingFocus.current = { date: day, preventScroll }
    onDate(day)
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const step = arrowSteps[event.key]
    if (!step || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const next = addDays(day, step)
    if (next >= earliestDate && next <= latestDate) selectDate(next, false)
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
              onClick={() => onDate(previousMonth)}
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
              onClick={() => onDate(nextMonth)}
            >
              <ChevronLeft size={19} aria-hidden="true" />
            </button>
          </div>
          <div className="cal-jump">
            <button className="btn secondary" type="button" onClick={() => onDate(today)}>
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
                  if (next.length === 10 && next >= earliestDate && next <= latestDate) onDate(next)
                }}
              />
            </label>
          </div>
        </div>
        <div className="cal-grid" role="grid" aria-labelledby={monthHeadingId} ref={gridRef}>
          <div className="cal-weekdays cal-row" role="row">
            {weekdays.map(([short, full]) => (
              <span role="columnheader" aria-label={full} key={short}>{short}</span>
            ))}
          </div>
          {Array.from({ length: days.length / 7 }, (_, index) => (
            <div className="cal-row" key={days[index * 7] ?? index} role="row">
              {days.slice(index * 7, index * 7 + 7).map((day, column) => {
                if (!day) return <div key={column} role="gridcell" />
                const entries = shiftsOn(day)
                const firstStart = entries.find((entry) => entry.start === day)
                const preview = firstStart ?? entries[0]
                const previewTime = firstStart && localTime(firstStart.shift.start)
                const summary = preview
                  ? (entries.length === 1 ? 'משמרת אחת' : entries.length + ' משמרות') + ', ' +
                    (previewTime ? 'התחלה ב־' + previewTime : 'המשך משמרת') + ', ' + statusLabels[preview.shift.status]
                  : 'אין משמרות'
                const selected = day === date
                return (
                  <div key={day} className="cal-cell" role="gridcell" aria-selected={selected}>
                    <button
                      className="cal-day"
                      type="button"
                      data-date={day}
                      data-outside={!day.startsWith(month)}
                      tabIndex={selected ? 0 : -1}
                      aria-current={day === today ? 'date' : undefined}
                      aria-label={dateLabel.format(dateMs(day)) + ', ' + summary}
                      onClick={() => selectDate(day, true)}
                      onKeyDown={(event) => moveFocus(event, day)}
                    >
                      <span className="cal-day-heading" aria-hidden="true">
                        <strong>{Number(day.slice(-2))}</strong>
                        {entries.length > 1 && <bdi className="cal-more" dir="ltr">+{entries.length - 1}</bdi>}
                      </span>
                      {preview && (
                        <span className="cal-day-preview" aria-hidden="true">
                          <i className="cal-indicator" data-status={preview.shift.status} />
                          {previewTime ? <bdi dir="ltr">{previewTime}</bdi> : <span>המשך</span>}
                        </span>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <ul className="cal-legend" aria-label="מצבי משמרות">
          {statusKeys.map((status) => (
            <li key={status}>
              <i className="cal-indicator" data-status={status} aria-hidden="true" />
              {statusLabels[status]}
            </li>
          ))}
        </ul>
      </div>

      <section className="cal-agenda" aria-labelledby={agendaHeadingId}>
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
                  <button className="cal-entry" type="button" onClick={() => onEdit(shift)}>
                    <span className="cal-mark" data-status={shift.status} aria-hidden="true" />
                    <span className="cal-entry-main">
                      <strong>{shift.title || 'משמרת עבודה'}</strong>
                      <span>
                        <bdi dir="ltr">
                          {localTime(shift.start)}
                          {shift.status === 'active' ? '' : ' – ' + localTime(shift.end)}
                        </bdi>
                        {crossDay && <small> · חוצה חצות</small>}
                        {shift.status === 'active' && ' · במשמרת'}
                      </span>
                    </span>
                    {shift.status !== 'active' && (
                      <span className="cal-length">
                        <Clock3 size={14} aria-hidden="true" />
                        <bdi>{durationLabel(shift)}</bdi> שעות
                      </span>
                    )}
                    <span className="cal-status">{statusLabels[shift.status]}</span>
                  </button>
                  {shift.status !== 'active' && (
                    <button
                      className="icon-btn"
                      type="button"
                      aria-label={'שכפול ' + (shift.title || 'משמרת עבודה')}
                      title="שכפול משמרת"
                      onClick={() => onDuplicate(shift)}
                    >
                      <Copy size={16} aria-hidden="true" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </section>
  )
}
