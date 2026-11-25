import { fetchWithTimeout } from './http.js'

const directPublicPaths = /^\/api\/public\/(?:records(?:\/[0-9a-f-]+)?|tags|paintings|appearance)(?:\?|$)/i
const directApiOrigin = 'https://api.ars000.top'

async function requestPublicDirect(path, options) {
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal.reason)
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetchWithTimeout(`${directApiOrigin}${path}`, {
      ...options,
      credentials: 'omit',
      signal: controller.signal,
    })
    if (response.status >= 500) throw new Error('公开接口暂不可用。')
    return response
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

export async function apiRequest(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' }
  const options = {
    method,
    credentials: 'include',
    headers,
    signal,
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  let response
  try {
    const direct = method === 'GET' && directPublicPaths.test(path) &&
      typeof window !== 'undefined' && window.location.origin === 'https://re-code-life.netlify.app'
    if (direct) {
      try {
        response = await requestPublicDirect(path, options)
      } catch (error) {
        if (signal?.aborted) throw error
        response = await fetchWithTimeout(path, options)
      }
    } else {
      response = await fetchWithTimeout(path, options)
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error
    if (error?.name === 'AbortError') throw error
    throw new Error('无法连接笔记服务，请检查网络后重试。', { cause: error })
  }

  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error('笔记服务返回了无法识别的响应。')
    }
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `请求失败（${response.status}）。`)
    error.status = response.status
    if (payload?.code) error.code = payload.code
    throw error
  }
  return payload
}

export function apiGet(path, options) {
  return apiRequest(path, options)
}

export function apiPost(path, body, options = {}) {
  return apiRequest(path, { ...options, method: 'POST', body })
}

export function apiPut(path, body, options = {}) {
  return apiRequest(path, { ...options, method: 'PUT', body })
}

export function apiDelete(path, options = {}) {
  return apiRequest(path, { ...options, method: 'DELETE' })
}
