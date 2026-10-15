import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import {
  errorText,
  escapeLike,
  formatDate,
  PAGE_SIZE,
} from './lib/recordUtils.js'
import { recordLink } from './lib/navigation.js'
import RecordThumbnail from './RecordThumbnail.jsx'

export default function RecordsList({
  query = '',
  tag = '',
  trash = false,
  preview = false,
  returnTo = '/?view=records',
}) {
  const pageSize = preview ? 4 : PAGE_SIZE
  const [records, setRecords] = useState([])
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const active = useRef(true)
  const loading = useRef(false)
  async function fetchPage(last) {
    let request = supabase
      .from('records')
      .select('id,title,tags,cover_path,created_at,deleted_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(pageSize + 1)
    request = trash
      ? request.not('deleted_at', 'is', null)
      : request.is('deleted_at', null)
    if (query) request = request.ilike('title', `%${escapeLike(query)}%`)
    if (tag) request = request.contains('tags', [tag])
    if (last)
      request = request.or(
        `created_at.lt.${last.created_at},and(created_at.eq.${last.created_at},id.lt.${last.id})`,
      )
    const { data, error } = await request.retry(false)
    if (error) throw error
    return data
  }
  useEffect(() => {
    active.current = true
    let cancelled = false
    fetchPage(null)
      .then((data) => {
        if (!cancelled) {
          setRecords(data.slice(0, pageSize))
          setHasMore(data.length > pageSize)
          setMessage('')
        }
      })
      .catch((err) => {
        if (!cancelled) setMessage(errorText(err))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
      active.current = false
    }
    // Filter changes navigate to a new page; a retry reloads the current list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])
  async function more() {
    if (loading.current) return
    loading.current = true
    setBusy(true)
    setMessage('')
    try {
      const data = await fetchPage(records.at(-1))
      if (active.current) {
        setRecords((old) => [
          ...old,
          ...data
            .slice(0, pageSize)
            .filter((row) => !old.some((item) => item.id === row.id)),
        ])
        setHasMore(data.length > pageSize)
      }
    } catch (err) {
      if (active.current) setMessage(errorText(err))
    } finally {
      loading.current = false
      if (active.current) setBusy(false)
    }
  }
  return (
    <>
      {!busy && !message && !records.length && (
        <p className="empty-state">
          {query || tag
            ? '没有符合筛选条件的记录。'
            : trash
              ? '回收站是空的。'
              : '还没有记录，写下第一条吧。'}
        </p>
      )}
      <div
        className="record-list"
        aria-label={trash ? '回收站记录列表' : '记录列表'}
        tabIndex={0}
      >
        {records.map((record) => (
          <a
            className="record-card"
            href={recordLink(record.id, { back: returnTo })}
            key={record.id}
          >
            <RecordThumbnail
              key={record.cover_path || record.id}
              coverPath={record.cover_path}
            />
            <span className="record-card-info">
              <span className="record-title">{record.title}</span>
              <span className="record-tags">
                {record.tags.map((value) => (
                  <span className="record-tag" key={value}>
                    {value}
                  </span>
                ))}
              </span>
              <time className="record-date" dateTime={record.created_at}>
                {formatDate(record.created_at)}
              </time>
            </span>
          </a>
        ))}
      </div>
      {busy && <p role="status">正在读取记录…</p>}
      {message && (
        <p role="alert">
          {message}{' '}
          <button
            disabled={busy}
            onClick={() => (records.length ? more() : setAttempt((n) => n + 1))}
          >
            重试
          </button>
        </p>
      )}
      {!preview && hasMore && !message && (
        <button className="load-more" disabled={busy} onClick={more}>
          {busy ? '读取中…' : '加载更多'}
        </button>
      )}
      {!preview && !hasMore && !!records.length && !busy && (
        <small>已显示 {records.length} 条记录</small>
      )}
    </>
  )
}
