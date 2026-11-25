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
  process.env.PAINTING_DIR || (process.env.NODE_ENV === 'production'
    ? '/var/lib/portfolio-api/paintings'
    : fileURLToPath(new URL('../data/paintings', import.meta.url))),
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

async function readImage(request, maxBytes = maxPaintingBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) throw httpError(413, '图片文件过大。')
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
      `SELECT id, title, created_at, duration_text, stroke_count, description,
         '/api/public/paintings/' || id::text || '/image' AS image_url,
         '/api/public/paintings/' || id::text || '/thumbnail' AS thumbnail_url
       FROM paintings ORDER BY created_at DESC, id DESC`,
    )
    sendJson(response, 200, rows)
  } catch (error) {
    console.error('Painting gallery query failed:', error.code || error.message)
    sendJson(response, 503, { error: '绘画作品暂时无法读取。' })
  }
}

async function getPaintingImage(response, id, thumbnail = false) {
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
  let imageFile = file
  let contentType = painting.content_type
  let thumbnailFound = false
  let bytes
  if (thumbnail) {
    for (const [extension, type] of [['webp', 'image/webp'], ['jpg', 'image/jpeg']]) {
      try {
        imageFile = resolve(root, `${id}.thumb.${extension}`)
        bytes = await readFile(imageFile)
        contentType = type
        thumbnailFound = true
        break
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
  if (!bytes) bytes = await readFile(file).catch((error) => {
    if (error.code === 'ENOENT') throw httpError(404, '作品图片不存在。')
    throw error
  })
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': String(bytes.length),
    'Cache-Control': thumbnail && !thumbnailFound ? 'no-store' : 'public, max-age=31536000, immutable',
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
       RETURNING id, title, created_at, duration_text, stroke_count, description,
         '/api/public/paintings/' || id::text || '/image' AS image_url,
         '/api/public/paintings/' || id::text || '/thumbnail' AS thumbnail_url`,
      [id, title, imagePath, contentType, user.id],
    )
    sendJson(response, 201, rows[0])
  } catch (error) {
    await unlink(file).catch(() => {})
    throw error
  }
}

async function updatePaintingDetails(request, response, user, id) {
  if (!user.is_author) throw httpError(403, '只有站长可以编辑作品说明。')
  if (!uuidPattern.test(id)) throw httpError(404, '作品不存在。')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 8192) throw httpError(413, '作品说明过长。')
    chunks.push(chunk)
  }
  let body
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw httpError(400, '作品说明格式无效。') }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw httpError(400, '作品说明格式无效。')
  if ((body.duration_text != null && typeof body.duration_text !== 'string') ||
      (body.description != null && typeof body.description !== 'string'))
    throw httpError(400, '作品说明格式无效。')
  const duration = typeof body.duration_text === 'string' ? body.duration_text.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const strokes = body.stroke_count
  if (duration.length > 40 || /[\u0000-\u001f\u007f]/.test(duration))
    throw httpError(400, '时长不能超过 40 个字符。')
  if (description.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description))
    throw httpError(400, '内容简述不能超过 1000 个字符。')
  if (strokes !== null && (!Number.isInteger(strokes) || strokes < 0 || strokes > 2147483647))
    throw httpError(400, '笔数请输入有效的非负整数。')
  const { rows } = await pool.query(
    `UPDATE paintings SET duration_text = $2, stroke_count = $3, description = $4
     WHERE id = $1 RETURNING id, title, created_at, duration_text, stroke_count, description,
       '/api/public/paintings/' || id::text || '/image' AS image_url,
       '/api/public/paintings/' || id::text || '/thumbnail' AS thumbnail_url`,
    [id, duration || null, strokes, description || null],
  )
  if (!rows.length) throw httpError(404, '作品不存在。')
  sendJson(response, 200, rows[0])
}

async function uploadThumbnail(request, response, user, id) {
  if (!user.is_author) throw httpError(403, '只有站长可以上传绘画作品。')
  if (!uuidPattern.test(id)) throw httpError(404, '作品不存在。')
  const { rows } = await pool.query('SELECT id FROM paintings WHERE id = $1 LIMIT 1', [id])
  if (!rows.length) throw httpError(404, '作品不存在。')
  const contentType = String(request.headers['content-type'] || '').toLowerCase().split(';')[0]
  const extension = { 'image/webp': 'webp', 'image/jpeg': 'jpg' }[contentType]
  if (!extension) throw httpError(415, '仅支持 WebP 或 JPEG 缩略图。')
  const bytes = await readImage(request, 2 * 1024 * 1024)
  if (!validImage(bytes, contentType)) throw httpError(415, '图片内容与文件类型不一致。')
  const file = resolve(root, `${id}.thumb.${extension}`)
  await mkdir(root, { recursive: true })
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 })
  sendJson(response, 201, { ok: true })
}

export async function handlePaintingRoute(request, response, url) {
  const { pathname } = url
  const method = request.method || 'GET'
  const imageMatch = pathname.match(/^\/api\/public\/paintings\/([^/]+)\/(image|thumbnail)$/)
  const thumbnailUpload = pathname.match(/^\/api\/paintings\/([^/]+)\/thumbnail$/)
  const detailsUpdate = pathname.match(/^\/api\/paintings\/([^/]+)$/)
  const recognized =
    (method === 'GET' && pathname === '/api/public/paintings') ||
    (method === 'GET' && !!imageMatch) ||
    (method === 'POST' && (pathname === '/api/paintings' || !!thumbnailUpload)) ||
    (method === 'PUT' && !!detailsUpdate)
  if (!recognized) return false

  try {
    if (method === 'GET' && pathname === '/api/public/paintings') {
      await listPaintings(response)
      return true
    }
    if (method === 'GET' && imageMatch) {
      await getPaintingImage(response, imageMatch[1], imageMatch[2] === 'thumbnail')
      return true
    }
    const user = await getAuthenticatedUser(request)
    if (!user) throw httpError(401, '请先登录。')
    if (detailsUpdate) await updatePaintingDetails(request, response, user, detailsUpdate[1])
    else if (thumbnailUpload) await uploadThumbnail(request, response, user, thumbnailUpload[1])
    else await uploadPainting(request, response, user)
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
