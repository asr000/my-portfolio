import { apiGet } from './apiClient.js'

export function listPaintings(signal) {
  return apiGet('/api/public/paintings', { signal })
}

export async function uploadPainting(file, title, signal) {
  let response
  try {
    response = await fetch('/api/paintings', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': file.type,
        'X-Painting-Title': encodeURIComponent(title),
      },
      body: file,
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error
    throw new Error('无法连接绘画作品服务，请稍后重试。')
  }

  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error('绘画作品服务返回了无法识别的响应。')
    }
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `作品上传失败（${response.status}）。`)
    error.status = response.status
    throw error
  }
  return payload
}
