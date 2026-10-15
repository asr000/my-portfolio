import { Fragment } from 'react'
import { useAuth } from './lib/authContext.js'
import { AuthNotice } from './AuthAccess.jsx'

export default function RecordsLayout({
  title,
  description,
  back = '/?view=records',
  backLabel = '返回记录列表',
  children,
}) {
  const params = new URLSearchParams(window.location.search)
  const notice = params.get('notice')
  return (
    <main className="record-page">
      <div className="page-topbar">
        <a className="record-back" href={back}>
          ← {backLabel}
        </a>
        {params.get('view') !== 'account' && (
          <a className="text-link" href="/?view=account">
            我的账号
          </a>
        )}
      </div>
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
  const auth = useAuth()
  if (auth.status !== 'ready' || !auth.user) return <AuthNotice />
  return <Fragment key={auth.user.id}>{children(auth.user)}</Fragment>
}
