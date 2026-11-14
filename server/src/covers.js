import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'
import { getAuthenticatedUser } from './auth.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const maxCoverBytes = 5 * 1024 * 1024
const contentTypeByExtension = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}
const extensionByContentType = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}
const root = resolve(
  process.env.COVER_DIR || fileURLToPath(new URL('../data/covers', import.meta.url)),
)

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function parsePath(value, userId) {
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw httpError(400, '封面路径无效。')
  }
  const match = decoded.match(/^([0-9a-f-]{36})\/([0-9a-f-]{36})\.(webp|jpe?g|png)$/i)
  if (!match || !uuidPattern.test(match[1]) || !uuidPattern.test(match[2]))
    throw httpError(400, '封面路径无效。')
  if (userId && match[1].toLowerCase() !== userId.toLowerCase())
    throw httpError(404, '封面不存在。')
  const extension = match[3].toLowerCase()
  return {
    path: `${match[1]}/${match[2]}.${extension}`,
    file: resolve(root, match[1], `${match[2]}.${extension}`),
    contentType: contentTypeByExtension[extension],
  }
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxCoverBytes) throw httpError(413, '封面不能超过 5 MB。')
    chunks.push(chunk)
  }
  if (!size) throw httpError(400, '封面文件为空。')
  return Buffer.concat(chunks)
}

async function requireWriter(user) {
  const { rows } = await pool.query(
    `SELECT (u.is_author OR (u.email_verified_at IS NOT NULL AND m.user_id IS NOT NULL)) AS can_write
     FROM users u LEFT JOIN note_members m ON m.user_id = u.id WHERE u.id = $1`,
    [user.id],
  )
  if (!rows[0]?.can_write) throw httpError(403, '请先开通笔记记录功能。')
}

async function uploadCover(request, response, user) {
  await requireWriter(user)
  const { path, file, contentType: expectedContentType } = parsePath(
    request.headers['x-cover-path'] || '',
    user.id,
  )
  const contentType = String(request.headers['content-type'] || '')
    .toLowerCase()
    .split(';')[0]
  if (contentType !== expectedContentType)
    throw httpError(415, '封面文件格式与路径不一致。')
  const bytes = await readBody(request)
  await mkdir(dirname(file), { recursive: true })
  try {
    await writeFile(file, bytes, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const info = await stat(file)
    if (!info.isFile() || info.size > maxCoverBytes)
      throw httpError(409, '封面路径已被占用，请重新选择图片。')
  }
  sendJson(response, 200, { path })
}

export async function saveImportedCover(userId, bytes, contentType = 'image/webp') {
  const extension = extensionByContentType[contentType]
  if (!extension) throw httpError(415, '备份封面格式不受支持。')
  const path = `${userId}/${randomUUID()}.${extension}`
  const { file } = parsePath(path, userId)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 })
  return { path, file }
}

export async function discardImportedCover(file) {
  await unlink(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
}

async function coverExists(response, user, encodedPath) {
  const { file } = parsePath(encodedPath, user.id)
  try {
    const info = await stat(file)
    sendJson(response, 200, { exists: info.isFile() })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    sendJson(response, 200, { exists: false })
  }
}

async function getCover(request, response, encodedPath) {
  const user = await getAuthenticatedUser(request)
  const { path, file, contentType } = parsePath(encodedPath)
  let allowed = false
  if (user) {
    const owned = await pool.query(
      'SELECT 1 FROM records WHERE user_id = $1 AND cover_path = $2 LIMIT 1',
      [user.id, path],
    )
    allowed = owned.rows.length > 0
  }
  if (!allowed) {
    const published = await pool.query(
      `SELECT 1 FROM records r JOIN users u ON u.id = r.user_id
       WHERE r.cover_path = $1 AND r.is_public AND r.deleted_at IS NULL
         AND (u.is_author OR (u.email_verified_at IS NOT NULL AND EXISTS (
           SELECT 1 FROM note_members m WHERE m.user_id = u.id
         ))) LIMIT 1`,
      [path],
    )
    allowed = published.rows.length > 0
  }
  if (!allowed) throw httpError(404, '封面不存在或当前不可见。')
  const bytes = await readFile(file).catch((error) => {
    if (error.code === 'ENOENT') throw httpError(404, '封面文件不存在。')
    throw error
  })
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': String(bytes.length),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(bytes)
}

async function removeCover(response, user, encodedPath) {
  const { path, file } = parsePath(encodedPath, user.id)
  const references = await pool.query(
    'SELECT 1 FROM records WHERE cover_path = $1 LIMIT 1',
    [path],
  )
  if (references.rows.length) {
    sendJson(response, 200, { ok: true, deleted: false })
    return
  }
  await unlink(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  sendJson(response, 200, { ok: true, deleted: true })
}

export async function handleCoverRoute(request, response, url) {
  const { pathname, searchParams } = url
  const method = request.method || 'GET'
  const coverMatch = pathname.match(/^\/api\/covers\/(.+)$/)
  const recognized =
    (method === 'POST' && pathname === '/api/covers') ||
    (method === 'GET' && pathname === '/api/covers/exists') ||
    (method === 'GET' && !!coverMatch) ||
    (method === 'DELETE' && !!coverMatch)
  if (!recognized) return false
  try {
    if (method === 'POST') {
      const user = await getAuthenticatedUser(request)
      if (!user) throw httpError(401, '请先登录。')
      await uploadCover(request, response, user)
      return true
    }
    if (method === 'GET' && pathname === '/api/covers/exists') {
      const user = await getAuthenticatedUser(request)
      if (!user) throw httpError(401, '请先登录。')
      await coverExists(response, user, searchParams.get('path') || '')
      return true
    }
    if (method === 'GET' && coverMatch) {
      await getCover(request, response, coverMatch[1])
      return true
    }
    if (method === 'DELETE' && coverMatch) {
      const user = await getAuthenticatedUser(request)
      if (!user) throw httpError(401, '请先登录。')
      await removeCover(response, user, coverMatch[1])
      return true
    }
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 503
    if (status >= 500) console.error('Cover request failed:', error.code || error.message)
    sendJson(response, status, {
      error: status >= 500 ? '封面服务暂时不可用，请稍后重试。' : error.message,
    })
    return true
  }
  return false
}
