import { records } from './records.js'

function Projects() {
  return (
    <section id="projects">
      <h2>项目记录</h2>
      <p>记录每一次练习和进步。</p>

      <a className="record-create-link" href="/?new=1">
        ＋ 新增记录
      </a>

      <div className="record-list">
        {records.map((record) => (
          <a
            className="record-card"
            href={`/?record=${encodeURIComponent(record.id)}`}
            key={record.id}
          >
            <span className="record-title">
              {record.title}
            </span>

            <span className="record-tags">
              {record.tags.map((tag) => (
                <span className="record-tag" key={tag}>
                  {tag}
                </span>
              ))}
            </span>
          </a>
        ))}
      </div>
    </section>
  )
}

export default Projects