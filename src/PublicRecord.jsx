import { lazy, Suspense, useEffect, useState } from 'react'
import { getPublicRecord } from './lib/recordsApi.js'
import { errorText, formatDate } from './lib/recordUtils.js'
import { listReturn, loginLink } from './lib/navigation.js'
import RecordsLayout from './RecordsLayout.jsx'
import RecordSource from './RecordSource.jsx'

const MarkdownContent = lazy(() => import('./MarkdownContent.jsx'))

export default function PublicRecord({ recordId }) {
  const [record, setRecord] = useState(null)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const back = listReturn(
    new URLSearchParams(window.location.search).get('back'),
    'showcase',
  )
  useEffect(() => {
    let active = true
    getPublicRecord(recordId)
      .then((data) => {
        if (!active) return
        setRecord(data)
        setStatus(data ? 'ready' : 'not-found')
      })
      .catch((err) => {
        if (active) {
          setMessage(errorText(err))
          setStatus('error')
        }
      })
    return () => {
      active = false
    }
  }, [recordId, attempt])
  return (
    <RecordsLayout
      publicPage
      title={record?.title || '练习详情'}
      description={
        record
          ? `创建于 ${formatDate(record.created_at)} · 更新于 ${formatDate(record.updated_at)}`
          : '公开的项目与学习记录。'
      }
      back={back}
      backLabel="返回练习展示"
    >
      {status === 'loading' && <p role="status">正在读取练习…</p>}
      {status === 'error' && (
        <div role="alert">
          <p>{message}</p>
          <button onClick={() => setAttempt((n) => n + 1)}>重试读取</button>
        </div>
      )}
      {status === 'not-found' && (
        <div className="notice">
          <p>这条练习未公开、已取消公开或不存在。</p>
          <a
            className="text-link"
            href={loginLink(`/?record=${encodeURIComponent(recordId)}`)}
          >
            作者登录后查看自己的记录 →
          </a>
        </div>
      )}
      {status === 'ready' && record && (
        <article className="record-article public-record-article">
          <p className="public-record-source">
            <RecordSource record={record} />
          </p>
          <div className="record-tags">
            {record.tags.map((tag) => (
              <a
                className="record-tag"
                key={tag}
                href={`/?view=showcase&tag=${encodeURIComponent(tag)}`}
              >
                {tag}
              </a>
            ))}
          </div>
          <div className="public-record-content">
            <Suspense fallback={<p role="status">正在排版正文…</p>}>
              <MarkdownContent content={record.content} />
            </Suspense>
          </div>
        </article>
      )}
    </RecordsLayout>
  )
}
