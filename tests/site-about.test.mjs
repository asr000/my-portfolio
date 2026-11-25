import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { pool } from '../server/src/db.js'
import { handleSiteAbout } from '../server/src/siteAbout.js'

after(async () => { await pool.end() })

test('about is public to read but only the author may update it', async (t) => {
  let isAuthor = false
  let stored
  t.mock.method(pool, 'query', async (sql, params) => {
    if (sql.includes('FROM sessions')) return { rows: [{ id: 'user', is_author: isAuthor }] }
    if (sql.startsWith('SELECT content')) return { rows: stored === undefined ? [] : [{ content: stored }] }
    if (sql.includes('INSERT INTO site_about')) { stored = params[0]; return { rows: [] } }
    throw new Error('Unexpected query')
  })
  async function request(method, body, cookie = true) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    req.method = method
    req.headers = cookie ? { cookie: `portfolio_session=${'a'.repeat(64)}` } : {}
    let status, payload
    const res = { writeHead(value) { status = value }, end(value) { payload = JSON.parse(value) } }
    await handleSiteAbout(req, res, new URL(method === 'GET' ? '/api/public/about' : '/api/about', 'http://localhost'))
    return { status, payload }
  }
  assert.equal((await request('GET')).payload.content, '好像还没啥可说的。')
  assert.equal((await request('PUT', { content: '内容' }, false)).status, 401)
  assert.equal((await request('PUT', { content: '内容' })).status, 403)
  isAuthor = true
  assert.equal((await request('PUT', { content: 'x'.repeat(2001) })).status, 400)
  assert.equal((await request('PUT', { content: 123 })).status, 400)
  assert.equal((await request('PUT', { content: ' 第一行\n第二行 ' })).payload.content, '第一行\n第二行')
  assert.equal((await request('GET')).payload.content, '第一行\n第二行')
  assert.equal((await request('PUT', { content: '' })).payload.content, '')
  assert.equal((await request('GET')).payload.content, '')
})
