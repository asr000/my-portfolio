import { pool } from './db.js'
import { getAuthenticatedUser } from './auth.js'
import { discardImportedCover, saveImportedCover } from './covers.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function httpError(statusCode, message, code) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  return error
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 120 * 1024) throw httpError(413, '请求内容过大。')
    chunks.push(chunk)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw httpError(400, '请求内容不是有效 JSON。')
  }
}

async function readImportJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 8 * 1024 * 1024) throw httpError(413, '单条记录和封面不能超过 8 MB。')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw httpError(400, '导入内容不是有效 JSON。')
  }
}

async function accessFor(user) {
  const { rows } = await pool.query(
    `SELECT u.is_author,
       (u.email_verified_at IS NOT NULL) AS email_verified,
       (u.is_author OR (u.email_verified_at IS NOT NULL AND m.user_id IS NOT NULL)) AS can_write
     FROM users u LEFT JOIN note_members m ON m.user_id = u.id
     WHERE u.id = $1`,
    [user.id],
  )
  return rows[0] || { is_author: false, email_verified: false, can_write: false }
}

async function listRecords(url, user) {
  const { searchParams } = url
  const query = (searchParams.get('q') || '').trim()
  const tag = (searchParams.get('tag') || '').trim()
  const trashValue = searchParams.get('trash') || 'false'
  const beforeCreatedAt = searchParams.get('before_created_at') || null
  const beforeId = searchParams.get('before_id') || null
  const rawLimit = Number(searchParams.get('limit') || 13)
  if (query.length > 160 || tag.length > 24)
    throw httpError(400, '搜索词或标签长度超出限制。')
  if (!['true', 'false', 'all'].includes(trashValue))
    throw httpError(400, '回收站参数无效。')
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200)
    throw httpError(400, '每页数量须为 1 到 200。')
  if (
    Boolean(beforeCreatedAt) !== Boolean(beforeId) ||
    (beforeCreatedAt && !Number.isFinite(Date.parse(beforeCreatedAt))) ||
    (beforeId && !uuidPattern.test(beforeId))
  ) throw httpError(400, '分页游标无效。')

  const { rows } = await pool.query(
    `SELECT id, user_id, title, tags, content, cover_path, created_at, updated_at,
       deleted_at, version, is_public
     FROM records
     WHERE user_id = $1
       AND ($2 = 'all' OR (deleted_at IS NOT NULL) = ($2 = 'true'))
       AND ($3 = '' OR strpos(lower(title), lower($3)) > 0)
       AND ($4 = '' OR tags @> ARRAY[$4]::text[])
       AND ($5::timestamptz IS NULL OR (created_at, id) < ($5::timestamptz, $6::uuid))
     ORDER BY created_at DESC, id DESC
     LIMIT $7`,
    [user.id, trashValue, query, tag, beforeCreatedAt, beforeId, rawLimit],
  )
  return rows
}

function validateTags(tags) {
  if (!Array.isArray(tags) || tags.length > 12)
    throw httpError(400, '最多只能添加 12 个标签。')
  const normalized = tags.map((tag) => typeof tag === 'string' ? tag.trim() : '')
  if (normalized.some((tag) => !tag || tag.length > 24))
    throw httpError(400, '每个标签须为 1 到 24 个字符。')
  if (new Set(normalized).size !== normalized.length)
    throw httpError(400, '标签不能重复。')
  return normalized
}

function timestamp(value, label, nullable = false) {
  if (nullable && value == null) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw httpError(400, `${label}时间无效。`)
  return new Date(value).toISOString()
}

function validateImport(body) {
  const row = body?.record
  if (!row || typeof row !== 'object' || Array.isArray(row) || !uuidPattern.test(row.id || ''))
    throw httpError(400, '备份记录编号无效。')
  if (typeof row.title !== 'string' || !row.title.trim() || row.title.trim().length > 160)
    throw httpError(400, '备份中存在无效标题。')
  if (typeof row.content !== 'string' || row.content.length > 100000)
    throw httpError(400, '备份中的正文超过 100000 个字符。')
  if (row.is_public !== undefined && typeof row.is_public !== 'boolean')
    throw httpError(400, '备份中的公开状态无效。')
  const createdAt = timestamp(row.created_at, '创建')
  const updatedAt = timestamp(row.updated_at, '更新')
  const deletedAt = timestamp(row.deleted_at, '删除', true)
  const version = row.version === undefined ? 1 : row.version
  if (!Number.isInteger(version) || version < 1)
    throw httpError(400, '备份中的记录版本无效。')
  const isPublic = row.is_public ?? false
  if (deletedAt && isPublic)
    throw httpError(400, '回收站中的记录不能标记为公开。')

  let coverBytes = null
  let coverContentType = null
  const encoded = body.cover?.base64
  if (encoded !== undefined) {
    const contentType = body.cover?.content_type
    const supportedContentTypes = ['image/webp', 'image/jpeg', 'image/png']
    if (
      !supportedContentTypes.includes(contentType) ||
      typeof encoded !== 'string' ||
      encoded.length > Math.ceil((5 * 1024 * 1024 * 4) / 3) + 8 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    ) throw httpError(400, '备份封面格式无效。')
    coverBytes = Buffer.from(encoded, 'base64')
    const isWebp =
      coverBytes.length >= 12 &&
      coverBytes.toString('ascii', 0, 4) === 'RIFF' &&
      coverBytes.toString('ascii', 8, 12) === 'WEBP'
    const isJpeg =
      coverBytes.length >= 3 &&
      coverBytes[0] === 0xff &&
      coverBytes[1] === 0xd8 &&
      coverBytes[2] === 0xff
    const isPng =
      coverBytes.length >= 8 &&
      coverBytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const signatureMatches =
      (contentType === 'image/webp' && isWebp) ||
      (contentType === 'image/jpeg' && isJpeg) ||
      (contentType === 'image/png' && isPng)
    if (
      coverBytes.length > 5 * 1024 * 1024 ||
      coverBytes.toString('base64') !== encoded ||
      !signatureMatches
    ) throw httpError(400, '备份封面格式与文件内容不一致。')
    coverContentType = contentType
  }

  return {
    id: row.id,
    title: row.title.trim(),
    tags: validateTags(row.tags),
    content: row.content,
    createdAt,
    updatedAt,
    deletedAt,
    version,
    isPublic,
    coverBytes,
    coverContentType,
  }
}

async function importRecord(user, body) {
  const access = await accessFor(user)
  if (!access.can_write) throw httpError(403, '请先开通笔记记录功能，再导入备份。')
  const record = validateImport(body)
  const client = await pool.connect()
  let savedCover = null
  try {
    await client.query('BEGIN')
    const existing = await client.query(
      'SELECT user_id FROM records WHERE id = $1 FOR UPDATE',
      [record.id],
    )
    if (existing.rows[0]) {
      if (existing.rows[0].user_id !== user.id)
        throw httpError(409, '备份中的记录编号已被另一个账号使用。')
      await client.query('COMMIT')
      return { imported: false, already_exists: true }
    }
    if (record.coverBytes)
      savedCover = await saveImportedCover(
        user.id,
        record.coverBytes,
        record.coverContentType,
      )
    const { rows } = await client.query(
      `INSERT INTO records (
         id, user_id, title, tags, content, cover_path, created_at, updated_at,
         deleted_at, version, is_public
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        record.id,
        user.id,
        record.title,
        record.tags,
        record.content,
        savedCover?.path || null,
        record.createdAt,
        record.updatedAt,
        record.deletedAt,
        record.version,
        record.isPublic,
      ],
    )
    await client.query('COMMIT')
    return { imported: true, id: rows[0].id }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (savedCover) await discardImportedCover(savedCover.file).catch(() => {})
    if (error.code === '23505')
      throw httpError(409, '记录编号冲突，请重新检查备份后重试。')
    throw error
  } finally {
    client.release()
  }
}

function validateMutation(body, user) {
  const action = body.action
  const recordId = body.recordId
  const requestId = body.requestId
  if (!['create', 'update', 'trash', 'restore', 'purge', 'publish', 'unpublish'].includes(action))
    throw httpError(400, '不支持的笔记操作。')
  if (!uuidPattern.test(recordId || '') || !uuidPattern.test(requestId || ''))
    throw httpError(400, '记录编号或操作编号无效。')
  if (action !== 'create' && (!Number.isInteger(body.version) || body.version < 1))
    throw httpError(400, '记录版本无效。')

  let title = null
  let tags = null
  let content = null
  let coverPath = null
  if (action === 'create' || action === 'update') {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 160)
      throw httpError(400, '标题须为 1 到 160 个字符。')
    if (typeof body.content !== 'string' || body.content.length > 100000)
      throw httpError(400, '正文不能超过 100000 个字符。')
    title = body.title.trim()
    tags = validateTags(body.tags)
    content = body.content
    coverPath = body.coverPath ?? null
    if (coverPath !== null) {
      const pathPattern = new RegExp(
        `^${user.id}/[0-9a-f-]{36}\\.(?:webp|jpe?g|png)$`,
        'i',
      )
      if (typeof coverPath !== 'string' || !pathPattern.test(coverPath))
        throw httpError(400, '封面路径无效。')
    }
  }
  return { action, recordId, requestId, version: body.version ?? null, title, tags, content, coverPath }
}

function mutationPayload(mutation) {
  if (mutation.action === 'publish' || mutation.action === 'unpublish')
    return { action: mutation.action, id: mutation.recordId, version: mutation.version }
  return {
    action: mutation.action,
    id: mutation.recordId,
    version: mutation.version,
    title: mutation.title,
    tags: mutation.tags,
    content: mutation.content,
    cover_path: mutation.coverPath,
  }
}

async function mutateRecord(user, body) {
  const access = await accessFor(user)
  if (!access.can_write) throw httpError(403, '请先验证邮箱并兑换邀请码，开通笔记记录功能。')
  const mutation = validateMutation(body, user)
  const payload = mutationPayload(mutation)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`,
      [user.id, mutation.requestId],
    )
    const prior = await client.query(
      `SELECT payload, result FROM record_mutations
       WHERE user_id = $1 AND request_id = $2`,
      [user.id, mutation.requestId],
    )
    if (prior.rows[0]) {
      const same = await client.query(
        'SELECT $1::jsonb = $2::jsonb AS matches',
        [JSON.stringify(prior.rows[0].payload), JSON.stringify(payload)],
      )
      if (!same.rows[0].matches)
        throw httpError(409, '操作编号已用于另一份内容，请重新载入。')
      await client.query('COMMIT')
      return prior.rows[0].result
    }

    let record
    let oldCoverPath = null
    if (mutation.action === 'create') {
      const { rows } = await client.query(
        `INSERT INTO records (id, user_id, title, tags, content, cover_path)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [mutation.recordId, user.id, mutation.title, mutation.tags, mutation.content, mutation.coverPath],
      )
      record = rows[0]
    } else {
      const selected = await client.query(
        'SELECT * FROM records WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [mutation.recordId, user.id],
      )
      record = selected.rows[0]
      if (!record) throw httpError(404, '记录不存在或没有访问权限。')
      if (record.version !== mutation.version)
        throw httpError(409, '记录已在其他页面或设备修改，请重新载入。', '40001')
      if (['update', 'trash', 'publish', 'unpublish'].includes(mutation.action) && record.deleted_at)
        throw httpError(409, '回收站中的记录不能执行此操作。')
      if (['restore', 'purge'].includes(mutation.action) && !record.deleted_at)
        throw httpError(409, '请先将记录移入回收站。')

      if (mutation.action === 'update') {
        oldCoverPath = record.cover_path
        const { rows } = await client.query(
          `UPDATE records SET title = $1, tags = $2, content = $3, cover_path = $4,
             version = version + 1, updated_at = now()
           WHERE id = $5 RETURNING *`,
          [mutation.title, mutation.tags, mutation.content, mutation.coverPath, mutation.recordId],
        )
        record = rows[0]
      } else if (mutation.action === 'trash') {
        const { rows } = await client.query(
          `UPDATE records SET deleted_at = now(), is_public = false,
             version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [mutation.recordId],
        )
        record = rows[0]
      } else if (mutation.action === 'restore') {
        const { rows } = await client.query(
          `UPDATE records SET deleted_at = NULL, is_public = false,
             version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [mutation.recordId],
        )
        record = rows[0]
      } else if (mutation.action === 'purge') {
        oldCoverPath = record.cover_path
        await client.query('DELETE FROM records WHERE id = $1', [mutation.recordId])
        record = null
      } else if (mutation.action === 'publish' || mutation.action === 'unpublish') {
        const isPublic = mutation.action === 'publish'
        const { rows } = await client.query(
          `UPDATE records SET is_public = $1, version = version + 1, updated_at = now()
           WHERE id = $2 RETURNING *`,
          [isPublic, mutation.recordId],
        )
        record = rows[0]
        if (isPublic) {
          await client.query(
            `INSERT INTO note_first_publications (record_id, user_id, published_at, published_day)
             VALUES ($1, $2, now(), (now() AT TIME ZONE 'Asia/Taipei')::date)
             ON CONFLICT (record_id) DO NOTHING`,
            [record.id, user.id],
          )
        }
      }
    }

    const result = { record, old_cover_path: oldCoverPath }
    await client.query(
      `INSERT INTO record_mutations (user_id, request_id, payload, result)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
      [user.id, mutation.requestId, JSON.stringify(payload), JSON.stringify(result)],
    )
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error.code === '23505')
      throw httpError(409, '记录编号已存在，请重新载入后重试。')
    throw error
  } finally {
    client.release()
  }
}

export async function handlePrivateRecordRoute(request, response, url) {
  const { pathname, searchParams } = url
  const method = request.method || 'GET'
  const recordMatch = pathname.match(/^\/api\/records\/([^/]+)$/)
  const recognized =
    (method === 'GET' && ['/api/note-access', '/api/record-tags', '/api/records'].includes(pathname)) ||
    (method === 'GET' && !!recordMatch) ||
    (method === 'POST' && pathname === '/api/records/mutate') ||
    (method === 'POST' && pathname === '/api/records/import') ||
    (method === 'GET' && pathname === '/api/note-profile') ||
    (method === 'PUT' && pathname === '/api/note-profile')
  if (!recognized) return false

  try {
    const user = await getAuthenticatedUser(request)
    if (!user) throw httpError(401, '请先登录。')

    if (pathname === '/api/note-access' && method === 'GET') {
      sendJson(response, 200, await accessFor(user))
      return true
    }
    if (pathname === '/api/record-tags' && method === 'GET') {
      const trash = searchParams.get('trash') === 'true'
      const { rows } = await pool.query(
        `SELECT DISTINCT unnest(tags) AS tag FROM records
         WHERE user_id = $1 AND (deleted_at IS NOT NULL) = $2 ORDER BY tag`,
        [user.id, trash],
      )
      sendJson(response, 200, rows)
      return true
    }
    if (pathname === '/api/records' && method === 'GET') {
      sendJson(response, 200, await listRecords(url, user))
      return true
    }
    if (recordMatch && method === 'GET') {
      const id = recordMatch[1]
      if (!uuidPattern.test(id)) throw httpError(400, '记录编号无效。')
      const { rows } = await pool.query(
        'SELECT * FROM records WHERE id = $1 AND user_id = $2 LIMIT 1',
        [id, user.id],
      )
      sendJson(response, 200, rows[0] || null)
      return true
    }
    if (pathname === '/api/records/mutate' && method === 'POST') {
      const result = await mutateRecord(user, await readJson(request))
      sendJson(response, 200, result)
      return true
    }
    if (pathname === '/api/records/import' && method === 'POST') {
      const result = await importRecord(user, await readImportJson(request))
      sendJson(response, 200, result)
      return true
    }
    if (pathname === '/api/note-profile' && method === 'GET') {
      const access = await accessFor(user)
      if (!access.can_write) throw httpError(403, '请先兑换邀请码，开通笔记记录功能。')
      const { rows } = await pool.query(
        `SELECT COALESCE(p.display_name,
           CASE WHEN u.is_author THEN '网站作者'
             ELSE '笔记作者-' || left(md5(u.id::text), 10) END) AS display_name
         FROM users u LEFT JOIN note_profiles p ON p.user_id = u.id
         WHERE u.id = $1`,
        [user.id],
      )
      sendJson(response, 200, {
        display_name: rows[0]?.display_name || (access.is_author ? '网站作者' : '笔记作者'),
        author_role: access.is_author ? 'owner' : 'member',
      })
      return true
    }
    if (pathname === '/api/note-profile' && method === 'PUT') {
      const access = await accessFor(user)
      if (!access.can_write) throw httpError(403, '请先兑换邀请码，开通笔记记录功能。')
      const body = await readJson(request)
      const name = typeof body.display_name === 'string' ? body.display_name.trim() : ''
      if (!name || name.length > 30 || /[\u0000-\u001f\u007f]/.test(name))
        throw httpError(400, '昵称需要 1 到 30 个字符，不能包含控制字符。')
      await pool.query(
        `INSERT INTO note_profiles (user_id, display_name) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [user.id, name],
      )
      sendJson(response, 200, {
        display_name: name,
        author_role: access.is_author ? 'owner' : 'member',
      })
      return true
    }
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 503
    if (status >= 500)
      console.error('Private records request failed:', error.code || error.message)
    sendJson(response, status, {
      error: status >= 500 ? '记录服务暂时不可用，请稍后重试。' : error.message,
      ...(error.code === '40001' ? { code: '40001' } : {}),
    })
    return true
  }
  return false
}
