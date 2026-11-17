import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'
import { getAuthenticatedUser } from './auth.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const extensionByType = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}
const typeByExtension = Object.fromEntries(
  Object.entries(extensionByType).map(([type, extension]) => [extension, type]),
)
const imageFields = {
  wallpaper: {
    path: 'wallpaper_path',
    type: 'wallpaper_content_type',
    url: 'wallpaper_url',
    maxBytes: 8 * 1024 * 1024,
  },
  'mobile-wallpaper': {
    path: 'mobile_wallpaper_path',
    type: 'mobile_wallpaper_content_type',
    url: 'mobile_wallpaper_url',
    maxBytes: 8 * 1024 * 1024,
  },
  avatar: {
    path: 'avatar_path',
    type: 'avatar_content_type',
    url: 'avatar_url',
    maxBytes: 2 * 1024 * 1024,
  },
}
const appearanceColumns = `wallpaper_path, wallpaper_content_type,
  mobile_wallpaper_path, mobile_wallpaper_content_type,
  avatar_path, avatar_content_type, opacity, clarity, theme_color, updated_at`
const root = resolve(
  process.env.APPEARANCE_DIR || fileURLToPath(new URL('../data/appearance', import.meta.url)),
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

async function readImage(request, kind) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > imageFields[kind].maxBytes) {
      const description = kind === 'avatar' ? '头像' : '壁纸'
      const limit = kind === 'avatar' ? '2 MB' : '8 MB'
      throw httpError(413, `${description}图片不能超过 ${limit}。`)
    }
    chunks.push(chunk)
  }
  if (!size) throw httpError(400, '图片文件为空。')
  return Buffer.concat(chunks)
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

function imageUrl(row, kind, isPublic = false) {
  const field = imageFields[kind]
  const path = row?.[field.path]
  if (!path) return null
  const version = row.updated_at instanceof Date
    ? row.updated_at.getTime()
    : Date.parse(row.updated_at || '') || 0
  const prefix = isPublic ? '/api/public/appearance/image' : '/api/appearance/image'
  return `${prefix}/${kind}?v=${version}`
}

function serialize(row, isPublic = false) {
  return {
    wallpaper_url: imageUrl(row, 'wallpaper', isPublic),
    mobile_wallpaper_url: imageUrl(row, 'mobile-wallpaper', isPublic),
    avatar_url: imageUrl(row, 'avatar', isPublic),
    opacity: row?.opacity == null ? (isPublic ? 0.28 : 0.30) : Number(row.opacity),
    clarity: row?.clarity == null ? (isPublic ? 88 : 92) : Number(row.clarity),
    theme_color: row?.theme_color || null,
  }
}

async function appearanceForUser(userId) {
  const { rows } = await pool.query(
    `SELECT ${appearanceColumns}
       FROM user_appearances WHERE user_id = $1 LIMIT 1`,
    [userId],
  )
  return rows[0] || null
}

async function appearanceForAuthor() {
  const { rows } = await pool.query(
    `SELECT a.wallpaper_path, a.wallpaper_content_type,
            a.mobile_wallpaper_path, a.mobile_wallpaper_content_type,
            a.avatar_path, a.avatar_content_type, a.opacity, a.clarity,
            a.theme_color, a.updated_at
       FROM users u LEFT JOIN user_appearances a ON a.user_id = u.id
      WHERE u.is_author ORDER BY u.created_at, u.id LIMIT 1`,
  )
  return rows[0] || null
}

function safeFile(path) {
  if (typeof path !== 'string' || !/^[0-9a-f-]{36}\.(webp|jpg|png)$/i.test(path))
    throw httpError(404, '图片不存在。')
  const file = resolve(root, path)
  if (dirname(file) !== root) throw httpError(404, '图片不存在。')
  return file
}

async function serveImage(response, row, kind, isPublic) {
  const field = imageFields[kind]
  const imagePath = row?.[field.path]
  const contentType = row?.[field.type]
  if (!imagePath || !contentType || typeByExtension[imagePath.split('.').at(-1)] !== contentType)
    throw httpError(404, '图片不存在。')
  const file = safeFile(imagePath)
  const bytes = await readFile(file).catch((error) => {
    if (error.code === 'ENOENT') throw httpError(404, '图片不存在。')
    throw error
  })
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': String(bytes.length),
    'Cache-Control': isPublic ? 'public, max-age=300' : 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(bytes)
}

async function removeStoredImage(path) {
  if (!path) return
  try {
    await unlink(safeFile(path)).catch(() => {})
  } catch {
    // A stale or invalid old path must not prevent the replacement from saving.
  }
}

async function uploadImage(request, response, user, kind) {
  const contentType = String(request.headers['content-type'] || '')
    .toLowerCase()
    .split(';')[0]
  const extension = extensionByType[contentType]
  if (!extension) throw httpError(415, '仅支持 WebP、JPEG 或 PNG 图片。')
  const bytes = await readImage(request, kind)
  if (!validImage(bytes, contentType)) throw httpError(415, '图片内容与文件类型不一致。')

  const imagePath = `${randomUUID()}.${extension}`
  const file = safeFile(imagePath)
  await mkdir(root, { recursive: true })
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 })

  const field = imageFields[kind]
  const pathColumn = field.path
  const typeColumn = field.type
  try {
    const previous = await appearanceForUser(user.id)
    const oldPath = previous?.[pathColumn]
    const { rows } = await pool.query(
      `INSERT INTO user_appearances (user_id, ${pathColumn}, ${typeColumn})
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET ${pathColumn} = EXCLUDED.${pathColumn},
             ${typeColumn} = EXCLUDED.${typeColumn}, updated_at = now()
       RETURNING ${appearanceColumns}`,
      [user.id, imagePath, contentType],
    )
    if (oldPath && oldPath !== imagePath)
      await removeStoredImage(oldPath)
    const settings = serialize(rows[0])
    sendJson(response, 201, { ...settings, uploaded: kind })
  } catch (error) {
    await unlink(file).catch(() => {})
    throw error
  }
}

async function updateSettings(request, response, user) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 8 * 1024) throw httpError(413, '主题设置请求过大。')
    chunks.push(chunk)
  }
  let body = {}
  try {
    body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  } catch {
    throw httpError(400, '主题设置格式无效。')
  }
  const opacity = Number(body.opacity)
  const clarity = Number(body.clarity)
  const themeColor = body.theme_color == null || body.theme_color === ''
    ? null
    : String(body.theme_color)
  if (!Number.isFinite(opacity) || opacity < 0.1 || opacity > 1)
    throw httpError(400, '背景透明度设置无效。')
  if (!Number.isInteger(clarity) || clarity < 0 || clarity > 100)
    throw httpError(400, '背景清晰度设置无效。')
  if (themeColor !== null && !/^#[0-9a-f]{6}$/i.test(themeColor))
    throw httpError(400, '主题色格式无效。')

  const { rows } = await pool.query(
    `INSERT INTO user_appearances (user_id, opacity, clarity, theme_color)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET opacity = EXCLUDED.opacity, clarity = EXCLUDED.clarity,
           theme_color = EXCLUDED.theme_color, updated_at = now()
     RETURNING ${appearanceColumns}`,
    [user.id, opacity, clarity, themeColor],
  )
  sendJson(response, 200, serialize(rows[0]))
}

async function removeImage(response, user, kind) {
  const field = imageFields[kind]
  const pathColumn = field.path
  const typeColumn = field.type
  const previous = await appearanceForUser(user.id)
  const oldPath = previous?.[pathColumn]
  await pool.query(
    `INSERT INTO user_appearances (user_id, ${pathColumn}, ${typeColumn})
     VALUES ($1, NULL, NULL)
     ON CONFLICT (user_id) DO UPDATE
       SET ${pathColumn} = NULL, ${typeColumn} = NULL, updated_at = now()`,
    [user.id],
  )
  await removeStoredImage(oldPath)
  sendJson(response, 200, { ok: true })
}

export async function handleAppearanceRoute(request, response, url) {
  const { pathname } = url
  const method = request.method || 'GET'
  const imageKinds = '(wallpaper|mobile-wallpaper|avatar)'
  const privateImage = pathname.match(new RegExp(`^/api/appearance/image/${imageKinds}$`))
  const publicImage = pathname.match(new RegExp(`^/api/public/appearance/image/${imageKinds}$`))
  const recognized =
    (method === 'GET' && pathname === '/api/appearance') ||
    (method === 'GET' && pathname === '/api/public/appearance') ||
    (method === 'PUT' && pathname === '/api/appearance') ||
    (method === 'POST' && new RegExp(`^/api/appearance/image/${imageKinds}$`).test(pathname)) ||
    (method === 'DELETE' && new RegExp(`^/api/appearance/image/${imageKinds}$`).test(pathname)) ||
    (method === 'GET' && !!privateImage) ||
    (method === 'GET' && !!publicImage)
  if (!recognized) return false

  try {
    if (method === 'GET' && pathname === '/api/public/appearance') {
      sendJson(response, 200, serialize(await appearanceForAuthor(), true))
      return true
    }
    if (publicImage) {
      await serveImage(response, await appearanceForAuthor(), publicImage[1], true)
      return true
    }
    const user = await getAuthenticatedUser(request)
    if (!user) throw httpError(401, '请先登录。')
    if (method === 'GET' && pathname === '/api/appearance') {
      sendJson(response, 200, serialize(await appearanceForUser(user.id)))
      return true
    }
    if (method === 'GET' && privateImage) {
      await serveImage(response, await appearanceForUser(user.id), privateImage[1], false)
      return true
    }
    const imageMatch = pathname.match(new RegExp(`^/api/appearance/image/${imageKinds}$`))
    if (method === 'POST' && imageMatch) {
      await uploadImage(request, response, user, imageMatch[1])
      return true
    }
    if (method === 'DELETE' && imageMatch) {
      await removeImage(response, user, imageMatch[1])
      return true
    }
    if (method === 'PUT') {
      await updateSettings(request, response, user)
      return true
    }
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 503
    if (status >= 500)
      console.error('Appearance request failed:', error.code || error.message)
    sendJson(response, status, {
      error: status >= 500 ? '主题设置服务暂时不可用，请稍后重试。' : error.message,
    })
    return true
  }
  return false
}
