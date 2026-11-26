import { addDays, dateMs, HOUR_MS, instantMs, localDate, localToInstant, weekday } from './time'

export interface Window {
  start: string
  end: string
}
export interface Shift extends Window {
  id: string
  breaks?: (Window & { paid?: boolean })[]
  note?: string
  holiday?: boolean
  /** Optional shared anchor for pieces of an overnight split shift. */
  workDate?: string
}

export interface PaySettings {
  hourlyRate: number
  workDays: 5 | 6
  shortDay: number
  restDay: number
  restStart: string
  restEnd: string
  restStartDay?: number
  nightPremiumAmount?: number
  nightPremiumPercent?: number
  rateHistory?: { from: string; rate: number }[]
  holidays?: string[]
  holidayCalendar?: 'israel-jewish' | 'manual'
  holidayStart?: string
  holidayEnd?: string
  holidayEveHours?: 7 | 8
  /** Exact intervals replace the configured holiday hours for the holiday ending on that date. */
  holidayWindows?: Window[]
}

export type BandKind = 'regular' | 'overtime125' | 'overtime150' | 'rest150' | 'rest175' | 'rest200'
export interface PayBand {
  kind: BandKind
  hours: number
  amount: number
}
interface Totals {
  gross: number
  hours: number
  overtimeHours: number
  regularHours: number
  restHours: number
  pensionable: number
  bands: PayBand[]
}
export interface ShiftPay extends Totals {
  id: string
}
export interface GrossResult extends Totals {
  shifts: ShiftPay[]
}

export const grossCoverage = {
  version: 'IL-private-hourly-2026.11',
  verifiedOn: '2026-11-26',
  weekly42EffectiveFrom: '2018-04-01',
  scope: 'אומדן לעובד שעתי בגיר במגזר הפרטי בהסדר הכללי. כל חישוב מתייחס למעסיק אחד.',
  thresholds:
    'חמישה ימים: 8:36 שעות וביום המקוצר 7:36. שישה ימים: 8 שעות. ערב המנוחה, ערב חג ועבודת לילה: 7 שעות כברירת מחדל. בשני הפרופילים 42 שעות רגילות בשבוע.',
  week: 'שבוע החישוב מתחיל ביום ראשון. משמרת רצופה שומרת על מדרגת השעות היומית בחצות. דקות המשמרת משויכות לחודש ולשבוע לפי מועד העבודה בפועל.',
  premium:
    'תוספת לילה מוגדרת בסכום לשעה או כאחוז משכר הבסיס לכל שעות המשמרת שסווגה כלילה, ונכללת בבסיס לחישוב הגמולים באותה משמרת.',
  rest: 'חלונות המנוחה והחג הם השעות שהוגדרו במקום העבודה. השעות הקבועות לחגים הן קירוב. חפיפה בין חג למנוחה מזכה פעם אחת בתוספת.',
  limitations:
    'החישוב כולל משמרות שהוזנו. השלמת שכר בערב חג לפי הסכם, דמי חג בגין היעדרות או עבודה מכורח, חופשה, מחלה, שעות גמישות, הסדרים ענפיים, שעות גלובליות ומנוחת פיצוי טעונים בדיקה נפרדת. שבוע שחסרים בו ימי עבודה או היעדרות בתשלום עשוי לתת אומדן חלקי.',
  pension:
    'בסיס הפנסיה המשוער כולל שכר יסוד לשעות רגילות, לרבות שעות רגילות במנוחה, ומוציא שעות נוספות ותוספות. יש להתאים להסכם ולתלוש.',
  sources: [
    'https://www.gov.il/BlobFolder/dynamiccollectorresultitem/extention-order-short-week-2018/he/extention-order-short-week-2018.pdf',
    'https://www.gov.il/BlobFolder/policy/directive-regarding-non-payment-of-minimum-wage-for-overtime-hours/he/procedures_non-payment-overtime-hours.pdf',
    'https://www.gov.il/he/pages/working-at-night',
    'https://www.gov.il/he/pages/weekends-and-holidays?chapterindex=1',
    'https://www.gov.il/he/pages/collective-labor-agreement-and-extension-orders',
  ],
} as const

const H = HOUR_MS
const hebrewCalendar = new Intl.DateTimeFormat('en-u-ca-hebrew', {
  timeZone: 'UTC',
  month: 'long',
  day: 'numeric',
})
const festivalNames: Record<string, string> = {
  'Tishri 1': 'ראש השנה',
  'Tishri 2': 'ראש השנה',
  'Tishri 10': 'יום הכיפורים',
  'Tishri 15': 'סוכות',
  'Tishri 22': 'שמיני עצרת ושמחת תורה',
  'Nisan 15': 'פסח',
  'Nisan 21': 'שביעי של פסח',
  'Sivan 6': 'שבועות',
}

/** Major Jewish rest days in Israel, plus the observed modern Independence Day (2004 onward). */
export function israelHolidayName(date: string): string | undefined {
  const parts = hebrewCalendar.formatToParts(dateMs(date))
  const month = parts.find((p) => p.type === 'month')?.value
  const day = Number(parts.find((p) => p.type === 'day')?.value)
  if (month === 'Iyar' && date >= '2004-01-01') {
    const nominal = weekday(addDays(date, 5 - day))
    const observed = nominal === 6 ? 3 : nominal === 5 ? 4 : nominal === 1 ? 6 : 5
    if (day === observed) return 'יום העצמאות'
  }
  return festivalNames[month + ' ' + day]
}

interface Span {
  start: number
  end: number
}
interface Piece extends Span {
  date: string
  workDate: string
  shiftId: string
  rest: boolean
  night: boolean
}
function readSpan(window: Window): Span {
  const start = instantMs(window.start),
    end = instantMs(window.end)
  if (end <= start) throw new Error('שעת הסיום חייבת להיות אחרי שעת ההתחלה')
  return { start, end }
}

function paidSpans(shift: Shift, span: Span): Span[] {
  const breaks = (shift.breaks ?? [])
    .map((b) => ({ ...readSpan(b), paid: b.paid }))
    .sort((a, b) => a.start - b.start)
  const paid: Span[] = []
  let cursor = span.start,
    previousEnd = span.start
  for (const b of breaks) {
    if (b.start < previousEnd || b.end > span.end) throw new Error('יש להזין הפסקות בתוך המשמרת וללא חפיפה')
    previousEnd = b.end
    if (b.paid) continue
    if (cursor < b.start) paid.push({ start: cursor, end: b.start })
    cursor = b.end
  }
  if (cursor < span.end) paid.push({ start: cursor, end: span.end })
  return paid
}

function validClock(time: string, allowMidnight = false): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || (allowMidnight && time === '24:00')
}

function boundary(date: string, time: string, end = false): number {
  if (time === '24:00') return Date.parse(localToInstant(addDays(date, 1), '00:00'))
  return Date.parse(localToInstant(date, time, end ? 'later' : 'earlier'))
}

function validAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function verifySettings(s: PaySettings) {
  const weekdays = [s.shortDay, s.restDay, s.restStartDay ?? (s.restDay + 6) % 7]
  if (
    !validAmount(s.hourlyRate) ||
    ![5, 6].includes(s.workDays) ||
    !validAmount(s.nightPremiumPercent ?? 0) ||
    !validAmount(s.nightPremiumAmount ?? 0) ||
    !weekdays.every((d) => Number.isInteger(d) && d >= 0 && d < 7) ||
    !validClock(s.restStart) ||
    !validClock(s.restEnd, true) ||
    !validClock(s.holidayStart ?? '18:00') ||
    !validClock(s.holidayEnd ?? '19:00', true)
  ) {
    throw new Error('הגדרות חישוב השכר אינן תקינות')
  }
  for (const d of s.holidays ?? []) dateMs(d)
}

function makeCalendar(s: PaySettings) {
  const manual = new Set(s.holidays ?? [])
  const exact = (s.holidayWindows ?? []).map(readSpan)
  const replaced = new Set(exact.map((h) => localDate(h.end - 1)))
  const cache = new Map<string, { intervals: Span[]; nightEnd: number; nightStart: number; next: number }>()
  const holidays = new Map<string, boolean>()
  function holiday(date: string): boolean {
    if (!holidays.has(date))
      holidays.set(
        date,
        manual.has(date) ||
          replaced.has(date) ||
          (s.holidayCalendar === 'israel-jewish' && Boolean(israelHolidayName(date))),
      )
    return holidays.get(date)!
  }
  function forDate(date: string) {
    const cached = cache.get(date)
    if (cached) return cached
    const currentDay = weekday(date)
    const startDay = s.restStartDay ?? (s.restDay + 6) % 7
    const restStartDate = addDays(date, -((currentDay - startDay + 7) % 7))
    const restEndDate = addDays(restStartDate, (s.restDay - startDay + 7) % 7)
    const rest = { start: boundary(restStartDate, s.restStart), end: boundary(restEndDate, s.restEnd, true) }
    if (rest.end <= rest.start) throw new Error('חלון המנוחה השבועית אינו תקין')
    const tomorrow = addDays(date, 1)
    const next = boundary(tomorrow, '00:00')
    const today = boundary(date, '00:00')
    const intervals = [rest, ...exact.filter((h) => h.start < next && h.end > today)]
    for (const day of [date, tomorrow]) {
      if (holiday(day) && !replaced.has(day))
        intervals.push({
          start: boundary(addDays(day, -1), s.holidayStart ?? '18:00'),
          end: boundary(day, s.holidayEnd ?? '19:00', true),
        })
    }
    const info = { intervals, next, nightEnd: boundary(date, '06:00'), nightStart: boundary(date, '22:00') }
    cache.set(date, info)
    return info
  }
  return { forDate, holiday }
}

function emptyTotals(): Totals {
  return { gross: 0, pensionable: 0, hours: 0, regularHours: 0, overtimeHours: 0, restHours: 0, bands: [] }
}

const kinds = [
  ['regular', 'overtime125', 'overtime150'],
  ['rest150', 'rest175', 'rest200'],
] as const

function record(
  target: Totals,
  kind: BandKind,
  hours: number,
  amount: number,
  pensionable: number,
  overtime: boolean,
  rest: boolean,
) {
  target.hours += hours
  target.gross += amount
  target.pensionable += pensionable
  if (overtime) target.overtimeHours += hours
  else target.regularHours += hours
  if (rest) target.restHours += hours
  let band = target.bands.find((item) => item.kind === kind)
  if (!band) {
    band = { kind, hours: 0, amount: 0 }
    target.bands.push(band)
  }
  band.hours += hours
  band.amount += amount
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
function finalize(totals: Totals) {
  totals.gross = roundMoney(totals.gross)
  totals.pensionable = roundMoney(totals.pensionable)
  for (const b of totals.bands) b.amount = roundMoney(b.amount)
}

export function calculateGross(shifts: Shift[], settings: PaySettings, month?: string): GrossResult {
  verifySettings(settings)
  if (month !== undefined) dateMs(month + '-01')
  const rates = [...(settings.rateHistory ?? [])].sort((a, b) => a.from.localeCompare(b.from))
  for (const r of rates) {
    dateMs(r.from)
    if (!validAmount(r.rate)) throw new Error('תעריף שעתי לא תקין')
  }
  const calendar = makeCalendar(settings)
  const sorted = shifts
    .map((shift) => ({ shift, span: readSpan(shift) }))
    .sort((a, b) => a.span.start - b.span.start)
  const nightDuration = new Map<string, number>()
  const pieces: Piece[] = []
  const ids = new Set<string>()
  const rows = new Map<string, ShiftPay>()
  let lastEnd = -Infinity
  for (const { shift, span } of sorted) {
    if (!shift.id || ids.has(shift.id)) throw new Error('זיהוי משמרת חסר או כפול')
    if (span.start < lastEnd) throw new Error('קיימת חפיפה בין משמרות')
    ids.add(shift.id)
    lastEnd = span.end
    if (
      !month ||
      (localDate(span.start).slice(0, 7) <= month && localDate(span.end - 1).slice(0, 7) >= month)
    ) {
      rows.set(shift.id, { id: shift.id, ...emptyTotals() })
    }
    const workDate = shift.workDate ?? localDate(span.start)
    dateMs(workDate)
    for (const paid of paidSpans(shift, span)) {
      let start = paid.start
      while (start < paid.end) {
        const date = localDate(start)
        const { intervals, next, nightEnd, nightStart } = calendar.forDate(date)
        const edges = [paid.end, next, nightEnd, nightStart, ...intervals.flatMap((r) => [r.start, r.end])]
        const end = Math.min(...edges.filter((edge) => edge > start))
        const night = start < nightEnd || start >= nightStart
        const rest = shift.holiday === true || intervals.some((r) => start >= r.start && start < r.end)
        pieces.push({ start, end, date, workDate, shiftId: shift.id, rest, night })
        if (night) nightDuration.set(shift.id, (nightDuration.get(shift.id) ?? 0) + end - start)
        start = end
      }
    }
  }
  const result: GrossResult = { ...emptyTotals(), shifts: [...rows.values()] }
  const daily = new Map<string, { paid: number; overtime: number }>()
  const weeklyRegular = new Map<string, number>()
  for (const p of pieces) {
    const day = daily.get(p.workDate) ?? { paid: 0, overtime: 0 }
    daily.set(p.workDate, day)
    const night = (nightDuration.get(p.shiftId) ?? 0) >= 2 * H
    const wday = weekday(p.workDate)
    const restEve = (wday + 1) % 7 === settings.restDay
    const holidayEve = calendar.holiday(addDays(p.workDate, 1))
    const dayHours = settings.workDays === 6 ? 8 : wday === settings.shortDay ? 7.6 : 8.6
    const cap =
      Math.min(
        dayHours,
        night || restEve ? 7 : Infinity,
        holidayEve ? (settings.holidayEveHours ?? 7) : Infinity,
      ) * H
    const week = addDays(p.date, -weekday(p.date))
    const remainingWeekly = 42 * H - (weeklyRegular.get(week) ?? 0)
    const regular = Math.min(p.end - p.start, Math.max(0, cap - day.paid), Math.max(0, remainingWeekly))
    const overtime = p.end - p.start - regular
    const firstTier = Math.min(overtime, Math.max(0, 2 * H - day.overtime))
    day.paid += p.end - p.start
    day.overtime += overtime
    weeklyRegular.set(week, (weeklyRegular.get(week) ?? 0) + regular)
    if (month && !p.date.startsWith(month)) continue
    let baseRate = settings.hourlyRate
    for (const r of rates) {
      if (r.from > p.date) break
      baseRate = r.rate
    }
    const nightPremium = settings.nightPremiumAmount ?? (baseRate * (settings.nightPremiumPercent ?? 0)) / 100
    const rate = night ? baseRate + nightPremium : baseRate
    const row = rows.get(p.shiftId)!
    for (const [tier, duration] of [regular, firstTier, overtime - firstTier].entries()) {
      if (duration === 0) continue
      const hours = duration / H
      const amount = hours * rate * (1 + tier * 0.25 + (p.rest ? 0.5 : 0))
      const pensionable = tier === 0 ? hours * baseRate : 0
      const kind = kinds[p.rest ? 1 : 0][tier]
      record(row, kind, hours, amount, pensionable, tier > 0, p.rest)
      record(result, kind, hours, amount, pensionable, tier > 0, p.rest)
    }
  }
  for (const row of result.shifts) finalize(row)
  finalize(result)
  return result
}
