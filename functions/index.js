import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldPath } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { calendarActions, run } from './service.js'

initializeApp()
const db = getFirestore()
const secret = defineSecret('APPLE_CALENDAR_ENCRYPTION_KEY')
const calendarOptions = { region: 'europe-west1', secrets: [secret], timeoutSeconds: 300 }
const basicOptions = { region: 'europe-west1' }
const connections = db.collection('appleCalendarConnections')
function callable(name, options) {
  return onCall(options, async (req) => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'נדרשת כניסה לחשבון.')
    return calendarActions[name](req.auth.uid, req.data)
  })
}

export const discoverAppleCalendars = callable('discoverAppleCalendars', calendarOptions)
export const connectAppleCalendar = callable('connectAppleCalendar', calendarOptions)
export const disconnectAppleCalendar = callable('disconnectAppleCalendar', basicOptions)
export const getAppleCalendarStatus = callable('getAppleCalendarStatus', basicOptions)
export const updateAppleCalendarPreferences = callable('updateAppleCalendarPreferences', basicOptions)
export const syncAppleCalendar = callable('syncAppleCalendar', calendarOptions)
export const resolveAppleCalendar = callable('resolveAppleCalendar', basicOptions)

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
