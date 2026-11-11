import { fetchWithTimeout } from './http.js'

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
    response = await fetchWithTimeout(path, options)
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error
    if (error?.name === 'AbortError') throw error
    throw new Error('无法连接笔记服务，请检查网络后重试。')
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
