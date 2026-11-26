import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { appleUrl, createCalendarClient } from '../caldav.js'
import { decrypt, encrypt, parseEvent, serializeEvent, signature } from '../events.js'
import { syncCalendar } from '../sync.js'

const original = { title: 'משמרת, בוקר', start: '2026-10-24T20:00:00.000Z', end: '2026-10-25T04:00:00.000Z' }
const calendar = 'https://p02-caldav.icloud.com/100/calendars/test/'
test('credentials are encrypted with random nonces and bound to the Firebase user', () => {
  const key = randomBytes(32).toString('base64')
  const creds = { email: 'test@example.org', password: 'synthetic' }
  const token = encrypt(key, 'alice', creds)
  assert.notEqual(token, encrypt(key, 'alice', creds))
  assert.deepEqual(decrypt(key, 'alice', token), creds)
  assert.throws(() => decrypt(key, 'bob', token))
  assert.throws(() => encrypt('weak', 'alice', creds))
})
test('allow only HTTPS Apple CalDAV hosts and inspect every redirect', async () => {
  for (const host of [
    'http://caldav.icloud.com/',
    'https://caldav.icloud.com.example.org/',
    'https://caldav.icloud.com@localhost/',
    'https://p02-caldav.icloud.com:444/',
  ])
    assert.throws(() => appleUrl(host))
  let calls = 0
  const client = createCalendarClient({ email: 'x', password: 'y' }, async () => {
    calls++
    return new Response(null, { status: 302, headers: { Location: 'https://unrelated.example.org/private' } })
  })
  await assert.rejects(client.inventory(calendar), /apple-address/)
  assert.equal(calls, 1)
})
test('discover principal and home, create a dedicated calendar and require complete ETags', async () => {
  const response = (href, props) =>
    '<D:response><D:href>' +
    href +
    '</D:href><D:propstat><D:prop>' +
    props +
    '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
  const multistatus = (rows) =>
    new Response(
      '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' + rows + '</D:multistatus>',
      { status: 207 },
    )
  let created = false
  let missingTag = false
  const client = createCalendarClient({ email: 'x', password: 'y' }, async (url, options) => {
    const path = new URL(url).pathname
    assert.equal(options.headers.Authorization, 'Basic eDp5')
    if (path === '/')
      return multistatus(
        response(
          path,
          '<D:current-user-principal><D:href>/one/principal</D:href></D:current-user-principal>',
        ),
      )
    if (path === '/one/principal')
      return multistatus(
        response(
          path,
          '<C:calendar-home-set><D:href>https://p02-caldav.icloud.com/one/calendars/</D:href></C:calendar-home-set>',
        ),
      )
    assert.match(path, /^\/one\/calendars\/shift-ledger-[0-9a-f]{32}\/$/)
    if (options.method === 'MKCALENDAR') {
      assert.match(options.body, /המשמרות שלי/)
      created = true
      return new Response(null, { status: 201 })
    }
    if (!created) return new Response(null, { status: 404 })
    return multistatus(
      response(path, '<D:resourcetype><D:collection/><C:calendar/></D:resourcetype>') +
        (options.headers.Depth === '1'
          ? response(
              path + 'shift.ics',
              missingTag ? '<D:resourcetype/>' : '<D:getetag>&quot;v1&quot;</D:getetag>',
            )
          : ''),
    )
  })
  const { calendar: url, created: isNew } = await client.discover('alice')
  assert.equal(isNew, true)
  assert.deepEqual(await client.discover('alice'), { calendar: url, created: false })
  assert.deepEqual([...(await client.inventory(url))], [[url + 'shift.ics', '"v1"']])
  missingTag = true
  await assert.rejects(client.inventory(url), /apple-incomplete-inventory/)
})
test('iCalendar round-trip supports Hebrew, UTC and overnight Israeli DST, retaining other event properties', () => {
  const ics = serializeEvent('stable', original)
  assert.deepEqual(parseEvent(ics), { uid: 'stable', value: original })
  const zoned = ics
    .replace('DTSTART:20261024T200000Z', 'DTSTART;TZID=Asia/Jerusalem:20261024T230000')
    .replace('DTEND:20261025T040000Z', 'DTEND;TZID=Asia/Jerusalem:20261025T060000')
  assert.deepEqual(parseEvent(zoned), { uid: 'stable', value: original })
  const withNotes = ics.replace('END:VEVENT', 'DESCRIPTION:private note\r\nEND:VEVENT')
  const edited = serializeEvent('stable', { ...original, title: 'שעות חדשות' }, withNotes)
  assert.match(edited, /DESCRIPTION:private note/)
  assert.equal(parseEvent(edited).value.title, 'שעות חדשות')
  assert.equal(parseEvent(ics.replace('END:VEVENT', 'RRULE:FREQ=DAILY\r\nEND:VEVENT')), null)
})

function fixture(t) {
  let now = Date.parse(original.start) - 1
  let transactionTime
  t.mock.method(Date, 'now', () => now)
  const docs = new Map()
  function collection(path) {
    return {
      doc(id) {
        const key = path + '/' + id
        return {
          id,
          key,
          collection: (sub) => collection(key + '/' + sub),
          set: async (v) => docs.set(key, structuredClone(v)),
        }
      },
      where() {
        return this
      },
      async get() {
        const rows = [...docs].filter(
          ([key]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'),
        )
        return {
          docs: rows.map(([key, v]) => ({ id: key.slice(path.length + 1), data: () => structuredClone(v) })),
        }
      },
    }
  }
  const db = {
    collection,
    async runTransaction(job) {
      if (transactionTime !== undefined) {
        now = transactionTime
        transactionTime = undefined
      }
      return await job({
        get: async (ref) => (ref.get ? ref.get() : { data: () => structuredClone(docs.get(ref.key)) }),
        create: (ref, v) => {
          assert.ok(!docs.has(ref.key))
          docs.set(ref.key, v)
        },
        update: (ref, v) => docs.set(ref.key, { ...docs.get(ref.key), ...v }),
        delete: (ref) => docs.delete(ref.key),
        set: (ref, v) => docs.set(ref.key, v),
      })
    },
  }
  const objects = new Map()
  let version = 0,
    reads = 0
  function put(url, text) {
    const etag = '"' + ++version + '"'
    objects.set(url, { etag, text })
    return etag
  }
  const client = {
    async inventory() {
      return new Map([...objects].map(([url, event]) => [url, event.etag]))
    },
    async read(url) {
      reads++
      return objects.get(url)
    },
    async write(url, data, tag) {
      assert.equal(objects.get(url)?.etag, tag)
      return put(url, data)
    },
    async remove(url, tag) {
      assert.equal(objects.get(url).etag, tag)
      objects.delete(url)
    },
  }
  return {
    docs,
    objects,
    put,
    reads: () => reads,
    setTime(time) {
      now = time
    },
    setTimeInNextTransaction(time) {
      transactionTime = time
    },
    run: () => syncCalendar(db, 'alice', { calendar }, client, Date.now() + 30_000),
  }
}

test('bidirectional create, incremental ETags, rename, simultaneous edit, completed review, retries, tombstones and imports', async (t) => {
  const f = fixture(t)
  const path = 'users/alice/shifts/one'
  f.docs.set(path, { ...original, id: 'one', breaks: [], status: 'planned', notes: 'private', holiday: true })
  f.docs.set('users/alice/shifts/live', {
    ...original,
    start: '2027-10-24T20:00:00.000Z',
    id: 'live',
    status: 'active',
  })
  await f.run()
  assert.equal(f.objects.size, 1)
  const [url, initial] = [...f.objects][0]
  assert.doesNotMatch(initial.text, /private|holiday/)
  const { uid } = parseEvent(initial.text)
  await f.run()
  assert.equal(f.reads(), 0)
  const appleValue = { ...original, title: 'ערב' }
  const moved = url.replace(/[^/]+$/, 'moved.ics')
  f.put(moved, serializeEvent(uid, appleValue))
  f.objects.delete(url)
  await f.run()
  assert.equal(f.docs.get(path).title, 'ערב')
  assert.equal(f.docs.get(path).notes, 'private')
  assert.equal(f.docs.get(path).holiday, true)
  assert.equal(f.objects.size, 1)
  f.setTime(Date.parse(original.end))
  const localValue = { ...original, title: 'מקומי' }
  f.docs.set(path, { ...f.docs.get(path), ...localValue, status: 'completed' })
  const otherValue = { ...original, title: 'אפל' }
  f.put(moved, serializeEvent(uid, otherValue))
  assert.equal((await f.run()).reviews, 1)
  const mapPath = [...f.docs.keys()].find((key) => key.includes('appleSyncScopes'))
  assert.equal(f.docs.get(mapPath).review.status, 'completed')
  assert.equal(f.docs.get(path).title, 'מקומי')
  f.docs.set(mapPath, {
    ...f.docs.get(mapPath),
    resolution: {
      revision: f.docs.get(path)?.updatedAt ?? null,
      left: signature(localValue),
      right: signature(otherValue),
      status: 'completed',
      choice: 'remote',
    },
  })
  await f.run()
  assert.equal(f.docs.get(path).title, 'אפל')
  assert.equal(f.docs.get(path).status, 'completed')
  f.objects.delete(moved)
  assert.equal((await f.run()).reviews, 1)
  assert.ok(f.docs.has(path))
  f.docs.set(mapPath, {
    ...f.docs.get(mapPath),
    resolution: {
      revision: f.docs.get(path)?.updatedAt ?? null,
      left: signature(otherValue),
      right: null,
      status: 'completed',
      choice: 'remote',
    },
  })
  await f.run()
  assert.equal(f.docs.has(path), false)
  await f.run()
  assert.equal(f.objects.size, 0)
  const entry = calendar + 'manual.ics'
  f.put(entry, serializeEvent('external-uid', original))
  await f.run()
  const imported = [...f.docs].find(([key]) => key.includes('shifts/apple-'))
  assert.equal(imported[1].status, 'completed')
  f.docs.delete(imported[0])
  await f.run()
  assert.ok(!f.objects.has(entry))
  assert.equal((await f.run()).reviews, 0)
})

test('reject invalid dates, all-day, zero-length, and nonexistent Israeli local times', () => {
  const valid = serializeEvent('uid', original)
  for (const invalid of [
    valid.replace('20261024T200000Z', '20260230T120000Z'),
    valid.replace('DTSTART:20261024T200000Z', 'DTSTART;VALUE=DATE:20261024'),
    valid.replace('20261025T040000Z', '20261024T200000Z'),
    valid.replace('DTSTART:20261024T200000Z', 'DTSTART;TZID=Asia/Jerusalem:20260327T023000'),
  ])
    assert.equal(parseEvent(invalid), null)
})

test('incoming overlaps, invalid break windows, open clocks and adjacent boundaries', async (t) => {
  const f = fixture(t)
  f.docs.set('users/alice/shifts/local', { ...original, id: 'local', status: 'completed', breaks: [] })
  const url = calendar + 'other.ics'
  const uid = 'another'
  f.put(url, serializeEvent(uid, { ...original, title: 'Apple' }))
  assert.equal((await f.run()).reviews, 1)
  const marker = [...f.docs.keys()].find((key) => f.docs.get(key)?.review?.overlap)
  assert.ok(marker)
  assert.equal([...f.docs.keys()].filter((key) => key.startsWith('users/alice/shifts/')).length, 1)
  const adjacent = { title: 'Apple', start: original.end, end: '2026-10-25T12:00:00.000Z' }
  f.put(url, serializeEvent(uid, adjacent))
  assert.equal((await f.run()).reviews, 0)
  const imported = [...f.docs.keys()].find((key) => key.startsWith('users/alice/shifts/apple-'))
  const shift = f.docs.get(imported)
  assert.equal(shift.status, 'planned')
  f.docs.set(imported, {
    ...shift,
    breaks: [{ start: '2026-10-25T08:00:00.000Z', end: '2026-10-25T08:30:00.000Z' }],
  })
  f.put(url, serializeEvent(uid, { ...adjacent, end: '2026-10-25T07:00:00.000Z' }))
  assert.equal((await f.run()).reviews, 1)
  assert.equal(f.docs.get(marker).review.invalidBreaks, true)
  assert.equal(f.docs.get(imported).end, adjacent.end)
  f.setTime(Date.parse(adjacent.start) + 1)
  f.docs.set('users/alice/shifts/clock', {
    id: 'clock',
    title: 'פעילה',
    status: 'active',
    start: '2020-01-01T08:00:00.000Z',
    end: '2020-01-01T08:00:00.000Z',
  })
  f.put(url, serializeEvent(uid, { ...adjacent, title: 'different' }))
  assert.equal((await f.run()).reviews, 1)
  assert.equal(f.docs.get(marker).review.overlap, true)
})

test('a new local revision invalidates a previously approved deletion of a completed shift', async (t) => {
  const f = fixture(t),
    id = 'users/alice/shifts/one'
  f.setTime(Date.parse(original.end))
  f.docs.set(id, { ...original, id: 'one', status: 'completed', updatedAt: 'old', breaks: [] })
  await f.run()
  f.objects.clear()
  await f.run()
  const marker = [...f.docs.keys()].find((k) => k.includes('appleSyncScopes'))
  const old = f.docs.get(marker)
  f.docs.set(marker, {
    ...old,
    resolution: {
      choice: 'remote',
      left: signature(original),
      right: null,
      status: 'completed',
      revision: 'old',
    },
  })
  f.docs.set(id, { ...f.docs.get(id), updatedAt: 'new', note: 'new note' })
  assert.equal((await f.run()).reviews, 1)
  assert.equal(f.docs.get(id).note, 'new note')
})

test('an Apple deletion needs review when the shift ends during the incoming transaction', async (t) => {
  const f = fixture(t)
  const id = 'users/alice/shifts/one'
  f.docs.set(id, { ...original, id: 'one', status: 'planned', updatedAt: 'stored', breaks: [] })
  await f.run()
  f.objects.clear()
  const end = Date.parse(original.end)
  f.setTime(end - 1)
  f.setTimeInNextTransaction(end)
  await assert.rejects(f.run(), /apple-concurrent/)
  assert.equal(f.docs.get(id).status, 'planned')
  assert.equal((await f.run()).reviews, 1)
  const marker = [...f.docs.keys()].find((key) => key.includes('appleSyncScopes'))
  assert.deepEqual(f.docs.get(marker).review, {
    left: original,
    right: null,
    status: 'completed',
    revision: 'stored',
    invalidBreaks: false,
    overlap: false,
  })
})

test('partial outbound success is idempotent when a cloud write succeeded before its response was lost', async (t) => {
  const f = fixture(t),
    id = 'users/alice/shifts/one'
  f.docs.set(id, { ...original, id: 'one', status: 'planned', breaks: [] })
  await f.run()
  const marker = [...f.docs.keys()].find((key) => key.includes('appleSyncScopes'))
  f.docs.delete(marker)
  await f.run()
  assert.equal(f.objects.size, 1)
  assert.equal(f.docs.get(marker).base, signature(original))
})
