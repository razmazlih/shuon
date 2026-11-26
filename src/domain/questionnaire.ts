import type { UserProfile } from '../data/model'
import type { PayrollProfile } from './net'
import { localDate } from './time'

export type Answers = Record<string, string>
export type Question = {
  id: string
  section: 'work' | 'shifts' | 'personal'
  title: string
  hint?: string
  kind: 'choice' | 'number'
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  step?: number
  unit?: string
}

type Section = Question['section']
type Option = [string, string]
const days: Option[] = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map((d, i) => [
  String(i),
  d,
])
const unsure: Option = ['unknown', 'לא ידוע לי כרגע']
const yesNo: Option[] = [
  ['yes', 'כן'],
  ['no', 'לא'],
]
const choice = (section: Section, id: string, title: string, options: Option[], hint?: string): Question => ({
  section,
  id,
  title,
  hint,
  kind: 'choice',
  options: options.map(([value, label]) => ({ value, label })),
})
const numeric = (
  section: Section,
  id: string,
  title: string,
  min: number,
  step: number,
  unit?: string,
  max?: number,
): Question => ({
  section,
  id,
  title,
  kind: 'number',
  min,
  max,
  step,
  unit,
})

// The salary engine currently supports the 2026 tax year.
const taxYear = 2026
export function visibleQuestions(a: Answers): Question[] {
  const qs: Question[] = [
    { ...numeric('work', 'hourlyRate', 'מה השכר שלך לשעה?', 0.01, 0.01, '₪'), hint: 'שכר ברוטו, לפני תוספות.' },
  ]
  qs.push(
    choice(
      'shifts',
      'restDay',
      'מהו יום המנוחה השבועי שלך?',
      [...days, unsure],
      'אם לא ידוע, האומדן ישתמש בשבת.',
    ),
    choice(
      'shifts',
      'holidayCalendar',
      'לפי אילו חגים מחשבים אצלך שכר חג?',
      [['israel-jewish', 'חגי ישראל'], ['manual', 'חגים אחרים, לפי תאריכים שאבחר'], unsure],
      a.holidayCalendar === 'manual'
        ? 'אפשר להוסיף תאריכים בהגדרות, תחת תעריפים עתידיים, זמני מנוחה וחגים.'
        : 'אם לא ידוע, האומדן ישתמש בחגי ישראל.',
    ),
    choice('shifts', 'nights', 'יש לך משמרות לילה?', [...yesNo, unsure]),
  )
  if (a.nights === 'yes') {
    qs.push(
      choice(
        'shifts',
        'nightBonus',
        'איזו תוספת משלמים לך במשמרת לילה?',
        [['no', 'אין תוספת מיוחדת'], ['percent', 'אחוז מהשכר לשעה'], ['amount', 'סכום קבוע לכל שעה'], unsure],
        'הכוונה לתוספת מעבר לשעות נוספות. אם הפרטים עדיין לא ידועים, אפשר לעדכן בהמשך.',
      ),
    )
    if (a.nightBonus === 'percent')
      qs.push(numeric('shifts', 'nightPercent', 'כמה אחוזים נוספים משלמים בלילה?', 0.01, 0.01, '%'))
    if (a.nightBonus === 'amount')
      qs.push(numeric('shifts', 'nightAmount', 'כמה שקלים נוספים משלמים לכל שעת לילה?', 0.01, 0.01, '₪'))
  }
  if (a.taxMode)
    qs.push(
      choice('personal', 'taxMode', 'איך לעדכן את אומדן מס ההכנסה?', [
        ['saved', 'להשאיר את הנתון מהתלוש'],
        ['questions', 'לחשב לפי התשובות שלי'],
      ]),
    )
  qs.push(
    choice(
      'personal',
      'onlyJob',
      'זו העבודה היחידה שלך?',
      [...yesNo, unsure],
      'כשיש כמה מעסיקים, המס תלוי גם בתיאום המס.',
    ),
  )
  if (a.onlyJob === 'yes' && (a.resident ?? 'yes') === 'yes')
    qs.push(
      choice(
        'personal',
        'ageGroup',
        'מה קבוצת הגיל שלך?',
        [
          ['adult', 'מגיל 18 ועד לפני גיל הפרישה'],
          ['minor', 'מתחת לגיל 18'],
          ['retired', 'בגיל הפרישה או אחריו'],
          unsure,
        ],
        'האומדן האוטומטי של ביטוח לאומי ובריאות מיועד לעובדים מגיל 18 שטרם הגיעו לגיל הפרישה.',
      ),
    )
  if (a.onlyJob === 'yes' && (a.resident ?? 'yes') === 'yes' && a.ageGroup === 'adult') {
    qs.push(
      choice(
        'personal',
        'sex',
        'מה המין הרשום שלך לצורכי מס?',
        [
          ['female', 'אישה'],
          ['male', 'גבר'],
          ['unknown', 'מעדיף/ה לא לענות'],
        ],
        'האומדן כולל זיכוי בסיסי וזיכוי לילדים. הטבות נוספות אפשר לעדכן לפי התלוש במסך השכר.',
      ),
    )
    if (a.sex === 'female' || a.sex === 'male') {
      qs.push(choice('personal', 'children', 'יש לך ילדים שנולדו בין 2008 ל־2026, כולל?', [...yesNo, unsure]))
      if (a.children === 'yes') {
        qs.push(
          choice(
            'personal',
            'family',
            'מה המצב המשפחתי שלך?',
            [
              [
                'married',
                a.sex === 'female'
                  ? 'אני ובעלי נשואים וכל הילדים משותפים לנו'
                  : 'אני ואשתי נשואים וכל הילדים משותפים לנו',
              ],
              ['sameSex', 'נישואים לבן או בת זוג מאותו מין, וכל הילדים משותפים לנו'],
              ['single', 'הורות עצמאית ללא בן או בת זוג בבית'],
              ['other', 'מצב משפחתי אחר'],
            ],
            'במצבים משפחתיים אחרים אפשר להשתמש בנתון האישי מהתלוש במסך השכר.',
          ),
        )
        if (a.family === 'single')
          qs.push(
            choice(
              'personal',
              'care',
              'כל הילדים גרים איתך וקצבת הילדים משולמת לך?',
              [...yesNo, unsure],
              'לגבי ילד שמלאו לו 18 השנה, הכוונה לקצבה ששולמה עד יום ההולדת.',
            ),
          )
        if (a.family === 'single' && a.care === 'yes')
          qs.push(
            choice('personal', 'otherParent', 'האם לכל הילדים יש הורה נוסף רשום שנמצא בחיים?', [
              ['yes', 'כן, לכולם'],
              ['none', 'לאף אחד מהם'],
              ['mixed', 'רק לחלקם'],
              unsure,
            ]),
          )
        if (supportsChildEstimate(a)) {
          qs.push(
            numeric('personal', 'childCount', 'כמה ילדים עד גיל 18 יש לך בשנת המס הזו?', 1, 1, undefined, 30),
          )
          const count = Number(a.childCount)
          if (Number.isInteger(count) && count <= 30) {
            for (let i = 1; i <= count; i++)
              qs.push(
                numeric(
                  'personal',
                  'childYear' + i,
                  count === 1 ? 'באיזו שנה הילד או הילדה נולדו?' : 'מהי שנת הלידה של ילד/ה ' + i + '?',
                  taxYear - 18,
                  1,
                  undefined,
                  taxYear,
                ),
              )
          }
          if (needsAllowance(a))
            qs.push(
              choice(
                'personal',
                'allowance',
                'למי משולמת קצבת הילדים?',
                [
                  ['mine', 'לי, עבור כל הילדים'],
                  ['partner', 'לבן או לבת הזוג, עבור כל הילדים'],
                  ['other', 'סידור אחר'],
                  unsure,
                ],
                'לגבי ילד שמלאו לו 18 השנה, הכוונה לקצבה ששולמה עד יום ההולדת.',
              ),
            )
        }
      }
    }
  }
  const pensionOptions: Option[] = [...yesNo, unsure]
  if (a.pension === 'saved' || a.hasPensionOverride === 'yes')
    pensionOptions.unshift(['saved', 'להשאיר את הנתון מהתלוש'])
  qs.push(
    choice(
      'personal',
      'pension',
      'יורד לך מהשכר כסף לפנסיה?',
      pensionOptions,
      'בתשובה חיובית נשתמש באומדן של 6% מהשכר המבוטח. אפשר לדייק לפי התלוש במסך השכר.',
    ),
  )
  return qs
}

export function answerError(q: Question, a: Answers): string | null {
  const raw = a[q.id]?.trim()
  if (!raw) return 'יש למלא תשובה כדי להמשיך.'
  if (q.kind === 'choice') return q.options?.some((o) => o.value === raw) ? null : 'יש לבחור אחת מהאפשרויות.'
  const n = Number(raw)
  if (!Number.isFinite(n) || n < (q.min ?? 0) || n > (q.max ?? Infinity))
    return q.max === undefined
      ? 'יש להזין מספר מ־' + q.min + ' ומעלה.'
      : 'יש להזין מספר בין ' + q.min + ' ל־' + q.max + '.'
  if (q.step && Math.abs(n / q.step - Math.round(n / q.step)) > 0.00001)
    return q.step === 1 ? 'יש להזין מספר שלם.' : 'אפשר להזין עד שתי ספרות אחרי הנקודה.'
  return null
}

function supportsChildEstimate(a: Answers) {
  return (
    a.family === 'married' ||
    a.family === 'sameSex' ||
    (a.family === 'single' && a.care === 'yes' && ['yes', 'none'].includes(a.otherParent))
  )
}

function needsAllowance(a: Answers) {
  if (a.family !== 'sameSex') return false
  return Object.entries(a).some(([id, value]) => {
    const match = /^childYear(\d+)$/.exec(id)
    const age = taxYear - Number(value)
    return match && Number(match[1]) <= Number(a.childCount) && age >= 6 && age <= 18
  })
}

// Israel Tax Authority, Guide to Filing a Tax Refund, chapter 6 (2026).
// https://www.gov.il/he/pages/tax-return-application-guide?chapterIndex=6
function basicCredits(a: Answers): number | null {
  if (
    a.onlyJob !== 'yes' ||
    (a.resident ?? 'yes') !== 'yes' ||
    a.ageGroup !== 'adult' ||
    !['female', 'male'].includes(a.sex)
  )
    return null
  let points = a.sex === 'female' ? 2.75 : 2.25
  if (a.children === 'no') return points
  const count = Number(a.childCount)
  if (
    a.children !== 'yes' ||
    !supportsChildEstimate(a) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 30
  )
    return null
  if (needsAllowance(a) && !['mine', 'partner'].includes(a.allowance)) return null
  const primary =
    a.family === 'single' || (a.family === 'sameSex' ? a.allowance === 'mine' : a.sex === 'female')
  const soleParent = a.family === 'single' && a.otherParent === 'none'
  if (a.family === 'single') points += 1
  for (let i = 1; i <= count; i++) {
    const age = taxYear - Number(a['childYear' + i])
    if (!Number.isInteger(age) || age < 0 || age > 18) return null
    if (age <= 5) {
      const pointsPerParent = [2.5, 4.5, 4.5, 3.5, 2.5, 2.5][age]
      points += soleParent ? 2 * pointsPerParent : pointsPerParent
    } else if (age <= 17) {
      points += soleParent ? 3 : primary ? 2 : 1
    } else if (primary) points += 0.5
  }
  return points
}

const pensionEstimate = (answer: string) => (answer === 'yes' ? 6 : answer === 'no' ? 0 : null)
function currentRate(profile: UserProfile, today: string) {
  return (
    (profile.pay.rateHistory ?? [])
      .filter((r) => r.from <= today)
      .sort((a, b) => a.from.localeCompare(b.from))
      .at(-1)?.rate ?? profile.pay.hourlyRate
  )
}

export function initialAnswers(
  profile: UserProfile,
  payroll: PayrollProfile,
  today = localDate(Date.now()),
): Answers {
  const saved = profile.questionnaire
  const a: Answers = { ...saved }
  if (profile.onboarded || saved) {
    a.hourlyRate = String(currentRate(profile, today))
    a.restDay ??= String(profile.pay.restDay)
    a.holidayCalendar ??= profile.pay.holidayCalendar ?? 'manual'
    if (!saved && profile.pay.nightPremiumPercent) {
      Object.assign(a, {
        nights: 'yes',
        nightBonus: 'percent',
        nightPercent: String(profile.pay.nightPremiumPercent),
      })
    }
  }
  if (payroll.creditPoints !== basicCredits(a) || saved?.taxMode === 'saved') a.taxMode = 'saved'
  if (payroll.pensionPercent !== pensionEstimate(a.pension) || a.pension === 'saved') {
    a.pension = 'saved'
    a.hasPensionOverride = 'yes'
  }
  return a
}

export function applyAnswers(
  profile: UserProfile,
  payroll: PayrollProfile,
  draft: Answers,
  today = localDate(Date.now()),
) {
  const answers: Answers = { resident: draft.resident ?? 'yes' }
  for (const q of visibleQuestions(draft)) {
    if (!draft[q.id]?.trim()) continue
    const invalid = answerError(q, draft)
    if (invalid) throw new Error(q.title + ' ' + invalid)
    answers[q.id] = draft[q.id].trim()
  }
  const pay = { ...profile.pay }
  if (answers.hourlyRate && Number(answers.hourlyRate) !== currentRate(profile, today)) {
    if (profile.onboarded) {
      pay.rateHistory = [
        ...(pay.rateHistory ?? []).filter((r) => r.from !== today),
        { from: today, rate: Number(answers.hourlyRate) },
      ].sort((a, b) => a.from.localeCompare(b.from))
    } else pay.hourlyRate = Number(answers.hourlyRate)
  }
  if (answers.restDay) {
    const day = answers.restDay === 'unknown' ? 6 : Number(answers.restDay)
    if (day !== pay.restDay) delete pay.restStartDay
    pay.restDay = day
  }
  if (answers.holidayCalendar)
    pay.holidayCalendar = answers.holidayCalendar === 'manual' ? 'manual' : 'israel-jewish'
  if (answers.nights) {
    pay.nightPremiumPercent = Number(answers.nightPercent ?? 0)
    if (answers.nightAmount) pay.nightPremiumAmount = Number(answers.nightAmount)
    else delete pay.nightPremiumAmount
  }
  const updatedPayroll = { ...payroll }
  if (answers.onlyJob) {
    updatedPayroll.regularInsurance =
      answers.onlyJob === 'yes' && answers.resident === 'yes' && answers.ageGroup === 'adult'
    if (answers.taxMode !== 'saved') {
      updatedPayroll.creditPoints = basicCredits(answers)
      delete answers.taxMode
    }
  }
  if (answers.pension && answers.pension !== 'saved')
    updatedPayroll.pensionPercent = pensionEstimate(answers.pension)
  return { profile: { ...profile, pay, questionnaire: answers, onboarded: true }, payroll: updatedPayroll }
}
