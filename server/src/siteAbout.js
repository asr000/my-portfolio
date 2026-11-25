import { pool } from './db.js'
import { getAuthenticatedUser } from './auth.js'
import { Buffer } from 'node:buffer'

const defaultContent = '好像还没啥可说的。'

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

export async function handleSiteAbout(request, response, url) {
  const isPublic = request.method === 'GET' && url.pathname === '/api/public/about'
  const isUpdate = request.method === 'PUT' && url.pathname === '/api/about'
  if (!isPublic && !isUpdate) return false

  try {
    if (isPublic) {
      const { rows } = await pool.query('SELECT content FROM site_about WHERE singleton = true')
      send(response, 200, { content: rows[0]?.content ?? defaultContent })
      return true
    }
    const user = await getAuthenticatedUser(request)
    if (!user) { send(response, 401, { error: '请先登录。' }); return true }
    if (!user.is_author) { send(response, 403, { error: '只有站长可以编辑关于我。' }); return true }
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > 16384) { send(response, 413, { error: '内容过长。' }); return true }
      chunks.push(chunk)
    }
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { send(response, 400, { error: '内容格式无效。' }); return true }
    if (!body || typeof body.content !== 'string' || body.content.length > 2000 ||
        [...body.content].some((char) => {
          const code = char.codePointAt(0)
          return (code < 32 && ![9, 10, 13].includes(code)) || code === 127
        })) {
      send(response, 400, { error: '内容不能超过 2000 个字符或包含控制字符。' })
      return true
    }
    const content = body.content.trim()
    await pool.query(
      `INSERT INTO site_about (singleton, content, updated_at) VALUES (true, $1, now())
       ON CONFLICT (singleton) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [content],
    )
    send(response, 200, { content })
  } catch (error) {
    console.error('Site about request failed:', error.code || error.message)
    send(response, 503, { error: '关于我的内容暂时不可用，请稍后重试。' })
  }
  return true
}
