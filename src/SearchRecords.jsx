import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { errorText } from './lib/recordUtils.js'
import RecordsLayout, { RecordsAccess } from './RecordsLayout.jsx'
import RecordsList from './RecordsList.jsx'

export default function SearchRecords() {
  return (
    <RecordsLayout
      title="搜索记录"
      description="按标题和标签，找回某一次记录。"
    >
      <RecordsAccess>{(user) => <SearchForm key={user.id} />}</RecordsAccess>
    </RecordsLayout>
  )
}

function SearchForm() {
  const params = new URLSearchParams(window.location.search)
  const query = (params.get('q') || '').trim()
  const tag = params.get('tag') || ''
  const [tags, setTags] = useState([])
  const [tagError, setTagError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    supabase
      .rpc('record_tags', { p_trash: false })
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
  }, [attempt])
  const returnTo = `/?${new URLSearchParams({ view: 'search', ...(query && { q: query }), ...(tag && { tag }) })}`
  return (
    <>
      <form className="record-search-panel" action="/" method="get">
        <input type="hidden" name="view" value="search" />
        <label htmlFor="record-search">搜索标题</label>
        <input
          id="record-search"
          name="q"
          type="search"
          placeholder="输入标题关键词…"
          maxLength={160}
          defaultValue={query}
        />
        <label htmlFor="search-tag">标签</label>
        <select id="search-tag" name="tag" defaultValue={tag}>
          <option value="">全部标签</option>
          {[...new Set([...(tag ? [tag] : []), ...tags])].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <div className="actions">
          <button type="submit">搜索</button>
          {(query || tag) && (
            <a className="text-link" href="/?view=search">
              清除筛选
            </a>
          )}
        </div>
      </form>
      {tagError && (
        <p className="inline-warning" role="status">
          标签暂时未能读取：{tagError}{' '}
          <button onClick={() => setAttempt((n) => n + 1)}>重试标签</button>
        </p>
      )}
      <h2 className="results-heading">
        {query || tag ? '搜索结果' : '全部记录'}
      </h2>
      <RecordsList query={query} tag={tag} returnTo={returnTo} />
    </>
  )
}
