import { records } from './records.js'

function RecordDetail({ recordId }) {
  const record = records.find((item) => item.id === recordId)

  if (!record) {
    return (
      <main className="record-page">
        <a className="record-back" href="/#projects">
          ← 返回项目记录
        </a>

        <h1>没有找到这条记录</h1>
      </main>
    )
  }

  return (
    <main className="record-page">
      <a className="record-back" href="/#projects">
        ← 返回项目记录
      </a>

      <article className="record-article">
        <h1>{record.title}</h1>

        <div className="record-tags">
          {record.tags.map((tag) => (
            <span className="record-tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>

        <p>{record.content}</p>
      </article>
    </main>
  )
}

export default RecordDetail