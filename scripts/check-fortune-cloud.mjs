// Anonymous read-only checks. Never draw, sign in, publish, or change real data.
import process from 'node:process'
try { process.loadEnvFile('.env.local') } catch { /* deployment environment can supply configuration */ }
const base = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!base || !key) throw new Error('缺少 Supabase 配置。')
let failed = false
for (const [name, path, body, valid] of [
  ['花园接口已移除', 'rpc/public_learning_garden', {}, (r, d) => r.status === 404 && d.code === 'PGRST202'],
  ['访客发布天数', 'rpc/note_garden_progress', {}, (r, d) => r.ok && d.scope === 'owner' && Number.isInteger(d.publish_days) && d.fortune_index === null && d.can_check_in === false && !('user_id' in d)],
  ['签到表权限', 'note_daily_checkins?select=day&limit=1', null, (r, d) => [401, 403].includes(r.status) && d.code === '42501'],
  ['发布历史表权限', 'note_first_publications?select=published_day&limit=1', null, (r, d) => [401, 403].includes(r.status) && d.code === '42501'],
]) {
  try {
    const response = await fetch(`${base}/rest/v1/${path}`, {
      method: body ? 'POST' : 'GET', headers: { apikey: key, ...(body && { 'Content-Type': 'application/json' }) },
      ...(body && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
    })
    const data = await response.json()
    const ok = valid(response, data)
    console.log(name, ok ? '符合预期' : '需检查', JSON.stringify({ status: response.status, code: data.code || null }))
    if (!ok) failed = true
  } catch { failed = true; console.log(name, '连接失败，尚不能确认。') }
}
if (failed) process.exitCode = 1
