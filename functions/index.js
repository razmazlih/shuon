import { initializeApp } from 'firebase-admin/app'
import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { calendarActions } from './service.js'

initializeApp()
const secret = defineSecret('APPLE_CALENDAR_ENCRYPTION_KEY')
const calendarOptions = { region: 'europe-west1', secrets: [secret], timeoutSeconds: 300 }
const basicOptions = { region: 'europe-west1' }
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
