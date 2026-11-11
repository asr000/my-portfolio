import { apiPost } from './apiClient.js'

// Email tokens arrive in the URL fragment so web servers and proxy logs never see them.
function readCallback() {
  if (typeof window === 'undefined')
    return { recovery: false, failed: false, token: '' }
  const params = new URLSearchParams(window.location.hash.slice(1))
  const query = new URLSearchParams(window.location.search)
  const token = params.get('token') || ''
  const state = {
    recovery:
      query.get('view') === 'reset-password' && !!token,
    failed:
      params.has('error') ||
      params.has('error_code') ||
      query.has('error') ||
      query.has('error_code'),
    token,
  }
  if (token || params.has('error') || params.has('error_code'))
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  return state
}
export const initialAuthCallback = readCallback()

let verificationPromise
export function verifyEmailCallback() {
  if (!initialAuthCallback.token)
    return Promise.reject(new Error('验证链接无效或已过期。'))
  if (!verificationPromise) {
    verificationPromise = apiPost('/api/auth/verify-email', {
      token: initialAuthCallback.token,
    })
  }
  return verificationPromise
}
