import { Clock } from 'lucide-react'
import { formatMoney, type WorkShift } from '../data/model'
import { formatWorkDuration } from '../data/shift-hours'
import type { BandKind, PayBand, ShiftPay } from '../domain/gross'
import { HOUR_MS } from '../domain/time'

export const workHourBands = [
  ['regular', 'שעות רגילות'],
  ['overtime125', 'שעות נוספות · 125%'],
  ['overtime150', 'שעות נוספות · 150%'],
  ['rest150', 'מנוחה או חג · 150%'],
  ['rest175', 'מנוחה או חג ושעות נוספות · 175%'],
  ['rest200', 'מנוחה או חג ושעות נוספות · 200%'],
] as const satisfies readonly (readonly [BandKind, string])[]

export function WorkDuration({ hours }: { hours: number }) {
  return <bdi className="work-duration" dir="ltr">{formatWorkDuration(hours * HOUR_MS)}</bdi>
}

function ShiftHoursValue({ band }: { band: PayBand }) {
  return (
    <dd>
      <WorkDuration hours={band.hours} />
      <small><bdi>{formatMoney(band.amount, 2)}</bdi></small>
    </dd>
  )
}

export function ShiftWorkHours({ status, pay }: { status: WorkShift['status']; pay?: ShiftPay }) {
  return (
    <section className="shift-work-hours">
      <h3><Clock size={17} aria-hidden="true" /> {status === 'planned' ? 'שעות עבודה צפויות' : 'שעות עבודה'}</h3>
      {pay ? (
        <dl>
          <div className="shift-work-total"><dt>סך שעות העבודה</dt><dd><WorkDuration hours={pay.hours} /></dd></div>
          {workHourBands.map(([kind, label]) => {
            const band = pay.bands.find((item) => item.kind === kind && item.hours > 0)
            return band && <div key={kind}><dt>{label}</dt><ShiftHoursValue band={band} /></div>
          })}
        </dl>
      ) : (
        <p>{status === 'active' ? 'פירוט השעות יהיה זמין בסיום המשמרת.' : 'פירוט השעות אינו זמין כרגע.'}</p>
      )}
    </section>
  )
}
