import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Bookmark, CalendarPlus, Check, Trash2 } from 'lucide-react'
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
import { Dialog } from './Dialog'
import { ShiftDatesPicker } from './ShiftDatesPicker'
import { TimeRange } from './TimeRange'
import './calendar.css'

interface ShiftEditorProps {
  preview?: { title: string; content: ReactNode }
  transitionFrom?: DOMRect
  initial?: WorkShift
  date: string
  templates: Template[]
  shifts: WorkShift[]
  onSave: (change: ManualShiftWrites) => Promise<void>
  onDelete: (id: string) => Promise<void>
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
  disabled,
}: {
  title: string
  foldDates: string[]
  hint?: string
  value: Wall
  change: (clock: Wall) => void
  disabled: boolean
}) {
  const hintId = useId()
  return (
    <div className="se-clock">
      <label className="se-field">
        <span className="se-field-label">{title}</span>
        <input
          aria-describedby={hint ? hintId : undefined}
          required
          disabled={disabled}
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
      <span className="se-field-label">הערה <small className="se-optional">לא חובה</small></span>
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
  preview,
  transitionFrom,
  initial,
  date,
  templates,
  shifts,
  onSave,
  onDelete,
  onClose,
}: ShiftEditorProps) {
  const editing = !!initial
  const originalDate = initial ? localDate(initial.start) : date
  const defaultDate = editing ? originalDate : date
  const [day, setDay] = useState(defaultDate)
  const [start, setStart] = useState(() => (initial ? wallFromInstant(initial.start) : wall('08:00')))
  const [end, setEnd] = useState(() => (initial ? wallFromInstant(initial.end) : wall('16:00')))
  const [note, setNote] = useState(initial?.note || '')
  const [selections, setSelections] = useState<DaySelection[]>([])
  const [pickingDates, setPickingDates] = useState(false)
  const [pickerFooter, setPickerFooter] = useState<HTMLDivElement | null>(null)
  const [timeMode, setTimeMode] = useState<'manual' | 'template'>('manual')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const pickerButtonRef = useRef<HTMLButtonElement>(null)
  const restorePickerFocus = useRef(false)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const restoreDeleteFocus = useRef(false)
  const useTemplate = timeMode === 'template' && templates.length > 0
  const needsTemplate = useTemplate && !templates.some((template) => template.id === selectedTemplateId)

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

  useLayoutEffect(() => {
    if (confirmDelete) cancelDeleteRef.current?.focus()
    else if (restoreDeleteFocus.current) {
      restoreDeleteFocus.current = false
      deleteButtonRef.current?.focus()
    }
  }, [confirmDelete])

  function cancelDeletion() {
    restoreDeleteFocus.current = true
    setConfirmDelete(false)
    setError('')
  }

  function closeDatesPicker() {
    restorePickerFocus.current = true
    setPickingDates(false)
  }

  function reportError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : 'השמירה נכשלה. אפשר לנסות שוב.')
  }

  function applyTemplate(template: Template) {
    setStart(wall(template.start))
    setEnd(wall(template.end))
    setSelectedTemplateId(template.id)
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || pickingDates || confirmDelete || needsTemplate) return
    setError('')
    try {
      const change = buildManualShiftWrites({ date: day, start, end, note, initial, selections, shifts })
      setBusy(true)
      await onSave(change)
      onClose()
    } catch (reason) {
      reportError(reason)
    } finally {
      setBusy(false)
    }
  }

  async function deleteShift() {
    if (busy || !editing || !confirmDelete) return
    setBusy(true)
    setError('')
    try {
      await onDelete(initial.id)
      onClose()
    } catch (reason) {
      reportError(reason)
    } finally {
      setBusy(false)
    }
  }

  const form = (
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
            {templates.length > 0 && (
              <div className="se-time-mode" role="group" aria-label="אופן בחירת שעות">
                <button type="button" aria-pressed={!useTemplate} onClick={() => setTimeMode('manual')}>
                  שעות ידניות
                </button>
                <button type="button" aria-pressed={useTemplate} onClick={() => setTimeMode('template')}>
                  <Bookmark size={15} aria-hidden="true" /> מתבנית
                </button>
              </div>
            )}
            <div className="se-time-panels">
              <div className="se-time-panel" inert={!useTemplate}>
                <div className="se-templates" role="group" aria-label="תבניות משמרת">
                  {templates.map((template) => (
                    <button key={template.id} type="button" aria-pressed={selectedTemplateId === template.id} onClick={() => applyTemplate(template)}>
                      <span>{template.title}</span>
                      <small>
                        <TimeRange start={template.start} end={template.end} />
                        {template.end < template.start && ' · למחרת'}
                      </small>
                      <Check size={15} className="se-template-check" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
              <div className="se-time-panel" inert={useTemplate}>
                <div className="se-grid se-shift-times">
                  <ClockField
                    disabled={useTemplate}
                    title="שעת התחלה"
                    foldDates={days}
                    value={start}
                    change={(value) => {
                      setStart(value)
                      setSelectedTemplateId(null)
                    }}
                  />
                  <ClockField
                    disabled={useTemplate}
                    title="שעת סיום"
                    foldDates={finishFoldDates}
                    value={end}
                    change={(value) => {
                      setEnd(value)
                      setSelectedTemplateId(null)
                    }}
                    hint={finishHint}
                  />
                </div>
              </div>
            </div>
            <NoteField value={note} onChange={setNote} />
          </fieldset>
        )}
      </div>
      <div className="se-footer" ref={setPickerFooter}>
        {!pickingDates && (
          <>
            {error && <p className="se-error" role="alert">{error}</p>}
            {changeSummary && <p className="se-change-summary" role="status">{changeSummary}</p>}
            {confirmDelete ? (
              <div className="se-confirm" role="group" aria-label="אישור מחיקת המשמרת">
                <strong>למחוק את המשמרת מהיומן?</strong>
                <span>{dateFormat.format(dateMs(originalDate))} · לא ניתן לבטל אחרי המחיקה.</span>
                <div className="se-actions">
                  <button ref={cancelDeleteRef} type="button" className="btn secondary" disabled={busy} onClick={cancelDeletion}>
                    ביטול
                  </button>
                  <button type="button" className="btn se-destructive" disabled={busy} onClick={deleteShift}>
                    {busy ? 'מוחק…' : 'כן, למחוק'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="se-actions">
                <button type="submit" className="btn primary" disabled={busy || needsTemplate}>
                  {busy ? 'שומר…' : days.length > 1 ? 'שמירת ' + days.length + ' משמרות' : 'שמירת משמרת'}
                </button>
                {editing ? (
                  <button ref={deleteButtonRef} type="button" className="btn secondary se-delete" disabled={busy} onClick={() => {
                    setError('')
                    setConfirmDelete(true)
                  }}>
                    <Trash2 size={16} aria-hidden="true" />
                    מחיקת משמרת
                  </button>
                ) : (
                  <button
                    ref={pickerButtonRef}
                    className="btn secondary"
                    type="button"
                    disabled={busy || !day || needsTemplate}
                    onClick={() => setPickingDates(true)}
                  >
                    <CalendarPlus size={17} aria-hidden="true" />
                    <span>{selections.length ? 'עריכת ימים נוספים' : 'בחירת ימים נוספים'}</span>
                    {selections.length > 0 && <span className="se-count">{selections.length}</span>}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </form>
  )

  return (
    <Dialog
      title={preview?.title ?? (editing ? 'עריכת משמרת' : 'הוספת משמרת')}
      className={preview ? undefined : 'shift-editor-modal'}
      transitionFrom={transitionFrom}
      closeDisabled={busy}
      onClose={pickingDates ? undefined : confirmDelete ? cancelDeletion : onClose}
      onBack={pickingDates ? closeDatesPicker : undefined}
    >
      {preview ? preview.content : editing && initial.status === 'active' ? (
        <div className="se-form">
          <p>המשמרת פעילה. אפשר לסיים אותה בשעון הנוכחות ולערוך את הפרטים לאחר מכן.</p>
          <button type="button" className="btn secondary" onClick={onClose}>
            סגירה
          </button>
        </div>
      ) : form}
    </Dialog>
  )
}
