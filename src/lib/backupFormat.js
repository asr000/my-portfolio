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
