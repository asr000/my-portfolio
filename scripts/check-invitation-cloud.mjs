// Anonymous read-only checks. No registration, emails, credentials or invitations are created.
import process from 'node:process'
try {
  process.loadEnvFile('.env.local')
} catch {
  /* deployment environment may already provide values */
}
const base = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!base || !key) throw new Error('缺少本地 Supabase 配置。')
let failed = false
for (const [name, path, body] of [
  ['笔记权限接口', '/rest/v1/rpc/note_access', {}],
  ['邀请码表', '/rest/v1/note_invitations?select=id&limit=1', null],
  ['笔记成员表', '/rest/v1/note_members?select=user_id&limit=1', null],
]) {
  try {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        apikey: key,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      ...(body && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    })
    const result = await response.json()
    const denied =
      [401, 403].includes(response.status) && result.code === '42501'
    console.log(
      name,
      denied ? '符合预期，匿名拒绝' : '需检查',
      JSON.stringify({ status: response.status, code: result.code || null }),
    )
    if (!denied) failed = true
  } catch {
    failed = true
    console.log(name, '网络请求失败，无法确认。')
  }
}
try {
  const response = await fetch(base + '/auth/v1/settings', {
    headers: { apikey: key },
    signal: AbortSignal.timeout(15000),
  })
  const settings = await response.json()
  if (response.ok) {
    console.log(
      '注册配置',
      JSON.stringify({
        email: settings.external?.email,
        signupDisabled: settings.disable_signup,
        emailAutoConfirmed: settings.mailer_autoconfirm,
      }),
    )
    if (
      settings.disable_signup ||
      settings.mailer_autoconfirm ||
      !settings.external?.email
    ) {
      failed = true
      console.log('请开启邮箱注册并开启邮箱确认。')
    }
  } else {
    failed = true
    console.log('无法读取公开的注册配置，HTTP', response.status)
  }
} catch {
  failed = true
  console.log('注册配置网络检查失败。')
}
console.log(
  'SMTP 凭证、发信投递和后台 URL 白名单无法用匿名接口确认，需要后台配置及真实邮箱验证。',
)
if (failed) process.exitCode = 1
