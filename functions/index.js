import { randomUUID } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldPath } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { createCalendarClient } from './caldav.js'
import { decrypt, encrypt, hash, signature } from './events.js'
import { syncCalendar } from './sync.js'

initializeApp()
const db = getFirestore()
const secret = defineSecret('APPLE_CALENDAR_ENCRYPTION_KEY')
const calendarOptions = { region: 'europe-west1', secrets: [secret], timeoutSeconds: 300 }
const basicOptions = { region: 'europe-west1' }
const connections = db.collection('appleCalendarConnections')
const fail = (code, text) => new HttpsError(code, text)
function userId(request) {
  if (!request.auth) throw fail('unauthenticated', 'נדרשת כניסה לחשבון.')
  return request.auth.uid
}
function mapping(uid, connection) {
  return db
    .collection('users')
    .doc(uid)
    .collection('appleSyncScopes')
    .doc(connection.scope || hash(connection.calendar))
    .collection('events')
}
const safeError = (error) => {
  if (error.status === 401 || error.status === 403)
    return 'Apple דחתה את הגישה. בדקו את כתובת החשבון והסיסמה הייעודית לאפליקציה.'
  if (error.status === 404) return 'היומן הייעודי לא נמצא ב־iCloud. חברו מחדש את החשבון.'
  if (error.status === 412 || error.message === 'apple-concurrent')
    return 'המשמרת השתנתה במהלך העדכון. הסנכרון הבא ינסה שוב.'
  return 'הסנכרון מול iCloud לא הושלם. נסו שוב ובדקו את הגדרות החיבור.'
}
async function acquire(uid, connecting = false) {
  const ref = connections.doc(uid)
  const lock = randomUUID()
  const details = await db.runTransaction(async (tx) => {
    const state = (await tx.get(ref)).data() || {}
    if (state.lockUntil > Date.now())
      throw fail('aborted', 'פעולת סנכרון כבר מתבצעת. נסו שוב בעוד מספר רגעים.')
    if (!connecting && !state.sealed) throw fail('failed-precondition', 'חשבון iCloud טרם חובר.')
    tx.set(ref, { lock, lockUntil: Date.now() + 600_000 }, { merge: true })
    return state
  })
  return { ref, lock, details }
}
async function release(job, fields) {
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(job.ref)).data()
    if (current?.lock === job.lock) tx.update(job.ref, { ...fields, lock: null, lockUntil: 0 })
  })
}

export const connectAppleCalendar = onCall(calendarOptions, async (req) => {
  const uid = userId(req)
  const email = String(req.data?.email || '').trim()
  const password = String(req.data?.password || '').trim()
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
  const job = await acquire(uid, true)
  try {
    const credentials = { email, password }
    const sealed = encrypt(secret.value(), uid, credentials)
    const { calendar, created } = await createCalendarClient(credentials).discover(uid)
    // A freshly recreated Apple calendar must be repopulated from local records.
    const scope =
      !created && job.details.calendar === calendar ? job.details.scope || hash(calendar) : randomUUID()
    await release(job, {
      sealed,
      calendar,
      scope,
      connected: true,
      error: null,
      lastSync: null,
      unsupported: 0,
    })
    return { connected: true }
  } catch (error) {
    await release(job, { error: safeError(error) })
    throw fail('failed-precondition', safeError(error))
  }
})

export const disconnectAppleCalendar = onCall(basicOptions, async (req) => {
  const uid = userId(req)
  await db.runTransaction(async (tx) => {
    const ref = connections.doc(uid)
    const existing = (await tx.get(ref)).data()
    if (existing?.lockUntil > Date.now()) throw fail('aborted', 'הסנכרון פעיל. נסו להתנתק שוב בעוד רגע.')
    tx.delete(ref)
  })
  return { connected: false }
})

export const getAppleCalendarStatus = onCall(basicOptions, async (req) => {
  const uid = userId(req)
  const state = (await connections.doc(uid).get()).data()
  if (!state?.connected) return { connected: false, error: state?.error ?? null, reviews: [] }
  const docs = await mapping(uid, state).where('pending', '==', true).limit(50).get()
  return {
    connected: true,
    lastSync: state.lastSync,
    error: state.error,
    unsupported: state.unsupported || 0,
    reviews: docs.docs.map((d) => ({ id: d.id, ...d.data().review })),
  }
})

async function run(uid) {
  const job = await acquire(uid)
  try {
    const credentials = decrypt(secret.value(), uid, job.details.sealed)
    const result = await syncCalendar(
      db,
      uid,
      job.details,
      createCalendarClient(credentials),
      Date.now() + 240_000,
    )
    await release(job, { lastSync: new Date().toISOString(), error: null, unsupported: result.unsupported })
    return result
  } catch (error) {
    await release(job, { error: safeError(error) })
    throw fail('unavailable', safeError(error))
  }
}
export const syncAppleCalendar = onCall(calendarOptions, (req) => run(userId(req)))

export const resolveAppleCalendar = onCall(basicOptions, async (req) => {
  const uid = userId(req)
  const { id, choice, left, right, status, revision } = req.data || {}
  if (typeof id !== 'string' || !id || id.includes('/') || !['local', 'remote'].includes(choice))
    throw fail('invalid-argument', 'בחירה לא תקינה.')
  await db.runTransaction(async (tx) => {
    const connection = (await tx.get(connections.doc(uid))).data()
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
    if (choice === 'remote' && (review.invalidBreaks || review.overlap))
      throw fail('failed-precondition', 'יש לפתור את חפיפת השעות או להתאים את ההפסקות לפני האישור.')
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
})

export const refreshAppleCalendars = onSchedule(
  { ...calendarOptions, timeoutSeconds: 1800, schedule: 'every 15 minutes', maxInstances: 1 },
  async () => {
    let cursor
    while (true) {
      let page = connections.where('connected', '==', true).orderBy(FieldPath.documentId()).limit(8)
      if (cursor) page = page.startAfter(cursor)
      const docs = await page.get()
      if (docs.empty) return
      await Promise.all(
        docs.docs.map(async (doc) => {
          // Failures are recorded on the connection and retried at the next interval.
          try {
            await run(doc.id)
          } catch (error) {
            if (!(error instanceof HttpsError)) throw error
          }
        }),
      )
      cursor = docs.docs.at(-1)
    }
  },
)
