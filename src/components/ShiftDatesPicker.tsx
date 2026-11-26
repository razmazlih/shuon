import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import type { DaySelection } from '../data/manual-shifts'
import type { WorkShift } from '../data/model'
import { addDays, addMonths, dateMs, localDate, localTime, monthDays } from '../domain/time'
import './shift-dates-picker.css'

type PickerProps = {
  primary: string
  selections: DaySelection[]
  shifts: WorkShift[]
  footer: HTMLElement | null
  onConfirm: (selections: DaySelection[]) => void
  onBack: () => void
}

type ShiftAction = 'keep' | 'replace' | 'remove'
const shiftActions = [
  { key: 'keep', label: 'להשאיר' },
  { key: 'replace', label: 'להחליף' },
  { key: 'remove', label: 'להסיר' },
] as const
const dayLabels = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
const dayFormat = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const monthFormat = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const shortDateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dateLabel = (date: string) => dayFormat.format(dateMs(date))

function refreshSelection(selection: DaySelection, shifts: WorkShift[]) {
  const isCurrent = (snapshot: WorkShift) =>
    shifts.some(
      (shift) => shift.id === snapshot.id && shift.updatedAt === snapshot.updatedAt && shift.status !== 'active',
    )
  const replacement = selection.replacement && isCurrent(selection.replacement) ? selection.replacement : undefined
  const removed = selection.removed.filter(isCurrent)
  return {
    selection: { ...selection, replacement, removed },
    changed: replacement !== selection.replacement || removed.length !== selection.removed.length,
  }
}

function ShiftDayManagement({
  shifts,
  selection,
  changed,
  onChange,
  onDeselect,
}: {
  shifts: WorkShift[]
  selection: DaySelection
  changed: boolean
  onChange: (selection: DaySelection) => void
  onDeselect: () => void
}) {
  function choose(shift: WorkShift, action: ShiftAction) {
    const removed = selection.removed.filter((item) => item.id !== shift.id)
    const replacement =
      action === 'replace' ? shift : selection.replacement?.id === shift.id ? undefined : selection.replacement
    onChange({ ...selection, replacement, removed: action === 'remove' ? [...removed, shift] : removed })
  }

  return (
    <>
      <p className="se-picker-description" role="status">
        {selection.replacement
          ? 'השעות וההערה יעודכנו במשמרת שבחרת להחליף.'
          : 'השעות וההערה יישמרו כמשמרת חדשה לצד המשמרות שנשארו.'}
      </p>
      {changed && (
        <p className="se-picker-alert" role="alert">
          המשמרות השתנו מאז הבחירה. אפשר לעבור על הפעולות ליום הזה ולאשר מחדש.
        </p>
      )}
      {shifts.length > 0 && (
        <ul className="se-day-shifts">
          {shifts.map((shift) => {
            const active = shift.status === 'active'
            const endDate = active ? selection.date : localDate(shift.end)
            const endDay =
              endDate === selection.date
                ? ''
                : endDate === addDays(selection.date, 1)
                  ? 'למחרת'
                  : 'עד ' + shortDateFormat.format(dateMs(endDate))
            const time = localTime(shift.start) + (active ? ' – …' : ' – ' + localTime(shift.end))
            const action =
              selection.replacement?.id === shift.id
                ? 'replace'
                : selection.removed.some((item) => item.id === shift.id)
                  ? 'remove'
                  : 'keep'
            return (
              <li className="se-day-shift" key={shift.id}>
                <div className="se-day-shift-summary">
                  <span>{shift.title || 'משמרת עבודה'}</span>
                  <bdi dir="ltr">{time}</bdi>
                  {endDay && <small>{endDay}</small>}
                  {active && <small>שעון נוכחות פעיל</small>}
                </div>
                {!active && (
                  <div className="se-day-shift-actions" role="group" aria-label={'פעולות למשמרת ' + time}>
                    {shiftActions.map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        data-action={key}
                        aria-pressed={action === key}
                        onClick={() => choose(shift, key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <button type="button" className="se-option se-deselect-day" onClick={onDeselect}>
        ביטול בחירת היום
      </button>
    </>
  )
}

export function ShiftDatesPicker({ primary, selections, shifts, footer, onConfirm, onBack }: PickerProps) {
  const [month, setMonth] = useState(primary.slice(0, 7))
  const [draft, setDraft] = useState(selections)
  const [management, setManagement] = useState<{ selection: DaySelection; changed: boolean } | null>(null)
  const section = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const returnToDay = useRef<{ date: string; scrollTop: number } | null>(null)
  const headingId = useId()
  const date = management?.selection.date
  const first = month + '-01'
  const byDay = useMemo(() => {
    const grouped = new Map<string, WorkShift[]>()
    for (const shift of shifts) {
      const date = localDate(shift.start)
      const rows = grouped.get(date)
      if (rows) rows.push(shift)
      else grouped.set(date, [shift])
    }
    for (const rows of grouped.values()) rows.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    return grouped
  }, [shifts])

  useLayoutEffect(() => {
    const content = section.current?.closest<HTMLElement>('.se-content')
    const previousDay = returnToDay.current
    if (!date && previousDay) {
      returnToDay.current = null
      section.current?.querySelector<HTMLElement>(`[data-date="${previousDay.date}"]`)?.focus({ preventScroll: true })
      if (content) content.scrollTop = previousDay.scrollTop
      return
    }
    if (content) content.scrollTop = 0
    heading.current?.focus({ preventScroll: true })
  }, [date])

  function changeMonth(offset: number) {
    setMonth((current) => addMonths(current + '-01', offset).slice(0, 7))
  }

  function pickDay(date: string) {
    const previous = draft.find((item) => item.date === date)
    const existing = byDay.get(date) || []
    if (existing.length || previous?.replacement || previous?.removed.length) {
      returnToDay.current = {
        date,
        scrollTop: section.current?.closest<HTMLElement>('.se-content')?.scrollTop || 0,
      }
      setManagement(refreshSelection(previous ?? { date, removed: [] }, existing))
      return
    }
    setDraft((items) => previous ? items.filter((item) => item.date !== date) : [...items, { date, removed: [] }])
  }

  function confirmDay() {
    if (!management) return
    const { selection } = management
    const latest = refreshSelection(selection, byDay.get(selection.date) || [])
    if (latest.changed) {
      setManagement(latest)
      return
    }
    setDraft((items) => [...items.filter((item) => item.date !== selection.date), selection])
    setManagement(null)
  }

  function deselectDay() {
    setDraft((items) => items.filter((item) => item.date !== date))
    setManagement(null)
  }

  function handleEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    if (management) setManagement(null)
    else onBack()
  }

  const confirmLabel =
    draft.length === 0
      ? 'אישור תאריכים'
      : draft.length === 1
        ? 'אישור תאריך נוסף'
        : 'אישור ' + draft.length + ' תאריכים נוספים'

  return (
    <section className="se-date-picker" ref={section} aria-labelledby={headingId} onKeyDown={handleEscape}>
      <h3 ref={heading} id={headingId} tabIndex={-1}>
        {date ? dateLabel(date) : 'אותן שעות בתאריכים נוספים'}
      </h3>
      {management ? (
        <ShiftDayManagement
          shifts={byDay.get(management.selection.date) || []}
          selection={management.selection}
          changed={management.changed}
          onChange={(selection) => setManagement({ ...management, selection })}
          onDeselect={deselectDay}
        />
      ) : (
        <>
          <p className="se-picker-description">בוחרים ימים בלוח כדי לרשום בהם את אותן שעות.</p>
          <div className="se-month">
            <button
              type="button"
              className="icon-btn"
              aria-label="לחודש הקודם"
              disabled={month === '0001-01'}
              onClick={() => changeMonth(-1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <strong aria-live="polite">{monthFormat.format(dateMs(first))}</strong>
            <button
              type="button"
              className="icon-btn"
              aria-label="לחודש הבא"
              disabled={month === '9999-12'}
              onClick={() => changeMonth(1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="se-month-days" role="group" aria-label="ימי החודש">
            {dayLabels.map((label) => <span className="se-weekday" key={label} aria-hidden="true">{label}</span>)}
            {monthDays(first).map((day, index) => {
              if (!day) return <span key={index} aria-hidden="true" />
              const occupied = byDay.has(day)
              const label = dateLabel(day) + (occupied ? ', יש משמרת קיימת' : '')
              const number = Number(day.slice(-2))
              if (day === primary)
                return (
                  <span key={day} className="se-primary-day" data-occupied={occupied}>
                    <span aria-hidden="true">{number}</span>
                    <span className="sr-only">{label}, התאריך הראשי</span>
                  </span>
                )
              return (
                <button
                  key={day}
                  type="button"
                  className="se-month-day"
                  data-date={day}
                  data-outside={!day.startsWith(month)}
                  data-occupied={occupied}
                  aria-label={label}
                  aria-pressed={draft.some((item) => item.date === day)}
                  onClick={() => pickDay(day)}
                >
                  {number}
                </button>
              )
            })}
          </div>
          <div className="se-picker-tools">
            <div className="se-picker-legend">
              <span className="se-primary-key">תאריך ראשי</span>
              <span className="se-occupied-key">משמרת קיימת</span>
            </div>
            <button
              type="button"
              className="se-option se-picker-reset"
              aria-disabled={draft.length === 0}
              onClick={() => {
                if (draft.length > 0) setDraft([])
              }}
            >
              <RotateCcw size={15} aria-hidden="true" />
              איפוס בחירה
            </button>
          </div>
        </>
      )}
      {footer && createPortal(
        <div className="se-picker-actions">
          <button type="button" className="btn primary" onClick={management ? confirmDay : () => onConfirm(draft)}>
            {management ? 'אישור ליום הזה' : confirmLabel}
          </button>
          <button type="button" className="btn secondary" onClick={management ? () => setManagement(null) : onBack}>
            {management ? 'חזרה ללוח' : 'חזרה'}
          </button>
        </div>,
        footer,
      )}
    </section>
  )
}
