import { useNoteAccess } from './lib/useNoteAccess.js'
import PageTopbar from './PageTopbar.jsx'

export function NoteAccessMessage({ access }) {
  if (access.loading) return <p role="status">正在检查笔记权限…</p>
  if (access.error)
    return (
      <div role="alert">
        <p>{access.error}</p>
        <button onClick={access.retry}>重试笔记权限</button>
      </div>
    )
  return (
    <div className="notice">
      <p>
        笔记记录功能采用邀请制。兑换邀请码后，即可创建和编辑自己的笔记，并自行选择是否公开。
      </p>
      <a className="record-create-link" href="/?view=activate">
        兑换邀请码
      </a>
      <a className="text-link" href="/?view=showcase">
        浏览公开练习 →
      </a>
    </div>
  )
}

export default function NoteWriteAccess({ children }) {
  const access = useNoteAccess()
  if (!access.data?.can_write)
    return (
      <main className="record-page">
        <PageTopbar back="/?view=records" backLabel="返回我的记录" />
        <NoteAccessMessage access={access} />
      </main>
    )
  return children
}
