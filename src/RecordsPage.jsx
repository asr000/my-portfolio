import RecordsLayout, { RecordsAccess } from './RecordsLayout.jsx'
import RecordsList from './RecordsList.jsx'
import { useNoteAccess } from './lib/useNoteAccess.js'
import { NoteAccessMessage } from './NoteAccess.jsx'

export default function RecordsPage() {
  const access = useNoteAccess()
  return (
    <RecordsLayout
      title="我的记录"
      description="最近的项目、练习和想法，都在这里。"
      back="/#projects"
      backLabel="返回首页"
    >
      <RecordsAccess>
        {() => (
          <>
            <nav className="records-page-nav" aria-label="记录功能">
              {access.data?.can_write && (
                <a className="record-create-link" href="/?new=1">
                  ＋ 新增记录
                </a>
              )}
              <div className="records-nav-links">
                <a className="text-link" href="/?view=search">
                  搜索记录
                </a>
                <a className="text-link" href="/?view=manage">
                  记录管理
                </a>
              </div>
            </nav>
            {!access.data?.can_write && <NoteAccessMessage access={access} />}
            <RecordsList returnTo="/?view=records" />
          </>
        )}
      </RecordsAccess>
    </RecordsLayout>
  )
}
