import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import ICAL from 'ical.js'
import { DateTime, IANAZone } from 'luxon'

export const hash = (v) => createHash('sha256').update(v).digest('hex')
export const signature = (v) => (v ? hash(JSON.stringify([v.title, v.start, v.end])) : null)
export const calendarEventId = (uid, id) => hash(uid + '\0' + id) + '@personal-shifts'
export const importId = (uid) => 'apple-' + hash(uid)
const key = (secret) => {
  const bytes = Buffer.from(secret, 'base64')
  if (bytes.length !== 32) throw Error('calendar-secret-invalid')
  return bytes
}
export function encrypt(secret, uid, credentials) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  cipher.setAAD(Buffer.from(uid))
  const data = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}
export function decrypt(secret, uid, sealed) {
  const [iv, tag, data] = sealed.split('.').map((v) => Buffer.from(v, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', key(secret), iv)
  decipher.setAAD(Buffer.from(uid))
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'))
}

export function projectShift(shift) {
  if (!shift || shift.status === 'active') return null
  const start = new Date(shift.start),
    end = new Date(shift.end)
  if (!Number.isFinite(+start) || !(end > start)) return null
  // iCalendar stores timestamps to whole seconds.
  for (const date of [start, end]) date.setUTCMilliseconds(0)
  return { title: shift.title || 'משמרת', start: start.toISOString(), end: end.toISOString() }
}

function absoluteTime(component, name) {
  const prop = component.getFirstProperty(name)
  if (!prop || prop.type !== 'date-time') return null
  const wall = String(prop.toJSON()[3]).replace(/Z$/, '')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(wall)) return null
  const civil = DateTime.fromISO(wall, { zone: 'UTC' })
  if (!civil.isValid || civil.toFormat("yyyy-MM-dd'T'HH:mm:ss") !== wall || civil.year < 1000) return null
  const time = prop.getFirstValue()
  const tzid = prop.getParameter('tzid')
  if (time.zone.tzid === 'UTC') return civil.toISO()
  if (time.zone.component) return time.toJSDate().toISOString()
  // Floating times use the planning time zone. Reject local times lost at a DST change.
  const zone = tzid || 'Asia/Jerusalem'
  if (!IANAZone.isValidZone(zone)) return null
  const converted = DateTime.fromISO(wall, { zone })
  return converted.isValid && converted.toFormat("yyyy-MM-dd'T'HH:mm:ss") === wall
    ? converted.toUTC().toISO()
    : null
}
export function parseEvent(source) {
  const calendar = new ICAL.Component(ICAL.parse(source))
  const components = calendar.getAllSubcomponents('vevent')
  if (components.length !== 1) return null
  const event = components[0]
  if (['rrule', 'rdate', 'exdate', 'recurrence-id'].some((name) => event.hasProperty(name))) return null
  const uid = event.getFirstPropertyValue('uid')
  const start = absoluteTime(event, 'dtstart')
  const duration = event.getFirstPropertyValue('duration')
  const end = event.hasProperty('dtend')
    ? absoluteTime(event, 'dtend')
    : start && duration
      ? new Date(Date.parse(start) + duration.toSeconds() * 1000).toISOString()
      : null
  if (!uid || !start || !end || end <= start || uid.length > 2048) return null
  const title = event.getFirstPropertyValue('summary') || 'משמרת'
  if (typeof title !== 'string' || title.length > 120) return null
  return { uid, value: { title, start, end } }
}
function updateTravel(event, minutes) {
  const name = 'x-apple-travel-duration'
  event.removeAllProperties(name)
  if (minutes > 0) {
    const property = new ICAL.Property(name)
    property.resetType('duration')
    property.setValue(ICAL.Duration.fromSeconds(minutes * 60))
    event.addProperty(property)
  }
}

function bumpVersion(event) {
  event.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))
  event.updatePropertyWithValue('sequence', (Number(event.getFirstPropertyValue('sequence')) || 0) + 1)
}

export function serializeTravelTime(source, minutes) {
  const calendar = new ICAL.Component(ICAL.parse(source))
  const event = calendar.getFirstSubcomponent('vevent')
  updateTravel(event, minutes)
  bumpVersion(event)
  return calendar.toString()
}

export function serializeEvent(uid, value, source, travelMinutes) {
  const calendar = source ? new ICAL.Component(ICAL.parse(source)) : new ICAL.Component('vcalendar')
  if (!source) {
    calendar.addPropertyWithValue('version', '2.0')
    calendar.addPropertyWithValue('prodid', '-//Personal Shifts//HE')
  }
  const event =
    calendar.getFirstSubcomponent('vevent') || calendar.addSubcomponent(new ICAL.Component('vevent'))
  event.updatePropertyWithValue('uid', uid)
  event.updatePropertyWithValue('summary', value.title)
  bumpVersion(event)
  if (travelMinutes !== undefined) updateTravel(event, travelMinutes)
  event.removeAllProperties('duration')
  for (const [name, val] of [
    ['dtstart', value.start],
    ['dtend', value.end],
  ]) {
    event.removeAllProperties(name)
    event.addPropertyWithValue(name, ICAL.Time.fromJSDate(new Date(val), true))
  }
  return calendar.toString()
}

export function decide({ base, local, remote, status, exists, revision = null, resolution }) {
  const left = signature(local),
    right = signature(remote)
  if (exists && !local) return 'hold'
  if (left === right) return 'record'
  if (
    resolution?.left === left &&
    resolution.right === right &&
    resolution.status === (status ?? null) &&
    (resolution.revision ?? null) === revision
  )
    return resolution.choice
  if (right === base) return 'local'
  if (left !== base || status === 'completed') return 'review'
  return 'remote'
}
