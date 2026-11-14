export const BACKUP_LIMIT = 50 * 1024 * 1024

export function backupDocument(
  records,
  user,
  { includeTrash, coverFilesIncluded },
) {
  return {
    format: 'portfolio-records',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    owner: { id: user.id, email: user.email || null },
    includeTrash,
    coverFilesIncluded,
    records: records.map((record) => ({
      id: record.id,
      title: record.title,
      tags: record.tags,
      content: record.content,
      cover_path: record.cover_path,
      created_at: record.created_at,
      updated_at: record.updated_at,
      deleted_at: record.deleted_at,
      version: record.version,
      is_public: record.is_public ?? false,
    })),
  }
}

export function backupCoverName(path, index) {
  const extension = path.split('.').at(-1).toLowerCase()
  const safe = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)
    ? extension
    : 'bin'
  return `covers/cover-${index + 1}.${safe}`
}

export function inlineImagePaths(content, userId) {
  const paths = [...String(content || '').matchAll(
    /\/api\/covers\/([0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:webp|jpe?g|png))/gi,
  )].map((match) => match[1])
  return [...new Set(paths)].filter((path) =>
    path.slice(0, 37).toLowerCase() === `${userId}/`.toLowerCase(),
  )
}

export function backupImageName(path, index) {
  const extension = path.split('.').at(-1).toLowerCase()
  return `images/image-${index + 1}.${extension}`
}
