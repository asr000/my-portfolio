import { apiGet, apiPut } from './apiClient.js'

export function listPaintings(signal) {
  return apiGet('/api/public/paintings', { signal })
}

export function updatePaintingDetails(id, details) {
  return apiPut(`/api/paintings/${encodeURIComponent(id)}`, details)
}

export async function uploadPainting(file, title, signal, thumbnail) {
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
    throw new Error('无法连接绘画作品服务，请稍后重试。', { cause: error })
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
  if (!thumbnail) return { ...payload, thumbnail_failed: true }
  if (payload?.id) {
    try {
      const response = await fetch(`/api/paintings/${encodeURIComponent(payload.id)}/thumbnail`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': thumbnail.type },
        body: thumbnail,
        signal,
      })
      if (!response.ok) return { ...payload, thumbnail_failed: true }
    } catch {
      return { ...payload, thumbnail_failed: true }
    }
  }
  return payload
}
