import { getFirestore } from 'firebase-admin/firestore'
import { adminApp } from '../admin-app.js'
import { dispatchPage, interval } from '../scheduled-jobs.js'

export const config = { schedule: '*/15 * * * *' }

export default async function calendarSchedule() {
  await dispatchPage(getFirestore(adminApp()), Math.floor(Date.now() / interval))
}
