import { createHash } from 'node:crypto'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

const origin = 'https://caldav.icloud.com/'
const ns = 'xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"'
const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true })
const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value])
const digest = (value) => createHash('sha256').update(value).digest('hex')

export function appleUrl(value, base = origin) {
  const url = new URL(value, base)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !/^(?:p\d+-)?caldav\.icloud\.com$/i.test(url.hostname)
  )
    throw Error('apple-address')
  return url.href
}

export class DavError extends Error {
  constructor(status) {
    super('apple-http-' + status)
    this.status = status
  }
}

async function limitedText(response, max) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const parts = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > max) {
        await reader.cancel()
        throw Error('apple-response-size')
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(parts).toString('utf8')
}

function successfulProps(row) {
  return Object.assign(
    {},
    ...list(row.propstat)
      .filter((p) => /\s2\d\d(?:\s|$)/.test(p.status))
      .map((p) => p.prop),
  )
}

export function createCalendarClient(credentials, transport = fetch) {
  const authorization =
    'Basic ' + Buffer.from(credentials.email + ':' + credentials.password).toString('base64')
  async function request(
    method,
    address,
    { headers = {}, body, statuses = [200, 201, 204, 207], max = 512_000 } = {},
  ) {
    let url = appleUrl(address)
    for (let i = 0; i < 5; i++) {
      const response = await transport(url, {
        method,
        headers: { Authorization: authorization, ...headers },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(18_000),
      })
      if ([301, 302, 307, 308].includes(response.status) && response.headers.has('location')) {
        await response.body?.cancel()
        url = appleUrl(response.headers.get('location'), url)
        continue
      }
      if (!statuses.includes(response.status)) {
        await response.body?.cancel()
        throw new DavError(response.status)
      }
      return { text: await limitedText(response, max), etag: response.headers.get('etag'), url }
    }
    throw Error('apple-redirect')
  }

  async function properties(url, depth, names) {
    const res = await request('PROPFIND', url, {
      headers: { Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0"?><D:propfind ' + ns + '><D:prop>' + names + '</D:prop></D:propfind>',
      statuses: [207],
      max: 8_000_000,
    })
    if (res.text.includes('<!DOCTYPE') || XMLValidator.validate(res.text) !== true) throw Error('apple-xml')
    const rows = list(parser.parse(res.text).multistatus?.response)
    if (!rows.length || rows.some((row) => !row.href || (!row.propstat && !row.status)))
      throw Error('apple-props')
    return rows.map((row) => ({
      url: appleUrl(row.href, res.url),
      props: successfulProps(row),
      status: row.status,
    }))
  }

  return {
    async discover(uid) {
      const [{ url: principalBase, props }] = await properties(origin, 0, '<D:current-user-principal/>')
      if (!props['current-user-principal']?.href) throw Error('apple-principal')
      const principal = appleUrl(props['current-user-principal'].href, principalBase)
      const [account] = await properties(principal, 0, '<C:calendar-home-set/>')
      if (!account.props['calendar-home-set']?.href) throw Error('apple-home')
      const home = appleUrl(account.props['calendar-home-set'].href, account.url)
      const calendar = appleUrl('shift-ledger-' + digest(uid).slice(0, 32) + '/', home.replace(/\/?$/, '/'))
      let created = false
      try {
        const [existing] = await properties(calendar, 0, '<D:resourcetype/>')
        if (!Object.hasOwn(existing.props.resourcetype ?? {}, 'calendar')) throw Error('apple-collection')
      } catch (error) {
        if (error.status !== 404) throw error
        await request('MKCALENDAR', calendar, {
          body:
            '<C:mkcalendar ' +
            ns +
            '><D:set><D:prop><D:displayname>המשמרות שלי</D:displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></D:prop></D:set></C:mkcalendar>',
          headers: { 'Content-Type': 'application/xml; charset=utf-8' },
          statuses: [201],
        })
        created = true
      }
      return { calendar, created }
    },
    async inventory(calendar) {
      const rows = await properties(calendar, 1, '<D:getetag/><D:resourcetype/>')
      const root = rows.find((row) => row.url.replace(/\/$/, '') === calendar.replace(/\/$/, ''))
      if (!root || !Object.hasOwn(root.props.resourcetype ?? {}, 'calendar')) throw Error('apple-collection')
      const contents = new Map()
      for (const row of rows) {
        if (row === root || Object.hasOwn(row.props.resourcetype ?? {}, 'collection')) continue
        if (
          !row.url.startsWith(calendar) ||
          row.url.slice(calendar.length).includes('/') ||
          !row.props.getetag
        )
          throw Error('apple-incomplete-inventory')
        contents.set(row.url, row.props.getetag)
      }
      return contents
    },
    async read(url) {
      const event = await request('GET', url, { statuses: [200] })
      if (!event.etag) throw Error('apple-missing-etag')
      return event
    },
    async write(url, data, etag) {
      const written = await request('PUT', url, {
        body: data,
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
        },
      })
      return written.etag
    },
    async remove(url, etag) {
      if (!etag) throw Error('apple-missing-etag')
      await request('DELETE', url, { headers: { 'If-Match': etag }, statuses: [200, 204, 404] })
    },
  }
}
