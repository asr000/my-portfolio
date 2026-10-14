import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'

function RecordDetail({ recordId }) {
  const [record, setRecord] = useState(null)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [coverMessage, setCoverMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadRecord() {
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
          .select('id, title, tags, content, cover_path, created_at')
          .eq('id', recordId)
          .maybeSingle()

        if (error) {
          throw error
        }

        if (cancelled) {
          return
        }

        setRecord(data)
        setStatus(data ? 'ready' : 'not-found')
        setCoverUrl('')
        setCoverMessage('')

        if (data?.cover_path) {
          setCoverMessage('正在加载封面…')

          try {
            const { data: signedData, error: signedError } = await supabase
              .storage
              .from('record-covers')
              .createSignedUrl(data.cover_path, 3600)

            if (signedError) {
              throw signedError
            }

            if (!cancelled) {
              setCoverUrl(signedData.signedUrl)
              setCoverMessage('')
            }
          } catch (error) {
            if (!cancelled) {
              setCoverMessage(
                `封面加载失败：${error.message || '请刷新页面重试。'}`
              )
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error.message || '请求未完成，请检查网络。')
          setStatus('error')
        }
      }
    }

    loadRecord()

    return () => {
      cancelled = true
    }
  }, [recordId])

  return (
    <main className="record-page">
      <a className="record-back" href="/#projects">
        ← 返回项目记录
      </a>

      {status === 'loading' && (
        <p role="status">正在读取详情…</p>
      )}

      {status === 'signed-out' && (
        <a className="record-create-link" href="/?login=1">
          请先登录
        </a>
      )}

      {status === 'not-found' && (
        <p>这条记录不存在，或当前账号没有访问权限。</p>
      )}

      {status === 'error' && (
        <p role="alert">读取失败：{message}</p>
      )}

      {status === 'ready' && record && (
        <article className="record-article">
          <h1>{record.title}</h1>

          <a
            className="record-create-link"
            href={`/?edit=${encodeURIComponent(record.id)}`}
          >
            编辑记录
          </a>

          <div className="record-tags">
            {record.tags.map((tag) => (
              <span className="record-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          
          {coverMessage && (
            <p role="status">{coverMessage}</p>
          )}

          {coverUrl && (
            <img
              className="record-cover"
              src={coverUrl}
              alt={`${record.title}的封面`}
              onError={() => {
                setCoverUrl('')
                setCoverMessage('封面图片未能显示，请刷新页面重试。')
              }}
            />
          )}

          <p className="record-content">
            {record.content}
          </p>
        </article>
      )}
    </main>
  )
}

export default RecordDetail