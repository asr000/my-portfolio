export function validatePassword(password, confirmation) {
  if (password.length < 8) throw new Error('密码至少需要 8 个字符。')
  if (password !== confirmation) throw new Error('两次输入的密码不一致。')
}

export function authRedirect(view) {
  return new URL(`/?view=${view}`, window.location.origin).href
}

export function authErrorText(error) {
  if (
    error?.status === 429 ||
    ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(
      error?.code,
    )
  )
    return '请求较频繁，请稍后再试；邮件也可能在垃圾邮件文件夹中。'
  if (error?.code === 'email_not_confirmed')
    return '邮箱尚未验证，请先打开验证邮件，或重新发送验证邮件。'
  if (error?.code === 'invalid_credentials')
    return '邮箱或密码不正确，请重新输入。'
  if (error?.code === 'weak_password')
    return '密码强度不足，请使用更长且更难猜的密码。'
  if (error?.code === 'same_password')
    return '新密码与原密码相同，请换一个密码。'
  if (error?.code === 'signup_disabled') return '注册暂未开放，请稍后再试。'
  if (
    [
      'email_address_not_authorized',
      'email_address_not_authorized_for_signup',
    ].includes(error?.code)
  )
    return '验证邮件暂时无法发送，请联系网站作者完成发信配置。'
  return error?.message || '请求未完成，请检查网络后重试。'
}

export function randomInvitationCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

export function normalizeInvitationCode(code) {
  return code.replace(/[\s-]/g, '').toUpperCase()
}

export function invitationStatus(invitation) {
  if (invitation.redeemed_at) return '已兑换'
  if (invitation.revoked_at) return '已撤销'
  if (new Date(invitation.expires_at).getTime() <= Date.now()) return '已过期'
  return '待兑换'
}
