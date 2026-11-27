import { getAuth } from 'firebase-admin/auth'
import { HttpsError } from 'firebase-functions/v2/https'
import { adminApp } from '../admin-app.js'
import { dispatchUserSync } from '../scheduled-jobs.js'
import { calendarActions } from '../service.js'

export const config = { path: '/calendar/:action' }

const liveOrigins = ['https://shuon-shifts-il.web.app', 'https://shuon-shifts-il.firebaseapp.com']
const maxBody = 24_576

async function input(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new HttpsError('invalid-argument', 'נדרש גוף בקשה מסוג JSON.')
  const reader = request.body?.getReader()
  if (!reader) return {}
  const chunks = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > maxBody) {
      await reader.cancel()
      throw new HttpsError('invalid-argument', 'הבקשה גדולה מדי.')
    }
    chunks.push(value)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (body && typeof body === 'object' && !Array.isArray(body)) return body
  } catch { /* Report invalid JSON without reflecting request contents. */ }
  throw new HttpsError('invalid-argument', 'הבקשה אינה תקינה.')
}

export function calendarHandler(actions, verifyToken) {
  return async (request, context) => {
    const origin = request.headers.get('origin')
    const origins = (process.env.CALENDAR_ALLOWED_ORIGINS || liveOrigins.join(',')).split(',').map(s => s.trim())
    const headers = { 'Cache-Control': 'no-store', Vary: 'Origin' }
    if (origin) {
      if (!origins.includes(origin)) return new Response(null, { status: 403, headers })
      headers['Access-Control-Allow-Origin'] = origin
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
    }
    const action = context.params.action
    if (!Object.hasOwn(actions, action)) return new Response(null, { status: 404, headers })
    if (request.method !== 'POST') return new Response(null, { status: 405, headers })
    try {
      const token = /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') || '')?.[1]
      if (!token) throw new HttpsError('unauthenticated', 'נדרשת כניסה לחשבון שועון.')
      let identity
      try { identity = await verifyToken(token) } catch {
        throw new HttpsError('unauthenticated', 'יש להתחבר מחדש לחשבון שועון.')
      }
      const result = await actions[action](identity.uid, await input(request))
      return Response.json({ result }, { headers })
    } catch (reason) {
      const error = reason instanceof HttpsError ? reason : new HttpsError('internal', 'שירות היומן אינו זמין כרגע.')
      return Response.json({ error: { code: error.code, message: error.message } }, {
        status: error.httpErrorCode.status, headers,
      })
    }
  }
}

export default calendarHandler(
  { ...calendarActions, syncAppleCalendar: (uid, data) => dispatchUserSync(uid, undefined, { entry: data?.trigger === 'entry' }) },
  token => getAuth(adminApp()).verifyIdToken(token),
)
