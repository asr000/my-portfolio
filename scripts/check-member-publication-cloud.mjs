// Anonymous, read-only checks. Does not register, send mail, edit profiles or publish notes.
import process from 'node:process'
try { process.loadEnvFile('.env.local') } catch { /* environment may provide values */ }
const base = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!base || !key) throw new Error('缺少本地 Supabase 配置。')
let failed = false
for (const [label, path, body, expected] of [
  ['公开列表来源字段', 'rpc/public_records?select=id,author_name,author_role', { p_limit: 1 }, 'read'],
  ['公开详情来源字段', 'rpc/public_record?select=author_name,author_role', { p_record_id: '00000000-0000-4000-8000-000000000000' }, 'read'],
  ['昵称接口匿名拒绝', 'rpc/note_profile', {}, 'denied'],
  ['昵称表匿名拒绝', 'note_profiles?select=user_id&limit=1', null, 'denied'],
]) {
  try {
    const response = await fetch(`${base}/rest/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { apikey: key, ...(body && { 'Content-Type': 'application/json' }) },
      ...(body && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000), cache: 'no-store',
    })
    const data = await response.json()
    const ok = expected === 'read'
      ? response.status === 200 && Array.isArray(data)
      : [401, 403].includes(response.status) && data.code === '42501'
    console.log(label, ok ? '符合预期' : '需检查', JSON.stringify({
      status: response.status, code: data?.code || null,
      ...(Array.isArray(data) && { count: data.length }),
    }))
    if (!ok) failed = true
  } catch {
    failed = true
    console.log(label, '网络请求失败，尚不能确认云端状态。')
  }
}
console.log('检查不会公开任何记录；昵称和跨账号发布仍需在真实账号中验证。')
if (failed) process.exitCode = 1
