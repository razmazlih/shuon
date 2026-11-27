import type { PaySettings } from './gross'
import { dateMs } from './time'

export function withHourlyRate(pay: PaySettings, from: string, rate: number): PaySettings {
  if (!from) throw new Error('יש לבחור תאריך תחולה.')
  dateMs(from)
  return {
    ...pay,
    rateHistory: [...(pay.rateHistory ?? []).filter((row) => row.from !== from), { from, rate }]
      .sort((a, b) => a.from.localeCompare(b.from)),
  }
}
