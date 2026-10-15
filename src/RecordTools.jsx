import { useState } from 'react'
import { cleanupFiles } from './lib/recordsApi.js'
import { errorText } from './lib/recordUtils.js'
import RecordsLayout, { RecordsAccess } from './RecordsLayout.jsx'
import RecordsList from './RecordsList.jsx'

export default function RecordTools() {
  return (
    <RecordsLayout
      title="记录管理"
      description="选择需要处理的事项。编辑单条记录，请先打开那条记录的管理页面。"
    >
      <RecordsAccess>
        {() => (
          <nav className="management-links" aria-label="管理功能">
            <a className="management-link" href="/?view=trash">
              <span>
                <strong>回收站</strong>
                <small>查看已删除的记录，恢复或彻底删除。</small>
              </span>
              <span aria-hidden="true">→</span>
            </a>
            <a className="management-link" href="/?view=storage">
              <span>
                <strong>封面清理</strong>
                <small>重试清理替换或删除后不再使用的封面。</small>
              </span>
              <span aria-hidden="true">→</span>
            </a>
          </nav>
        )}
      </RecordsAccess>
    </RecordsLayout>
  )
}

export function TrashRecords() {
  return (
    <RecordsLayout
      title="回收站"
      description="记录和封面仍然保留。打开记录后，可进入管理页面恢复或彻底删除。"
      back="/?view=manage"
      backLabel="返回记录管理"
    >
      <RecordsAccess>
        {() => <RecordsList trash returnTo="/?view=trash" />}
      </RecordsAccess>
    </RecordsLayout>
  )
}

export function CoverCleanup() {
  return (
    <RecordsLayout
      title="封面清理"
      description="处理此前未能完成的旧封面清理。"
      back="/?view=manage"
      backLabel="返回记录管理"
    >
      <RecordsAccess>{(user) => <CleanupForm user={user} />}</RecordsAccess>
    </RecordsLayout>
  )
}

function CleanupForm({ user }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function clean() {
    if (busy) return
    setBusy(true)
    try {
      const remaining = await cleanupFiles(user.id)
      setMessage(
        remaining
          ? `仍有 ${remaining} 张图片等待清理，请检查权限或网络后重试。`
          : '待清理图片已处理。正在被记录使用的图片会保留。',
      )
    } catch (err) {
      setMessage(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="maintenance-panel">
      <h2>清理不再使用的图片</h2>
      <p>
        保存记录时会自动尝试清理旧封面。遇到断网或权限问题后，可以在这里重试。
      </p>
      <p className="helper">
        当前记录和回收站仍在使用的封面会保留。待清理队列来自当前浏览器。
      </p>
      <button disabled={busy} onClick={clean}>
        {busy ? '正在清理…' : '重试清理旧封面'}
      </button>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </div>
  )
}
