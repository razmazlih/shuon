import { randomUUID } from 'node:crypto'
import {
  calendarEventId,
  decide,
  hash,
  importId,
  parseEvent,
  projectShift,
  serializeEvent,
  signature,
} from './events.js'

export function breaksFit(breaks, event) {
  return (
    !event ||
    !Array.isArray(breaks) ||
    breaks.every(
      (b) => Date.parse(b.start) >= Date.parse(event.start) && Date.parse(b.end) <= Date.parse(event.end),
    )
  )
}

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

export async function syncCalendar(db, uid, connection, client, deadline) {
  const calendar = connection.calendar
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
  const byUrl = new Map([...mapped.values()].map((m) => [m.url, m]))
  const byUid = new Map([...mapped].map(([id, m]) => [m.uid, id]))
  for (const id of local.keys()) byUid.set(calendarEventId(uid, id), id)

  const remote = new Map()
  const ignoredUrls = new Set()
  const ignoredIds = new Set()
  const clock = () => {
    if (Date.now() >= deadline) throw Error('apple-deadline')
  }
  for (const [url, tag] of inventory) {
    clock()
    const previous = byUrl.get(url)
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
    const id = byUid.get(event.uid) || importId(event.uid)
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
    const base = prior?.base ?? null
    if (!prior && !left && !right) continue
    const eventUid = prior?.uid || apple?.uid || calendarEventId(uid, id)
    const url = apple?.url || prior?.url || new URL(hash(eventUid) + '.ics', calendar).href
    // A different UID may have reused the old resource name.
    if (!apple && inventory.has(url)) {
      ignoredIds.add(id)
      continue
    }
    const ref = mappings.doc(id)
    let action = decide({
      base,
      local: left,
      remote: right,
      status: current?.status,
      exists: !!current,
      revision: current?.updatedAt ?? null,
      resolution: prior?.resolution,
    })
    const invalidBreaks = !breaksFit(current?.breaks, right)
    const overlap = overlappingShift(id, local, right)
    if (action === 'remote' && (invalidBreaks || overlap)) action = 'review'
    const expectedStatus = current?.status ?? null
    const common = { uid: eventUid, url, base, remote: right, etag: apple?.etag ?? null, pending: false }
    if (action === 'hold') continue
    if (action === 'review') {
      const review = {
        left,
        right,
        status: expectedStatus,
        revision: current?.updatedAt ?? null,
        invalidBreaks,
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
        const original = apple && !apple.source ? await client.read(url) : null
        if (original && original.etag !== apple.etag) throw Error('apple-concurrent')
        const data = serializeEvent(eventUid, left, apple?.source || original?.text)
        const etag = await client.write(url, data, apple?.etag)
        // A missing ETag forces a subsequent read and verification.
        await ref.set({ ...common, remote: left, base: signature(left), etag: etag ?? null })
      } else {
        await client.remove(url, apple.etag)
        await ref.set({ ...common, remote: null, base: null, etag: null })
      }
      continue
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
        if (
          signature(projectShift(latest)) !== signature(left) ||
          (latest?.status ?? null) !== expectedStatus ||
          (latest?.updatedAt ?? null) !== (current?.updatedAt ?? null) ||
          !breaksFit(latest?.breaks, right)
        )
          throw Error('apple-concurrent')
        let next = null
        if (right) {
          const fields = { ...right, updatedAt: new Date().toISOString() }
          next = latest ? { ...latest, ...fields } : { ...fields, id, status: 'planned', breaks: [] }
          if (latest) tx.update(shiftRef, fields)
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
      prior.review ||
      prior.resolution
    ) {
      await ref.set({ ...common, base: signature(left) })
    }
  }
  return { reviews, unsupported: ignoredUrls.size + ignoredIds.size }
}
