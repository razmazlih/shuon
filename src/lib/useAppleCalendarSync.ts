import { useEffect } from 'react'
import type { User } from 'firebase/auth'
import { appleApiConfigured, appleRequest } from './appleCalendarApi'

export function useAppleCalendarSync(user: User | null) {
  useEffect(() => {
    if (!user || !appleApiConfigured) return
    let disposed = false
    let running = false
    let queued = false
    let timer: number | undefined
    const sync = async () => {
      if (disposed || !navigator.onLine) return
      if (running) {
        queued = true
        return
      }
      running = true
      try {
        const status = await appleRequest<{ connected: boolean }>(user, 'getAppleCalendarStatus')
        if (disposed || !status.connected) return
        await appleRequest(user, 'syncAppleCalendar')
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
      if ((event as CustomEvent<string>).detail === user.uid) schedule()
    }
    schedule()
    const interval = window.setInterval(schedule, 15 * 60_000)
    window.addEventListener('shuon-shifts-written', afterWrite)
    window.addEventListener('online', schedule)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      window.clearInterval(interval)
      window.removeEventListener('shuon-shifts-written', afterWrite)
      window.removeEventListener('online', schedule)
    }
  }, [user])
}
