import { useId, useState, type FormEvent } from 'react'
import { BriefcaseBusiness, Check, ClipboardList, MoonStar, Pencil, UserRound } from 'lucide-react'
import type { UserProfile } from '../data/model'
import type { PayrollProfile } from '../domain/net'
import {
  answerError,
  applyAnswers,
  initialAnswers,
  visibleQuestions,
  type Answers,
  type Question,
} from '../domain/questionnaire'
import { Dialog } from './Dialog'

export type QuestionnaireProps = {
  profile: UserProfile
  payroll: PayrollProfile
  onSaveQuestionnaire: (
    profile: UserProfile,
    payroll: PayrollProfile,
    originalProfile: UserProfile,
    originalPayroll: PayrollProfile,
  ) => Promise<void>
}

const sections = [
  { id: 'work', title: 'עבודה ושכר', Icon: BriefcaseBusiness },
  { id: 'shifts', title: 'משמרות ומנוחה', Icon: MoonStar },
  { id: 'personal', title: 'הפרטים שלי', Icon: UserRound },
] as const

type Section = Question['section']

function QuestionField({
  question,
  value,
  error,
  onChange,
}: {
  question: Question
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  const id = useId()
  const hintId = question.hint ? id + '-hint' : undefined
  const hint = question.hint && (
    <p className="question-hint" id={hintId}>
      {question.hint}
    </p>
  )
  const errorId = error ? id + '-error' : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const feedback = error && (
    <p className="prefs-error" role="alert" id={errorId}>
      {error}
    </p>
  )
  const options = question.options ?? []
  if (question.kind === 'choice' && options.length <= 4) {
    return (
      <fieldset className="question-field" aria-describedby={describedBy} aria-invalid={Boolean(error)}>
        <legend>{question.title}</legend>
        {hint}
        <div className="question-choices">
          {options.map((option) => (
            <label key={option.value} className="question-chip">
              <input
                type="radio"
                name={question.id}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {feedback}
      </fieldset>
    )
  }
  return (
    <div className="question-field">
      <label htmlFor={id}>{question.title}</label>
      {hint}
      {question.kind === 'choice' ? (
        <select
          id={id}
          name={question.id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
        >
          <option value="" disabled>
            בחירה מהרשימה
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="question-number">
          <input
            id={id}
            type="number"
            inputMode={question.step === 1 ? 'numeric' : 'decimal'}
            dir="ltr"
            name={question.id}
            value={value}
            min={question.min}
            max={question.max}
            step={question.step ?? 'any'}
            aria-describedby={describedBy}
            aria-invalid={Boolean(error)}
            onChange={(e) => onChange(e.target.value)}
          />
          {question.unit && <span>{question.unit}</span>}
        </div>
      )}
      {feedback}
    </div>
  )
}

function QuestionnaireForm({
  profile,
  payroll,
  onSaveQuestionnaire,
  editSection,
  onDone,
  onBusy,
}: QuestionnaireProps & {
  editSection?: Section
  onDone?: () => void
  onBusy?: (busy: boolean) => void
}) {
  const [baseline] = useState(() => ({ profile, payroll }))
  const [answers, setAnswers] = useState(() => initialAnswers(baseline.profile, baseline.payroll))
  const [error, setError] = useState('')
  const [invalidField, setInvalidField] = useState('')
  const [saving, setSaving] = useState(false)
  const section = sections.find((entry) => entry.id === editSection) ?? sections[0]
  const currentQuestions = visibleQuestions(answers).filter((q) => q.section === section.id)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    for (const q of currentQuestions) {
      const message = answerError(q, answers)
      if (message) {
        setInvalidField(q.id)
        setError(message)
        event.currentTarget.querySelector<HTMLElement>(`[name="${q.id}"]`)?.focus()
        return
      }
    }
    setInvalidField('')
    setError('')
    setSaving(true)
    onBusy?.(true)
    try {
      const next = applyAnswers(baseline.profile, baseline.payroll, answers)
      await onSaveQuestionnaire(next.profile, next.payroll, baseline.profile, baseline.payroll)
      onDone?.()
    } catch (reason) {
      setError(
        reason instanceof Error && /[א-ת]/.test(reason.message)
          ? reason.message
          : 'התשובות לא נשמרו. אפשר לנסות שוב.',
      )
    } finally {
      setSaving(false)
      onBusy?.(false)
    }
  }

  return (
    <form className="question-form" onSubmit={submit} noValidate>
      <fieldset className="question-fields" disabled={saving}>
        <legend className="sr-only">{section.title}</legend>
        {currentQuestions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            value={answers[q.id] ?? ''}
            error={invalidField === q.id ? error : undefined}
            onChange={(value) => {
              setAnswers((current) => ({ ...current, [q.id]: value }))
              setError('')
            }}
          />
        ))}
      </fieldset>
      {error && !invalidField && (
        <p className="prefs-error" role="alert">
          {error}
        </p>
      )}
      <div className="question-actions">
        <button type="submit" className="prefs-primary" disabled={saving}>
          {saving ? 'בשמירה…' : editSection ? 'שמירת התשובות' : 'שמירה והתחלת העבודה'}
          {!saving && <Check size={16} />}
        </button>
      </div>
    </form>
  )
}

export function Onboarding(props: QuestionnaireProps) {
  return (
    <>
      <p className="prefs-hint questionnaire-intro">
        כדי להתחיל לתעד משמרות מספיק להזין שכר לשעה. אפשר להשלים פרטים לחישוב הנטו בהגדרות.
      </p>
      <QuestionnaireForm {...props} />
    </>
  )
}

function answerLabel(q: Question, answers: Answers) {
  const value = answers[q.id]
  if (!value) return 'טרם נענתה'
  return q.kind === 'choice'
    ? (q.options?.find((option) => option.value === value)?.label ?? 'טרם נענתה')
    : [Number(value).toLocaleString('he-IL', { useGrouping: Boolean(q.unit) }), q.unit]
        .filter(Boolean)
        .join(' ')
}

export function QuestionnaireSettings(props: QuestionnaireProps) {
  const [editing, setEditing] = useState<(typeof sections)[number] | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const answers = initialAnswers(props.profile, props.payroll)
  const questions = visibleQuestions(answers)
  return (
    <section className="prefs-card questionnaire-card">
      <header className="questionnaire-header">
        <span className="questionnaire-mark" aria-hidden="true">
          <ClipboardList size={24} />
        </span>
        <div>
          <h2>שאלון השכר שלי</h2>
          <p>התשובות שלך משמשות לחישוב השכר בכל משמרת ובדוח החודשי.</p>
        </div>
      </header>
      <div className="questionnaire-overview">
        {sections.map((section) => {
          const { id, title, Icon } = section
          return (
            <section key={id} className="question-group">
              <header>
                <h3>
                  <Icon size={17} aria-hidden="true" />
                  {title}
                </h3>
                <button
                  className="question-edit"
                  type="button"
                  aria-label={`עריכת ${title}`}
                  onClick={() => {
                    setEditing(section)
                    setNotice('')
                  }}
                >
                  <Pencil size={13} />
                  עריכה
                </button>
              </header>
              <dl>
                {questions
                  .filter((q) => q.section === id)
                  .map((q) => (
                    <div key={q.id}>
                      <dt>{q.title}</dt>
                      <dd data-empty={!answers[q.id]}>{answerLabel(q, answers)}</dd>
                    </div>
                  ))}
              </dl>
            </section>
          )
        })}
      </div>
      {notice && (
        <p className="prefs-status" role="status">
          {notice}
        </p>
      )}
      {editing && (
        <Dialog title={editing.title} onClose={() => setEditing(null)} closeDisabled={busy}>
          <QuestionnaireForm
            {...props}
            editSection={editing.id}
            onBusy={setBusy}
            onDone={() => {
              setEditing(null)
              setNotice('התשובות נשמרו')
            }}
          />
        </Dialog>
      )}
    </section>
  )
}
