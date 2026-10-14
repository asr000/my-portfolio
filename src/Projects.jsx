import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import RecordThumbnail from './RecordThumbnail.jsx'

function Projects() {
  const [records, setRecords] = useState([])
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadRecords() {
      try {
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession()

        if (sessionError) {
          throw sessionError
        }

        if (cancelled) {
          return
        }

        if (!sessionData.session) {
          setStatus('signed-out')
          return
        }

        const { data, error } = await supabase
          .from('records')
          .select('id, title, tags, cover_path, created_at')
          .order('created_at', { ascending: false })

        if (error) {
          throw error
        }

        if (!cancelled) {
          setRecords(data)
          setStatus('ready')
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error.message || '请求未完成，请检查网络。')
          setStatus('error')
        }
      }
    }

    loadRecords()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section id="projects">
      <h2>项目记录</h2>
      <p>记录每一次练习和进步。</p>

      {status === 'loading' && (
        <p role="status">正在读取记录…</p>
      )}

      {status === 'signed-out' && (
        <a className="record-create-link" href="/?login=1">
          登录后查看记录
        </a>
      )}

      {status === 'error' && (
        <p role="alert">读取失败：{message}</p>
      )}

      {status === 'ready' && (
        <>
          <a className="record-create-link" href="/?new=1">
            ＋ 新增记录
          </a>

          {records.length === 0 && (
            <p>云端还没有你的记录。</p>
          )}

          <div className="record-list">
            {records.map((record) => (
              <a
                className="record-card"
                href={`/?record=${encodeURIComponent(record.id)}`}
                key={record.id}
              > 
                <RecordThumbnail
                  key={`${record.id}:${record.cover_path ?? ''}`}
                  coverPath={record.cover_path}
                />

                <span className="record-card-info">
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
                </span>
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export default Projects