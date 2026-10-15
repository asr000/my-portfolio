import RecordsLayout, { RecordsAccess } from './RecordsLayout.jsx'
import RecordsList from './RecordsList.jsx'

export default function RecordsPage() {
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
              <a className="record-create-link" href="/?new=1">
                ＋ 新增记录
              </a>
              <div className="records-nav-links">
                <a className="text-link" href="/?view=search">
                  搜索记录
                </a>
                <a className="text-link" href="/?view=manage">
                  记录管理
                </a>
              </div>
            </nav>
            <RecordsList returnTo="/?view=records" />
          </>
        )}
      </RecordsAccess>
    </RecordsLayout>
  )
}
