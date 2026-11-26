import { calculateGross, type PaySettings, type ShiftPay } from '../domain/gross'
import type { WorkShift } from './model'

export function calculateShiftPay(shifts: WorkShift[], pay: PaySettings): ReadonlyMap<string, ShiftPay> {
  const completed = shifts.filter((shift) => shift.status === 'completed')
  const planned = shifts.filter((shift) => shift.status === 'planned')
  const byId = new Map<string, ShiftPay>()

  try {
    for (const row of calculateGross(completed, pay).shifts) byId.set(row.id, row)
  } catch {
    return byId
  }

  if (planned.length > 0) {
    try {
      const plannedIds = new Set(planned.map((shift) => shift.id))
      for (const row of calculateGross([...completed, ...planned], pay).shifts) {
        if (plannedIds.has(row.id)) byId.set(row.id, row)
      }
    } catch {
      // Conflicts in the forecast leave completed earnings available.
    }
  }

  return byId
}
