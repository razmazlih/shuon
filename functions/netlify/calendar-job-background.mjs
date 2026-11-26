import { getFirestore } from 'firebase-admin/firestore'
import { adminApp } from '../admin-app.js'
import { dispatchPage, enqueueManual, verifyJob } from '../scheduled-jobs.js'
import { run } from '../service.js'

export const config = { background: true }

export default async function calendarJob(request) {
  if (request.method !== 'POST') return
  const job = verifyJob(request.headers.get('x-calendar-job'), process.env.APPLE_CALENDAR_ENCRYPTION_KEY)
  if (!job) return
  const db = getFirestore(adminApp())
  if (job.kind === 'page') {
    await dispatchPage(db, job.slot, job.uid)
    return
  }
  await run(job.uid, job.kind === 'sync' ? job.slot : undefined, job.requestId, enqueueManual)
}
