import { useEffect, useRef, useState } from 'react'
import RecordsLayout, { RecordsAccess } from './RecordsLayout.jsx'
import { createBackup } from './lib/backup.js'
import { errorText } from './lib/recordUtils.js'

export default function DataBackup() {
  return (
    <RecordsLayout
      title="数据备份"
      description="把自己的云端记录保存到设备上。"
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
  const job = useRef(null)
  useEffect(() => () => job.current?.abort(), [])
  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download.url)
    },
    [download],
  )
  async function exportData(event) {
    event.preventDefault()
    if (job.current) return
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
  return (
    <div className="maintenance-panel">
      <form className="record-fields" onSubmit={exportData}>
        <label htmlFor="backup-format">备份格式</label>
        <select
          id="backup-format"
          value={format}
          disabled={busy}
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
            disabled={busy}
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
          <button type="submit" disabled={busy}>
            {busy ? '正在准备…' : '生成备份'}
          </button>
          {busy && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => job.current?.abort()}
            >
              取消导出
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
      <p className="helper">
        JSON 可用文本编辑器查看，ZIP
        可解压查看封面。当前提供导出，尚无自动导入入口。
      </p>
    </div>
  )
}
