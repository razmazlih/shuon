import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Bookmark, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import type { Template, WorkShift } from '../data/model'
import { addDays, dateMs, localDate, localTime, localToInstant, weekday } from '../domain/time'
import './calendar.css'

interface ShiftEditorProps {
  initial?: WorkShift
  date: string
  duplicate?: boolean
  templates: Template[]
  shifts: WorkShift[]
  onSave: (shifts: WorkShift[]) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onBusyChange?: (busy: boolean) => void
  onClose: () => void
}

type Fold = 'earlier' | 'later'
type Wall = { time: string; fold: Fold }
type PauseDraft = {
  id: string
  start: Wall
  end: Wall
  startDay: number
  endDay: number
  paid: boolean
  original?: WorkShift['breaks'][number]
}
const wall = (time: string): Wall => ({ time, fold: 'earlier' })
const dayOffset = (a: string, b: string) => (dateMs(b) - dateMs(a)) / 86_400_000
const dateFormat = new Intl.DateTimeFormat('he-IL', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const monthFormat = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const weekdays = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
const formatDate = (day: string) => dateFormat.format(dateMs(day))

function wallFromInstant(instant: string): Wall {
  const date = localDate(instant),
    time = localTime(instant)
  const earlier = localToInstant(date, time)
  return {
    time,
    fold:
      Math.floor(Date.parse(earlier) / 60_000) === Math.floor(Date.parse(instant) / 60_000)
        ? 'earlier'
        : 'later',
  }
}

function resolveClock(date: string, clock: Wall, original?: string) {
  const result = localToInstant(date, clock.time, clock.fold)
  if (original && Math.floor(Date.parse(result) / 60_000) === Math.floor(Date.parse(original) / 60_000))
    return original
  return result
}

function inferEndOffset(date: string, start: Wall, end: Wall) {
  if (!start.time || !end.time || end.time >= start.time) return 0
  try {
    if (Date.parse(resolveClock(date, end)) > Date.parse(resolveClock(date, start))) return 0
  } catch {
    // An invalid wall time is reported when the shift is saved.
  }
  return 1
}

function isAmbiguous(date: string, time: string) {
  try {
    return localToInstant(date, time) !== localToInstant(date, time, 'later')
  } catch {
    return false
  }
}

function ClockField({
  title,
  foldDates,
  hint,
  value,
  change,
}: {
  title: string
  foldDates: string[]
  hint?: string
  value: Wall
  change: (clock: Wall) => void
}) {
  const hintId = useId()
  return (
    <div className="se-clock">
      <label className="se-field">
        <span className="se-field-label">{title}</span>
        <input
          aria-describedby={hint ? hintId : undefined}
          required
          type="time"
          value={value.time}
          onChange={(e) => change(wall(e.target.value))}
        />
      </label>
      {hint && (
        <span className="se-time-hint" id={hintId}>
          {hint}
        </span>
      )}
      {foldDates.some((d) => isAmbiguous(d, value.time)) && (
        <label className="se-fold">
          {title} במעבר לשעון חורף
          <select value={value.fold} onChange={(e) => change({ ...value, fold: e.target.value as Fold })}>
            <option value="earlier">השעה הראשונה · שעון קיץ</option>
            <option value="later">השעה החוזרת · שעון חורף</option>
          </select>
        </label>
      )}
    </div>
  )
}

function DatesPicker({
  primary,
  selected,
  onChange,
}: {
  primary: string
  selected: string[]
  onChange: (selected: string[]) => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [month, setMonth] = useState(primary.slice(0, 7))
  const first = month + '-01'
  const firstDay = weekday(first)
  const year = Number(month.slice(0, 4))
  const monthIndex = Number(month.slice(5, 7)) - 1
  const monthEnd = new Date(dateMs(first))
  monthEnd.setUTCMonth(monthIndex + 1, 0)
  const headingId = useId()

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  function changeMonth(offset: number) {
    const next = new Date(dateMs(first))
    next.setUTCMonth(monthIndex + offset)
    setMonth(next.toISOString().slice(0, 7))
  }

  return (
    <section className="se-date-picker" aria-labelledby={headingId}>
      <div className="se-picker-intro">
        <h3 ref={headingRef} id={headingId} tabIndex={-1}>
          אותן שעות בתאריכים נוספים
        </h3>
        <p>בוחרים ימים בלוח כדי לרשום בהם את אותן שעות.</p>
      </div>
      <div className="se-month">
        <button
          type="button"
          className="icon-btn"
          aria-label="לחודש הקודם"
          disabled={year === 1 && monthIndex === 0}
          onClick={() => changeMonth(-1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <strong aria-live="polite">{monthFormat.format(dateMs(first))}</strong>
        <button
          type="button"
          className="icon-btn"
          aria-label="לחודש הבא"
          disabled={year === 9999 && monthIndex === 11}
          onClick={() => changeMonth(1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="se-month-days" role="group" aria-label="ימי החודש">
        {weekdays.map((name) => (
          <span key={name} aria-hidden="true">{name}</span>
        ))}
        {Array.from({ length: firstDay }, (_, index) => <span key={index} aria-hidden="true" />)}
        {Array.from({ length: monthEnd.getUTCDate() }, (_, index) => {
          const date = addDays(first, index)
          const chosen = selected.includes(date)
          if (date === primary)
            return (
              <span className="se-primary-day" key={date}>
                {index + 1}<span className="sr-only">, התאריך הראשי</span>
              </span>
            )
          return (
            <button
              key={date}
              type="button"
              className="se-month-day"
              aria-label={formatDate(date)}
              aria-pressed={chosen}
              onClick={() => onChange(chosen ? selected.filter((item) => item !== date) : [...selected, date])}
            >
              {index + 1}
            </button>
          )
        })}
      </div>
      <p className="se-primary-caption"><span aria-hidden="true" /> תאריך ראשי · {formatDate(primary)}</p>
    </section>
  )
}

function parsePauses(s?: WorkShift): PauseDraft[] {
  if (!s) return []
  const startDay = localDate(s.start)
  return s.breaks.map((b) => ({
    id: crypto.randomUUID(),
    start: wallFromInstant(b.start),
    end: wallFromInstant(b.end),
    startDay: dayOffset(startDay, localDate(b.start)),
    endDay: dayOffset(startDay, localDate(b.end)),
    paid: b.paid ?? false,
    original: b,
  }))
}

function spanOverlaps(a: WorkShift, b: WorkShift, now: number): boolean {
  const end = (s: WorkShift) =>
    s.status === 'active' ? Math.max(now, Date.parse(s.start) + 1) : Date.parse(s.end)
  return Date.parse(a.start) < end(b) && Date.parse(b.start) < end(a)
}

export function ShiftEditor({
  initial,
  date,
  duplicate = false,
  templates,
  shifts,
  onSave,
  onDelete,
  onBusyChange,
  onClose,
}: ShiftEditorProps) {
  const editing = !!initial && !duplicate
  const originalDate = initial ? localDate(initial.start) : date
  const defaultDate = duplicate && date === originalDate ? addDays(date, 1) : editing ? originalDate : date
  const [day, setDay] = useState(defaultDate)
  const [start, setStart] = useState(() => (initial ? wallFromInstant(initial.start) : wall('08:00')))
  const [end, setEnd] = useState(() => (initial ? wallFromInstant(initial.end) : wall('16:00')))
  const [endOffsetOverride, setEndOffsetOverride] = useState<number | null>(() => {
    if (!initial) return null
    const originalOffset = dayOffset(originalDate, localDate(initial.end))
    return originalOffset === inferEndOffset(originalDate, start, end) ? null : originalOffset
  })
  const [note, setNote] = useState(initial?.note || '')
  const [breaks, setBreaks] = useState<PauseDraft[]>(() => parsePauses(initial))
  const [extraDays, setExtraDays] = useState<string[]>([])
  const [pickerDays, setPickerDays] = useState<string[] | null>(null)
  const [panel, setPanel] = useState<'details' | 'templates' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const pickerButtonRef = useRef<HTMLButtonElement>(null)
  const restorePickerFocus = useRef(false)
  const templateButtonRef = useRef<HTMLButtonElement>(null)
  const detailsId = useId()
  const templatesId = useId()
  const offsetFor = (date: string) => endOffsetOverride ?? inferEndOffset(date, start, end)
  const endOffset = offsetFor(day)
  const endDate = day ? addDays(day, endOffset) : ''
  const days = [day, ...extraDays].filter(Boolean).sort()
  const finishFoldDates = days.flatMap((d) => {
    const finishDate = addDays(d, offsetFor(d))
    const couldFinishOnStartDate =
      endOffsetOverride === null && finishDate !== d && inferEndOffset(d, start, { ...end, fold: 'later' }) === 0
    return couldFinishOnStartDate ? [d, finishDate] : [finishDate]
  })
  const message = (reason: unknown) =>
    setError(reason instanceof Error ? reason.message : 'השמירה נכשלה. אפשר לנסות שוב.')

  const pickingDates = pickerDays !== null
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0
    if (!pickingDates && restorePickerFocus.current) {
      restorePickerFocus.current = false
      pickerButtonRef.current?.focus()
    }
  }, [pickingDates])

  function closeDatesPicker(confirm: boolean) {
    if (confirm && pickerDays) setExtraDays(pickerDays)
    restorePickerFocus.current = true
    setPickerDays(null)
  }

  function markBusy(value: boolean) {
    setBusy(value)
    onBusyChange?.(value)
  }

  function applyTemplate(template: Template) {
    setStart(wall(template.start))
    setEnd(wall(template.end))
    setEndOffsetOverride(null)
    setPanel(null)
    templateButtonRef.current?.focus()
    setNotice('התבנית הוחלה')
    setError('')
  }

  function changeBreak(id: string, next: Partial<PauseDraft>) {
    setBreaks((items) => items.map((b) => (b.id === id ? { ...b, ...next } : b)))
  }

  function addBreak() {
    let first = wall(start.time),
      last = wall(start.time),
      firstDay = 0,
      lastDay = 0
    try {
      const begin = Date.parse(resolveClock(day, start)),
        finish = Date.parse(resolveClock(endDate, end))
      const middle = Math.floor((begin + (finish - begin) / 2) / 60_000) * 60_000
      const stop = Math.min(finish, middle + 30 * 60_000)
      first = wallFromInstant(new Date(middle).toISOString())
      last = wallFromInstant(new Date(stop).toISOString())
      firstDay = dayOffset(day, localDate(middle))
      lastDay = dayOffset(day, localDate(stop))
    } catch {
      /* The user can set both break times manually. */
    }
    setBreaks((items) => [
      ...items,
      { id: crypto.randomUUID(), start: first, end: last, startDay: firstDay, endDay: lastDay, paid: false },
    ])
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || pickingDates) return
    setError('')
    setNotice('')
    if (!day) {
      setError('יש לבחור תאריך למשמרת.')
      return
    }
    try {
      const now = Date.now(),
        updatedAt = new Date(now).toISOString()
      const changes = days.map((d): WorkShift => {
        const resolve = (date: string, clock: Wall, original?: string) => {
          try {
            return resolveClock(date, clock, original)
          } catch (reason) {
            if (reason instanceof Error) throw new Error(formatDate(d) + ' · ' + reason.message)
            throw reason
          }
        }
        const shiftStart = resolve(d, start, initial?.start)
        const shiftEnd = resolve(addDays(d, offsetFor(d)), end, initial?.end)
        const begin = Date.parse(shiftStart),
          finish = Date.parse(shiftEnd)
        if (finish <= begin)
          throw new Error(formatDate(d) + ' · שעת הסיום צריכה להיות אחרי שעת ההתחלה.')
        let pauses
        try {
          pauses = breaks
            .map((b) => ({
              start: resolve(addDays(d, b.startDay), b.start, b.original?.start),
              end: resolve(addDays(d, b.endDay), b.end, b.original?.end),
              paid: b.paid,
            }))
            .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
          let previous = begin
          for (const b of pauses) {
            if (
              Date.parse(b.start) < previous ||
              Date.parse(b.end) <= Date.parse(b.start) ||
              Date.parse(b.end) > finish
            ) {
              throw new Error(formatDate(d) + ' · ההפסקות צריכות להיות בתוך המשמרת וללא חפיפה.')
            }
            previous = Date.parse(b.end)
          }
        } catch (reason) {
          setPanel('details')
          throw reason
        }
        return {
          ...(editing ? initial : {}),
          id: editing ? initial!.id : crypto.randomUUID(),
          title: editing ? initial.title : 'משמרת עבודה',
          start: shiftStart,
          end: shiftEnd,
          status: finish <= now ? 'completed' : 'planned',
          breaks: pauses,
          note: note.trim(),
          updatedAt,
          openBreak: null,
        }
      })
      const existing = shifts.filter((s) => !editing || s.id !== initial!.id)
      for (const s of changes) {
        if (existing.some((other) => spanOverlaps(s, other, now))) {
          throw new Error(
            'המשמרת בתאריך ' + formatDate(localDate(s.start)) + ' חופפת למשמרת אחרת.',
          )
        }
        existing.push(s)
      }
      markBusy(true)
      await onSave(changes)
      onClose()
    } catch (reason) {
      message(reason)
    } finally {
      markBusy(false)
    }
  }

  async function deleteShift() {
    if (busy || !initial || !editing) return
    markBusy(true)
    setError('')
    try {
      await onDelete(initial.id)
      onClose()
    } catch (reason) {
      message(reason)
    } finally {
      markBusy(false)
    }
  }

  if (editing && initial.status === 'active')
    return (
      <div className="se-form">
        <p>המשמרת פעילה. אפשר לסיים אותה בשעון הנוכחות ולערוך את הפרטים לאחר מכן.</p>
        <button type="button" className="btn secondary" onClick={onClose}>
          סגירה
        </button>
      </div>
    )

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-busy={busy}
      className="se-form"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && pickingDates) {
          event.preventDefault()
          closeDatesPicker(false)
        }
      }}
    >
      <div className="se-content" ref={contentRef}>
        {pickerDays ? (
          <DatesPicker primary={day} selected={pickerDays} onChange={setPickerDays} />
        ) : (
          <fieldset disabled={busy} className="se-body">
            <label className="se-field">
              <span className="se-field-label">תאריך המשמרת</span>
              <input
                type="date"
                value={day}
                required
                onChange={(event) => {
                  const value = event.target.value
                  if (value && value.length !== 10) return
                  setDay(value)
                  setExtraDays((dates) => dates.filter((date) => date !== value))
                }}
              />
            </label>
            {!editing && (
              <button
                ref={pickerButtonRef}
                className="se-option se-multi"
                type="button"
                disabled={!day}
                onClick={() => setPickerDays(extraDays)}
              >
                <CalendarPlus size={17} aria-hidden="true" />
                <span>אותן שעות בתאריכים נוספים</span>
                {extraDays.length > 0 && <span className="se-count">{extraDays.length}</span>}
              </button>
            )}
            <div className="se-grid se-shift-times">
              <ClockField title="שעת התחלה" foldDates={days} value={start} change={setStart} />
              <ClockField
                title="שעת סיום"
                foldDates={finishFoldDates}
                value={end}
                change={setEnd}
                hint={endOffset === 1 ? 'למחרת' : endOffset > 1 && endDate ? formatDate(endDate) : undefined}
              />
            </div>
            <div className="se-options">
              <button
                type="button"
                className="se-option"
                aria-expanded={panel === 'details'}
                aria-controls={detailsId}
                onClick={() => setPanel(panel === 'details' ? null : 'details')}
              >
                <ChevronDown size={16} aria-hidden="true" />
                פרטים נוספים
                {(breaks.length > 0 || note || endOffsetOverride !== null) && (
                  <span className="se-dot" aria-hidden="true" />
                )}
              </button>
              {templates.length > 0 && (
                <button
                  ref={templateButtonRef}
                  type="button"
                  className="se-option"
                  aria-expanded={panel === 'templates'}
                  aria-controls={templatesId}
                  onClick={() => setPanel(panel === 'templates' ? null : 'templates')}
                >
                  <Bookmark size={15} aria-hidden="true" />
                  בחירה מתבנית
                </button>
              )}
            </div>
            <div className="se-templates" id={templatesId} hidden={panel !== 'templates'}>
              {templates.map((template) => (
                <button key={template.id} type="button" onClick={() => applyTemplate(template)}>
                  <span>{template.title}</span>
                  <bdi dir="ltr">{template.start}–{template.end}</bdi>
                </button>
              ))}
            </div>
            <div className="se-details-body" id={detailsId} hidden={panel !== 'details'}>
              <label className="se-field">
                <span className="se-field-label">תאריך סיום</span>
                <input
                  type="date"
                  value={endDate}
                  min={day}
                  disabled={!day}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value.length === 10 && value >= day)
                      setEndOffsetOverride(dayOffset(day, value))
                    else if (!value) setEndOffsetOverride(null)
                  }}
                />
              </label>
              {endOffsetOverride !== null && (
                <button className="se-option" type="button" onClick={() => setEndOffsetOverride(null)}>
                  חזרה לתאריך סיום אוטומטי
                </button>
              )}
              <label className="se-field">
                <span className="se-field-label">הערה</span>
                <textarea rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="se-breaks">
                <div className="se-section-row">
                  <strong>הפסקות</strong>
                  <button type="button" className="se-option" onClick={addBreak}>
                    <Plus size={16} aria-hidden="true" />
                    הוספת הפסקה
                  </button>
                </div>
                {breaks.map((b, i) => (
                  <div className="se-pause" key={b.id}>
                    <div className="se-section-row">
                      <strong>הפסקה {i + 1}</strong>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={'הסרת הפסקה ' + (i + 1)}
                        onClick={() => setBreaks((items) => items.filter((item) => item.id !== b.id))}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="se-grid">
                      <ClockField
                        title="תחילת הפסקה"
                        foldDates={days.map((date) => addDays(date, b.startDay))}
                        value={b.start}
                        change={(v) => changeBreak(b.id, { start: v })}
                      />
                      <ClockField
                        title="סיום הפסקה"
                        foldDates={days.map((date) => addDays(date, b.endDay))}
                        value={b.end}
                        change={(v) => changeBreak(b.id, { end: v })}
                      />
                      {day && (endOffset > 0 || b.startDay !== 0 || b.endDay !== 0) && (
                        <>
                          <label className="se-field">
                            <span className="se-field-label">תאריך תחילת הפסקה</span>
                            <input
                              type="date"
                              min={day}
                              max={endDate}
                              value={addDays(day, b.startDay)}
                              onChange={(e) => {
                                if (e.target.value.length === 10 && e.target.value >= day && e.target.value <= endDate)
                                  changeBreak(b.id, { startDay: dayOffset(day, e.target.value) })
                              }}
                            />
                          </label>
                          <label className="se-field">
                            <span className="se-field-label">תאריך סיום הפסקה</span>
                            <input
                              type="date"
                              min={day}
                              max={endDate}
                              value={addDays(day, b.endDay)}
                              onChange={(e) => {
                                if (e.target.value.length === 10 && e.target.value >= day && e.target.value <= endDate)
                                  changeBreak(b.id, { endDay: dayOffset(day, e.target.value) })
                              }}
                            />
                          </label>
                        </>
                      )}
                    </div>
                    <label className="se-check">
                      <input
                        type="checkbox"
                        checked={b.paid}
                        onChange={(e) => changeBreak(b.id, { paid: e.target.checked })}
                      />
                      הפסקה בתשלום
                    </label>
                  </div>
                ))}
              </div>
              {editing && !confirmDelete && (
                <button className="se-option se-delete" type="button" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={16} aria-hidden="true" />
                  מחיקת משמרת
                </button>
              )}
              {confirmDelete && (
                <div className="se-confirm" role="group" aria-label="אישור מחיקת המשמרת">
                  <span>למחוק את המשמרת מהיומן?</span>
                  <div>
                    <button type="button" className="btn secondary" onClick={() => setConfirmDelete(false)}>
                      חזרה
                    </button>
                    <button type="button" className="btn se-destructive" onClick={deleteShift}>
                      כן, למחוק
                    </button>
                  </div>
                </div>
              )}
            </div>
          </fieldset>
        )}
      </div>
      <div className="se-footer">
        {pickerDays ? (
          <div className="se-picker-actions">
            <button type="button" className="btn primary" onClick={() => closeDatesPicker(true)}>
              {pickerDays.length === 0
                ? 'אישור תאריכים'
                : pickerDays.length === 1
                  ? 'אישור תאריך נוסף'
                  : 'אישור ' + pickerDays.length + ' תאריכים נוספים'}
            </button>
            <button type="button" className="btn secondary" onClick={() => closeDatesPicker(false)}>חזרה</button>
          </div>
        ) : (
          <>
            {error && <p className="se-error" role="alert">{error}</p>}
            {notice && <p className="sr-only" role="status">{notice}</p>}
            <button type="submit" className="btn primary se-save" disabled={busy}>
              {busy ? 'שומר…' : days.length > 1 ? 'שמירת ' + days.length + ' משמרות' : 'שמירת משמרת'}
            </button>
          </>
        )}
      </div>
    </form>
  )
}
