import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { interval, signJob, verifyJob } from '../scheduled-jobs.js'

test('background tickets bind the account, job and time slot, and expire after five minutes', () => {
  const secret = randomBytes(32).toString('base64')
  const now = Date.now()
  const job = { kind: 'sync', uid: 'alice', slot: Math.floor(now / interval) }
  const token = signJob(job, secret, now)
  assert.equal(verifyJob(token, secret, now).uid, 'alice')
  const changed = Buffer.from(JSON.stringify({ ...job, uid: 'bob', issued: now })).toString('base64url')
  assert.equal(verifyJob(changed + '.' + token.split('.')[1], secret, now), null)
  assert.equal(verifyJob(token, secret, now + 301_000), null)
  assert.equal(verifyJob(token, randomBytes(32).toString('base64'), now), null)
  assert.equal(verifyJob(null, secret, now), null)
  assert.equal(verifyJob(signJob({ ...job, kind: 'manual' }, secret, now), secret, now), null)
})
