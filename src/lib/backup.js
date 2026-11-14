import { strToU8, zip } from 'fflate'
import { currentUser, downloadCover, listRecords } from './recordsApi.js'
import {
  BACKUP_LIMIT,
  backupCoverName,
  backupImageName,
  backupDocument,
  inlineImagePaths,
} from './backupFormat.js'

async function readRecords(user, includeTrash, signal, progress) {
  const records = []
  const seen = new Set()
  let cursor = null
  let size = 0
  while (true) {
    signal.throwIfAborted()
    const data = await listRecords({
      trash: includeTrash ? 'all' : false,
      limit: 200,
      cursor,
      signal,
    })
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
  signal.throwIfAborted()
  const blob = await downloadCover(path, signal)
  if (blob.size > remaining)
    throw new Error('记录与封面超过 50 MB，请改用 JSON 备份文字。')
  return new Uint8Array(await blob.arrayBuffer())
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
    const imagePaths = [
      ...new Set(records.flatMap((row) => inlineImagePaths(row.content, user.id))),
    ]
    for (const [index, path] of imagePaths.entries()) {
      signal.throwIfAborted()
      progress(`正在备份正文图片 ${index + 1}/${imagePaths.length}…`)
      const name = backupImageName(path, index)
      const bytes = await coverBytes(path, signal, BACKUP_LIMIT - size)
      size += bytes.length
      files[name] = bytes
      for (const row of document.records) {
        if (!inlineImagePaths(row.content, user.id).includes(path)) continue
        row.inline_image_files ||= {}
        row.inline_image_files[path] = name
      }
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
    'Re:代码生活 记录备份\n\nrecords.json 保存记录文字、标签、时间和回收站状态。\ncovers/ 保存封面原文件，记录中的 cover_file 对应该文件。\nimages/ 保存 Markdown 正文中引用的站内图片，记录中的 inline_image_files 对应该文件。\n不包含登录凭证、本机未保存草稿，或 Markdown 中引用的外部图片。\n请在网站的数据备份页面导入 JSON 或 ZIP；已有记录不会被覆盖。\n',
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
