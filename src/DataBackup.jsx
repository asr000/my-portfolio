import { useEffect, useRef, useState } from 'react'
import RecordsLayout, { RecordsAccess } from './RecordsLayout.jsx'
import { createBackup } from './lib/backup.js'
import { importBackup } from './lib/backupImport.js'
import { errorText } from './lib/recordUtils.js'

export default function DataBackup() {
  return (
    <RecordsLayout
      title="数据备份"
      description="导出记录备份，或把旧备份导入当前账号。"
      back="/?view=manage"
      backLabel="返回记录管理"
    >
      <RecordsAccess>
        {(user) => <BackupForm key={user.id} user={user} />}
      </RecordsAccess>
    </RecordsLayout>
  )
}

function BackupForm({ user }) {
  const [format, setFormat] = useState('json')
  const [includeTrash, setIncludeTrash] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [download, setDownload] = useState(null)
  const [importFile, setImportFile] = useState(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [importError, setImportError] = useState('')
  const job = useRef(null)
  const importJob = useRef(null)
  useEffect(
    () => () => {
      job.current?.abort()
      importJob.current?.abort()
    },
    [],
  )
  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download.url)
    },
    [download],
  )
  async function exportData(event) {
    event.preventDefault()
    if (job.current || importJob.current) return
    const controller = new AbortController()
    job.current = controller
    setBusy(true)
    setDownload(null)
    setError('')
    setMessage('正在读取云端记录…')
    try {
      const result = await createBackup({
        user,
        format,
        includeTrash,
        signal: controller.signal,
        progress: (text) => {
          if (!controller.signal.aborted) setMessage(text)
        },
      })
      if (controller.signal.aborted) return
      setDownload({
        url: URL.createObjectURL(result.blob),
        filename: result.filename,
      })
      setMessage(`已准备好 ${result.count} 条记录的备份，请点击下载保存。`)
    } catch (err) {
      if (controller.signal.aborted)
        setMessage('导出已取消，云端记录不受影响。')
      else {
        setMessage('')
        setError(errorText(err))
      }
    } finally {
      job.current = null
      setBusy(false)
    }
  }
  async function importData(event) {
    event.preventDefault()
    if (!importFile || job.current || importJob.current) return
    if (
      !window.confirm(
        '导入会把备份中的记录添加到当前账号。已存在的相同记录编号会跳过，现有记录不会被覆盖。继续吗？',
      )
    ) return
    const controller = new AbortController()
    importJob.current = controller
    setImportBusy(true)
    setImportError('')
    setImportMessage('正在读取备份…')
    try {
      const result = await importBackup({
        file: importFile,
        user,
        signal: controller.signal,
        progress: setImportMessage,
      })
      if (controller.signal.aborted) return
      setImportMessage(
        `导入完成：新增 ${result.imported} 条，已存在跳过 ${result.alreadyExists} 条。${
          result.missingCovers
            ? `有 ${result.missingCovers} 条记录没有随备份提供封面文件。`
            : ''
        }${
          result.missingImages
            ? `有 ${result.missingImages} 张正文图片没有随备份提供。`
            : ''
        }`,
      )
    } catch (err) {
      if (controller.signal.aborted)
        setImportMessage('导入已停止。已经完成的记录保留；再次导入会跳过已存在记录。')
      else {
        setImportMessage('')
        setImportError(errorText(err))
      }
    } finally {
      importJob.current = null
      setImportBusy(false)
    }
  }
  return (
    <div className="maintenance-panel">
      <form className="record-fields" onSubmit={exportData}>
        <label htmlFor="backup-format">备份格式</label>
        <select
          id="backup-format"
          value={format}
          disabled={busy || importBusy}
          onChange={(event) => {
            setFormat(event.target.value)
            setDownload(null)
          }}
        >
          <option value="json">JSON：记录文字、标签与时间</option>
          <option value="zip">ZIP：记录和封面文件</option>
        </select>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={includeTrash}
            disabled={busy || importBusy}
            onChange={(event) => {
              setIncludeTrash(event.target.checked)
              setDownload(null)
            }}
          />
          包含回收站中的记录
        </label>
        <p className="helper">
          读取全部云端记录，不受列表当前加载条数限制。未保存的本机草稿和正文引用的外部图片不包含在内。单次备份限
          50 MB。
        </p>
        <div className="actions">
          <button type="submit" disabled={busy || importBusy}>
            {busy ? '正在准备…' : '生成备份'}
          </button>
          {(busy || importBusy) && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                job.current?.abort()
                importJob.current?.abort()
              }}
            >
              停止当前操作
            </button>
          )}
        </div>
      </form>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {download && (
        <a
          className="record-create-link"
          href={download.url}
          download={download.filename}
        >
          下载备份
        </a>
      )}
      <hr />
      <h2>导入备份</h2>
      <p className="helper">
        选择以前从 Supabase 或本网站导出的 JSON/ZIP 文件。ZIP 可以还原封面；JSON 只含记录文字。导入仅新增记录，已有记录不会覆盖。
      </p>
      <form className="record-fields" onSubmit={importData}>
        <label htmlFor="backup-import-file">备份文件</label>
        <input
          id="backup-import-file"
          type="file"
          accept=".json,.zip,application/json,application/zip"
          disabled={busy || importBusy}
          onChange={(event) => {
            setImportFile(event.target.files?.[0] || null)
            setImportMessage('')
            setImportError('')
          }}
        />
        <div className="actions">
          <button type="submit" disabled={!importFile || busy || importBusy}>
            {importBusy ? '正在导入…' : '导入到当前账号'}
          </button>
        </div>
      </form>
      {importMessage && <p role="status">{importMessage}</p>}
      {importError && <p role="alert">{importError}</p>}
      <p className="helper">
        备份只属于其原账号邮箱。导入前请确认已登录对应邮箱，且已开通笔记记录权限。
      </p>
    </div>
  )
}
