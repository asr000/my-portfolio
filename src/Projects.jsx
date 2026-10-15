import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { cleanupFiles, currentUser } from './lib/recordsApi.js'
import {
  errorText,
  escapeLike,
  formatDate,
  PAGE_SIZE,
} from './lib/recordUtils.js'
import RecordThumbnail from './RecordThumbnail.jsx'

export default function Projects() {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState(
    () => new URLSearchParams(window.location.search).get('notice') || '',
  )
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState(
    () => new URLSearchParams(window.location.search).get('tag') || '',
  )
  const [trash, setTrash] = useState(false)
  const [tags, setTags] = useState([])
  const [tagError, setTagError] = useState('')
  const [reload, setReload] = useState(0)
  const [cleaning, setCleaning] = useState(false)
  useEffect(() => {
    let active = true
    currentUser()
      .then((value) => {
        if (active) {
          setUser(value)
          setStatus(value ? 'ready' : 'signed-out')
        }
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
  }, [reload])
  useEffect(() => {
    let active = true
    if (!user) return
    supabase
      .rpc('record_tags', { p_trash: trash })
      .retry(false)
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setTagError(errorText(error))
          return
        }
        setTags(data.map((row) => row.tag))
        setTagError('')
      })
      .catch((err) => {
        if (active) setTagError(errorText(err))
      })
    return () => {
      active = false
    }
  }, [user, trash, reload])
  async function clean() {
    setCleaning(true)
    try {
      const remaining = await cleanupFiles(user.id)
      setMessage(
        remaining
          ? `仍有 ${remaining} 张图片等待清理，请检查权限或网络后重试。`
          : '待清理图片已处理。正在被记录使用的图片会保留。',
      )
    } catch (err) {
      setMessage(errorText(err))
    } finally {
      setCleaning(false)
    }
  }
  return (
    <section id="projects">
      <div className="projects-heading">
        <div>
          <h2>项目记录</h2>
          <p>记录每一次练习和进步。</p>
        </div>
        {user && (
          <a className="record-create-link" href="/?new=1">
            ＋ 新增记录
          </a>
        )}
      </div>
      {status === 'loading' && <p role="status">正在读取账号…</p>}
      {status === 'signed-out' && (
        <a className="record-create-link" href="/?login=1">
          登录后查看记录
        </a>
      )}
      {status === 'error' && (
        <div role="alert">
          <p>{message}</p>
          <button onClick={() => setReload((n) => n + 1)}>重试</button>
        </div>
      )}
      {status === 'ready' && user && (
        <div className="records-workspace">
          <div className="list-tabs" role="group" aria-label="记录范围">
            <button
              aria-pressed={!trash}
              onClick={() => {
                setTrash(false)
                setTag('')
              }}
            >
              我的记录
            </button>
            <button
              aria-pressed={trash}
              onClick={() => {
                setTrash(true)
                setTag('')
              }}
            >
              回收站
            </button>
          </div>
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault()
              setQuery(search.trim())
            }}
          >
            <label className="sr-only" htmlFor="record-search">
              搜索标题
            </label>
            <input
              id="record-search"
              type="search"
              placeholder="搜索记录标题…"
              maxLength={160}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="submit">搜索</button>
            {(query || tag) && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setSearch('')
                  setQuery('')
                  setTag('')
                }}
              >
                清除筛选
              </button>
            )}
          </form>
          <div className="tag-filters" role="group" aria-label="按标签筛选">
            <button aria-pressed={!tag} onClick={() => setTag('')}>
              全部标签
            </button>
            {tags.map((value) => (
              <button
                key={value}
                aria-pressed={tag === value}
                onClick={() => setTag(tag === value ? '' : value)}
              >
                {value}
              </button>
            ))}
          </div>
          {tagError && (
            <p className="inline-warning" role="status">
              标签筛选暂不可用：{tagError}{' '}
              <button onClick={() => setReload((n) => n + 1)}>重试</button>
            </p>
          )}
          {trash && (
            <p className="helper">
              回收站中的记录和封面仍然保留，可以恢复；彻底删除后无法恢复。
            </p>
          )}
          <RecordsList
            key={`${user.id}:${query}:${tag}:${trash}:${reload}`}
            query={query}
            tag={tag}
            trash={trash}
          />
          <div className="list-footer">
            <button
              className="secondary-button"
              disabled={cleaning}
              onClick={clean}
            >
              {cleaning ? '正在清理…' : '重试清理旧封面'}
            </button>
            <small role="status">{message}</small>
          </div>
        </div>
      )}
    </section>
  )
}

function RecordsList({ query, tag, trash }) {
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
      .limit(PAGE_SIZE + 1)
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
          setRecords(data.slice(0, PAGE_SIZE))
          setHasMore(data.length > PAGE_SIZE)
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
    // The parent keys this component by every filter, so a new filter gets a new list.
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
            .slice(0, PAGE_SIZE)
            .filter((row) => !old.some((item) => item.id === row.id)),
        ])
        setHasMore(data.length > PAGE_SIZE)
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
            href={`/?record=${record.id}`}
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
      {hasMore && !message && (
        <button className="load-more" disabled={busy} onClick={more}>
          {busy ? '读取中…' : '加载更多'}
        </button>
      )}
      {!hasMore && !!records.length && !busy && (
        <small>已显示 {records.length} 条记录</small>
      )}
    </>
  )
}
