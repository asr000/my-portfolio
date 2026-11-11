import { createHash } from 'node:crypto'
import { pool } from './db.js'
import { getAuthenticatedUser } from './auth.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
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

function normalizeCode(value) {
  return typeof value === 'string'
    ? value.toUpperCase().replace(/[\s-]/g, '')
    : ''
}

function codeHash(code) {
  return createHash('sha256').update(code).digest('hex')
}

async function requireAuthor(user, client = pool) {
  const { rows } = await client.query(
    'SELECT is_author FROM users WHERE id = $1',
    [user.id],
  )
  if (!rows[0]?.is_author) throw httpError(403, '邀请管理仅对网站作者开放。')
}

async function listInvitations(url, user, response) {
  await requireAuthor(user)
  const beforeCreatedAt = url.searchParams.get('before_created_at') || null
  const beforeId = url.searchParams.get('before_id') || null
  if (
    Boolean(beforeCreatedAt) !== Boolean(beforeId) ||
    (beforeCreatedAt && !Number.isFinite(Date.parse(beforeCreatedAt))) ||
    (beforeId && !uuidPattern.test(beforeId))
  ) throw httpError(400, '分页游标无效。')
  const { rows } = await pool.query(
    `SELECT id, created_at, expires_at, revoked_at, redeemed_at
     FROM note_invitations
     WHERE created_by = $1
       AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
     ORDER BY created_at DESC, id DESC LIMIT 21`,
    [user.id, beforeCreatedAt, beforeId],
  )
  sendJson(response, 200, rows)
}

async function issueInvitation(user, body) {
  await requireAuthor(user)
  const id = body.id
  const code = normalizeCode(body.code)
  const days = Number(body.days)
  if (!uuidPattern.test(id || '') || !/^[0-9A-F]{32}$/.test(code) || ![7, 30].includes(days))
    throw httpError(400, '邀请码参数无效。')
  const hashed = codeHash(code)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('note-invite:' || $1, 0))`,
      [id],
    )
    const existing = await client.query(
      'SELECT * FROM note_invitations WHERE id = $1 FOR UPDATE',
      [id],
    )
    let invitation
    if (existing.rows[0]) {
      invitation = existing.rows[0]
      if (
        invitation.created_by !== user.id ||
        invitation.code_hash !== hashed ||
        invitation.valid_days !== days
      ) throw httpError(409, '操作编号已用于另一份邀请，请重新生成。')
    } else {
      const { rows } = await client.query(
        `INSERT INTO note_invitations (id, code_hash, created_by, expires_at, valid_days)
         VALUES ($1, $2, $3, now() + ($4 * interval '1 day'), $4)
         RETURNING id, created_at, expires_at, revoked_at, redeemed_at`,
        [id, hashed, user.id, days],
      )
      invitation = rows[0]
    }
    await client.query('COMMIT')
    return invitation
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error.code === '23505') throw httpError(409, '该邀请码已存在，请重新生成。')
    throw error
  } finally {
    client.release()
  }
}

async function revokeInvitation(user, id) {
  await requireAuthor(user)
  if (!uuidPattern.test(id || '')) throw httpError(400, '邀请编号无效。')
  const { rows } = await pool.query(
    `UPDATE note_invitations
     SET revoked_at = COALESCE(revoked_at, now())
     WHERE id = $1 AND created_by = $2 AND redeemed_at IS NULL
     RETURNING id`,
    [id, user.id],
  )
  if (!rows.length) {
    const exists = await pool.query('SELECT redeemed_at FROM note_invitations WHERE id = $1', [id])
    if (!exists.rows[0]) throw httpError(404, '邀请不存在。')
    if (exists.rows[0].redeemed_at) throw httpError(409, '邀请码已兑换，不能撤销。')
    throw httpError(403, '没有权限撤销这条邀请。')
  }
}

async function redeemInvitation(user, submittedCode) {
  const code = normalizeCode(submittedCode)
  const normalizedCode = /^[0-9A-F]{32}$/.test(code) ? code : ''
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: users } = await client.query(
      'SELECT email_verified_at FROM users WHERE id = $1 FOR UPDATE',
      [user.id],
    )
    if (!users[0]?.email_verified_at)
      throw httpError(403, '请先验证邮箱，再兑换邀请码。')

    const { rows: members } = await client.query(
      `SELECT 1 FROM users u LEFT JOIN note_members m ON m.user_id = u.id
       WHERE u.id = $1 AND (u.is_author OR m.user_id IS NOT NULL)`,
      [user.id],
    )
    if (members[0]) {
      await client.query('COMMIT')
      return { ok: true, already_active: true }
    }

    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('note-member:' || $1, 0))`,
      [user.id],
    )
    await client.query(
      `INSERT INTO note_invitation_attempts (user_id)
       VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [user.id],
    )
    let attempts = await client.query(
      'SELECT * FROM note_invitation_attempts WHERE user_id = $1 FOR UPDATE',
      [user.id],
    )
    let state = attempts.rows[0]
    if (Date.now() - new Date(state.window_started_at).getTime() >= 15 * 60 * 1000) {
      attempts = await client.query(
        `UPDATE note_invitation_attempts
         SET failures = 0, window_started_at = now()
         WHERE user_id = $1 RETURNING *`,
        [user.id],
      )
      state = attempts.rows[0]
    }
    if (state.failures >= 5) {
      await client.query('COMMIT')
      return { ok: false, message: '尝试次数较多，请在 15 分钟后重试。' }
    }

    let invitation = null
    if (normalizedCode) {
      const found = await client.query(
        `SELECT * FROM note_invitations
         WHERE code_hash = $1 FOR UPDATE`,
        [codeHash(normalizedCode)],
      )
      invitation = found.rows[0] || null
    }
    const valid = invitation && !invitation.revoked_at && !invitation.redeemed_at &&
      new Date(invitation.expires_at).getTime() > Date.now()
    if (!valid) {
      await client.query(
        'UPDATE note_invitation_attempts SET failures = failures + 1 WHERE user_id = $1',
        [user.id],
      )
      await client.query('COMMIT')
      return { ok: false, message: '邀请码无效、已使用或已过期，请向网站作者获取新邀请码。' }
    }

    await client.query(
      'INSERT INTO note_members (user_id, invitation_id) VALUES ($1, $2)',
      [user.id, invitation.id],
    )
    await client.query(
      'UPDATE note_invitations SET redeemed_by = $1, redeemed_at = now() WHERE id = $2',
      [user.id, invitation.id],
    )
    await client.query('DELETE FROM note_invitation_attempts WHERE user_id = $1', [user.id])
    await client.query('COMMIT')
    return { ok: true, already_active: false }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export async function handleInvitationRoute(request, response, url) {
  const { pathname } = url
  const method = request.method || 'GET'
  const revokeMatch = pathname.match(/^\/api\/invitations\/([^/]+)$/)
  const recognized =
    (method === 'GET' && pathname === '/api/invitations') ||
    (method === 'POST' && ['/api/invitations', '/api/invitations/redeem'].includes(pathname)) ||
    (method === 'DELETE' && !!revokeMatch)
  if (!recognized) return false

  try {
    const user = await getAuthenticatedUser(request)
    if (!user) throw httpError(401, '请先登录。')
    if (method === 'GET') {
      await listInvitations(url, user, response)
      return true
    }
    if (method === 'POST' && pathname === '/api/invitations') {
      const invitation = await issueInvitation(user, await readJson(request))
      sendJson(response, 200, invitation)
      return true
    }
    if (method === 'POST' && pathname === '/api/invitations/redeem') {
      const body = await readJson(request)
      const result = await redeemInvitation(user, body.code)
      sendJson(response, 200, result)
      return true
    }
    if (method === 'DELETE' && revokeMatch) {
      await revokeInvitation(user, revokeMatch[1])
      sendJson(response, 200, { ok: true })
      return true
    }
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 503
    if (status >= 500)
      console.error('Invitation request failed:', error.code || error.message)
    sendJson(response, status, {
      error: status >= 500 ? '邀请码服务暂时不可用，请稍后重试。' : error.message,
    })
    return true
  }
  return false
}
