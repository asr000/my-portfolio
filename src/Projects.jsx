import RecordsList from './RecordsList.jsx'
import HelpHint from './HelpHint.jsx'

export default function Projects() {
  return (
    <section id="projects">
      <div className="projects-heading">
        <div>
          <div className="projects-title-row">
          <h2>项目记录</h2>
          <HelpHint align="start">记录每一次练习和进步。</HelpHint>
          </div>
        </div>
        <a className="text-link" href="/?view=showcase">
          查看全部练习 →
        </a>
      </div>
      <div className="records-workspace">
        <RecordsList preview publicView returnTo="/?view=showcase" />
      </div>
    </section>
  )
}
