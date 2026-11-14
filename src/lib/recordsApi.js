import { apiDelete, apiGet, apiPost } from './apiClient.js'
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
  const response = await fetch('/api/covers', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': file.type,
      'X-Cover-Path': path,
    },
    body: file,
    signal,
  })
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
    cache: 'no-store',
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

export async function prepareCover(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('请选择 JPEG、PNG 或 WebP 图片。')
  if (file.size > 5 * 1024 * 1024) throw new Error('原图不能超过 5 MB。')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const webp = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.82),
    )
    if (webp?.type === 'image/webp' && webp.size <= 5 * 1024 * 1024)
      return new File([webp], 'cover.webp', { type: webp.type })

    // Some browsers display WebP but cannot encode it with canvas.toBlob.
    // Keep JPEGs as JPEGs and preserve transparency for PNG/WebP inputs.
    const fallbackType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const fallback = await new Promise((resolve) =>
      canvas.toBlob(
        resolve,
        fallbackType,
        fallbackType === 'image/jpeg' ? 0.82 : undefined,
      ),
    )
    if (!fallback || fallback.type !== fallbackType)
      throw new Error('当前浏览器无法处理这张封面，请用 Chrome 重试。')
    if (fallback.size > 5 * 1024 * 1024)
      throw new Error('封面处理后仍超过 5 MB，请换用较小的图片。')

    const extension = fallbackType === 'image/jpeg' ? 'jpg' : 'png'
    return new File([fallback], `cover.${extension}`, { type: fallbackType })
  } finally {
    bitmap.close()
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
