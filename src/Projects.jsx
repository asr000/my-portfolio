import RecordsList from './RecordsList.jsx'

export default function Projects() {
  return (
    <section id="projects">
      <div className="projects-heading">
        <div>
          <h2>项目记录</h2>
          <p>记录每一次练习和进步。</p>
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
