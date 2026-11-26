import { GeoLocation, NOAACalculator } from '@hebcal/noaa'
import { Temporal } from 'temporal-polyfill'
import type { PaySettings } from './gross'
import { addDays, dateMs, localToInstant, TIME_ZONE, weekday } from './time'

const INDEPENDENCE_DAY = 'יום העצמאות'
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
    if (day === observed) return INDEPENDENCE_DAY
  }
  return festivalNames[month + ' ' + day]
}

export function holidayTimeMode(pay: PaySettings): 'automatic' | 'fixed' {
  if (pay.holidayCalendar === 'manual') return 'fixed'
  if (pay.holidayTimeMode) return pay.holidayTimeMode

  // Older saves also wrote both default clocks when only weekly rest settings changed.
  return (pay.holidayStart ?? '18:00') !== '18:00' || (pay.holidayEnd ?? '19:00') !== '19:00'
    ? 'fixed'
    : 'automatic'
}

const MINUTE_MS = 60_000
const jerusalem = new GeoLocation('Jerusalem', 31.76904, 35.21633, 0, TIME_ZONE)

export function automaticHolidayWindow(date: string, name: string): { start: number; end: number } | undefined {
  const eve = addDays(date, -1)
  if (name === INDEPENDENCE_DAY) {
    return { start: Date.parse(localToInstant(eve, '20:00')), end: Date.parse(localToInstant(date, '20:00')) }
  }

  const sunset = new NOAACalculator(jerusalem, Temporal.PlainDate.from(eve)).getSeaLevelSunset()
  const nightfall = new NOAACalculator(jerusalem, Temporal.PlainDate.from(date)).getSunsetOffsetByDegrees(98.5)
  if (!sunset || !nightfall) return undefined
  return {
    start: (Math.floor(sunset.epochMilliseconds / MINUTE_MS) - 40) * MINUTE_MS,
    end: Math.ceil(nightfall.epochMilliseconds / MINUTE_MS) * MINUTE_MS,
  }
}
