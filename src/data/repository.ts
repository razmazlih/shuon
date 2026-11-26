import { collection, doc, onSnapshot, runTransaction } from 'firebase/firestore'
import { db } from './firebase'
import { demoWorkspace, freshWorkspace, type Workspace, type WorkShift } from './model'
import { prepareShiftWrites, writeCloudShifts } from './shift-writes'

type Setting = Exclude<keyof Workspace, 'shifts'>
const demoKey = 'shuon.demo.workspace.v1'
const changed = () => new Event('shuon-demo-update')
const conflict = () => new Error('הנתונים השתנו בחלון אחר. יש לפתוח מחדש ולנסות שוב.')
const local = (): Workspace => {
  const stored = localStorage.getItem(demoKey)
  if (stored) return JSON.parse(stored)
  return demoWorkspace()
}
async function localWrite(change: (data: Workspace) => void) {
  const write = () => {
    const data = local()
    change(data)
    localStorage.setItem(demoKey, JSON.stringify(data))
    window.dispatchEvent(changed())
  }
  if (navigator.locks) {
    await navigator.locks.request(demoKey, write)
    return
  }
  // Older browsers serialize read/write IndexedDB transactions on the same store.
  // localStorage stays the demo data source so existing records survive the fallback.
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('shuon-demo-lock', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('writers')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('writers', 'readwrite')
      let failure: unknown
      tx.objectStore('writers').get(demoKey).onsuccess = () => {
        try {
          write()
        } catch (error) {
          failure = error
          tx.abort()
        }
      }
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onabort = () => {
        db.close()
        reject(failure ?? tx.error)
      }
    }
  })
}

export function subscribeWorkspace(
  uid: string | undefined,
  next: (w: Workspace) => void,
  fail: (e: Error) => void,
) {
  if (!uid) {
    const read = () => {
      try {
        next(local())
      } catch (err) {
        fail(err as Error)
      }
    }
    read()
    window.addEventListener('storage', read)
    window.addEventListener('shuon-demo-update', read)
    return () => {
      window.removeEventListener('storage', read)
      window.removeEventListener('shuon-demo-update', read)
    }
  }
  const base = freshWorkspace()
  let current = { ...base }
  const ready = new Set<string>()
  const emit = (key: string) => {
    ready.add(key)
    if (ready.size === 2) next({ ...current })
  }
  const settingKeys: Setting[] = ['profile', 'payroll', 'adjustments', 'templates']
  // Subscribe to permitted documents individually so private server paths are never queried.
  const seen = new Set<string>()
  const watches = settingKeys.map((key) =>
    onSnapshot(
      doc(db, 'users', uid, 'settings', key),
      (snap) => {
        current = { ...current, [key]: snap.exists() ? snap.data().value : base[key] }
        seen.add(key)
        if (seen.size === settingKeys.length) emit('settings')
      },
      fail,
    ),
  )
  watches.push(
    onSnapshot(
      collection(db, 'users', uid, 'shifts'),
      (snap) => {
        current = { ...current, shifts: snap.docs.map((d) => d.data() as WorkShift) }
        emit('shifts')
      },
      fail,
    ),
  )
  return () => watches.forEach((stop) => stop())
}
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const first = a as Record<string, unknown>,
    second = b as Record<string, unknown>
  return (
    Object.keys(first).length === Object.keys(second).length &&
    Object.keys(first).every((k) => same(first[k], second[k]))
  )
}
export async function writeSetting<K extends Setting>(
  uid: string | undefined,
  key: K,
  value: Workspace[K],
  previous: Workspace[K],
) {
  if (!uid)
    return localWrite((data) => {
      if (!same(data[key], previous)) throw conflict()
      data[key] = value
    })
  const reference = doc(db, 'users', uid, 'settings', key)
  await runTransaction(db, async (tx) => {
    const old = await tx.get(reference)
    const current = old.exists() ? old.data().value : freshWorkspace()[key]
    if (!same(current, previous)) throw conflict()
    tx.set(reference, { value })
  })
}

export async function writeShifts(
  uid: string | undefined,
  rows: WorkShift[],
  deleted: string[],
  previous: WorkShift[],
) {
  if (uid) return writeCloudShifts(db, uid, rows, deleted, previous)
  const change = prepareShiftWrites(rows, deleted, previous)
  return localWrite((data) => {
    change.validate(data.shifts)
    data.shifts = [...data.shifts.filter((s) => !change.ids.has(s.id)), ...change.writes]
  })
}
