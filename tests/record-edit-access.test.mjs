import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { pool } from '../server/src/db.js'
import { handlePrivateRecordRoute } from '../server/src/privateRecords.js'

after(async () => { await pool.end() })
test('only the owner with writing access can edit a non-deleted record', async (t) => {
  let canWrite = true
  let ownsRecord = true
  t.mock.method(pool, 'query', async (sql, params) => {
    if (sql.includes('FROM sessions')) return { rows: [{ id: 'owner', is_author: false }] }
    if (sql.includes('FROM users u LEFT JOIN note_members')) return { rows: [{ can_write: canWrite }] }
    if (sql.includes('SELECT 1 FROM records')) {
      assert.equal(params[1], 'owner')
      assert.match(sql, /deleted_at IS NULL/)
      return { rows: ownsRecord ? [{}] : [] }
    }
    throw new Error('Unexpected query')
  })
  async function check(cookie = true) {
    const req = Readable.from([])
    req.method = 'GET'
    req.headers = cookie ? { cookie: `portfolio_session=${'a'.repeat(64)}` } : {}
    let status, payload
    const res = { writeHead(value) { status = value }, end(value) { payload = JSON.parse(value) } }
    await handlePrivateRecordRoute(req, res, new URL('/api/records/11111111-1111-4111-8111-111111111111/edit-access', 'http://localhost'))
    return { status, payload }
  }
  assert.equal((await check(false)).status, 401)
  assert.equal((await check()).payload.can_edit, true)
  ownsRecord = false
  assert.equal((await check()).payload.can_edit, false)
  ownsRecord = true
  canWrite = false
  assert.equal((await check()).payload.can_edit, false)
})

test('batch edit access only returns IDs owned by the signed-in user', async (t) => {
  let canWrite = true
  const ownId = '11111111-1111-4111-8111-111111111111'
  const otherId = '22222222-2222-4222-8222-222222222222'
  t.mock.method(pool, 'query', async (sql, params) => {
    if (sql.includes('FROM sessions')) return { rows: [{ id: 'owner' }] }
    if (sql.includes('FROM users u LEFT JOIN note_members')) return { rows: [{ can_write: canWrite }] }
    if (sql.includes('id = ANY')) {
      assert.equal(params[0], 'owner')
      assert.deepEqual(params[1], [ownId, otherId])
      return { rows: [{ id: ownId }] }
    }
    throw new Error('Unexpected query')
  })
  async function check(ids) {
    const req = Readable.from([])
    req.method = 'GET'
    req.headers = { cookie: `portfolio_session=${'a'.repeat(64)}` }
    let status, payload
    const res = { writeHead(value) { status = value }, end(value) { payload = JSON.parse(value) } }
    await handlePrivateRecordRoute(req, res, new URL(`/api/records/editable?ids=${ids}`, 'http://localhost'))
    return { status, payload }
  }
  assert.deepEqual((await check(`${ownId},${otherId}`)).payload.ids, [ownId])
  canWrite = false
  assert.deepEqual((await check(`${ownId},${otherId}`)).payload.ids, [])
  assert.equal((await check('invalid')).status, 400)
})
