import { randomUUID } from 'node:crypto'
import {
  calendarEventId,
  decide,
  hash,
  importId,
  parseEvent,
  projectShift,
  serializeEvent,
  serializeTravelTime,
  signature,
} from './events.js'

export function overlappingShift(id, rows, event, now = Date.now()) {
  if (!event) return false
  const start = Date.parse(event.start),
    end = Date.parse(event.end)
  for (const [otherId, shift] of rows) {
    if (otherId === id) continue
    const otherStart = Date.parse(shift.start)
    const otherEnd = shift.status === 'active' ? now : Date.parse(shift.end)
    if (otherStart < otherEnd && start < otherEnd && end > otherStart) return true
  }
  return false
}

function shiftStatus(shift, now) {
  if (!shift) return null
  if (shift.status === 'active') return 'active'
  return Date.parse(shift.end) <= now ? 'completed' : 'planned'
}

async function eventSource(client, event) {
  if (!event || event.source) return event?.source
  const original = await client.read(event.url)
  if (original.etag !== event.etag) throw Error('apple-concurrent')
  return original.text
}

export async function syncCalendar(db, uid, connection, client, deadline) {
  const calendar = connection.calendar
  const personal = connection.dedicated === false
  const travelMinutes = connection.travelMinutes ?? 0
  const user = db.collection('users').doc(uid)
  const shifts = user.collection('shifts')
  const mappings = user
    .collection('appleSyncScopes')
    .doc(connection.scope || hash(calendar))
    .collection('events')
  const [inventory, localDocs, mapDocs] = await Promise.all([
    client.inventory(calendar),
    shifts.get(),
    mappings.get(),
  ])
  const local = new Map(localDocs.docs.map((doc) => [doc.id, doc.data()]))
  const mapped = new Map(mapDocs.docs.map((doc) => [doc.id, doc.data()]))
  const byUrl = new Map([...mapped].map(([id, m]) => [m.url, { ...m, id }]))
  const byUid = new Map()
  if (!personal) {
    for (const [id, m] of mapped) byUid.set(m.uid, id)
    for (const id of local.keys()) byUid.set(calendarEventId(uid, id), id)
  }

  const remote = new Map()
  const ignoredUrls = new Set()
  const ignoredIds = new Set()
  const clock = () => {
    if (Date.now() >= deadline) throw Error('apple-deadline')
  }
  for (const [url, tag] of inventory) {
    clock()
    const previous = byUrl.get(url)
    // A personal calendar may contain private appointments. Never fetch their contents.
    if (personal && !previous) continue
    let event
    if (previous?.etag === tag && previous.remote) {
      event = { uid: previous.uid, value: previous.remote, etag: tag, url }
    } else {
      const resource = await client.read(url)
      let parsed
      try {
        parsed = parseEvent(resource.text)
      } catch {
        parsed = null
      }
      if (!parsed) {
        ignoredUrls.add(url)
        continue
      }
      event = { ...parsed, etag: resource.etag, url, source: resource.text }
    }
    if (personal && event.uid !== previous.uid) {
      ignoredUrls.add(url)
      continue
    }
    const id = personal ? previous.id : byUid.get(event.uid) || importId(event.uid)
    if (remote.has(id)) ignoredIds.add(id)
    remote.set(id, event)
  }

  let reviews = 0
  const ids = new Set([...mapped.keys(), ...local.keys(), ...remote.keys()])
  for (const id of ids) {
    clock()
    const current = local.get(id)
    const prior = mapped.get(id)
    const apple = remote.get(id)
    if (ignoredIds.has(id) || ignoredUrls.has(prior?.url)) continue
    const left = projectShift(current)
    const right = apple?.value ?? null
    const base = (apple && prior?.pendingCreateBase) || prior?.base || null
    if (!prior && !left && !right) continue
    const eventUid =
      prior?.uid || apple?.uid || (personal ? randomUUID() + '@personal-shifts' : calendarEventId(uid, id))
    const url = apple?.url || prior?.url || new URL(hash(eventUid) + '.ics', calendar).href
    // A different UID may have reused the old resource name.
    if (!apple && inventory.has(url)) {
      ignoredIds.add(id)
      continue
    }
    const ref = mappings.doc(id)
    const expectedStatus = shiftStatus(current, Date.now())
    let action = decide({
      base,
      local: left,
      remote: right,
      status: expectedStatus,
      exists: !!current,
      revision: current?.updatedAt ?? null,
      resolution: prior?.resolution,
    })
    const overlap = (action === 'remote' || action === 'review') && overlappingShift(id, local, right)
    if (action === 'remote' && overlap) action = 'review'
    const appliedTravel = prior?.appliedTravel ?? 0
    const common = {
      uid: eventUid,
      url,
      base,
      remote: right,
      etag: apple?.etag ?? null,
      pending: false,
      appliedTravel,
    }
    if (action === 'hold') continue
    if (action === 'review') {
      const review = {
        left,
        right,
        status: expectedStatus,
        revision: current?.updatedAt ?? null,
        overlap,
      }
      if (JSON.stringify(prior?.review ?? null) !== JSON.stringify(review) || prior?.etag !== common.etag) {
        await ref.set({ ...common, pending: true, review, resolution: null })
      }
      reviews++
      continue
    }
    if (action === 'local') {
      if (left) {
        // Reserve ownership before PUT so a lost acknowledgement can be retried without scanning private events.
        if (personal && !apple && !base) await ref.set({ ...common, pendingCreateBase: signature(left) })
        const future = Date.parse(left.start) > Date.now()
        const travel = future && (!apple || travelMinutes !== appliedTravel) ? travelMinutes : undefined
        const data = serializeEvent(eventUid, left, await eventSource(client, apple), travel)
        const etag = await client.write(url, data, apple?.etag)
        // A missing ETag forces a subsequent read and verification.
        await ref.set({
          ...common,
          remote: left,
          base: signature(left),
          etag: etag ?? null,
          appliedTravel: travel ?? appliedTravel,
        })
      } else {
        await client.remove(url, apple.etag)
        await ref.set({ ...common, remote: null, base: null, etag: null })
      }
      continue
    }
    if (right && Date.parse(right.start) > Date.now() && travelMinutes !== appliedTravel) {
      const source = await eventSource(client, apple)
      const data = serializeTravelTime(source, travelMinutes)
      common.etag = (await client.write(url, data, apple.etag)) ?? null
      common.appliedTravel = travelMinutes
    }
    if (action === 'remote') {
      const shiftRef = shifts.doc(id)
      const saved = await db.runTransaction(async (tx) => {
        const revisionRef = user.collection('settings').doc('shiftWrite')
        await tx.get(revisionRef)
        const latest = (await tx.get(shiftRef)).data()
        // Re-read potential overlaps inside the same transaction as an incoming write.
        if (right) {
          const others = await tx.get(shifts.where('start', '<', right.end))
          if (
            overlappingShift(
              id,
              others.docs.map((doc) => [doc.id, doc.data()]),
              right,
            )
          )
            throw Error('apple-concurrent')
        }
        const now = Date.now()
        if (
          signature(projectShift(latest)) !== signature(left) ||
          latest?.status !== current?.status ||
          shiftStatus(latest, now) !== expectedStatus ||
          (latest?.updatedAt ?? null) !== (current?.updatedAt ?? null)
        )
          throw Error('apple-concurrent')
        let next = null
        if (right) {
          const fields = { ...right, status: shiftStatus(right, now), updatedAt: new Date(now).toISOString() }
          const { breaks: _breaks, openBreak: _openBreak, ...savedFields } = latest ?? { id }
          next = { ...savedFields, ...fields }
          if (latest) tx.set(shiftRef, next)
          else tx.create(shiftRef, next)
        } else tx.delete(shiftRef)
        tx.set(revisionRef, { nonce: randomUUID() })
        tx.set(ref, { ...common, base: signature(right) })
        return next
      })
      if (saved) local.set(id, saved)
      else local.delete(id)
      continue
    }
    if (
      !prior ||
      prior.base !== signature(left) ||
      prior.url !== url ||
      prior.etag !== common.etag ||
      appliedTravel !== common.appliedTravel ||
      prior.review ||
      prior.resolution
    ) {
      await ref.set({ ...common, base: signature(left) })
    }
  }
  return { reviews, unsupported: ignoredUrls.size + ignoredIds.size }
}
