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
  const eventReview = ref.parent.parent.collection('appleSyncScopes').doc(connection.scope).collection('events').doc(ref.id)
  await eventReview.update({ 'review.invalidBreaks': true })
  const as = (who, data = {}) => ({ auth: { uid: who }, data })
  const status = async () => getAppleCalendarStatus.run(as(uid))
  await assert.rejects(getAppleCalendarStatus.run({ data: {} }), { code: 'unauthenticated' })
  assert.equal((await getAppleCalendarStatus.run(as(otherUid))).connected, false)
  const state = await status()
  assert.equal(state.reviews.length, 1)
  const review = state.reviews[0]
  assert.equal(review.status, 'completed')
  assert.deepEqual(Object.keys(review).sort(), ['id', 'left', 'overlap', 'revision', 'right', 'status'])
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

test('calendar selection is writable, private to the authenticated account, revocable, and consumed once', async (t) => {
  const { calendarActions } = await import('../service.js')
  const { createHash, randomBytes } = await import('node:crypto')
  const db = getFirestore()
  const alice = randomUUID()
  const bob = randomUUID()
  const credentials = (email) => ({ email, password: 'abcd-efgh-ijkl-mnop' })
  const row = (addr, props) =>
    '<D:response><D:href>' +
    addr +
    '</D:href><D:propstat><D:prop>' +
    props +
    '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
  const list = (path, name, priv, component = 'VEVENT') =>
    row(
      path,
      '<C:resourcetype><D:collection/><C:calendar/></C:resourcetype><D:displayname>' +
        name +
        '</D:displayname>' +
        '<A:calendar-color>#42B883FF</A:calendar-color><D:current-user-privilege-set><D:privilege><D:' +
        priv +
        '/></D:privilege></D:current-user-privilege-set><C:supported-calendar-component-set><C:comp name="' +
        component +
        '"/></C:supported-calendar-component-set>',
    )
  const original = globalThis.fetch
  const oldKey = process.env.APPLE_CALENDAR_ENCRYPTION_KEY
  process.env.APPLE_CALENDAR_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  let allowWrite = true
  t.after(() => {
    globalThis.fetch = original
    if (oldKey === undefined) delete process.env.APPLE_CALENDAR_ENCRYPTION_KEY
    else process.env.APPLE_CALENDAR_ENCRYPTION_KEY = oldKey
  })
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname
    assert.equal(options.method, 'PROPFIND')
    const email = Buffer.from(options.headers.Authorization.slice(6), 'base64').toString().split(':')[0]
    if (email.startsWith('bad')) return new Response(null, { status: 401 })
    const name = email.split('@')[0]
    const home = '/' + name + '/calendars/'
    let rows
    if (path === '/')
      rows = row('/', '<D:current-user-principal><D:href>/principal</D:href></D:current-user-principal>')
    else if (path === '/principal')
      rows = row(path, '<C:calendar-home-set><D:href>' + home + '</D:href></C:calendar-home-set>')
    else {
      assert.equal(path, home)
      rows =
        list(home + 'work/', name, allowWrite ? 'write' : 'read') +
        list(home + 'family/', 'read only', 'read') +
        list(home + 'tasks/', 'tasks', 'write', 'VTODO')
    }
    return new Response(
      '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">' +
        rows +
        '</D:multistatus>',
      { status: 207 },
    )
  }

  const discover = (uid, name) =>
    calendarActions.discoverAppleCalendars(uid, credentials(name + '@example.com'))
  const activate = (uid, setup) =>
    calendarActions.connectAppleCalendar(uid, {
      calendarId: setup.calendars[0].id,
      setupToken: setup.setupToken,
      travelMinutes: 30,
    })
  const status = (uid) => calendarActions.getAppleCalendarStatus(uid)
  await assert.rejects(discover(alice, 'bad'), /Apple דחתה/)
  const first = await discover(alice, 'alice')
  const other = await discover(bob, 'bob')
  assert.equal(first.calendars.length, 1)
  assert.equal(first.calendars[0].name, 'alice')
  assert.equal(first.calendars[0].color, '#42B883')
  assert.deepEqual(Object.keys(first.calendars[0]).sort(), ['color', 'id', 'name'])
  assert.equal(other.calendars[0].name, 'bob')
  assert.notEqual(first.calendars[0].id, other.calendars[0].id)
  assert.equal((await status(alice)).connected, false)
  assert.deepEqual((await db.collection('appleCalendarConnections').doc(alice).get()).data(), {
    setupHash: createHash('sha256').update(first.setupToken).digest('hex'),
  })
  await assert.rejects(activate(bob, first), /תוקף/)
  allowWrite = false
  await assert.rejects(activate(alice, first), /זמין לכתיבה/)
  allowWrite = true
  await activate(alice, first)
  await assert.rejects(activate(alice, first), /תוקף/)
  assert.equal((await status(alice)).travelMinutes, 30)
  assert.equal((await status(alice)).dedicated, false)
  assert.equal((await status(alice)).calendarName, 'alice')
  assert.equal((await status(bob)).connected, false)
  await calendarActions.updateAppleCalendarPreferences(alice, { travelMinutes: 45 })
  assert.equal((await status(alice)).travelMinutes, 45)
  await calendarActions.disconnectAppleCalendar(alice)
  assert.equal((await db.collection('appleCalendarConnections').doc(alice).get()).exists, false)
  await assert.rejects(activate(alice, first), /תוקף/)
  await calendarActions.disconnectAppleCalendar(bob)
})

test('scheduled fanout paginates, manual writes coalesce and completed job replays do no work', async (t) => {
  const { dispatchPage, dispatchUserSync, interval } = await import('../scheduled-jobs.js')
  const { calendarActions, run } = await import('../service.js')
  const { encrypt } = await import('../events.js')
  const { randomBytes } = await import('node:crypto')
  const db = getFirestore()
  const connections = db.collection('appleCalendarConnections')
  const prefix = 'zz-schedule-' + randomUUID()
  const refs = Array.from({ length: 18 }, (_, i) => connections.doc(prefix + String(i).padStart(2, '0')))
  const oldKey = process.env.APPLE_CALENDAR_ENCRYPTION_KEY
  const originalFetch = globalThis.fetch
  const key = randomBytes(32).toString('base64')
  process.env.APPLE_CALENDAR_ENCRYPTION_KEY = key
  const slot = Math.floor(Date.now() / interval)
  const calendar = 'https://caldav.icloud.com/one/calendar/'
  const creds = { email: 'scheduler@example.com', password: 'abcd-efgh-ijkl-mnop' }
  const uid = refs[0].id
  const markerFor = async (cursor) => {
    const { hash } = await import('../events.js')
    return db.collection('appleCalendarDispatch').doc(hash(cursor))
  }
  const markers = [await markerFor(prefix)]
  t.after(async () => {
    globalThis.fetch = originalFetch
    if (oldKey === undefined) delete process.env.APPLE_CALENDAR_ENCRYPTION_KEY
    else process.env.APPLE_CALENDAR_ENCRYPTION_KEY = oldKey
    await Promise.all([...refs, ...markers].map((ref) => ref.delete()))
  })
  await Promise.all(
    refs.map((ref, i) =>
      ref.set({
        connected: i !== 17,
        calendar,
        sealed: encrypt(key, ref.id, creds),
      }),
    ),
  )
  const sent = []
  const enqueue = async (job) => {
    sent.push(job)
  }
  await dispatchPage(db, slot, prefix, enqueue)
  assert.equal(sent.filter((j) => j.kind === 'sync').length, 16)
  const next = sent.find((j) => j.kind === 'page')
  markers.push(await markerFor(next.uid))
  await dispatchPage(db, slot, next.uid, enqueue)
  await dispatchPage(db, slot, prefix, enqueue)
  await dispatchPage(db, slot, next.uid, enqueue)
  assert.deepEqual(
    sent.filter((j) => j.kind === 'sync' && j.uid.startsWith(prefix)).map((j) => j.uid),
    refs.slice(0, 17).map((ref) => ref.id),
  )

  let calls = 0
  let follow
  globalThis.fetch = async () => {
    calls++
    if (calls === 1) follow = await dispatchUserSync(uid, enqueue)
    const props = '<D:resourcetype><D:collection/><C:calendar/></D:resourcetype>'
    return new Response(
      '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>' +
        calendar +
        '</D:href><D:propstat><D:prop>' +
        props +
        '</D:prop><D:status>HTTP/1.1 200 OK</D:status>' +
        '</D:propstat></D:response></D:multistatus>',
      { status: 207 },
    )
  }
  const request = await dispatchUserSync(uid, enqueue)
  assert.equal((await dispatchUserSync(uid, enqueue)).requestId, request.requestId)
  await run(uid, slot, undefined, async (user, id) => {
    assert.equal(user, uid)
    assert.equal(id, follow.requestId)
  })
  assert.notEqual(follow.requestId, request.requestId)
  const status = () => calendarActions.getAppleCalendarStatus(uid)
  assert.equal((await status()).completedRequestId, request.requestId)
  assert.equal((await status()).syncPending, true)
  assert.deepEqual(await run(uid, slot), { skipped: true })
  assert.deepEqual(await run(uid, undefined, request.requestId), { skipped: true })
  await run(uid, undefined, follow.requestId)
  assert.equal((await status()).completedRequestId, follow.requestId)
  assert.equal((await status()).syncPending, false)
  assert.equal(calls, 2)
})
