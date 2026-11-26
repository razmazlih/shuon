import { cert, getApps, initializeApp } from 'firebase-admin/app'

export function adminApp() {
  const existing = getApps()[0]
  if (existing) return existing
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!json) throw Error('Firebase service account is missing')
  return initializeApp({ credential: cert(JSON.parse(json)) })
}
