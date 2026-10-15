// Read-only schema availability probe. Does not sign in or write remote data.
import process from 'node:process'
try { process.loadEnvFile('.env.local') } catch { /* environment may already be configured */ }
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('缺少本地 Supabase 配置。')
const response = await fetch(`${url}/rest/v1/rpc/record_tags`, {
  method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_trash: false }), signal: AbortSignal.timeout(15000),
})
const result = await response.json()
if (result.code === 'PGRST202') console.log('云端尚未安装本次升级：record_tags 不存在。请先执行升级 SQL。')
else if (result.code === '42501' && /function record_tags/i.test(result.message || '')) console.log('云端已识别 record_tags 接口，并拒绝匿名访问（预期）。仍需登录后验证实际读写。')
else if (response.status === 401 || response.status === 403) console.log('云端拒绝了检查请求，尚不能确认升级状态。错误类型：', result.code || response.status)
else console.log('Schema probe:', response.status, result.code || '接口可用；仍需登录后验证。')
