import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import { pool } from './db.js'
import { sendAuthEmail } from './email.js'

const scrypt = promisify(scryptCallback)
const sessionCookie = 'portfolio_session'
const sessionDurationMs = 30 * 24 * 60 * 60 * 1000
const requestBuckets = new Map()

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  })
  response.end(JSON.stringify(value))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 16 * 1024) throw httpError(413, '请求内容过大。')
    chunks.push(chunk)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw httpError(400, '请求内容不是有效 JSON。')
  }
}

function limited(key, max, windowMs) {
  const now = Date.now()
  const current = requestBuckets.get(key)
  if (!current || now - current.start >= windowMs) {
    requestBuckets.set(key, { start: now, count: 1 })
    if (requestBuckets.size > 5000) {
      for (const [bucketKey, value] of requestBuckets)
        if (now - value.start >= windowMs) requestBuckets.delete(bucketKey)
    }
    return false
  }
  current.count += 1
  return current.count > max
}

function requestIp(request) {
  // Production reverse proxies must overwrite this header and keep the Node port private.
  const forwarded = String(request.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim()
  return forwarded || request.socket.remoteAddress || 'unknown'
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function validEmail(email) {
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function checkPassword(password) {
  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    Buffer.byteLength(password, 'utf8') > 1024
  )
    throw httpError(400, '密码至少 8 个字符，且不能超过 1024 字节。')
}

async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, 64, {
    N: 1 << 14,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  })
  return `scrypt$16384$${salt.toString('base64url')}$${key.toString('base64url')}`
}

async function verifyPassword(password, encoded) {
  const [scheme, cost, saltText, keyText] = String(encoded || '').split('$')
  if (scheme !== 'scrypt' || cost !== '16384' || !saltText || !keyText)
    return false
  try {
    const salt = Buffer.from(saltText, 'base64url')
    const expected = Buffer.from(keyText, 'base64url')
    if (salt.length !== 16 || expected.length !== 64) return false
    const actual = await scrypt(password, salt, expected.length, {
      N: 1 << 14,
      r: 8,
      p: 1,
      maxmem: 32 * 1024 * 1024,
    })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function authLink(view, token) {
  const base = process.env.APP_BASE_URL
  if (!base) throw httpError(503, '邮件链接网址尚未配置。')
  let url
  try {
    url = new URL('/', base)
  } catch {
    throw httpError(503, '邮件链接网址配置无效。')
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
    throw httpError(503, '邮件链接网址必须使用 HTTPS。')
  url.searchParams.set('view', view)
  url.hash = `token=${token}`
  return url.toString()
}

async function issueToken(client, userId, purpose, lifetimeMs) {
  const token = randomBytes(32).toString('hex')
  await client.query(
    `DELETE FROM auth_tokens
     WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose],
  )
  await client.query(
    `INSERT INTO auth_tokens (id, user_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 millisecond'))`,
    [randomUUID(), userId, hashToken(token), purpose, lifetimeMs],
  )
  return token
}

function cookieValue(request) {
  const raw = request.headers.cookie || ''
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === sessionCookie) return rest.join('=')
  }
  return ''
}

function cookieHeader(request, token, maxAge) {
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
  const secure = process.env.NODE_ENV === 'production' || forwardedProto === 'https'
  return `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

export async function getAuthenticatedUser(request) {
  const token = cookieValue(request)
  if (!/^[0-9a-f]{64}$/i.test(token)) return null
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.email_verified_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  )
  return rows[0] || null
}

async function createSession(request, response, userId) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + sessionDurationMs)
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), userId, expiresAt],
  )
  response.setHeader(
    'Set-Cookie',
    cookieHeader(request, token, Math.floor(sessionDurationMs / 1000)),
  )
}

async function createAuthTokenAndSend(userId, purpose, email) {
  const client = await pool.connect()
  let token
  try {
    await client.query('BEGIN')
    token = await issueToken(
      client,
      userId,
      purpose,
      purpose === 'verify_email' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000,
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }

  const isVerify = purpose === 'verify_email'
  await sendAuthEmail({
    to: email,
    subject: isVerify ? '验证 Re:代码生活账号' : '重置 Re:代码生活密码',
    heading: isVerify ? '验证邮箱' : '重置密码',
    message: isVerify
      ? '请打开下面的链接，完成邮箱验证。此链接 24 小时内有效。'
      : '请打开下面的链接，设置新密码。此链接 1 小时内有效。',
    link: authLink(isVerify ? 'auth-confirm' : 'reset-password', token),
    button: isVerify ? '验证邮箱' : '设置新密码',
  })
}

async function register(body) {
  const email = normalizeEmail(body.email)
  const password = body.password
  const authorEmail = normalizeEmail(process.env.AUTHOR_EMAIL)
  const isAuthor = !!authorEmail && email === authorEmail
  if (!validEmail(email)) throw httpError(400, '请输入有效邮箱地址。')
  checkPassword(password)
  const passwordHash = await hashPassword(password)
  const client = await pool.connect()
  let user = null
  try {
    await client.query('BEGIN')
    const existing = await client.query(
      `SELECT id, email_verified_at FROM users
       WHERE lower(btrim(email)) = $1 FOR UPDATE`,
      [email],
    )
    if (!existing.rows.length) {
      const id = randomUUID()
      const inserted = await client.query(
        `INSERT INTO users (id, email, password_hash, is_author)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, email_verified_at`,
        [id, email, passwordHash, isAuthor],
      )
      user = inserted.rows[0]
    } else if (isAuthor) {
      await client.query('UPDATE users SET is_author = true WHERE id = $1', [existing.rows[0].id])
    } else {
      user = existing.rows[0]
    }
    if (!user) user = existing.rows[0]
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error.code === '23505') return { accepted: true }
    throw error
  } finally {
    client.release()
  }
  if (user && !user.email_verified_at)
    await createAuthTokenAndSend(user.id, 'verify_email', email)
  return { accepted: true }
}

async function resendVerification(email) {
  const { rows } = await pool.query(
    `SELECT id FROM users
     WHERE lower(btrim(email)) = $1 AND email_verified_at IS NULL`,
    [email],
  )
  if (rows[0]) await createAuthTokenAndSend(rows[0].id, 'verify_email', email)
}

async function sendPasswordReset(email) {
  const { rows } = await pool.query(
    `SELECT id FROM users
     WHERE lower(btrim(email)) = $1 AND email_verified_at IS NOT NULL`,
    [email],
  )
  if (rows[0]) await createAuthTokenAndSend(rows[0].id, 'reset_password', email)
}

async function verifyEmail(token) {
  if (!/^[0-9a-f]{64}$/i.test(token)) throw httpError(400, '验证链接无效或已过期。')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT t.id, t.user_id FROM auth_tokens t
       WHERE t.token_hash = $1 AND t.purpose = 'verify_email'
         AND t.consumed_at IS NULL AND t.expires_at > now()
       FOR UPDATE`,
      [hashToken(token)],
    )
    if (!rows[0]) throw httpError(400, '验证链接无效或已过期。')
    await client.query(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1',
      [rows[0].user_id],
    )
    await client.query('UPDATE auth_tokens SET consumed_at = now() WHERE id = $1', [rows[0].id])
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function resetPassword(token, password) {
  if (!/^[0-9a-f]{64}$/i.test(token)) throw httpError(400, '重置链接无效或已过期。')
  checkPassword(password)
  const passwordHash = await hashPassword(password)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT t.id, t.user_id FROM auth_tokens t
       WHERE t.token_hash = $1 AND t.purpose = 'reset_password'
         AND t.consumed_at IS NULL AND t.expires_at > now()
       FOR UPDATE`,
      [hashToken(token)],
    )
    if (!rows[0]) throw httpError(400, '重置链接无效或已过期。')
    await client.query(
      'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
      [passwordHash, rows[0].user_id],
    )
    await client.query('UPDATE auth_tokens SET consumed_at = now() WHERE id = $1', [rows[0].id])
    await client.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].user_id])
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

function emailActionMessage(verify = false) {
  return verify
    ? '如果该邮箱有待验证的注册，验证邮件会发送到邮箱。请检查收件箱和垃圾邮件。'
    : '如果该邮箱已注册，重置密码的邮件会发送到邮箱。请检查收件箱和垃圾邮件。'
}

const postRoutes = new Set([
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
])

export async function handleAuthRoute(request, response, url) {
  const { pathname } = url
  const method = request.method || 'GET'
  const isMe = pathname === '/api/auth/me' && method === 'GET'
  if (!isMe && !(method === 'POST' && postRoutes.has(pathname))) return false

  try {
    if (isMe) {
      const user = await getAuthenticatedUser(request)
      sendJson(response, 200, {
        user: user
          ? {
              id: user.id,
              email: user.email,
              email_confirmed_at: user.email_verified_at,
            }
          : null,
      })
      return true
    }

    const body = pathname === '/api/auth/logout' ? {} : await readJson(request)
    const email = normalizeEmail(body.email)
    const ip = requestIp(request)

    if (pathname === '/api/auth/register') {
      if (limited(`register:${ip}`, 5, 60 * 60 * 1000))
        throw httpError(429, '注册请求过于频繁，请稍后重试。')
      await register(body)
      sendJson(response, 202, {
        message: '如果邮箱可以注册，验证邮件会发送到邮箱。',
      })
      return true
    }

    if (pathname === '/api/auth/login') {
      if (limited(`login:${ip}`, 12, 15 * 60 * 1000))
        throw httpError(429, '登录尝试过于频繁，请稍后重试。')
      if (!validEmail(email) || typeof body.password !== 'string')
        throw httpError(401, '邮箱或密码不正确。')
      const { rows } = await pool.query(
        `SELECT id, email, password_hash, email_verified_at
         FROM users WHERE lower(btrim(email)) = $1 LIMIT 1`,
        [email],
      )
      const user = rows[0]
      if (!user || !(await verifyPassword(body.password, user.password_hash)))
        throw httpError(401, '邮箱或密码不正确。')
      if (!user.email_verified_at)
        throw httpError(403, '请先验证邮箱，再登录。')
      await createSession(request, response, user.id)
      sendJson(response, 200, {
        user: {
          id: user.id,
          email: user.email,
          email_confirmed_at: user.email_verified_at,
        },
      })
      return true
    }

    if (pathname === '/api/auth/logout') {
      const token = cookieValue(request)
      if (/^[0-9a-f]{64}$/i.test(token))
        await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)])
      sendJson(
        response,
        200,
        { ok: true },
        { 'Set-Cookie': cookieHeader(request, '', 0) },
      )
      return true
    }

    if (pathname === '/api/auth/verify-email') {
      await verifyEmail(typeof body.token === 'string' ? body.token : '')
      sendJson(response, 200, { ok: true })
      return true
    }

    if (pathname === '/api/auth/resend-verification') {
      if (limited(`email-action:${ip}`, 5, 15 * 60 * 1000))
        throw httpError(429, '请求过于频繁，请稍后重试。')
      if (validEmail(email)) await resendVerification(email)
      sendJson(response, 200, { message: emailActionMessage(true) })
      return true
    }

    if (pathname === '/api/auth/forgot-password') {
      if (limited(`email-action:${ip}`, 5, 15 * 60 * 1000))
        throw httpError(429, '请求过于频繁，请稍后重试。')
      if (validEmail(email)) await sendPasswordReset(email)
      sendJson(response, 200, { message: emailActionMessage(false) })
      return true
    }

    if (pathname === '/api/auth/reset-password') {
      await resetPassword(
        typeof body.token === 'string' ? body.token : '',
        body.password,
      )
      sendJson(response, 200, { ok: true })
      return true
    }
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 503
    if (status >= 500)
      console.error('Auth request failed:', error.code || error.message)
    sendJson(response, status, {
      error: status >= 500 ? '认证服务暂时不可用，请稍后重试。' : error.message,
    })
    return true
  }
  return false
}
