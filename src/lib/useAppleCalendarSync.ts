import { useEffect } from 'react'
import type { User } from 'firebase/auth'
import { appleApiConfigured, appleRequest } from './appleCalendarApi'

export function useAppleCalendarSync(user: User | null) {
  useEffect(() => {
    if (!user || !appleApiConfigured) return
    const key = 'shuon.apple.pending.' + user.uid
    let pending = localStorage.getItem(key)
    let entryPending = true
    let disposed = false
    let running = false
    let queued = false
    let timer: number | undefined
    const sync = async () => {
      if (disposed || (!pending && !entryPending) || !navigator.onLine) return
      if (running) {
        queued = true
        return
      }
      entryPending = false
      const revision = pending
      running = true
      try {
        if (!revision) {
          await appleRequest(user, 'syncAppleCalendar', { trigger: 'entry' })
          return
        }
        const status = await appleRequest<{ connected: boolean }>(user, 'getAppleCalendarStatus')
        if (disposed) return
        if (status.connected) await appleRequest(user, 'syncAppleCalendar')
        if (pending === revision) pending = null
        if (localStorage.getItem(key) === revision) localStorage.removeItem(key)
      } catch {
        // Firestore keeps the source shifts and mappings for the next reconciliation.
      } finally {
        running = false
        if (!disposed) {
          window.dispatchEvent(new CustomEvent('shuon-apple-sync-complete', { detail: { uid: user.uid } }))
          if (queued) {
            queued = false
            schedule()
          }
        }
      }
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void sync(), 800)
    }
    const afterWrite = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== user.uid) return
      pending = crypto.randomUUID()
      localStorage.setItem(key, pending)
      schedule()
    }
    schedule()
    window.addEventListener('shuon-shifts-written', afterWrite)
    window.addEventListener('online', schedule)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      window.removeEventListener('shuon-shifts-written', afterWrite)
      window.removeEventListener('online', schedule)
    }
  }, [user])
}
