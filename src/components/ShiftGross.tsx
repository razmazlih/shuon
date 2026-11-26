import { formatMoney, type WorkShift } from '../data/model'

export function ShiftGross({ status, gross }: { status: WorkShift['status']; gross?: number }) {
  if (status === 'active') return null

  return (
    <span className="shift-gross">
      <span>{status === 'planned' ? 'שכר צפוי' : 'שכר למשמרת'}</span>
      {gross === undefined ? <span>סכום לא זמין</span> : <bdi>{formatMoney(gross, 2, 2)}</bdi>}
    </span>
  )
}
