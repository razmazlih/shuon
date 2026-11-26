import { formatMoney, type WorkShift } from '../data/model'

export function ShiftGross({ status, gross, compact = false }: { status: WorkShift['status']; gross?: number; compact?: boolean }) {
  if (status === 'active') return null

  return (
    <span className="shift-gross">
      <span className={compact && status === 'completed' ? 'sr-only' : undefined}>
        {status === 'planned' ? (compact ? 'צפוי' : 'שכר צפוי') : 'שכר למשמרת'}
      </span>
      {gross === undefined ? <span>סכום לא זמין</span> : <bdi>{formatMoney(gross, 2, 2)}</bdi>}
    </span>
  )
}
