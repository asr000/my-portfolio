import { Unzip, UnzipInflate } from 'fflate'
import { apiPost } from './apiClient.js'
import { currentUser, prepareCover } from './recordsApi.js'
import { BACKUP_LIMIT } from './backupFormat.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readDocument(value) {
  if (
    !value ||
    value.format !== 'portfolio-records' ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records) ||
    value.records.length > 5000
  ) throw new Error('文件不是受支持的 Re:代码生活备份，或记录数量超过上限。')

  const seen = new Set()
  for (const row of value.records) {
    if (!row || !uuidPattern.test(row.id || '') || seen.has(row.id))
      throw new Error('备份包含无效或重复的记录编号。')
    seen.add(row.id)
  }
  return value
}

async function loadBackup(file, signal) {
  if (file.size > BACKUP_LIMIT)
    throw new Error('备份文件超过 50 MB。')
  if (file.name.toLowerCase().endsWith('.json')) {
    return { document: readDocument(JSON.parse(await file.text())), files: null }
  }
  if (!file.name.toLowerCase().endsWith('.zip'))
    throw new Error('请选择 JSON 或 ZIP 备份文件。')
  signal.throwIfAborted()
  const files = unzipLimited(new Uint8Array(await file.arrayBuffer()))
  const json = files['records.json']
  if (!json) throw new Error('ZIP 中找不到 records.json。')
  const document = readDocument(JSON.parse(new TextDecoder().decode(json)))
  return { document, files }
}

function unzipLimited(data) {
  const files = Object.create(null)
  let totalSize = 0
  let entries = 0
  let failure = null
  const unzip = new Unzip((file) => {
    entries += 1
    if (entries > 10100) {
      failure = new Error('ZIP 文件包含过多条目。')
      file.terminate()
      return
    }
    const isDocument = file.name === 'records.json'
    const isCover = /^covers\/cover-[0-9]+\.(?:webp|png|jpg|jpeg)$/i.test(file.name)
    if (!isDocument && !isCover) return
    if (Object.prototype.hasOwnProperty.call(files, file.name)) {
      failure = new Error(`ZIP 中出现重复文件：${file.name}`)
      file.terminate()
      return
    }
    if (file.originalSize > BACKUP_LIMIT || totalSize + file.originalSize > BACKUP_LIMIT) {
      failure = new Error('ZIP 解压后的内容超过 50 MB。')
      file.terminate()
      return
    }
    const chunks = []
    let fileSize = 0
    file.ondata = (error, chunk, final) => {
      if (error) {
        failure = error
        return
      }
      fileSize += chunk.length
      totalSize += chunk.length
      if (
        fileSize > BACKUP_LIMIT ||
        totalSize > BACKUP_LIMIT ||
        (isCover && fileSize > 5 * 1024 * 1024)
      ) {
        failure = new Error('ZIP 解压后的内容超过允许大小。')
        file.terminate()
        return
      }
      chunks.push(chunk)
      if (final) {
        const output = new Uint8Array(fileSize)
        let offset = 0
        for (const part of chunks) {
          output.set(part, offset)
          offset += part.length
        }
        files[file.name] = output
      }
    }
    try {
      file.start()
    } catch (error) {
      failure = error
    }
  })
  unzip.register(UnzipInflate)
  try {
    unzip.push(data, true)
  } catch (error) {
    failure ||= error
  }
  if (failure) throw failure
  return files
}

function base64(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

async function coverFor(row, files, signal) {
  if (!row.cover_path) return { cover: null, missing: false }
  if (!files || !row.cover_file) return { cover: null, missing: true }
  const name = row.cover_file
  if (
    typeof name !== 'string' ||
    !name.startsWith('covers/') ||
    name.includes('..') ||
    name.includes('\\')
  ) return { cover: null, missing: true }
  const bytes = files[name]
  if (!bytes) return { cover: null, missing: true }
  const extension = name.split('.').at(-1).toLowerCase()
  const type = {
    webp: 'image/webp',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  }[extension]
  if (!type) return { cover: null, missing: true }
  signal.throwIfAborted()
  const source = new File([bytes], name.split('/').at(-1), { type })
  const processedCover = await prepareCover(source)
  if (processedCover.size > 5 * 1024 * 1024)
    throw new Error(`封面 ${name} 处理后仍超过 5 MB。`)
  return {
    cover: {
      content_type: processedCover.type,
      base64: base64(new Uint8Array(await processedCover.arrayBuffer())),
    },
    missing: false,
  }
}

export async function importBackup({ file, user, signal, progress }) {
  const account = await currentUser()
  if (account?.id !== user.id)
    throw new Error('登录状态已变化，请重新登录后导入。')

  const { document, files } = await loadBackup(file, signal)
  const backupEmail = String(document.owner?.email || '').trim().toLowerCase()
  if (backupEmail && backupEmail !== String(account.email || '').trim().toLowerCase())
    throw new Error('备份邮箱与当前账号不同。请使用原邮箱注册/登录后再导入。')

  let imported = 0
  let alreadyExists = 0
  let missingCovers = 0
  for (const [index, row] of document.records.entries()) {
    signal.throwIfAborted()
    const { cover, missing } = await coverFor(row, files, signal)
    if (missing) missingCovers += 1
    const result = await apiPost('/api/records/import', { record: row, cover }, { signal })
    if (result.imported) imported += 1
    else alreadyExists += 1
    progress(`正在导入 ${index + 1}/${document.records.length} 条记录…`)
  }

  if ((await currentUser())?.id !== user.id)
    throw new Error('账号已变化，导入已停止。')
  return { imported, alreadyExists, missingCovers, total: document.records.length }
}
