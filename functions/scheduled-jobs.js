import { shouldSkipEntrySync } from './service.js'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { HttpsError } from 'firebase-functions/v2/https'
import { FieldPath, getFirestore } from 'firebase-admin/firestore'

export const interval = 15 * 60_000
const ticketLifetime = 5 * 60_000
const pageSize = 16
const sha = (value) => createHash('sha256').update(value).digest('hex')

function mac(secret, payload) {
  const key = Buffer.from(secret || '', 'base64')
  if (key.length !== 32) throw Error('calendar-scheduler-key')
  const signingKey = createHmac('sha256', key).update('shuon/scheduler/signing-key/v1').digest()
  return createHmac('sha256', signingKey).update(payload).digest()
}

export function signJob(job, secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...job, issued: now })).toString('base64url')
  return body + '.' + mac(secret, body).toString('base64url')
}

export function verifyJob(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048 || !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]{43}$/.test(token))
    return null
  const [body, signature] = token.split('.')
  const expected = mac(secret, body)
  if (!timingSafeEqual(expected, Buffer.from(signature, 'base64url'))) return null
  try {
    const job = JSON.parse(Buffer.from(body, 'base64url').toString())
    const currentSlot = Math.floor(now / interval)
    if (
      !Number.isSafeInteger(job.issued) ||
      job.issued > now + 10_000 ||
      now - job.issued > ticketLifetime ||
      !Number.isSafeInteger(job.slot) ||
      job.slot < currentSlot - 1 ||
      job.slot > currentSlot ||
      !['sync', 'page', 'manual'].includes(job.kind) ||
      (job.kind === 'manual' && !/^[a-f0-9-]{36}$/.test(job.requestId)) ||
      typeof job.uid !== 'string' ||
      !job.uid ||
      job.uid.length > 256 ||
      job.uid.includes('/')
    )
      return null
    return job
  } catch {
    return null
  }
}

export async function enqueueJob(job) {
  const origin = new URL(process.env.NETLIFY_SITE_URL || process.env.URL)
  if (origin.protocol !== 'https:' || origin.username || origin.password)
    throw Error('calendar-scheduler-origin')
  const target = new URL('/.netlify/functions/calendar-job-background', origin)
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'x-calendar-job': signJob(job, process.env.APPLE_CALENDAR_ENCRYPTION_KEY) },
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  })
  await response.body?.cancel()
  if (response.status !== 202) throw Error('calendar-job-dispatch')
}

// Pages reuse a marker per cursor. A failed fanout is safe to retry because each
// user's sync claim is atomic and unique to the 15-minute slot.
export async function dispatchPage(db, slot, cursor = '', enqueue = enqueueJob) {
  const marker = db.collection('appleCalendarDispatch').doc(sha(cursor))
  const claimId = randomUUID()
  const claimed = await db.runTransaction(async (tx) => {
    const state = (await tx.get(marker)).data()
    if (
      state &&
      (state.slot > slot || (state.slot === slot && (state.done || state.leaseUntil > Date.now())))
    )
      return false
    tx.set(marker, { slot, claimId, done: false, leaseUntil: Date.now() + 40_000 })
    return true
  })
  if (!claimed) return
  try {
    let query = db
      .collection('appleCalendarConnections')
      .where('connected', '==', true)
      .orderBy(FieldPath.documentId())
      .select()
      .limit(pageSize + 1)
    if (cursor) query = query.startAfter(cursor)
    const { docs } = await query.get()
    const page = docs.slice(0, pageSize)
    const jobs = page.map((doc) => ({ kind: 'sync', slot, uid: doc.id }))
    if (docs.length > pageSize) jobs.push({ kind: 'page', slot, uid: page.at(-1).id })
    const sent = await Promise.allSettled(jobs.map(enqueue))
    if (sent.some((result) => result.status === 'rejected')) throw Error('calendar-page-dispatch')
    await mark(true)
  } catch (error) {
    await mark(false)
    throw error
  }
  async function mark(done) {
    await db.runTransaction(async (tx) => {
      const state = (await tx.get(marker)).data()
      if (state?.claimId === claimId) tx.update(marker, { done, leaseUntil: 0 })
    })
  }
}

// Persist before enqueueing so a dropped dispatch can also be picked up by the next scheduled run.
export async function dispatchUserSync(uid, enqueue = enqueueJob, { entry = false } = {}) {
  const db = getFirestore()
  const ref = db.collection('appleCalendarConnections').doc(uid)
  const request = await db.runTransaction(async (tx) => {
    const state = (await tx.get(ref)).data()
    const now = Date.now()
    if (entry && shouldSkipEntrySync(state, now)) return null
    if (!state?.connected) throw new HttpsError('failed-precondition', 'היומן אינו מחובר.')
    if (state.pendingRequestId && state.pendingDispatchAt > now - 30_000)
      return { requestId: state.pendingRequestId, send: false }
    const requestId = state.pendingRequestId || randomUUID()
    tx.update(ref, { pendingRequestId: requestId, pendingDispatchAt: now })
    return { requestId, send: true }
  })
  if (!request) return { skipped: true }
  if (request.send) await enqueueManual(uid, request.requestId, enqueue)
  return { requestId: request.requestId }
}

export function enqueueManual(uid, requestId, enqueue = enqueueJob) {
  return enqueue({ kind: 'manual', slot: Math.floor(Date.now() / interval), uid, requestId })
}
