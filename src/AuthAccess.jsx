import { Fragment } from 'react'
import { useAuth } from './lib/authContext.js'
import { loginLink } from './lib/navigation.js'

export function AuthNotice({ label = '登录后查看记录' }) {
  const auth = useAuth()
  if (auth.status === 'loading') return <p role="status">正在读取账号…</p>
  if (auth.status === 'error')
    return (
      <div role="alert">
        <p>{auth.message}</p>
        <button onClick={auth.refresh}>重试</button>
      </div>
    )
  return (
    <>
      {auth.message && <p role="status">{auth.message}</p>}
      <a
        className="record-create-link"
        href={loginLink(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        )}
      >
        {label}
      </a>
    </>
  )
}

export function RequireAccount({ children }) {
  const auth = useAuth()
  if (auth.status === 'ready' && auth.user)
    return <Fragment key={auth.user.id}>{children}</Fragment>
  return (
    <main className="record-page">
      <a className="record-back" href="/?view=records">
        ← 返回记录列表
      </a>
      {auth.status === 'signed-out' && <h1>请先登录</h1>}
      <AuthNotice label="请先登录" />
    </main>
  )
}
