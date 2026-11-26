import {
  collection,
  doc,
  getDocsFromServer,
  query,
  runTransaction,
  where,
  type Firestore,
} from 'firebase/firestore'
import type { WorkShift } from './model'

export const shiftConflict = () => new Error('המשמרת השתנתה במכשיר אחר. יש לפתוח אותה מחדש לפני השמירה.')
const overlap = () => new Error('יש חפיפה עם משמרת שכבר נשמרה. יש לעדכן את השעות ולנסות שוב.')

function interval(shift: WorkShift, now: number) {
  const start = Date.parse(shift.start)
  const end = shift.status === 'active' ? Math.max(start + 1, now) : Date.parse(shift.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new Error('טווח המשמרת אינו תקין.')
  return { start, end }
}

export function prepareShiftWrites(
  rows: WorkShift[],
  deleted: string[],
  previous: WorkShift[],
  now = Date.now(),
) {
  const ids = new Set([...rows.map((s) => s.id), ...deleted])
  if (ids.size !== rows.length + deleted.length) throw new Error('אותה משמרת מופיעה יותר מפעם אחת בשמירה.')
  const originals = new Map(previous.map((s) => [s.id, s]))
  const writes = rows.map((s) => {
    const oldTime = Date.parse(originals.get(s.id)?.updatedAt ?? '')
    const updatedAt = new Date(Number.isFinite(oldTime) ? Math.max(now, oldTime + 1) : now).toISOString()
    return { ...s, updatedAt }
  })

  function validate(current: WorkShift[], at = Date.now()) {
    const currentById = new Map(current.map((s) => [s.id, s]))
    for (const id of ids) {
      const expected = originals.get(id),
        actual = currentById.get(id)
      if (Boolean(expected) !== Boolean(actual) || expected?.updatedAt !== actual?.updatedAt)
        throw shiftConflict()
    }
    // Deletions and edits can repair older schedules even if other rows overlap.
    const unaffected = current.filter((s) => !ids.has(s.id))
    const activeCount = [...unaffected, ...writes].filter((s) => s.status === 'active').length
    if (writes.some((s) => s.status === 'active') && activeCount > 1)
      throw new Error('שעון משמרת כבר פועל. יש לסיים אותו לפני התחלת משמרת נוספת.')
    const others = unaffected.map((s) => interval(s, at))
    for (const s of writes) {
      const next = interval(s, at)
      if (others.some((other) => next.start < other.end && other.start < next.end)) throw overlap()
      others.push(next)
    }
  }
  return { ids, writes, validate }
}

export async function writeCloudShifts(
  db: Firestore,
  uid: string,
  rows: WorkShift[],
  deleted: string[],
  previous: WorkShift[],
) {
  const change = prepareShiftWrites(rows, deleted, previous)
  if (!change.ids.size) return
  const shifts = collection(db, 'users', uid, 'shifts')
  const marker = doc(db, 'users', uid, 'settings', 'shiftWrite')
  await runTransaction(db, async (tx) => {
    // Client transactions cannot query. All supported writers rotate this marker in
    // the same commit as their changes; a concurrent commit retries the server reads.
    await tx.get(marker)
    const touched = await Promise.all([...change.ids].map((id) => tx.get(doc(shifts, id))))
    const current = new Map<string, WorkShift>()
    if (rows.length) {
      const earliest = Math.min(...rows.map((s) => interval(s, Date.now()).start))
      // ISO timestamps supplied with an explicit UTC offset can sort on an adjacent date.
      // Most writes concern recent/future shifts; the lower bound skips old payroll history.
      const from = new Date(earliest - 86_400_000).toISOString()
      const nearby = await Promise.all([
        getDocsFromServer(query(shifts, where('end', '>=', from))),
        getDocsFromServer(query(shifts, where('status', '==', 'active'))),
      ])
      for (const result of nearby)
        for (const item of result.docs) current.set(item.id, item.data() as WorkShift)
    }
    for (const item of touched) {
      if (item.exists()) current.set(item.id, item.data() as WorkShift)
      else current.delete(item.id)
    }
    change.validate([...current.values()])
    tx.set(marker, { nonce: crypto.randomUUID() })
    for (const s of change.writes) tx.set(doc(shifts, s.id), s)
    for (const id of deleted) tx.delete(doc(shifts, id))
  })
}
