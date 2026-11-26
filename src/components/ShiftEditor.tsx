import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Bookmark, CalendarPlus, ChevronDown, Trash2 } from 'lucide-react'
import {
  buildManualShiftWrites,
  inferEndOffset,
  manualEndOffset,
  wall,
  wallFromInstant,
  type DaySelection,
  type ManualShiftWrites,
  type Wall,
} from '../data/manual-shifts'
import type { Template, WorkShift } from '../data/model'
import { addDays, dateMs, localDate, localToInstant } from '../domain/time'
import { ShiftDatesPicker } from './ShiftDatesPicker'
import { TimeRange } from './TimeRange'
import './calendar.css'

interface ShiftEditorProps {
  initial?: WorkShift
  date: string
  duplicate?: boolean
  templates: Template[]
  shifts: WorkShift[]
  onSave: (change: ManualShiftWrites) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onBusyChange?: (busy: boolean) => void
  onClose: () => void
}

const dateFormat = new Intl.DateTimeFormat('he-IL', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

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
          onChange={(event) => change(wall(event.target.value))}
        />
      </label>
      {hint && (
        <span className="se-time-hint" id={hintId}>
          {hint}
        </span>
      )}
      {foldDates.some((date) => isAmbiguous(date, value.time)) && (
        <label className="se-fold">
          {title} במעבר לשעון חורף
          <select
            value={value.fold}
            onChange={(event) => change({ ...value, fold: event.target.value as Wall['fold'] })}
          >
            <option value="earlier">השעה הראשונה · שעון קיץ</option>
            <option value="later">השעה החוזרת · שעון חורף</option>
          </select>
        </label>
      )}
    </div>
  )
}

function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)

  function resize(field: HTMLTextAreaElement) {
    field.style.height = 'auto'
    field.style.height = (field.scrollHeight + 2) + 'px'
  }

  useLayoutEffect(() => {
    const field = ref.current
    if (!field) return
    resize(field)
    let width = field.clientWidth
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return
      width = field.clientWidth
      resize(field)
      width = field.clientWidth
    })
    observer.observe(field)
    return () => observer.disconnect()
  }, [])

  return (
    <label className="se-field">
      <span className="se-field-label">הערה</span>
      <textarea
        ref={ref}
        className="se-note"
        rows={1}
        maxLength={2000}
        value={value}
        onChange={(event) => {
          resize(event.target)
          onChange(event.target.value)
        }}
      />
    </label>
  )
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
  const [note, setNote] = useState(initial?.note || '')
  const [selections, setSelections] = useState<DaySelection[]>([])
  const [pickingDates, setPickingDates] = useState(false)
  const [pickerFooter, setPickerFooter] = useState<HTMLDivElement | null>(null)
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

  const days = [day, ...selections.map((selection) => selection.date)].filter(Boolean)
  const endOffset = day ? manualEndOffset(day, start, end, editing ? initial : undefined) : 0
  const finishFoldDates = days.flatMap((date) => {
    const offset = date === day ? endOffset : inferEndOffset(date, start, end)
    const finishDate = addDays(date, offset)
    const canFinishOnStartDate =
      offset === 1 && inferEndOffset(date, start, { ...end, fold: 'later' }) === 0
    return canFinishOnStartDate ? [date, finishDate] : [finishDate]
  })
  const finishHint =
    endOffset === 1 ? 'למחרת' : endOffset > 1 ? dateFormat.format(dateMs(addDays(day, endOffset))) : undefined
  const replacements = selections.filter((selection) => selection.replacement).length
  const removals = new Set(selections.flatMap((selection) => selection.removed.map((shift) => shift.id))).size
  const changeSummary = [
    replacements === 1 ? 'משמרת אחת תוחלף' : replacements > 1 ? replacements + ' משמרות יוחלפו' : '',
    removals === 1 ? 'משמרת אחת תוסר' : removals > 1 ? removals + ' משמרות יוסרו' : '',
  ].filter(Boolean).join(' · ')

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0
    if (!pickingDates && restorePickerFocus.current) {
      restorePickerFocus.current = false
      pickerButtonRef.current?.focus({ preventScroll: true })
    }
  }, [pickingDates])

  function closeDatesPicker() {
    restorePickerFocus.current = true
    setPickingDates(false)
  }

  function markBusy(value: boolean) {
    setBusy(value)
    onBusyChange?.(value)
  }

  function reportError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : 'השמירה נכשלה. אפשר לנסות שוב.')
  }

  function applyTemplate(template: Template) {
    setStart(wall(template.start))
    setEnd(wall(template.end))
    setPanel(null)
    templateButtonRef.current?.focus()
    setNotice('התבנית הוחלה')
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || pickingDates) return
    setError('')
    setNotice('')
    try {
      const change = buildManualShiftWrites({ date: day, start, end, note, initial, duplicate, selections, shifts })
      markBusy(true)
      await onSave(change)
      onClose()
    } catch (reason) {
      reportError(reason)
    } finally {
      markBusy(false)
    }
  }

  async function deleteShift() {
    if (busy || !editing) return
    markBusy(true)
    setError('')
    try {
      await onDelete(initial.id)
      onClose()
    } catch (reason) {
      reportError(reason)
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
    <form noValidate onSubmit={submit} aria-busy={busy} className="se-form">
      <div className="se-content" ref={contentRef}>
        {pickingDates ? (
          <ShiftDatesPicker
            primary={day}
            selections={selections}
            shifts={shifts}
            footer={pickerFooter}
            onConfirm={(next) => {
              setSelections(next)
              setError('')
              closeDatesPicker()
            }}
            onBack={closeDatesPicker}
          />
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
                  setSelections((current) => current.filter((selection) => selection.date !== value))
                }}
              />
            </label>
            {!editing && (
              <div className="se-dates">
                <button
                  ref={pickerButtonRef}
                  className="se-option se-multi"
                  type="button"
                  disabled={!day}
                  onClick={() => setPickingDates(true)}
                >
                  <CalendarPlus size={17} aria-hidden="true" />
                  <span>אותן שעות בתאריכים נוספים</span>
                  {selections.length > 0 && <span className="se-count">{selections.length}</span>}
                </button>
                {changeSummary && <p className="se-change-summary" role="status">{changeSummary}</p>}
              </div>
            )}
            <div className="se-grid se-shift-times">
              <ClockField title="שעת התחלה" foldDates={days} value={start} change={setStart} />
              <ClockField
                title="שעת סיום"
                foldDates={finishFoldDates}
                value={end}
                change={setEnd}
                hint={finishHint}
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
                {note && <span className="se-dot" aria-hidden="true" />}
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
            <div className="se-panels">
              {templates.length > 0 && (
                <div
                  className="se-disclosure"
                  id={templatesId}
                  data-open={panel === 'templates'}
                  inert={panel !== 'templates'}
                >
                  <div className="se-disclosure-clip">
                    <div className="se-templates">
                      {templates.map((template) => (
                        <button key={template.id} type="button" onClick={() => applyTemplate(template)}>
                          <span>{template.title}</span>
                          <TimeRange start={template.start} end={template.end} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div className="se-disclosure" id={detailsId} data-open={panel === 'details'} inert={panel !== 'details'}>
                <div className="se-disclosure-clip">
                  <div className="se-details-body">
                    <NoteField value={note} onChange={setNote} />
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
                </div>
              </div>
            </div>
          </fieldset>
        )}
      </div>
      <div className="se-footer" ref={setPickerFooter}>
        {!pickingDates && (
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
