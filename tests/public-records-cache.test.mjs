import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../server/src/db.js'
import { handlePublicGet } from '../server/src/publicRecords.js'
import { invalidatePublicLists } from '../server/src/publicCache.js'

after(async () => { await pool.end() })

test('public record and tag routes cache separately and refresh after invalidation', async (t) => {
  invalidatePublicLists()
  let databaseCalls = 0
  let title = '公开文章'
  t.mock.method(pool, 'query', async (sql, params) => {
    databaseCalls += 1
    if (sql.includes('SELECT DISTINCT')) return { rows: [{ tag: '学习' }] }
    return { rows: [{ title, tag: params[1] }] }
  })
  async function get(path) {
    let status, body
    const response = { writeHead(value) { status = value }, end(value) { body = value } }
    assert.equal(await handlePublicGet(new URL(path, 'http://localhost'), response), true)
    assert.equal(status, 200)
    return JSON.parse(body)
  }
  assert.equal((await get('/api/public/records?tag=a'))[0].title, '公开文章')
  assert.equal((await get('/api/public/records?tag=a'))[0].title, '公开文章')
  assert.equal(databaseCalls, 1)
  await get('/api/public/records?tag=b')
  assert.deepEqual(await get('/api/public/tags'), ['学习'])
  assert.equal(databaseCalls, 3)
  title = '更新后的文章'
  invalidatePublicLists()
  assert.equal((await get('/api/public/records?tag=a'))[0].title, '更新后的文章')
  assert.equal(databaseCalls, 4)
})
