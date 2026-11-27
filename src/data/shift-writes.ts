import {
  collection,
  doc,
  documentId,
  getDocsFromServer,
  query,
  runTransaction,
  where,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from 'firebase/firestore'
import { normalizeShift, type WorkShift } from './model'

export const shiftConflict = () => new Error('המשמרת השתנתה במכשיר אחר. יש לפתוח אותה מחדש לפני השמירה.')
const overlap = () => new Error('יש חפיפה עם משמרת שכבר נשמרה. יש לעדכן את השעות ולנסות שוב.')
const cloudWrites = new WeakMap<Firestore, Map<string, Promise<void>>>()
const MAX_IDS_PER_QUERY = 30

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
    return { ...normalizeShift(s), updatedAt }
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
  const ids = [...change.ids]
  const read = (q: Query) => getDocsFromServer(q).then((snapshot) => snapshot.docs)
  const write = () => runTransaction(db, async (tx) => {
    // Every shift writer rotates this marker. Reading it before starting the queries
    // makes Firestore retry if anything changes before the validated write commits.
    await tx.get(marker)
    const reads: Promise<DocumentSnapshot[]>[] = []
    if (rows.length) {
      const earliest = Math.min(...rows.map((s) => interval(s, Date.now()).start))
      // ISO timestamps supplied with an explicit UTC offset can sort on an adjacent date.
      // Most writes concern recent/future shifts; the lower bound skips old payroll history.
      const from = new Date(earliest - 86_400_000).toISOString()
      reads.push(
        read(query(shifts, where('end', '>=', from))),
        read(query(shifts, where('status', '==', 'active'))),
      )
    }
    const nearbyCount = reads.length
    if (ids.length === 1) {
      reads.push(tx.get(doc(shifts, ids[0])).then((snapshot) => [snapshot]))
    } else {
      // A Web SDK transaction get sends a separate request for each document.
      for (let i = 0; i < ids.length; i += MAX_IDS_PER_QUERY) {
        reads.push(read(query(shifts, where(documentId(), 'in', ids.slice(i, i + MAX_IDS_PER_QUERY)))))
      }
    }
    const current = new Map<string, WorkShift>()
    // Wait for every transient listener to finish even when one read fails.
    const results = await Promise.allSettled(reads)
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') throw result.reason
      for (const item of result.value) {
        if (item.exists() && (index >= nearbyCount || !change.ids.has(item.id))) {
          current.set(item.id, item.data() as WorkShift)
        }
      }
    }
    change.validate([...current.values()])
    tx.set(marker, { nonce: crypto.randomUUID() })
    for (const s of change.writes) tx.set(doc(shifts, s.id), s)
    for (const id of deleted) tx.delete(doc(shifts, id))
  })

  // A one-shot Firestore query can share an identical active listener in this SDK
  // instance. Finish earlier reads before another write can observe a newer marker.
  let pending = cloudWrites.get(db)
  if (!pending) {
    pending = new Map()
    cloudWrites.set(db, pending)
  }
  const previousWrite = pending.get(uid)
  const saving = previousWrite ? previousWrite.catch(() => {}).then(write) : write()
  pending.set(uid, saving)
  try {
    await saving
  } finally {
    if (pending.get(uid) === saving) pending.delete(uid)
  }
}
