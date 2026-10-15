import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backupCoverName, backupDocument } from '../src/lib/backupFormat.js'
import { isSessionError } from '../src/lib/authContext.js'

test('backup preserves record content and trash metadata without copying session-like fields', () => {
  const record = {
    id: 'record',
    title: '标题',
    tags: ['笔记'],
    content: '# 正文',
    cover_path: 'owner/cover.png',
    deleted_at: '2026-10-15',
    version: 4,
    access_token: 'never-export',
  }
  const result = backupDocument(
    [record],
    { id: 'owner', email: 'a@example.invalid', access_token: 'never-export' },
    { includeTrash: true, coverFilesIncluded: false },
  )
  assert.equal(result.schemaVersion, 1)
  assert.equal(result.records[0].content, '# 正文')
  assert.equal(result.records[0].deleted_at, '2026-10-15')
  assert.equal(result.records[0].version, 4)
  assert.equal(JSON.stringify(result).includes('never-export'), false)
})

test('archive filenames do not reuse untrusted cloud paths or directory traversal', () => {
  assert.equal(backupCoverName('owner/../../file.PNG', 0), 'covers/cover-1.png')
  assert.equal(backupCoverName('owner/unknown.exe', 3), 'covers/cover-4.bin')
})

test('expired sessions are distinguished from temporary network errors', () => {
  assert.equal(isSessionError({ status: 401 }), true)
  assert.equal(
    isSessionError({ code: 'refresh_token_not_found', status: 400 }),
    true,
  )
  assert.equal(
    isSessionError({ name: 'AuthRetryableFetchError', status: 503 }),
    false,
  )
})
