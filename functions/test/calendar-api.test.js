import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarHandler } from '../netlify/calendar-api.mjs'

const origin = 'https://shuon-shifts-il.web.app'
const handler = calendarHandler({ check: (uid) => ({ uid }) }, async token => {
  if (token !== 'valid') throw Error()
  return { uid: 'signed-in-user' }
})
function invoke(action, options = {}) {
  return handler(new Request('https://service.example/calendar/' + action, {
    method: 'POST',
    headers: { origin, authorization: 'Bearer valid', 'content-type': 'application/json' },
    body: JSON.stringify({ uid: 'somebody-else' }), ...options,
  }), { params: { action } })
}
test('calendar HTTP adapter scopes caller to the verified Firebase token', async () => {
  const result = await invoke('check')
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('access-control-allow-origin'), origin)
  assert.deepEqual(await result.json(), { result: { uid: 'signed-in-user' } })
})
test('calendar HTTP adapter rejects invalid tokens, origins, actions and oversized bodies', async () => {
  assert.equal((await invoke('check', { headers: { authorization: 'Bearer wrong' } })).status, 401)
  assert.equal((await invoke('check', { headers: { origin: 'https://other.example' } })).status, 403)
  assert.equal((await invoke('toString')).status, 404)
  assert.equal((await invoke('check', { body: 'x'.repeat(25000) })).status, 400)
})
