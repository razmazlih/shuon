import { useState, type FormEvent } from 'react'
import { Bookmark, CalendarPlus, Plus, Trash2, X } from 'lucide-react'
import type { Template, WorkShift } from '../data/model'
import { addDays, dateMs, localDate, localTime, localToInstant } from '../domain/time'
import './calendar.css'

interface ShiftEditorProps {
  initial?: WorkShift
  date: string
  duplicate?: boolean
  templates: Template[]
  shifts: WorkShift[]
  onSave: (shifts: WorkShift[]) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onTemplate: (template: Template) => Promise<void>
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
  timeZone: 'UTC',
})

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

function ClockField({
  title,
  date,
  value,
  change,
}: {
  title: string
  date: string
  value: Wall
  change: (clock: Wall) => void
}) {
  let ambiguous = false
  try {
    ambiguous = localToInstant(date, value.time) !== localToInstant(date, value.time, 'later')
  } catch {
    /* Missing and skipped times are checked on save. */
  }
  return (
    <div className="se-clock">
      <label className="se-field">
        <span>{title}</span>
        <input required type="time" value={value.time} onChange={(e) => change(wall(e.target.value))} />
      </label>
      {ambiguous && (
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
  onTemplate,
  onClose,
}: ShiftEditorProps) {
  const editing = !!initial && !duplicate
  const originalDate = initial ? localDate(initial.start) : date
  const defaultDate = duplicate && date === originalDate ? addDays(date, 1) : editing ? originalDate : date
  const originalStatus = initial?.status === 'completed' ? 'completed' : 'planned'
  const [status, setStatus] = useState<'planned' | 'completed'>(() =>
    duplicate
      ? 'planned'
      : initial
        ? originalStatus
        : defaultDate < localDate(Date.now())
          ? 'completed'
          : 'planned',
  )
  const [day, setDay] = useState(defaultDate)
  const [endOffset, setEndOffset] = useState(initial ? dayOffset(originalDate, localDate(initial.end)) : 0)
  const [start, setStart] = useState(initial ? wallFromInstant(initial.start) : wall('08:00'))
  const [end, setEnd] = useState(initial ? wallFromInstant(initial.end) : wall('16:00'))
  const [title, setTitle] = useState(initial?.title || '')
  const [note, setNote] = useState(initial?.note || '')
  const [breaks, setBreaks] = useState<PauseDraft[]>(() => parsePauses(initial))
  const [extraDays, setExtraDays] = useState<string[]>([])
  const [candidate, setCandidate] = useState(addDays(defaultDate, 1))
  const [templateName, setTemplateName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const endDate = day ? addDays(day, endOffset) : ''
  const days = [...new Set([day, ...extraDays])].sort()
  const message = (reason: unknown) =>
    setError(reason instanceof Error ? reason.message : 'השמירה נכשלה. אפשר לנסות שוב.')

  function updateClock(isStart: boolean, next: Wall) {
    if (isStart) setStart(next)
    else setEnd(next)
    const first = isStart ? next.time : start.time
    const last = isStart ? end.time : next.time
    if (first && last && endOffset <= 1 && first !== last) {
      const repeats =
        day &&
        first > last &&
        (() => {
          try {
            return Date.parse(localToInstant(day, last, 'later')) > Date.parse(localToInstant(day, first))
          } catch {
            return false
          }
        })()
      setEndOffset(last < first && !repeats ? 1 : 0)
    }
  }

  function applyTemplate(template: Template) {
    setStart(wall(template.start))
    setEnd(wall(template.end))
    setEndOffset(template.end < template.start ? 1 : 0)
    setTitle(template.title)
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
    if (busy) return
    setError('')
    setNotice('')
    try {
      const now = Date.now(),
        updatedAt = new Date(now).toISOString()
      const changes = days.map((d): WorkShift => {
        const shiftStart = resolveClock(d, start, initial?.start)
        const shiftEnd = resolveClock(addDays(d, endOffset), end, initial?.end)
        const begin = Date.parse(shiftStart),
          finish = Date.parse(shiftEnd)
        if (finish <= begin)
          throw new Error('שעת הסיום צריכה להיות אחרי שעת ההתחלה. במשמרת לילה יש לבדוק גם את תאריך הסיום.')
        if (status === 'completed' && finish > now)
          throw new Error('אפשר לסמן משמרת כבוצעה רק לאחר שעת הסיום שלה.')
        const pauses = breaks
          .map((b) => ({
            start: resolveClock(addDays(d, b.startDay), b.start, b.original?.start),
            end: resolveClock(addDays(d, b.endDay), b.end, b.original?.end),
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
            throw new Error('ההפסקות צריכות להיות בתוך המשמרת, בסדר זמנים תקין וללא חפיפה.')
          }
          previous = Date.parse(b.end)
        }
        return {
          ...(editing ? initial : {}),
          id: editing ? initial!.id : crypto.randomUUID(),
          title: title.trim() || 'משמרת עבודה',
          start: shiftStart,
          end: shiftEnd,
          status,
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
            'המשמרת בתאריך ' + dateFormat.format(dateMs(localDate(s.start))) + ' חופפת למשמרת אחרת.',
          )
        }
        existing.push(s)
      }
      setBusy(true)
      await onSave(changes)
      onClose()
    } catch (reason) {
      message(reason)
    } finally {
      setBusy(false)
    }
  }

  async function saveTemplate() {
    if (busy) return
    setError('')
    setNotice('')
    const name = templateName.trim() || title.trim()
    if (!name || !start.time || !end.time || start.time === end.time) {
      setError('לשמירת תבנית יש להזין שם ושעות התחלה וסיום שונות.')
      return
    }
    setBusy(true)
    try {
      const existing = templates.find((t) => t.title === name && t.start === start.time && t.end === end.time)
      if (!existing)
        await onTemplate({ id: crypto.randomUUID(), title: name, start: start.time, end: end.time })
      setNotice('התבנית נשמרה')
      setTemplateName('')
    } catch (reason) {
      message(reason)
    } finally {
      setBusy(false)
    }
  }

  async function deleteShift() {
    if (busy || !initial || !editing) return
    setBusy(true)
    setError('')
    try {
      await onDelete(initial.id)
      onClose()
    } catch (reason) {
      message(reason)
    } finally {
      setBusy(false)
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
    <form onSubmit={submit} className="se-form">
      <fieldset disabled={busy} className="se-body">
        <div className="se-status" role="group" aria-label="מצב המשמרת">
          <button type="button" aria-pressed={status === 'planned'} onClick={() => setStatus('planned')}>
            מתוכננת
          </button>
          <button type="button" aria-pressed={status === 'completed'} onClick={() => setStatus('completed')}>
            בוצעה
          </button>
        </div>
        {templates.length > 0 && (
          <label className="se-field">
            מילוי מתבנית
            <select
              value=""
              onChange={(e) => {
                const template = templates.find((t) => t.id === e.target.value)
                if (template) applyTemplate(template)
              }}
            >
              <option value="">בחירת תבנית</option>
              {templates.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.title} · {t.start}–{t.end}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="se-field">
          שם המשמרת
          <input
            value={title}
            placeholder="משמרת עבודה"
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="se-grid">
          <label className="se-field">
            תאריך התחלה
            <input type="date" value={day} required onChange={(e) => setDay(e.target.value)} />
          </label>
          <ClockField title="שעת התחלה" date={day} value={start} change={(s) => updateClock(true, s)} />
          <label className="se-field">
            תאריך סיום
            <input
              type="date"
              value={endDate}
              min={day}
              required
              onChange={(e) => {
                if (day && e.target.value) setEndOffset(dayOffset(day, e.target.value))
              }}
            />
          </label>
          <ClockField title="שעת סיום" date={endDate} value={end} change={(s) => updateClock(false, s)} />
        </div>
        <details className="se-details" open={breaks.length > 0 || undefined}>
          <summary>הפסקות{breaks.length > 0 && ' (' + breaks.length + ')'}</summary>
          <div className="se-details-body">
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
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="se-grid">
                  <ClockField
                    title="תחילת הפסקה"
                    date={day && addDays(day, b.startDay)}
                    value={b.start}
                    change={(v) => changeBreak(b.id, { start: v })}
                  />
                  <ClockField
                    title="סיום הפסקה"
                    date={day && addDays(day, b.endDay)}
                    value={b.end}
                    change={(v) => changeBreak(b.id, { end: v })}
                  />
                  {endOffset > 0 && day && (
                    <>
                      <label className="se-field">
                        תאריך תחילת הפסקה
                        <input
                          type="date"
                          required
                          min={day}
                          max={endDate}
                          value={addDays(day, b.startDay)}
                          onChange={(e) => {
                            if (e.target.value)
                              changeBreak(b.id, { startDay: dayOffset(day, e.target.value) })
                          }}
                        />
                      </label>
                      <label className="se-field">
                        תאריך סיום הפסקה
                        <input
                          type="date"
                          required
                          min={day}
                          max={endDate}
                          value={addDays(day, b.endDay)}
                          onChange={(e) => {
                            if (e.target.value) changeBreak(b.id, { endDay: dayOffset(day, e.target.value) })
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
            <button type="button" className="btn secondary" onClick={addBreak}>
              <Plus size={15} />
              הוספת הפסקה
            </button>
          </div>
        </details>
        {!editing && (
          <details className="se-details">
            <summary>הוספה למספר תאריכים{extraDays.length > 0 && ' (' + days.length + ')'}</summary>
            <div className="se-details-body">
              <div className="se-inline">
                <label className="se-field">
                  תאריך נוסף
                  <input type="date" value={candidate} onChange={(e) => setCandidate(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!candidate || days.includes(candidate)}
                  onClick={() => {
                    setExtraDays((items) => [...items, candidate])
                    setCandidate(addDays(candidate, 1))
                  }}
                >
                  <CalendarPlus size={16} />
                  הוספה
                </button>
              </div>
              {extraDays.length > 0 && (
                <div className="se-chips">
                  {extraDays.map((d) => (
                    <button
                      className="se-chip"
                      key={d}
                      type="button"
                      aria-label={'הסרת ' + d}
                      onClick={() => setExtraDays((items) => items.filter((v) => v !== d))}
                    >
                      {dateFormat.format(dateMs(d))}
                      <X size={14} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </details>
        )}
        <details className="se-details">
          <summary>הערה ותבניות</summary>
          <div className="se-details-body">
            <label className="se-field">
              הערה
              <textarea rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="se-inline">
              <label className="se-field">
                שם לתבנית
                <input
                  value={templateName}
                  maxLength={120}
                  placeholder={title.trim() || 'למשל, משמרת בוקר'}
                  onChange={(e) => setTemplateName(e.target.value)}
                />
              </label>
              <button type="button" className="btn secondary" onClick={saveTemplate}>
                <Bookmark size={15} />
                שמירת שעות כתבנית
              </button>
            </div>
          </div>
        </details>
        {error && (
          <p className="se-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="se-notice" role="status">
            {notice}
          </p>
        )}
        <div className="se-actions">
          <button type="submit" className="btn primary">
            {busy ? 'שומר…' : days.length > 1 ? 'שמירת ' + days.length + ' משמרות' : 'שמירת משמרת'}
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            ביטול
          </button>
          {editing && !confirmDelete && (
            <button type="button" className="se-delete" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} />
              מחיקה
            </button>
          )}
        </div>
        {confirmDelete && (
          <div className="se-confirm" role="group" aria-label="אישור מחיקת המשמרת">
            <span>למחוק את המשמרת מהיומן?</span>
            <button type="button" className="btn secondary" onClick={() => setConfirmDelete(false)}>
              חזרה
            </button>
            <button type="button" className="btn se-destructive" onClick={deleteShift}>
              כן, למחוק
            </button>
          </div>
        )}
      </fieldset>
    </form>
  )
}
