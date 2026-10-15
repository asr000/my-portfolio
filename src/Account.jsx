import { useState } from 'react'
import { useAuth } from './lib/authContext.js'
import { supabase } from './lib/supabaseClient.js'
import { errorText } from './lib/recordUtils.js'
import RecordsLayout from './RecordsLayout.jsx'
import { AuthNotice } from './AuthAccess.jsx'

export default function Account() {
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function signOut() {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
      setMessage('已退出当前设备。你的记录仍保存在云端，本机文字草稿也会保留。')
    } catch (err) {
      setMessage(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <RecordsLayout
      title="我的账号"
      description="查看当前登录状态和管理当前设备的会话。"
    >
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {auth.status === 'ready' && auth.user ? (
        <div className="maintenance-panel">
          <h2>当前登录账号</h2>
          <p className="account-email">{auth.user.email || '已登录'}</p>
          <p className="helper">
            同一账号在手机和电脑登录后，可以查看同一份云端记录。退出只影响当前设备。
          </p>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={signOut}
          >
            {busy ? '正在退出…' : '退出登录'}
          </button>
          <p>
            <a className="text-link" href="/?view=backup">
              前往数据备份 →
            </a>
          </p>
        </div>
      ) : (
        <AuthNotice label="登录账号" />
      )}
    </RecordsLayout>
  )
}
