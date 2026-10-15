import { RecordsAccess } from './RecordsLayout.jsx'
import RecordsList from './RecordsList.jsx'

export default function Projects() {
  return (
    <section id="projects">
      <div className="projects-heading">
        <div>
          <h2>项目记录</h2>
          <p>记录每一次练习和进步。</p>
        </div>
        <a className="text-link" href="/?view=records">
          查看全部记录 →
        </a>
      </div>
      <div className="records-workspace">
        <RecordsAccess>
          {() => <RecordsList preview returnTo="/?view=records" />}
        </RecordsAccess>
      </div>
    </section>
  )
}
