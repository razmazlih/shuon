// Calendar dates are Israeli civil dates. Elapsed durations always use instants.
export const TIME_ZONE = 'Asia/Jerusalem'
export const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const FIRST_CALENDAR_YEAR = 1
const LAST_CALENDAR_YEAR = 9999
const clock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function dateMs(date: string): number {
  const ms = Date.parse(date + 'T00:00:00Z')
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().slice(0, 10) !== date
  ) {
    throw new Error('תאריך לא תקין')
  }
  return ms
}

export function instantMs(value: string): number {
  const ms = Date.parse(value)
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(ms)
  ) {
    throw new Error('שעת המשמרת חייבת לכלול תאריך ואזור זמן')
  }
  dateMs(value.slice(0, 10))
  return ms
}

export function addDays(date: string, days: number): string {
  return new Date(dateMs(date) + days * DAY_MS).toISOString().slice(0, 10)
}

export function weekday(date: string): number {
  return new Date(dateMs(date)).getUTCDay()
}

export function addMonths(date: string, offset: number): string {
  const target = new Date(dateMs(date))
  const yearStart = target.getUTCFullYear() * 12
  const day = target.getUTCDate()
  const month = Math.min(
    LAST_CALENDAR_YEAR * 12 + 11,
    Math.max(FIRST_CALENDAR_YEAR * 12, yearStart + target.getUTCMonth() + offset),
  )
  // Day zero of the following month is the target month's last day.
  target.setUTCMonth(month - yearStart + 1, 0)
  target.setUTCDate(Math.min(day, target.getUTCDate()))
  return target.toISOString().slice(0, 10)
}

export function monthDays(date: string): (string | null)[] {
  const first = new Date(dateMs(date))
  first.setUTCDate(1)
  const last = new Date(first)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  const leading = first.getUTCDay()
  const trailing = 6 - last.getUTCDay()
  return Array.from({ length: leading + last.getUTCDate() + trailing }, (_, index) => {
    const day = new Date(first.getTime() + (index - leading) * DAY_MS)
    return day.getUTCFullYear() >= FIRST_CALENDAR_YEAR && day.getUTCFullYear() <= LAST_CALENDAR_YEAR
      ? day.toISOString().slice(0, 10)
      : null
  })
}

// Format from named fields: Safari and Chrome can use different separators for the same locale.
function localWall(value: number): string {
  const parts = Object.fromEntries(clock.formatToParts(value).map((part) => [part.type, part.value]))
  return (
    parts.year +
    '-' +
    parts.month +
    '-' +
    parts.day +
    'T' +
    parts.hour +
    ':' +
    parts.minute +
    ':' +
    parts.second
  )
}

export function localDate(value: string | number): string {
  return localWall(typeof value === 'number' ? value : instantMs(value)).slice(0, 10)
}

export function localTime(value: string | number): string {
  return localWall(typeof value === 'number' ? value : instantMs(value)).slice(11, 16)
}

export function localToInstant(
  date: string,
  time: string,
  disambiguation: 'earlier' | 'later' = 'earlier',
): string {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('שעה לא תקינה')
  const wall = dateMs(date) + Number(time.slice(0, 2)) * HOUR_MS + Number(time.slice(3)) * 60_000
  // The two adjacent days cover both UTC offsets at an Israeli clock change.
  const offsets = [wall - DAY_MS, wall + DAY_MS].map((sample) => Date.parse(localWall(sample) + 'Z') - sample)
  const candidates = [...new Set(offsets.map((offset) => wall - offset))]
    .filter((value) => localWall(value).slice(0, 16) === date + 'T' + time)
    .sort((a, b) => a - b)
  if (!candidates.length) throw new Error('השעה אינה קיימת בתאריך הזה עקב המעבר לשעון קיץ')
  return new Date(candidates[disambiguation === 'later' ? candidates.length - 1 : 0]).toISOString()
}
