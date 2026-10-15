import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { errorText } from './lib/recordUtils.js'
import RecordsLayout, { RecordsAccess } from './RecordsLayout.jsx'
import RecordsList from './RecordsList.jsx'

export default function SearchRecords({ publicView = false }) {
  return (
    <RecordsLayout
      title={publicView ? '练习展示' : '搜索记录'}
      description={
        publicView
          ? '网站作者与受邀作者公开的项目和学习记录，无需登录即可阅读。'
          : '按标题和标签，找回某一次记录。'
      }
      publicPage={publicView}
      back={publicView ? '/#projects' : '/?view=records'}
      backLabel={publicView ? '返回首页' : '返回记录列表'}
    >
      {publicView ? (
        <SearchForm publicView />
      ) : (
        <RecordsAccess>{(user) => <SearchForm key={user.id} />}</RecordsAccess>
      )}
    </RecordsLayout>
  )
}

function SearchForm({ publicView = false }) {
  const params = new URLSearchParams(window.location.search)
  const query = (params.get('q') || '').trim()
  const tag = params.get('tag') || ''
  const [tags, setTags] = useState([])
  const [tagError, setTagError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    supabase
      .rpc(
        publicView ? 'public_record_tags' : 'record_tags',
        publicView ? {} : { p_trash: false },
      )
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
  }, [attempt, publicView])
  const view = publicView ? 'showcase' : 'search'
  const returnTo = `/?${new URLSearchParams({ view, ...(query && { q: query }), ...(tag && { tag }) })}`
  return (
    <>
      <form className="record-search-panel" action="/" method="get">
        <input type="hidden" name="view" value={view} />
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
            <a className="text-link" href={`/?view=${view}`}>
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
        {query || tag ? '搜索结果' : publicView ? '公开练习' : '全部记录'}
      </h2>
      <RecordsList
        query={query}
        tag={tag}
        returnTo={returnTo}
        publicView={publicView}
      />
    </>
  )
}
