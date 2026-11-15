import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'
import { getAuthenticatedUser } from './auth.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const maxPaintingBytes = 8 * 1024 * 1024
const extensionByType = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}
const root = resolve(
  process.env.PAINTING_DIR || fileURLToPath(new URL('../data/paintings', import.meta.url)),
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

function validImage(bytes, type) {
  if (type === 'image/jpeg')
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (type === 'image/png')
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return type === 'image/webp' &&
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
}

async function readImage(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxPaintingBytes) throw httpError(413, '单张作品不能超过 8 MB。')
    chunks.push(chunk)
  }
  if (!size) throw httpError(400, '图片文件为空。')
  return Buffer.concat(chunks)
}

function paintingTitle(request) {
  let title = ''
  try {
    title = decodeURIComponent(String(request.headers['x-painting-title'] || ''))
  } catch {
    throw httpError(400, '作品标题格式无效。')
  }
  title = title.trim() || '未命名作品'
  if (title.length > 120 || /[\u0000-\u001f\u007f]/.test(title))
    throw httpError(400, '作品标题不能超过 120 个字符或包含控制字符。')
  return title
}

async function listPaintings(response) {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, created_at,
         '/api/public/paintings/' || id::text || '/image' AS image_url
       FROM paintings ORDER BY created_at DESC, id DESC`,
    )
    sendJson(response, 200, rows)
  } catch (error) {
    console.error('Painting gallery query failed:', error.code || error.message)
    sendJson(response, 503, { error: '绘画作品暂时无法读取。' })
  }
}

async function getPaintingImage(response, id) {
  if (!uuidPattern.test(id)) throw httpError(404, '作品图片不存在。')
  const { rows } = await pool.query(
    'SELECT image_path, content_type FROM paintings WHERE id = $1 LIMIT 1',
    [id],
  )
  const painting = rows[0]
  if (!painting) throw httpError(404, '作品图片不存在。')
  const extension = extensionByType[painting.content_type]
  if (!extension || painting.image_path !== `${id}.${extension}`)
    throw httpError(404, '作品图片不存在。')
  const file = resolve(root, painting.image_path)
  if (dirname(file) !== root) throw httpError(404, '作品图片不存在。')
  const bytes = await readFile(file).catch((error) => {
    if (error.code === 'ENOENT') throw httpError(404, '作品图片不存在。')
    throw error
  })
  response.writeHead(200, {
    'Content-Type': painting.content_type,
    'Content-Length': String(bytes.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(bytes)
}

async function uploadPainting(request, response, user) {
  if (!user.is_author) throw httpError(403, '只有站长可以上传绘画作品。')
  const contentType = String(request.headers['content-type'] || '')
    .toLowerCase()
    .split(';')[0]
  const extension = extensionByType[contentType]
  if (!extension) throw httpError(415, '仅支持 WebP、JPEG 或 PNG 图片。')
  const title = paintingTitle(request)
  const bytes = await readImage(request)
  if (!validImage(bytes, contentType)) throw httpError(415, '图片内容与文件类型不一致。')

  const id = randomUUID()
  const imagePath = `${id}.${extension}`
  const file = resolve(root, imagePath)
  await mkdir(root, { recursive: true })
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 })
  try {
    const { rows } = await pool.query(
      `INSERT INTO paintings (id, title, image_path, content_type, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, created_at,
         '/api/public/paintings/' || id::text || '/image' AS image_url`,
      [id, title, imagePath, contentType, user.id],
    )
    sendJson(response, 201, rows[0])
  } catch (error) {
    await unlink(file).catch(() => {})
    throw error
  }
}

export async function handlePaintingRoute(request, response, url) {
  const { pathname } = url
  const method = request.method || 'GET'
  const imageMatch = pathname.match(/^\/api\/public\/paintings\/([^/]+)\/image$/)
  const recognized =
    (method === 'GET' && pathname === '/api/public/paintings') ||
    (method === 'GET' && !!imageMatch) ||
    (method === 'POST' && pathname === '/api/paintings')
  if (!recognized) return false

  try {
    if (method === 'GET' && pathname === '/api/public/paintings') {
      await listPaintings(response)
      return true
    }
    if (method === 'GET' && imageMatch) {
      await getPaintingImage(response, imageMatch[1])
      return true
    }
    const user = await getAuthenticatedUser(request)
    if (!user) throw httpError(401, '请先登录。')
    await uploadPainting(request, response, user)
    return true
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 503
    if (status >= 500)
      console.error('Painting gallery request failed:', error.code || error.message)
    sendJson(response, status, {
      error: status >= 500 ? '绘画作品服务暂时不可用，请稍后重试。' : error.message,
    })
    return true
  }
}
