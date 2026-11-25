import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { pool } from '../server/src/db.js'
import { handlePaintingRoute } from '../server/src/paintings.js'

const id = '11111111-1111-4111-8111-111111111111'
after(async () => { await pool.end() })

test('painting details require an author and validate the values', async (t) => {
  let author = false
  let saved
  t.mock.method(pool, 'query', async (sql, params) => {
    if (sql.includes('FROM sessions')) return { rows: [{ id: 'user', is_author: author }] }
    if (sql.includes('UPDATE paintings')) {
      saved = params
      return { rows: [{ id, duration_text: params[1], stroke_count: params[2], description: params[3] }] }
    }
    throw new Error('Unexpected query')
  })
  async function update(body, withCookie = true) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    req.method = 'PUT'
    req.headers = withCookie ? { cookie: `portfolio_session=${'a'.repeat(64)}` } : {}
    let status, payload
    const res = { writeHead(value) { status = value }, end(value) { payload = JSON.parse(value) } }
    await handlePaintingRoute(req, res, new URL(`/api/paintings/${id}`, 'http://localhost'))
    return { status, payload }
  }
  const details = { duration_text: ' 2 小时 ', stroke_count: 1280, description: ' 海边 ' }
  assert.equal((await update(details, false)).status, 401)
  assert.equal((await update(details)).status, 403)
  author = true
  assert.equal((await update({ ...details, stroke_count: -1 })).status, 400)
  assert.equal((await update({ ...details, duration_text: 12 })).status, 400)
  assert.equal((await update({ ...details, description: 'x'.repeat(1001) })).status, 400)
  const result = await update(details)
  assert.equal(result.status, 200)
  assert.deepEqual(saved, [id, '2 小时', 1280, '海边'])
  assert.equal(result.payload.description, '海边')
  const cleared = await update({ duration_text: '', stroke_count: null, description: '' })
  assert.equal(cleared.status, 200)
  assert.deepEqual(saved, [id, null, null, null])
})
