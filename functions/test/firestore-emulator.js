// Run with FIRESTORE_EMULATOR_HOST=127.0.0.1:PORT. Refuse cloud connections.
import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { getFirestore } from 'firebase-admin/firestore'
import { parseEvent, serializeEvent } from '../events.js'
import { syncCalendar } from '../sync.js'

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
  throw Error('This test requires a loopback Firestore emulator.')
}
process.env.GCLOUD_PROJECT = 'demo-shuon-apple'
const { getAppleCalendarStatus, resolveAppleCalendar, disconnectAppleCalendar } = await import('../index.js')

test('Firestore transactions, conflict review and per-user callable isolation', async () => {
  const db = getFirestore()
  const uid = randomUUID()
  const otherUid = randomUUID()
  const calendar = 'https://caldav.icloud.com/test/calendar/'
  const connection = { calendar, scope: randomUUID(), connected: true, lastSync: null, error: null }
  await db.collection('appleCalendarConnections').doc(uid).set(connection)
  const ref = db.collection('users').doc(uid).collection('shifts').doc('shift-one')
  const initial = {
    id: ref.id,
    title: 'משמרת לילה',
    status: 'planned',
    start: '2026-01-01T20:00:00.000Z',
    end: '2026-01-02T04:00:00.000Z',
    updatedAt: 'one',
    breaks: [],
    note: 'private',
  }
  await ref.set(initial)
  const remote = new Map()
  const client = {
    inventory: async () => new Map([...remote].map(([url, r]) => [url, r.etag])),
    read: async (url) => remote.get(url),
    write: async (url, text) => {
      remote.set(url, { text, etag: '"1"' })
      return '"1"'
    },
  }
  const run = () => syncCalendar(db, uid, connection, client, Date.now() + 10_000)
  await run()
  const [url, event] = [...remote][0]
  const changed = parseEvent(event.text)
  changed.value.title = 'כותרת חדשה'
  remote.set(url, { text: serializeEvent(changed.uid, changed.value), etag: '"2"' })
  await run()
  const as = (who, data = {}) => ({ auth: { uid: who }, data })
  const status = async () => getAppleCalendarStatus.run(as(uid))
  await assert.rejects(getAppleCalendarStatus.run({ data: {} }), { code: 'unauthenticated' })
  assert.equal((await getAppleCalendarStatus.run(as(otherUid))).connected, false)
  const state = await status()
  assert.equal(state.reviews.length, 1)
  const review = state.reviews[0]
  assert.equal(review.status, 'completed')
  await assert.rejects(
    resolveAppleCalendar.run(as(uid, { ...review, choice: 'remote', revision: 'wrong' })),
    { code: 'aborted' },
  )
  await resolveAppleCalendar.run(as(uid, { ...review, choice: 'remote' }))
  await run()
  const shift = (await ref.get()).data()
  assert.match(
    (await db.collection('users').doc(uid).collection('settings').doc('shiftWrite').get()).data().nonce,
    /^[a-f0-9-]{36}$/,
  )
  assert.equal(shift.title, changed.value.title)
  assert.equal(shift.note, initial.note)
  assert.equal(shift.status, 'completed')
  assert.equal((await status()).reviews.length, 0)
  await disconnectAppleCalendar.run(as(uid))
  assert.equal((await status()).connected, false)
})
