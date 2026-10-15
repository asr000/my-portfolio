import { useEffect, useState } from 'react'
import { currentUser } from './lib/recordsApi.js'
import { errorText } from './lib/recordUtils.js'

export default function RecordsLayout({
  title,
  description,
  back = '/?view=records',
  backLabel = '返回记录列表',
  children,
}) {
  const notice = new URLSearchParams(window.location.search).get('notice')
  return (
    <main className="record-page">
      <a className="record-back" href={back}>
        ← {backLabel}
      </a>
      <div className="records-page-content">
        <header className="records-page-heading">
          <p className="page-eyebrow">Re:代码生活 / 项目记录</p>
          <h1>{title}</h1>
          <p className="page-description">{description}</p>
        </header>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {children}
      </div>
    </main>
  )
}

export function RecordsAccess({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    currentUser()
      .then((account) => {
        if (!active) return
        setUser(account)
        setStatus(account ? 'ready' : 'signed-out')
      })
      .catch((err) => {
        if (!active) return
        setMessage(errorText(err))
        setStatus('error')
      })
    return () => {
      active = false
    }
  }, [attempt])
  if (status === 'loading') return <p role="status">正在读取账号…</p>
  if (status === 'signed-out')
    return (
      <a className="record-create-link" href="/?login=1">
        登录后查看记录
      </a>
    )
  if (status === 'error')
    return (
      <div role="alert">
        <p>{message}</p>
        <button
          onClick={() => {
            setStatus('loading')
            setAttempt((n) => n + 1)
          }}
        >
          重试
        </button>
      </div>
    )
  return children(user)
}
