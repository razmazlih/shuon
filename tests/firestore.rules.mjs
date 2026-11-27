import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import 'tsx/esm'
import { readFile } from 'node:fs/promises'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore'

const address = process.env.FIRESTORE_EMULATOR_HOST || ''
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(address))
  throw Error('Use a local Firestore emulator for rules tests.')
const [host, port] = address.split(':')
const shift = {
  id: 'one',
  title: 'משמרת',
  start: '2026-11-26T06:00:00.000Z',
  end: '2026-11-26T14:00:00.000Z',
  status: 'planned',
  updatedAt: '2026-11-26T02:00:00.000Z',
}
let env, own, other, guest
const uid = 'rules-owner'
const shiftPath = 'users/' + uid + '/shifts/'
const settingsPath = 'users/' + uid + '/settings/'
const privatePaths = [
  'appleCalendarConnections/' + uid,
  'users/' + uid + '/appleSyncScopes/scope/events/one',
  'users/' + uid + '/applePrivate/credentials',
]

function mutate(database, uid, operation) {
  const batch = writeBatch(database)
  batch.set(doc(database, 'users', uid, 'settings', 'shiftWrite'), { nonce: randomUUID() })
  operation(batch)
  return batch.commit()
}

before(async () => {
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')
  env = await initializeTestEnvironment({
    projectId: 'demo-shuon',
    firestore: { host, port: Number(port), rules },
  })
  own = env.authenticatedContext(uid).firestore()
  other = env.authenticatedContext('rules-other').firestore()
  guest = env.unauthenticatedContext().firestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const path of privatePaths) await setDoc(doc(ctx.firestore(), path), { server: true })
  })
})
after(async () => {
  await env?.cleanup()
})

test('authenticated owner can list, create, edit and delete their own shifts', async () => {
  const ref = doc(own, shiftPath + 'one')
  await assertSucceeds(mutate(own, uid, (batch) => batch.set(ref, shift)))
  await assertSucceeds(getDoc(ref))
  await assertSucceeds(getDocs(collection(own, 'users', uid, 'shifts')))
  await assertSucceeds(mutate(own, uid, (batch) => batch.update(ref, { status: 'completed' })))
  await assertSucceeds(mutate(own, uid, (batch) => batch.delete(ref)))
})

test('other accounts and unsigned clients cannot read or modify personal records', async () => {
  await assertSucceeds(mutate(own, uid, (batch) => batch.set(doc(own, shiftPath + 'one'), shift)))
  for (const db of [other, guest]) {
    for (const path of [shiftPath + 'one', settingsPath + 'profile']) {
      const ref = doc(db, path)
      await assertFails(getDoc(ref))
      await assertFails(setDoc(ref, shift))
      await assertFails(deleteDoc(ref))
    }
    await assertFails(getDocs(collection(db, 'users', uid, 'shifts')))
  }
})

test('only designated user settings documents can be read or changed', async () => {
  for (const setting of ['profile', 'payroll', 'adjustments', 'templates', 'clock']) {
    const ref = doc(own, settingsPath + setting)
    await assertSucceeds(setDoc(ref, { value: 1 }))
    await assertSucceeds(getDoc(ref))
  }
  await assertFails(setDoc(doc(own, settingsPath + 'credentials'), { value: 1 }))
  await assertFails(getDoc(doc(own, settingsPath + 'credentials')))
})

test('server-only Apple connections and reconciliation metadata resist direct access by every client', async () => {
  for (const db of [own, other, guest])
    for (const path of privatePaths) {
      const ref = doc(db, path)
      await assertFails(getDoc(ref))
      await assertFails(setDoc(ref, { sealed: 'impostor' }))
      await assertFails(deleteDoc(ref))
    }
  await assertFails(getDocs(collection(own, 'appleCalendarConnections')))
})

test('shift writes must preserve the matching ID, supported status and field types', async () => {
  const ref = doc(own, shiftPath + 'one')
  for (const invalid of [
    { id: 'wrong' },
    { status: 'unknown' },
    { title: 'a'.repeat(121) },
    { start: 42 },
    { end: false },
  ]) {
    await assertFails(mutate(own, uid, (batch) => batch.set(ref, { ...shift, ...invalid })))
  }
})

test('an older shift stays readable and its next save removes legacy clock fields', async () => {
  const { writeCloudShifts } = await import('../src/data/shift-writes.ts')
  const user = 'legacy-shift-' + randomUUID()
  const database = env.authenticatedContext(user).firestore()
  const reference = doc(database, 'users', user, 'shifts', 'legacy-clock')
  const legacy = { ...shift, id: 'legacy-clock', breaks: [], openBreak: null }
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), reference.path), legacy))
  const previous = (await assertSucceeds(getDoc(reference))).data()
  await writeCloudShifts(database, user, [{ ...previous, note: 'updated' }], [], [previous])
  const saved = (await getDoc(reference)).data()
  assert.equal(saved.note, 'updated')
  assert.equal(saved.start, legacy.start)
  assert.equal(saved.end, legacy.end)
  assert.equal('breaks' in saved, false)
  assert.equal('openBreak' in saved, false)
})

test('older clients cannot silently modify shifts without rotating the workspace marker', async () => {
  const reference = doc(own, shiftPath + 'marker-check')
  await assertFails(setDoc(reference, { ...shift, id: 'marker-check' }))
  await assertSucceeds(mutate(own, uid, (batch) => batch.set(reference, { ...shift, id: 'marker-check' })))
  await assertFails(deleteDoc(reference))
  const marker = doc(own, settingsPath + 'shiftWrite')
  const existing = (await getDoc(marker)).data()
  const unchanged = writeBatch(own)
  unchanged.set(marker, existing)
  unchanged.delete(reference)
  await assertFails(unchanged.commit())
  await assertFails(getDoc(doc(other, settingsPath + 'shiftWrite')))
})

test('two signed-in devices serialize overlapping creates, adjacent writes and stale edits through the repository', async () => {
  const { writeCloudShifts } = await import('../src/data/shift-writes.ts')
  const user = 'concurrent-' + randomUUID()
  const deviceA = env.authenticatedContext(user).firestore()
  const deviceB = env.authenticatedContext(user).firestore()
  const a = { ...shift, id: 'a' },
    b = { ...shift, id: 'b' }
  const results = await Promise.allSettled([
    writeCloudShifts(deviceA, user, [a], [], []),
    writeCloudShifts(deviceB, user, [b], [], []),
  ])
  assert.equal(
    results.filter((r) => r.status === 'fulfilled').length,
    1,
    results.map((r) => r.reason?.message ?? r.status).join('; '),
  )
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /חפיפה/)
  const collectionRef = collection(deviceA, 'users', user, 'shifts')
  const before = (await getDocs(collectionRef)).docs.map((s) => s.data())
  assert.equal(before.length, 1)
  const adjacent = { ...shift, id: 'adjacent', start: shift.end, end: '2026-11-26T15:00:00.000Z' }
  await writeCloudShifts(deviceB, user, [adjacent], [], [])
  await writeCloudShifts(deviceA, user, [{ ...before[0], title: 'גרסה חדשה' }], [], before)
  await assert.rejects(writeCloudShifts(deviceB, user, [], [before[0].id], before), /השתנתה/)
  assert.equal((await getDocs(collectionRef)).size, 2)
})

test('a mixed shift transaction applies every change together and rejects a stale deletion without partial writes', async () => {
  const { writeCloudShifts } = await import('../src/data/shift-writes.ts')
  const user = 'mixed-shifts-' + randomUUID()
  const deviceA = env.authenticatedContext(user).firestore()
  const deviceB = env.authenticatedContext(user).firestore()
  const shifts = collection(deviceA, 'users', user, 'shifts')
  const marker = doc(deviceA, 'users', user, 'settings', 'shiftWrite')
  const readShifts = async () => (await getDocs(shifts)).docs.map((snap) => snap.data())
  const old = { ...shift, id: 'remove', start: shift.end, end: '2026-11-26T18:00:00.000Z' }
  await writeCloudShifts(deviceA, user, [{ ...shift, id: 'edit' }, old], [], [])

  const originals = await readShifts()
  const edited = { ...originals.find((row) => row.id === 'edit'), note: 'תיקון משמרת' }
  const replacement = { ...old, id: 'add' }
  const modifiedElsewhere = { ...originals.find((row) => row.id === old.id), note: 'עדכון ממכשיר אחר' }
  await writeCloudShifts(deviceB, user, [modifiedElsewhere], [], originals)

  const latest = await readShifts()
  const markerBefore = (await getDoc(marker)).data()
  await assert.rejects(writeCloudShifts(deviceA, user, [edited, replacement], [old.id], originals), /השתנתה/)
  assert.deepEqual(await readShifts(), latest)
  assert.deepEqual((await getDoc(marker)).data(), markerBefore)

  await writeCloudShifts(deviceA, user, [edited, replacement], [old.id], latest)
  const result = new Map((await readShifts()).map((row) => [row.id, row]))
  assert.equal(result.size, 2)
  assert.equal(result.get(edited.id)?.note, edited.note)
  assert.equal(result.get(replacement.id)?.start, replacement.start)
  assert.equal(result.get(replacement.id)?.end, replacement.end)
  assert.equal(result.has(old.id), false)
  assert.notDeepEqual((await getDoc(marker)).data(), markerBefore)
})

test('a 120-date shift save commits every shift and the revision together', async () => {
  const { writeCloudShifts } = await import('../src/data/shift-writes.ts')
  const user = 'bulk-shifts-' + randomUUID()
  const database = env.authenticatedContext(user).firestore()
  const marker = doc(database, 'users', user, 'settings', 'shiftWrite')
  const nonce = randomUUID()
  await setDoc(marker, { nonce })
  const rows = Array.from({ length: 120 }, (_, index) => ({
    ...shift,
    id: 'shift-' + index,
    start: new Date(Date.UTC(2026, 10, 26 + index, 6)).toISOString(),
    end: new Date(Date.UTC(2026, 10, 26 + index, 14)).toISOString(),
  }))

  await writeCloudShifts(database, user, rows, [], [])

  const saved = await getDocs(collection(database, 'users', user, 'shifts'))
  assert.equal(saved.size, rows.length)
  const savedById = new Map(saved.docs.map((doc) => [doc.id, doc.data()]))
  for (const row of rows) {
    assert.equal(savedById.get(row.id)?.start, row.start)
    assert.equal(savedById.get(row.id)?.end, row.end)
  }
  const revision = (await getDoc(marker)).data()
  assert.ok(revision?.nonce)
  assert.notEqual(revision.nonce, nonce)
})

test('a bulk save rejects a stale shift with the same ID outside the overlap query range', async () => {
  const { writeCloudShifts } = await import('../src/data/shift-writes.ts')
  const user = 'bulk-conflict-' + randomUUID()
  const database = env.authenticatedContext(user).firestore()
  const shifts = collection(database, 'users', user, 'shifts')
  const marker = doc(database, 'users', user, 'settings', 'shiftWrite')
  const historical = { ...shift, id: 'historical', start: '2025-01-01T06:00:00Z', end: '2025-01-01T14:00:00Z' }
  await writeCloudShifts(database, user, [historical], [], [])

  const original = (await getDoc(doc(shifts, historical.id))).data()
  const revision = (await getDoc(marker)).data()
  const fresh = { ...shift, id: 'fresh', start: shift.end, end: '2026-11-26T18:00:00Z' }
  await assert.rejects(
    writeCloudShifts(database, user, [fresh, { ...shift, id: historical.id }], [], []),
    /השתנתה/,
  )
  assert.deepEqual((await getDocs(shifts)).docs.map((row) => row.data()), [original])
  assert.deepEqual((await getDoc(marker)).data(), revision)
})

test('only one of two concurrently opened timers can commit, without losing the other device’s revision', async () => {
  const { writeCloudShifts } = await import('../src/data/shift-writes.ts')
  const user = 'timers-' + randomUUID()
  const a = env.authenticatedContext(user).firestore(),
    b = env.authenticatedContext(user).firestore()
  const now = new Date().toISOString()
  const active = { ...shift, start: now, end: now, status: 'active' }
  const attempts = await Promise.allSettled([
    writeCloudShifts(a, user, [{ ...active, id: 'a' }], [], []),
    writeCloudShifts(b, user, [{ ...active, id: 'b' }], [], []),
  ])
  assert.equal(attempts.filter((v) => v.status === 'fulfilled').length, 1)
  assert.match(attempts.find((v) => v.status === 'rejected').reason.message, /כבר פועל/)
  const current = (await getDocs(collection(a, 'users', user, 'shifts'))).docs.map((s) => s.data())
  assert.equal(current.length, 1)
  await writeCloudShifts(a, user, [{ ...current[0], note: 'first change' }], [], current)
  await assert.rejects(writeCloudShifts(b, user, [{ ...current[0], note: 'stale change' }], [], current), /השתנתה/)
})
