import type { User } from 'firebase/auth'

const base = (import.meta.env.VITE_APPLE_CALENDAR_API_URL || '').replace(/\/+$/, '')
const emulator = import.meta.env.VITE_FIREBASE_EMULATORS === 'true'
const functionsEnabled = import.meta.env.VITE_ICLOUD_SYNC_ENABLED === 'true'
export const appleApiConfigured = Boolean(base || emulator || functionsEnabled)

export async function appleRequest<T>(user: User, name: string, data: unknown = {}): Promise<T> {
  if (!base && (emulator || functionsEnabled)) {
    const [{ getApp }, { getFunctions, httpsCallable, connectFunctionsEmulator }] = await Promise.all([
      import('firebase/app'), import('firebase/functions'),
    ])
    const functions = getFunctions(getApp(), 'europe-west1')
    if (emulator && !attached.has(functions)) {
      connectFunctionsEmulator(functions, '127.0.0.1', 5001)
      attached.add(functions)
    }
    return (await httpsCallable<unknown, T>(functions, name, { timeout: 300_000 })(data)).data
  }
  if (!base) throw Error('שירות היומן טרם הוגדר.')
  const response = await fetch(base + '/calendar/' + name, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(300_000),
    headers: { Authorization: 'Bearer ' + await user.getIdToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const value = await response.json().catch(() => null)
  if (!response.ok || !value || !('result' in value)) {
    throw Object.assign(new Error(value?.error?.message || 'שירות היומן אינו זמין כרגע. אפשר לנסות שוב.'), {
      code: value?.error?.code,
    })
  }
  if (name === 'syncAppleCalendar' && value.result?.requestId &&
    (data as { trigger?: string } | null)?.trigger !== 'entry') {
    const requestId = value.result.requestId
    const deadline = Date.now() + 5 * 60_000
    let delay = 1000
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, delay))
      const status = await appleRequest<{
        connected: boolean; syncPending: boolean; completedRequestId?: string; failedRequestId?: string; error?: string
      }>(user, 'getAppleCalendarStatus')
      if (!status.connected || status.completedRequestId === requestId) break
      if (status.failedRequestId === requestId) throw Error(status.error || 'הסנכרון נכשל. אפשר לנסות שוב.')
      if (!status.syncPending && !status.error) break
      delay = Math.min(delay * 2, 8000)
    }
    if (Date.now() >= deadline) throw Error('הסנכרון עדיין ממתין. אפשר לבדוק את מצבו בהגדרות.')
  }
  return value.result as T
}
const attached = new WeakSet<object>()
