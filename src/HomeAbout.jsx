import { useEffect, useState } from 'react'
import { useAuth } from './lib/authContext.js'
import { apiGet, apiPut } from './lib/apiClient.js'

const defaultContent = '好像还没啥可说的。'
const preview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('aboutPreview') === '1'

export default function HomeAbout() {
  const auth = useAuth()
  const canEdit = preview || (auth.status === 'ready' && auth.user?.is_author)
  const [content, setContent] = useState(defaultContent)
  const [draft, setDraft] = useState(defaultContent)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (preview) return undefined
    const controller = new AbortController()
    apiGet('/api/public/about', { signal: controller.signal })
      .then((result) => { setContent(result.content); setDraft(result.content) })
      .catch((error) => { if (error.name !== 'AbortError') setMessage('暂时无法读取介绍。') })
    return () => controller.abort()
  }, [])

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const result = preview ? { content: draft.trim() } : await apiPut('/api/about', { content: draft })
      setContent(result.content)
      setDraft(result.content)
      setEditing(false)
      setMessage(preview ? '预览已更新，不会保存到服务器。' : '已保存。')
    } catch (error) {
      setMessage(error.message || '保存失败，请重试。')
    } finally { setSaving(false) }
  }

  return (
    <section id="about">
      <div className="home-info-panel about-panel">
        <div className="about-heading">
          <h2>关于我</h2>
          {canEdit && !editing && <button type="button" onClick={() => { setDraft(content); setMessage(''); setEditing(true) }}>编辑</button>}
        </div>
        {editing ? (
          <form onSubmit={save}>
            <label htmlFor="about-content">介绍内容</label>
            <textarea id="about-content" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows={6} />
            <div className="about-actions">
              <button type="button" disabled={saving} onClick={() => { setEditing(false); setMessage('') }}>取消</button>
              <button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
            </div>
          </form>
        ) : content ? <p className="about-content">{content}</p> : null}
        {message && <p className="about-message" role="status">{message}</p>}
      </div>
    </section>
  )
}
