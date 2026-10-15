// Read-only anonymous probe. Never signs in, publishes a record or prints record data.
import process from 'node:process'
try {
  process.loadEnvFile('.env.local')
} catch {
  /* environment may already be configured */
}
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('缺少本地 Supabase 配置。')

async function probe(path, body) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      apikey: key,
      ...(body && { 'Content-Type': 'application/json' }),
    },
    ...(body && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  })
  const data = await response.json()
  return {
    status: response.status,
    code: data?.code || null,
    ...(Array.isArray(data) && { count: data.length }),
  }
}

let failed = false
for (const [label, path, body, expected] of [
  ['公开列表', 'rpc/public_records', { p_limit: 1 }, 'read'],
  ['匿名直接读取记录表', 'records?select=id&limit=1', null, 'denied'],
  [
    '匿名读取作者配置',
    'portfolio_site?select=owner_id&limit=1',
    null,
    'denied',
  ],
]) {
  try {
    const result = await probe(path, body)
    const ok =
      expected === 'read'
        ? result.status === 200 && result.count !== undefined
        : [401, 403].includes(result.status) && result.code === '42501'
    console.log(label, ok ? '符合预期' : '需检查', JSON.stringify(result))
    if (result.code === 'PGRST202' || result.code === 'PGRST205')
      console.log('请先完整执行 20261016_public_showcase.sql。')
    if (!ok) failed = true
  } catch {
    failed = true
    console.log(label, '网络请求失败，尚不能确认云端状态。')
  }
}
console.log(
  '该检查只验证匿名接口与表访问边界；发布、撤回、跨账号和实际图片仍需登录后联调。',
)
if (failed) process.exitCode = 1
