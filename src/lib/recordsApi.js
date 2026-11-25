import { apiDelete, apiGet, apiPost } from './apiClient.js'
import { fetchWithTimeout } from './http.js'
import { readLocal, writeLocal } from './localData.js'

export async function currentUser() {
  const result = await apiGet('/api/auth/me')
  return result.user
}

export async function getRecord(id) {
  return apiGet(`/api/records/${encodeURIComponent(id)}`)
}

export async function mutateRecord(request) {
  return apiPost('/api/records/mutate', request)
}

export async function getPublicRecord(id) {
  try {
    return await apiGet(`/api/public/records/${encodeURIComponent(id)}`)
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

export async function listRecords({
  query = '', tag = '', trash = false, cursor = null, limit = 13, signal,
} = {}) {
  const params = new URLSearchParams({
    q: query,
    tag,
    trash: String(trash),
    limit: String(limit),
  })
  if (cursor) {
    params.set('before_created_at', cursor.created_at)
    params.set('before_id', cursor.id)
  }
  return apiGet(`/api/records?${params}`, { signal })
}

export async function listPublicRecords({
  query = '', tag = '', cursor = null, limit = 13, signal,
} = {}) {
  const params = new URLSearchParams({ q: query, tag, limit: String(limit) })
  if (cursor) {
    params.set('before_created_at', cursor.created_at)
    params.set('before_id', cursor.id)
  }
  return apiGet(`/api/public/records?${params}`, { signal })
}

export async function listRecordTags({ publicView = false, trash = false } = {}) {
  const path = publicView
    ? '/api/public/tags'
    : `/api/record-tags?trash=${String(trash)}`
  return apiGet(path)
}

export async function canWriteNotes() {
  const result = await apiGet('/api/note-access')
  return !!result.can_write
}

export function queueCleanup(userId, path) {
  if (!path) return
  const key = `cleanup:${userId}`
  writeLocal(key, [...new Set([...readLocal(key, []), path])])
}

export async function cleanupFiles(userId) {
  const key = `cleanup:${userId}`
  const pending = readLocal(key, [])
  const remaining = []
  for (const path of pending) {
    try {
      const result = await apiDelete(
        `/api/covers/${encodeURIComponent(path)}`,
      )
      if (!result.ok) remaining.push(path)
    } catch {
      remaining.push(path)
    }
  }
  writeLocal(key, remaining)
  return remaining.length
}

export async function uploadCover(path, file, signal) {
  let response
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchWithTimeout('/api/covers', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': file.type,
          'X-Cover-Path': path,
        },
        body: file,
        signal,
      })
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 450))
        continue
      }
      throw new Error('图片上传连接中断或超时，请检查网络后重试。')
    }

    if (response.ok || ![408, 425, 429, 500, 502, 503, 504].includes(response.status))
      break
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 450))
  }

  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error('笔记服务返回了无法识别的响应。')
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `封面上传失败（${response.status}）。`)
    error.status = response.status
    throw error
  }
  return payload.path
}

export async function coverExists(path) {
  const params = new URLSearchParams({ path })
  return apiGet(`/api/covers/exists?${params}`)
}

export async function coverUrl(path) {
  const response = await fetch(`/api/covers/${encodeURIComponent(path)}`, {
    credentials: 'include',
  })
  if (!response.ok) throw new Error('封面读取失败。')
  return URL.createObjectURL(await response.blob())
}

export async function downloadCover(path, signal) {
  const response = await fetch(`/api/covers/${encodeURIComponent(path)}`, {
    credentials: 'include',
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error(`封面下载失败（${response.status}）。`)
  return response.blob()
}

async function coverSourceType(file) {
  const accepted = new Set(['image/jpeg', 'image/png', 'image/webp'])
  const declared = String(file.type || '').toLowerCase()
  const normalized = declared === 'image/jpg' ? 'image/jpeg' : declared
  if (accepted.has(normalized)) return normalized

  const extension = String(file.name || '').split('.').pop().toLowerCase()
  const byExtension = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }
  if (byExtension[extension]) return byExtension[extension]

  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg'
  if (bytes.length >= 8 &&
    bytes.subarray(0, 8).join(',') === '137,80,78,71,13,10,26,10')
    return 'image/png'
  if (bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP')
    return 'image/webp'
  throw new Error('请选择有效的 JPEG、PNG 或 WebP 图片。')
}

export async function prepareCover(file) {
  if (file.size > 20 * 1024 * 1024)
    throw new Error('原图不能超过 20 MB。')
  const sourceType = await coverSourceType(file)
  let source
  let width
  let height
  let cleanup = () => {}
  if (typeof createImageBitmap === 'function') {
    try {
      source = await createImageBitmap(file)
      width = source.width
      height = source.height
      cleanup = () => source.close()
    } catch {
      // Some Safari/image-decoder combinations cannot create an ImageBitmap;
      // retry decoding through a regular image element before failing.
    }
  }
  if (!source) {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve
        image.onerror = () => reject(new Error('图片无法解码。'))
        image.src = objectUrl
      })
      source = image
      width = image.naturalWidth
      height = image.naturalHeight
      cleanup = () => URL.revokeObjectURL(objectUrl)
    } catch {
      URL.revokeObjectURL(objectUrl)
      throw new Error('无法读取这张图片，请换用 JPEG、PNG 或 WebP 图片。')
    }
  }
  try {
    const makeCanvas = (maxEdge) => {
      const scale = Math.min(1, maxEdge / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前浏览器无法处理图片。')
      context.drawImage(source, 0, 0, canvas.width, canvas.height)
      return canvas
    }
    const initialCanvas = makeCanvas(1600)
    const webp = await new Promise((resolve) =>
      initialCanvas.toBlob(resolve, 'image/webp', 0.82),
    )
    if (webp?.type === 'image/webp' && webp.size <= 5 * 1024 * 1024)
      return new File([webp], 'cover.webp', { type: webp.type })

    // WebP encoding is missing in some Safari versions. Keep transparency for
    // PNG/WebP sources and progressively shrink until the server limit is met.
    const fallbackType = sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    for (const maxEdge of [1600, 1400, 1200, 1000, 800]) {
      const canvas = makeCanvas(maxEdge)
      const encoded = await new Promise((resolve) =>
        canvas.toBlob(
          resolve,
          fallbackType,
          fallbackType === 'image/jpeg' ? 0.82 : undefined,
        ),
      )
      if (encoded?.type === fallbackType && encoded.size <= 5 * 1024 * 1024) {
        const extension = fallbackType === 'image/jpeg' ? 'jpg' : 'png'
        return new File([encoded], `cover.${extension}`, { type: fallbackType })
      }
    }
    throw new Error('图片压缩后仍超过 5 MB，请换一张较小的图片。')
  } finally {
    cleanup()
  }
}

export function coverFileExtension(file) {
  const extensionByType = {
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
    'image/png': 'png',
  }
  const extension = extensionByType[file?.type]
  if (!extension) throw new Error('封面格式不受支持。')
  return extension
}
