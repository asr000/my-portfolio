import { randomInt } from 'node:crypto'
import { pool } from './db.js'
import { getAuthenticatedUser } from './auth.js'

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

async function progress(user) {
  const { rows: authors } = await pool.query(
    'SELECT id FROM users WHERE is_author ORDER BY created_at, id LIMIT 1',
  )
  const subjectId = user?.id || authors[0]?.id
  if (!subjectId) {
    const { rows } = await pool.query(
      "SELECT (now() AT TIME ZONE 'Asia/Taipei')::date::text AS day",
    )
    return {
      scope: user ? 'self' : 'owner',
      day: rows[0].day,
      publish_days: 0,
      published_today: false,
      checkin_days: 0,
      fortune_index: null,
      can_check_in: !!user?.email_verified_at,
    }
  }

  const { rows } = await pool.query(
    `WITH today AS (
       SELECT (now() AT TIME ZONE 'Asia/Taipei')::date AS day
     )
     SELECT today.day::text,
       (SELECT count(DISTINCT published_day)::int FROM note_first_publications
        WHERE user_id = $1) AS publish_days,
       EXISTS(SELECT 1 FROM note_first_publications
        WHERE user_id = $1 AND published_day = today.day) AS published_today,
       CASE WHEN $2::uuid IS NULL THEN 0 ELSE
         (SELECT count(*)::int FROM note_daily_checkins WHERE user_id = $2)
       END AS checkin_days,
       CASE WHEN $2::uuid IS NULL THEN NULL ELSE
         (SELECT fortune_index FROM note_daily_checkins WHERE user_id = $2 AND day = today.day)
       END AS fortune_index
     FROM today`,
    [subjectId, user?.id || null],
  )
  return {
    scope: user ? 'self' : 'owner',
    ...rows[0],
    can_check_in: !!user?.email_verified_at,
  }
}

async function draw(user) {
  if (!user) throw httpError(401, '请先登录。')
  if (!user.email_verified_at) throw httpError(403, '请先验证邮箱，再来抽取今日签。')
  const today = await pool.query(
    "SELECT (now() AT TIME ZONE 'Asia/Taipei')::date AS day",
  )
  await pool.query(
    `INSERT INTO note_daily_checkins (user_id, day, fortune_index)
     VALUES ($1, $2, $3) ON CONFLICT (user_id, day) DO NOTHING`,
    [user.id, today.rows[0].day, randomInt(0, 12)],
  )
  return progress(user)
}

export async function handleDailyRoute(request, response, url) {
  const { pathname } = url
  const method = request.method || 'GET'
  if (!(
    (method === 'GET' && pathname === '/api/progress') ||
    (method === 'POST' && pathname === '/api/fortune')
  )) return false
  try {
    const user = await getAuthenticatedUser(request)
    const result = method === 'POST' ? await draw(user) : await progress(user)
    sendJson(response, 200, result)
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 503
    if (status >= 500) console.error('Daily route failed:', error.code || error.message)
    sendJson(response, status, {
      error: status >= 500 ? '签到信息暂时无法读取，请稍后重试。' : error.message,
    })
  }
  return true
}
