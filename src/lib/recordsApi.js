import { supabase } from './supabaseClient.js'
import { readLocal, writeLocal } from './localData.js'

export async function currentUser() {
  const { data: session, error: sessionError } =
    await supabase.auth.getSession()
  if (sessionError) throw sessionError
  if (!session.session) return null
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  return data.user
}

export async function getRecord(id) {
  const { data, error } = await supabase
    .from('records')
    .select('*')
    .eq('id', id)
    .maybeSingle()
    .retry(false)
  if (error) throw error
  return data
}

export async function mutateRecord(request) {
  if (['publish', 'unpublish'].includes(request.action)) {
    const { data, error } = await supabase
      .rpc('set_record_visibility', {
        p_request_id: request.requestId,
        p_record_id: request.recordId,
        p_version: request.version,
        p_public: request.action === 'publish',
      })
      .retry(false)
    if (error) throw error
    return data
  }
  const { data, error } = await supabase
    .rpc('mutate_record', {
      p_request_id: request.requestId,
      p_action: request.action,
      p_record_id: request.recordId,
      p_version: request.version ?? null,
      p_title: request.title ?? null,
      p_tags: request.tags ?? null,
      p_content: request.content ?? null,
      p_cover_path: request.coverPath ?? null,
    })
    .retry(false)
  if (error) throw error
  return data
}

export async function getPublicRecord(id) {
  const { data, error } = await supabase
    .rpc('public_record', { p_record_id: id })
    .retry(false)
  if (error) throw error
  return data[0] || null
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
      const { data: references, error } = await supabase
        .from('records')
        .select('id')
        .eq('cover_path', path)
        .limit(1)
        .retry(false)
      if (error || references.length) {
        remaining.push(path)
        continue
      }
      const { error: removeError } = await supabase.storage
        .from('record-covers')
        .remove([path])
      if (removeError) {
        remaining.push(path)
        continue
      }
      const { data: stillExists, error: checkError } = await supabase.storage
        .from('record-covers')
        .exists(path)
      if (
        stillExists ||
        (checkError &&
          !['400', '404'].includes(
            String(checkError.statusCode || checkError.status),
          ))
      )
        remaining.push(path)
    } catch {
      remaining.push(path)
    }
  }
  writeLocal(key, remaining)
  return remaining.length
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
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.82),
    )
    if (!blob) throw new Error('图片处理失败，请换一张图片。')
    return new File([blob], 'cover.webp', { type: blob.type })
  } finally {
    bitmap.close()
  }
}
