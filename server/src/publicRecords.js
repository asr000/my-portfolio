import { pool } from './db.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sendJson(response, status, value) {
  response.writeHead(status)
  response.end(JSON.stringify(value))
}

const publisherCondition = `(
  u.is_author OR (
    u.email_verified_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM note_members m WHERE m.user_id = u.id
    )
  )
)`

export async function handlePublicGet(url, response) {
  const { pathname, searchParams } = url

  if (pathname === '/api/public/tags') {
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT unnest(r.tags) AS tag
         FROM records r
         JOIN users u ON u.id = r.user_id
         WHERE r.is_public AND r.deleted_at IS NULL
           AND ${publisherCondition}
         ORDER BY tag`,
      )
      sendJson(response, 200, rows.map((row) => row.tag))
    } catch (error) {
      console.error('Public tag query failed:', error.code || error.message)
      sendJson(response, 503, { error: '公开标签暂时无法读取。' })
    }
    return true
  }

  if (pathname === '/api/public/records') {
    const query = (searchParams.get('q') || '').trim()
    const tag = (searchParams.get('tag') || '').trim()
    const beforeCreatedAt = searchParams.get('before_created_at') || null
    const beforeId = searchParams.get('before_id') || null
    const rawLimit = Number(searchParams.get('limit') || 13)

    if (query.length > 160 || tag.length > 24) {
      sendJson(response, 400, { error: '搜索词或标签长度超出限制。' })
      return true
    }
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
      sendJson(response, 400, { error: '每页数量须为 1 到 50。' })
      return true
    }
    if (
      Boolean(beforeCreatedAt) !== Boolean(beforeId) ||
      (beforeCreatedAt && !Number.isFinite(Date.parse(beforeCreatedAt))) ||
      (beforeId && !uuidPattern.test(beforeId))
    ) {
      sendJson(response, 400, { error: '分页游标无效。' })
      return true
    }

    try {
      const { rows } = await pool.query(
        `SELECT r.id, r.title, r.tags, r.cover_path, r.created_at, r.updated_at,
           COALESCE(NULLIF(btrim(p.display_name), ''),
             CASE WHEN u.is_author THEN '网站作者'
               ELSE '笔记作者-' || left(md5(u.id::text), 10) END) AS author_name,
           CASE WHEN u.is_author THEN 'owner' ELSE 'member' END AS author_role
         FROM records r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN note_profiles p ON p.user_id = u.id
         WHERE r.is_public AND r.deleted_at IS NULL
           AND ${publisherCondition}
           AND ($1 = '' OR strpos(lower(r.title), lower($1)) > 0)
           AND ($2 = '' OR r.tags @> ARRAY[$2]::text[])
           AND ($3::timestamptz IS NULL OR (r.created_at, r.id) < ($3::timestamptz, $4::uuid))
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT $5`,
        [query, tag, beforeCreatedAt, beforeId, rawLimit],
      )
      sendJson(response, 200, rows)
    } catch (error) {
      console.error('Public records query failed:', error.code || error.message)
      sendJson(response, 503, { error: '公开记录暂时无法读取。' })
    }
    return true
  }

  const detailMatch = pathname.match(/^\/api\/public\/records\/([^/]+)$/)
  if (detailMatch) {
    const id = detailMatch[1]
    if (!uuidPattern.test(id)) {
      sendJson(response, 400, { error: '记录编号无效。' })
      return true
    }
    try {
      const { rows } = await pool.query(
        `SELECT r.id, r.title, r.tags, r.content, r.cover_path, r.created_at, r.updated_at,
           COALESCE(NULLIF(btrim(p.display_name), ''),
             CASE WHEN u.is_author THEN '网站作者'
               ELSE '笔记作者-' || left(md5(u.id::text), 10) END) AS author_name,
           CASE WHEN u.is_author THEN 'owner' ELSE 'member' END AS author_role
         FROM records r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN note_profiles p ON p.user_id = u.id
         WHERE r.id = $1 AND r.is_public AND r.deleted_at IS NULL
           AND ${publisherCondition}
         LIMIT 1`,
        [id],
      )
      if (!rows.length) {
        sendJson(response, 404, { error: '公开记录不存在。' })
        return true
      }
      sendJson(response, 200, rows[0])
    } catch (error) {
      console.error('Public record detail query failed:', error.code || error.message)
      sendJson(response, 503, { error: '公开记录暂时无法读取。' })
    }
    return true
  }

  return false
}
