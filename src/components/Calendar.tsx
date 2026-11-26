import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Copy, Plus } from 'lucide-react'
import type { WorkShift } from '../data/model'
import { addDays, dateMs, localDate, localTime, weekday } from '../domain/time'
import './calendar.css'

interface CalendarProps {
  shifts: WorkShift[]
  date: string
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
const shortDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const shortDay = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
const statusLabels = { planned: 'מתוכננת', completed: 'בוצעה', active: 'פעילה' }

function intersectsDay(shift: WorkShift, day: string) {
  const start = localDate(shift.start)
  const end = shift.status === 'active' ? localDate(Date.now()) : localDate(Date.parse(shift.end) - 1)
  return day >= start && day <= end
}

function durationLabel(shift: WorkShift) {
  const elapsed = Date.parse(shift.end) - Date.parse(shift.start)
  const unpaid = shift.breaks.reduce(
    (total, b) => total + (b.paid ? 0 : Date.parse(b.end) - Date.parse(b.start)),
    0,
  )
  const minutes = Math.round((elapsed - unpaid) / 60_000)
  const hours = Math.floor(minutes / 60),
    remainder = minutes % 60
  return hours + ':' + String(remainder).padStart(2, '0')
}

export function Calendar({ shifts, date, onDate, onEdit, onAdd, onDuplicate }: CalendarProps) {
  const today = localDate(Date.now())
  const first = addDays(date, -weekday(date))
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i))
  const dayShifts = shifts
    .filter((shift) => intersectsDay(shift, date))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  return (
    <section className="shift-calendar" aria-label="יומן משמרות">
      <div className="cal-week">
        <div className="cal-toolbar">
          <div className="cal-arrows">
            <button
              type="button"
              className="icon-btn"
              aria-label="השבוע הקודם"
              onClick={() => onDate(addDays(date, -7))}
            >
              <ChevronRight size={19} />
            </button>
            <h2>
              {shortDate.format(dateMs(first))} – {shortDate.format(dateMs(days[6]))}
            </h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="השבוע הבא"
              onClick={() => onDate(addDays(date, 7))}
            >
              <ChevronLeft size={19} />
            </button>
          </div>
          <div className="cal-jump">
            <button className="btn secondary" type="button" onClick={() => onDate(today)}>
              היום
            </button>
            <label className="cal-picker">
              <CalendarDays size={17} aria-hidden="true" />
              <span>בחירת תאריך</span>
              <input
                type="date"
                value={date}
                aria-label="מעבר לתאריך"
                onChange={(e) => {
                  if (e.target.value) onDate(e.target.value)
                }}
              />
            </label>
          </div>
        </div>
        <div className="cal-days" role="group" aria-label="ימי השבוע">
          {days.map((day, i) => {
            const count = shifts.filter((s) => intersectsDay(s, day)).length
            return (
              <button
                type="button"
                key={day}
                className="cal-day"
                aria-pressed={day === date}
                aria-current={day === today ? 'date' : undefined}
                aria-label={dateLabel.format(dateMs(day)) + ', ' + count + ' משמרות'}
                onClick={() => onDate(day)}
              >
                <span>{shortDay[i]}</span>
                <strong>{Number(day.slice(-2))}</strong>
                <i className={count ? 'cal-dot marked' : 'cal-dot'} aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </div>
      <div className="cal-agenda">
        <div className="cal-toolbar">
          <h2>{dateLabel.format(dateMs(date))}</h2>
          <button type="button" className="btn secondary" onClick={() => onAdd(date)}>
            <Plus size={16} aria-hidden="true" />
            הוספת משמרת
          </button>
        </div>
        {dayShifts.length === 0 ? (
          <div className="cal-empty">
            <CalendarDays aria-hidden="true" size={26} />
            <p>אין משמרות ביום הזה</p>
          </div>
        ) : (
          <ul className="cal-list">
            {dayShifts.map((shift) => {
              const crossDay = shift.status !== 'active' && localDate(shift.start) !== localDate(shift.end)
              return (
                <li key={shift.id}>
                  <button className="cal-entry" type="button" onClick={() => onEdit(shift)}>
                    <span className={'cal-mark ' + shift.status} aria-hidden="true" />
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
                    <span className={'cal-status ' + shift.status}>{statusLabels[shift.status]}</span>
                  </button>
                  {shift.status !== 'active' && (
                    <button
                      className="icon-btn"
                      type="button"
                      aria-label={'שכפול ' + (shift.title || 'משמרת עבודה')}
                      title="שכפול משמרת"
                      onClick={() => onDuplicate(shift)}
                    >
                      <Copy size={16} />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
