import test from 'node:test'
import assert from 'node:assert/strict'
import { cachedPublicList, invalidatePublicLists } from '../server/src/publicCache.js'

test('public list cache coalesces requests, expires and ignores failed loads', async (t) => {
  invalidatePublicLists()
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  let calls = 0
  const load = async () => ++calls
  const [first, concurrent] = await Promise.all([
    cachedPublicList('list', load), cachedPublicList('list', load),
  ])
  assert.deepEqual([first, concurrent, calls], [1, 1, 1])
  now += 4999
  assert.equal(await cachedPublicList('list', load), 1)
  now += 1
  assert.equal(await cachedPublicList('list', load), 2)
  await assert.rejects(cachedPublicList('failed', async () => { throw new Error('database down') }))
  assert.equal(await cachedPublicList('failed', async () => 'recovered'), 'recovered')
})

test('invalidation replaces cached data and prevents an in-flight stale result', async () => {
  invalidatePublicLists()
  let finishOld
  let loads = 0
  const load = () => {
    loads += 1
    return loads === 1 ? new Promise((resolve) => { finishOld = resolve }) : Promise.resolve('private now')
  }
  const previous = cachedPublicList('list', load)
  await Promise.resolve()
  invalidatePublicLists()
  const updated = cachedPublicList('list', load)
  finishOld('was public')
  assert.equal(await previous, 'private now')
  assert.equal(await updated, 'private now')
  assert.equal(loads, 2)
  invalidatePublicLists()
  assert.equal(await cachedPublicList('list', async () => 'updated again'), 'updated again')
})
