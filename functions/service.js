import { randomUUID } from 'node:crypto'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { createCalendarClient } from './caldav.js'
import { decrypt, encrypt, hash, signature } from './events.js'
import { syncCalendar } from './sync.js'

const connectionRef = (uid) => getFirestore().collection('appleCalendarConnections').doc(uid)
const secret = () => process.env.APPLE_CALENDAR_ENCRYPTION_KEY
const fail = (code, text) => new HttpsError(code, text)
const expiredSetup = () =>
  fail('failed-precondition', 'תוקף החיבור הזמני פג. חזרו לשלב הזנת הסיסמה והציגו שוב את הלוחות.')
const dedicatedName = 'המשמרות שלי'

function mapping(uid, connection) {
  return getFirestore()
    .collection('users')
    .doc(uid)
    .collection('appleSyncScopes')
    .doc(connection.scope || hash(connection.calendar))
    .collection('events')
}
const safeError = (error) => {
  if (error.status === 401 || error.status === 403)
    return 'Apple דחתה את הגישה. בדקו את כתובת החשבון. אם איפסתם את סיסמת חשבון Apple, צרו סיסמה ייעודית חדשה עבור שועון.'
  if (error.status === 404) return 'הלוח שנבחר לא נמצא ב־iCloud. חברו מחדש את החשבון.'
  if (error.status === 412 || error.message === 'apple-concurrent')
    return 'המשמרת השתנתה במהלך העדכון. הסנכרון הבא ינסה שוב.'
  return 'הסנכרון מול iCloud לא הושלם. נסו שוב ובדקו את הגדרות החיבור.'
}
async function acquire(uid, { connecting = false, setupToken, scheduledSlot, requestId } = {}) {
  const ref = connectionRef(uid)
  const lock = randomUUID()
  const details = await getFirestore().runTransaction(async (tx) => {
    const state = (await tx.get(ref)).data() || {}
    if (requestId && (!state.connected || state.pendingRequestId !== requestId)) return null
    if (
      scheduledSlot !== undefined &&
      (!state.connected || state.lockUntil > Date.now() || (state.lastScheduledSlot ?? -1) >= scheduledSlot)
    )
      return null
    if (state.lockUntil > Date.now())
      throw fail('aborted', 'פעולת סנכרון כבר מתבצעת. נסו שוב בעוד מספר רגעים.')
    if (!connecting && !state.sealed) throw fail('failed-precondition', 'חשבון iCloud טרם חובר.')
    if (setupToken && state.setupHash !== hash(setupToken)) throw expiredSetup()
    const fields = { lock, lockUntil: Date.now() + 600_000 }
    // A timed-out worker can leave an active request behind. The lease and slot
    // checks above ensure that its successor can safely adopt it.
    const requested = state.pendingRequestId || state.activeRequestId
    if (requested && (scheduledSlot !== undefined || requestId)) {
      fields.activeRequestId = requested
      fields.pendingRequestId = null
    }
    if (scheduledSlot !== undefined) fields.lastScheduledSlot = scheduledSlot
    tx.set(ref, fields, { merge: true })
    return state
  })
  return details ? { ref, lock, details } : null
}
async function release(job, fields) {
  return getFirestore().runTransaction(async (tx) => {
    const current = (await tx.get(job.ref)).data()
    if (current?.lock !== job.lock) throw fail('aborted', 'החיבור השתנה במהלך הפעולה. נסו שוב.')
    tx.update(job.ref, { ...fields, lock: null, lockUntil: 0 })
    return current.pendingRequestId
  })
}

function credentialsFrom(data) {
  const email = String(data?.email || '').trim()
  const password = String(data?.password || '').trim()
  if (
    !/^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(email) ||
    email.length > 254 ||
    !/^[a-z]{4}(?:-[a-z]{4}){3}$/i.test(password)
  ) {
    throw fail(
      'invalid-argument',
      'הזינו כתובת Apple Account וסיסמה ייעודית לאפליקציה בפורמט xxxx-xxxx-xxxx-xxxx.',
    )
  }
  return { email, password }
}

function travelDuration(value) {
  if (!Number.isInteger(value) || value < 0 || value >= 1440)
    throw fail('invalid-argument', 'משך הנסיעה צריך להיות מספר דקות שלם בין 0 ל־1439.')
  return value
}

async function discoverAppleCalendars(uid, data) {
  const credentials = credentialsFrom(data)
  try {
    const options = await createCalendarClient(credentials).calendars(uid)
    const setupToken = encrypt(secret(), 'setup:' + uid, { credentials, expires: Date.now() + 15 * 60_000 })
    // The browser holds the short-lived sealed token. The server stores only a revocation marker.
    await connectionRef(uid).set({ setupHash: hash(setupToken) }, { merge: true })
    return { setupToken, calendars: options.map(({ id, name, color }) => ({ id, name, color })) }
  } catch (error) {
    throw fail('failed-precondition', safeError(error))
  }
}

function openSetup(uid, token) {
  try {
    const payload = decrypt(secret(), 'setup:' + uid, token)
    if (!Number.isFinite(payload.expires) || payload.expires <= Date.now()) throw expiredSetup()
    return payload.credentials
  } catch {
    throw expiredSetup()
  }
}

async function connectAppleCalendar(uid, data) {
  // Earlier app releases submit credentials to connect directly to their dedicated calendar.
  const legacy = data?.setupToken === undefined && data?.calendarId === undefined
  const credentials = legacy ? credentialsFrom(data) : openSetup(uid, data?.setupToken)
  const calendarId = legacy ? 'dedicated' : data.calendarId
  const dedicated = calendarId === 'dedicated'
  if (!dedicated && (typeof calendarId !== 'string' || !/^[a-f0-9]{64}$/.test(calendarId)))
    throw fail('invalid-argument', 'בחרו לוח מהרשימה.')
  const travelMinutes = travelDuration(data?.travelMinutes ?? 0)
  const job = await acquire(uid, { connecting: true, setupToken: data.setupToken })
  try {
    const client = createCalendarClient(credentials)
    let calendar
    let scope
    let calendarName
    if (dedicated) {
      const found = await client.discover(uid)
      calendar = found.calendar
      calendarName = dedicatedName
      scope =
        !found.created && job.details.calendar === calendar
          ? job.details.scope || hash(calendar)
          : randomUUID()
    } else {
      // Recheck membership and current write rights before accepting the user's selection.
      const selected = (await client.calendars(uid)).find((item) => item.id === calendarId)
      if (!selected)
        throw fail('failed-precondition', 'הלוח שנבחר כבר אינו זמין לכתיבה. הציגו שוב את הלוחות.')
      calendar = selected.calendar
      calendarName = selected.name
      scope = hash('personal:' + calendar)
    }
    await release(job, {
      sealed: encrypt(secret(), uid, credentials),
      calendar,
      scope,
      dedicated,
      calendarName,
      travelMinutes,
      connected: true,
      error: null,
      lastSync: null,
      unsupported: 0,
      setupHash: FieldValue.delete(),
    })
    return { connected: true }
  } catch (error) {
    const message = error instanceof HttpsError ? error.message : safeError(error)
    await release(job, { error: message })
    throw fail('failed-precondition', message)
  }
}

async function updateAppleCalendarPreferences(uid, data) {
  const travelMinutes = travelDuration(data?.travelMinutes)
  const ref = connectionRef(uid)
  await getFirestore().runTransaction(async (tx) => {
    const state = (await tx.get(ref)).data()
    if (!state?.connected) throw fail('failed-precondition', 'היומן אינו מחובר.')
    if (state.lockUntil > Date.now()) throw fail('aborted', 'הסנכרון פעיל. נסו שוב בעוד רגע.')
    tx.update(ref, { travelMinutes })
  })
  return { saved: true }
}

async function disconnectAppleCalendar(uid) {
  await getFirestore().runTransaction(async (tx) => {
    const ref = connectionRef(uid)
    const existing = (await tx.get(ref)).data()
    if (existing?.lockUntil > Date.now()) throw fail('aborted', 'הסנכרון פעיל. נסו להתנתק שוב בעוד רגע.')
    tx.delete(ref)
  })
  return { connected: false }
}

async function getAppleCalendarStatus(uid) {
  const state = (await connectionRef(uid).get()).data()
  if (!state?.connected) return { connected: false, error: state?.error ?? null, reviews: [] }
  const docs = await mapping(uid, state).where('pending', '==', true).limit(50).get()
  return {
    connected: true,
    dedicated: state.dedicated !== false,
    calendarName: state.calendarName || dedicatedName,
    travelMinutes: state.travelMinutes ?? 0,
    syncPending: Boolean(state.pendingRequestId || (state.activeRequestId && state.lockUntil > Date.now())),
    completedRequestId: state.completedRequestId ?? null,
    failedRequestId: state.failedRequestId ?? null,
    lastSync: state.lastSync,
    error: state.error,
    unsupported: state.unsupported || 0,
    reviews: docs.docs.map((d) => {
      const { left, right, status, revision, overlap } = d.data().review ?? {}
      return { id: d.id, left, right, status, revision, overlap }
    }),
  }
}

export async function run(uid, scheduledSlot, requestId, followUp) {
  const job = await acquire(uid, { scheduledSlot, requestId })
  if (!job) return { skipped: true }
  // The transaction captured the pending request before clearing it for this run.
  const activeRequest =
    requestId || scheduledSlot !== undefined
      ? job.details.pendingRequestId || job.details.activeRequestId
      : null
  let pending
  try {
    const credentials = decrypt(secret(), uid, job.details.sealed)
    const result = await syncCalendar(
      getFirestore(),
      uid,
      job.details,
      createCalendarClient(credentials),
      Date.now() + 240_000,
    )
    pending = await release(job, {
      lastSync: new Date().toISOString(),
      error: null,
      unsupported: result.unsupported,
      activeRequestId: null,
      ...(activeRequest && { completedRequestId: activeRequest }),
    })
    return result
  } catch (error) {
    pending = await release(job, {
      error: safeError(error),
      activeRequestId: null,
      ...(activeRequest && { failedRequestId: activeRequest }),
    })
    throw fail('unavailable', safeError(error))
  } finally {
    if (pending && followUp) await followUp(uid, pending)
  }
}

async function resolveAppleCalendar(uid, data) {
  const { id, choice, left, right, status, revision } = data || {}
  if (typeof id !== 'string' || !id || id.includes('/') || !['local', 'remote'].includes(choice))
    throw fail('invalid-argument', 'בחירה לא תקינה.')
  await getFirestore().runTransaction(async (tx) => {
    const connection = (await tx.get(connectionRef(uid))).data()
    if (!connection?.connected) throw fail('failed-precondition', 'היומן אינו מחובר.')
    if (connection.lockUntil > Date.now()) throw fail('aborted', 'הסנכרון פעיל. נסו שוב בעוד רגע.')
    const ref = mapping(uid, connection).doc(id)
    const review = (await tx.get(ref)).data()?.review
    if (
      !review ||
      review.status !== status ||
      (review.revision ?? null) !== (revision ?? null) ||
      signature(review.left) !== signature(left) ||
      signature(review.right) !== signature(right)
    ) {
      throw fail('aborted', 'הגרסאות השתנו. רעננו את רשימת השינויים.')
    }
    if (choice === 'remote' && review.overlap)
      throw fail('failed-precondition', 'יש לפתור את חפיפת השעות לפני האישור.')
    tx.update(ref, {
      resolution: {
        choice,
        left: signature(left),
        right: signature(right),
        status,
        revision: revision ?? null,
      },
      review: null,
      pending: false,
    })
  })
  return { saved: true }
}

export const calendarActions = Object.freeze({
  discoverAppleCalendars,
  connectAppleCalendar,
  disconnectAppleCalendar,
  getAppleCalendarStatus,
  updateAppleCalendarPreferences,
  syncAppleCalendar: (uid) => run(uid),
  resolveAppleCalendar,
})
