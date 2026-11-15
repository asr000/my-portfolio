import { apiDelete, apiGet, apiPut } from './apiClient.js'
import { fetchWithTimeout } from './http.js'

export function loadAppearance({ publicView = false, signal } = {}) {
  return apiGet(publicView ? '/api/public/appearance' : '/api/appearance', { signal })
}

export function saveAppearance(settings, signal) {
  return apiPut('/api/appearance', settings, { signal })
}

export async function uploadAppearanceImage(kind, file, signal) {
  let response
  try {
    response = await fetchWithTimeout(`/api/appearance/image/${kind}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': file.type },
      body: file,
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error
    throw new Error('图片上传连接失败，请检查网络后重试。')
  }

  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error('主题服务返回了无法识别的响应。')
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `图片上传失败（${response.status}）。`)
    error.status = response.status
    throw error
  }
  return payload
}

export function removeAppearanceImage(kind, signal) {
  return apiDelete(`/api/appearance/image/${kind}`, { signal })
}
