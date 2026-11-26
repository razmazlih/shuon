import './onboarding.css'
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

const onboardingSteps = ['hourlyRate', 'restDay', 'pension'] as const

const sections = [
  { id: 'work', title: 'עבודה ושכר', Icon: BriefcaseBusiness },
  { id: 'shifts', title: 'משמרות ומנוחה', Icon: MoonStar },
  { id: 'personal', title: 'הפרטים שלי', Icon: UserRound },
] as const

type Section = Question['section']

const shortTitles: Record<string, string> = {
  restDay: 'יום מנוחה', holidayCalendar: 'לוח חגים', nightBonus: 'תוספת לילה',
  nightAmount: 'תוספת לשעה', nightPercent: 'תוספת באחוזים', taxMode: 'נקודות זיכוי',
  onlyJob: 'עבודה יחידה', ageGroup: 'קבוצת גיל', children: 'ילדים עד גיל 18',
  pension: 'הפרשה לפנסיה', sex: 'מין לצורכי מס',
}
const shortOptions: Record<string, Record<string, string>> = {
  nightBonus: { no: 'ללא תוספת', percent: 'אחוז מהשכר', amount: 'סכום לשעה' },
  holidayCalendar: { manual: 'חגים לפי בחירה' },
  taxMode: { saved: 'לפי התלוש', questions: 'לפי הפרטים שלי' },
  pension: { saved: 'לפי התלוש', yes: 'כן (אומדן 6%)' },
  ageGroup: { adult: '18 עד גיל פרישה' },
}

function QuestionField({
  question,
  compact = false,
  dayTiles = false,
  value,
  error,
  onChange,
}: {
  question: Question
  dayTiles?: boolean
  compact?: boolean
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  const hourlyRate = question.id === 'hourlyRate'
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
  if (question.kind === 'choice' && (dayTiles || (compact ? question.id !== 'restDay' : options.length <= 4))) {
    return (
      <fieldset className="question-field" aria-describedby={describedBy} aria-invalid={Boolean(error)}>
        <legend>{question.title}</legend>
        {dayTiles ? <p className="question-hint" id={hintId}>בחרו את יום המנוחה השבועי שלכם. ברירת המחדל היא שבת.</p> : hint}
        <div className={dayTiles ? "question-choices onboarding-days" : compact ? "question-choices question-grid" : "question-choices"} data-count={options.length}>
          {options.map((option) => (
            <label key={option.value} className="question-chip">
              <input
                type="radio"
                name={question.id}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              {dayTiles && option.value !== 'unknown' && (
                <span className="week-marker" aria-hidden="true">
                  {value === option.value ? <Check size={16} /> : Number(option.value) + 1}
                </span>
              )}
              <span>{dayTiles && option.value === 'unknown' ? 'לא בטוח/ה' : option.label}</span>
            </label>
          ))}
        </div>
        {feedback}
      </fieldset>
    )
  }
  return (
    <div className={compact ? "question-field question-row" : "question-field"}>
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
            type={hourlyRate ? 'text' : 'number'}
            inputMode={question.step === 1 ? 'numeric' : 'decimal'}
            dir="ltr"
            name={question.id}
            value={value}
            min={question.min}
            max={question.max}
            step={question.step ?? 'any'}
            aria-describedby={describedBy}
            aria-invalid={Boolean(error)}
            onChange={(e) => {
              const entered = e.target.value
              if (!hourlyRate) return onChange(entered)
              const amount = entered.replace(',', '.')
              if (/^\d*(?:\.\d{0,2})?$/.test(amount)) onChange(amount)
            }}
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
  const [answers, setAnswers] = useState(() => {
    const saved = initialAnswers(baseline.profile, baseline.payroll)
    if (editSection === 'personal')
      return { onlyJob: 'yes', ageGroup: 'adult', pension: 'yes', children: 'no', ...saved } as Answers
    if (editSection === 'shifts')
      return { nights: 'no', nightBonus: 'no', ...saved } as Answers
    return editSection ? saved : { restDay: String(profile.pay.restDay), ...saved }
  })
  const [step, setStep] = useState(0)
  const lastStep = step === onboardingSteps.length - 1
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const [invalidField, setInvalidField] = useState('')
  const [saving, setSaving] = useState(false)
  const section = sections.find((entry) => entry.id === editSection) ?? sections[0]
  const currentQuestions = visibleQuestions(answers).filter((q) => editSection ? q.section === section.id : q.id === onboardingSteps[step])
  const compact = editSection === 'personal' || editSection === 'shifts'
  const primary = currentQuestions.filter((q) => !compact || q.id === 'sex' || q.id === 'restDay')
  const extra = currentQuestions.filter((q) => !primary.includes(q))
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    for (const q of currentQuestions) {
      const message = answerError(q, answers)
      if (message) {
        if (extra.includes(q)) setExpanded(true)
        setInvalidField(q.id)
        setError(message)
        event.currentTarget.querySelector<HTMLElement>(`[name="${q.id}"]`)?.focus()
        return
      }
    }
    setInvalidField('')
    setError('')
    if (!editSection && !lastStep) {
      setStep(step + 1)
      return
    }
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

  const renderQuestion = (q: Question) => {
    if (compact && q.id === 'nightBonus') return null
    const night = compact && q.id === 'nights'
    const field = night
      ? visibleQuestions({ ...answers, nights: 'yes' }).find(item => item.id === 'nightBonus')!
      : q
    const short = compact && !!shortTitles[field.id]
    return (
      <QuestionField
        key={q.id}
        compact={compact}
        dayTiles={!editSection && q.id === 'restDay'}
        question={short ? {
          ...field, title: shortTitles[field.id], hint: undefined,
          options: field.options?.map(option => ({
            ...option, label: shortOptions[field.id]?.[option.value] ?? option.label,
          })),
        } : field}
        value={night && answers.nights !== 'yes' ? (answers.nights === 'unknown' ? 'unknown' : 'no') : answers[field.id] ?? ''}
        error={invalidField === field.id ? error : undefined}
        onChange={value => {
          setAnswers(current => night
            ? { ...current, nights: 'yes', nightBonus: value }
            : { ...current, [field.id]: value })
          setError('')
        }}
      />
    )
  }
  return (
    <form className="question-form" onSubmit={submit} noValidate>
      {!editSection && <p className="prefs-hint" aria-live="polite">שאלה {step + 1} מתוך {onboardingSteps.length}</p>}
      <fieldset key={editSection ?? step} className="question-fields" disabled={saving}>
        <legend className="sr-only">{section.title}</legend>
        {primary.map(renderQuestion)}
        {compact && (
          <>
            <button type="button" className="question-disclosure" aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}>
              {editSection === 'shifts' ? 'חגים ותוספת לילה' : 'עבודה, פנסיה וזיכויים'}
              <span aria-hidden="true">{expanded ? '−' : '+'}</span>
            </button>
            {expanded ? <div className="question-extra">{extra.map(renderQuestion)}</div> :
              <p className="prefs-hint">{editSection === 'shifts'
                ? [answers.holidayCalendar === 'manual' ? 'לוח חגים אישי' : 'חגי ישראל',
                   answers.nights === 'yes' && answers.nightBonus === 'percent' && answers.nightPercent ? 'תוספת לילה ' + answers.nightPercent + '%' :
                   answers.nights === 'yes' && answers.nightBonus === 'amount' && answers.nightAmount ? 'תוספת לילה ' + answers.nightAmount + ' ₪ לשעה' : 'ללא תוספת לילה מיוחדת'].join(' · ')
                : extra.filter(q => ['onlyJob', 'ageGroup', 'children', 'pension'].includes(q.id))
                    .map(q => ({ onlyJob: 'עבודה יחידה', ageGroup: 'גיל', children: 'ילדים', pension: 'פנסיה' }[q.id] + ' · ' + answerLabel(q, answers))).join(' | ')}</p>}
          </>
        )}
      </fieldset>
      {error && !invalidField && (
        <p className="prefs-error" role="alert">
          {error}
        </p>
      )}
      <div className="question-actions">
        {!editSection && step > 0 && <button type="button" className="prefs-secondary" disabled={saving} onClick={() => { setStep(step - 1); setError(''); setInvalidField('') }}>חזרה</button>}
        <button type="submit" className="prefs-primary" disabled={saving}>
          {saving ? 'בשמירה…' : editSection ? 'שמירת התשובות' : lastStep ? 'שמירה וכניסה ליומן' : 'המשך'}
          {!saving && (editSection || lastStep) && <Check size={16} />}
        </button>
      </div>
    </form>
  )
}

export function Onboarding(props: QuestionnaireProps) {
  return (
    <div className="onboarding-content">
      <img className="onboarding-fox" src="/fox.svg" alt="" width="64" height="64" />
      <QuestionnaireForm {...props} />
      <p className="prefs-hint">אפשר לעדכן את השכר בהגדרות בכל עת.</p>
    </div>
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
                  .filter((q) => q.section === id && (id === 'work' || ['restDay', 'holidayCalendar', 'sex', 'pension'].includes(q.id)))
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
