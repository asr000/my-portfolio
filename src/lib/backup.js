import { strToU8, zip } from 'fflate'
import { supabase } from './supabaseClient.js'
import { currentUser } from './recordsApi.js'
import {
  BACKUP_LIMIT,
  backupCoverName,
  backupDocument,
} from './backupFormat.js'

async function readRecords(user, includeTrash, signal, progress) {
  const records = []
  const seen = new Set()
  let cursor = null
  let size = 0
  while (true) {
    signal.throwIfAborted()
    let request = supabase
      .from('records')
      .select(
        'id,user_id,title,tags,content,cover_path,created_at,updated_at,deleted_at,version,is_public',
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(200)
    if (!includeTrash) request = request.is('deleted_at', null)
    if (cursor)
      request = request.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      )
    const { data, error } = await request.abortSignal(signal).retry(false)
    if (error) throw error
    for (const record of data) {
      if (record.user_id !== user.id)
        throw new Error('账号状态发生变化，请重新登录后导出。')
      if (seen.has(record.id))
        throw new Error('导出期间记录列表发生变化，请重试。')
      seen.add(record.id)
      records.push(record)
    }
    size += strToU8(JSON.stringify(data)).length
    if (size > BACKUP_LIMIT)
      throw new Error(
        '记录文字超过 50 MB，本次未生成备份。请分批整理记录后重试。',
      )
    progress(`已读取 ${records.length} 条记录…`)
    if (data.length < 200) return records
    cursor = data.at(-1)
  }
}

async function coverBytes(path, signal, remaining) {
  const { data, error } = await supabase.storage
    .from('record-covers')
    .createSignedUrl(path, 120)
  if (error) throw error
  signal.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(
    () => controller.abort(new Error('封面下载超时，请重试。')),
    30000,
  )
  try {
    const response = await fetch(data.signedUrl, { signal: controller.signal })
    if (!response.ok)
      throw new Error(`封面下载失败（${response.status}），本次 ZIP 未生成。`)
    if (Number(response.headers.get('Content-Length')) > remaining)
      throw new Error('记录与封面超过 50 MB，请改用 JSON 备份文字。')
    const reader = response.body.getReader()
    const parts = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > remaining)
          throw new Error('记录与封面超过 50 MB，请改用 JSON 备份文字。')
        parts.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const result = new Uint8Array(size)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.length
    }
    return result
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

function archive(files, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    let cancel = () => {}
    const abort = () => {
      cancel()
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    cancel = zip(files, { level: 0 }, (error, bytes) => {
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(bytes)
    })
  })
}

export async function createBackup({
  user,
  format,
  includeTrash,
  signal,
  progress,
}) {
  if (!['json', 'zip'].includes(format))
    throw new Error('请选择 JSON 或 ZIP 格式。')
  const account = await currentUser()
  if (account?.id !== user.id)
    throw new Error('登录状态已变化，请重新登录后导出。')
  const records = await readRecords(user, includeTrash, signal, progress)
  const document = backupDocument(records, user, {
    includeTrash,
    coverFilesIncluded: format === 'zip',
  })
  const files = {}
  if (format === 'zip') {
    const paths = [
      ...new Set(records.map((row) => row.cover_path).filter(Boolean)),
    ]
    let size = strToU8(JSON.stringify(document)).length
    for (const [index, path] of paths.entries()) {
      signal.throwIfAborted()
      if (!path.startsWith(user.id + '/'))
        throw new Error('封面路径不属于当前账号，本次 ZIP 未生成。')
      progress(`正在备份封面 ${index + 1}/${paths.length}…`)
      const name = backupCoverName(path, index)
      const bytes = await coverBytes(path, signal, BACKUP_LIMIT - size)
      size += bytes.length
      files[name] = bytes
      for (const row of document.records)
        if (row.cover_path === path) row.cover_file = name
    }
  }
  // Validate again before exposing a downloadable file, including after a tab changes accounts.
  if ((await currentUser())?.id !== user.id)
    throw new Error('账号已变化，备份已取消，请重新导出。')
  signal.throwIfAborted()
  const json = JSON.stringify(document, null, 2)
  const jsonBytes = strToU8(json)
  if (
    jsonBytes.length +
      Object.values(files).reduce((sum, file) => sum + file.length, 0) >
    BACKUP_LIMIT
  )
    throw new Error(
      '备份超过 50 MB，本次未生成文件，请改用 JSON 或排除回收站后重试。',
    )
  const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  if (format === 'json')
    return {
      blob: new Blob([jsonBytes], { type: 'application/json' }),
      filename: `portfolio-${date}.json`,
      count: records.length,
    }
  progress('正在打包记录与封面…')
  files['records.json'] = jsonBytes
  files['README.txt'] = strToU8(
    'Re:代码生活 记录备份\n\nrecords.json 保存记录文字、标签、时间和回收站状态。\ncovers/ 保存封面原文件，记录中的 cover_file 对应该文件。\n不包含登录凭证、本机未保存草稿，或 Markdown 中引用的外部图片。\n本备份可在本地解压查看；当前网站尚无自动导入入口。\n',
  )
  const bytes = await archive(files, signal)
  signal.throwIfAborted()
  if (bytes.length > BACKUP_LIMIT)
    throw new Error('ZIP 超过 50 MB，请改用 JSON 或排除回收站后重试。')
  return {
    blob: new Blob([bytes], { type: 'application/zip' }),
    filename: `portfolio-${date}.zip`,
    count: records.length,
  }
}
