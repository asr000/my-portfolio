import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { errorText } from './lib/recordUtils.js'

export default function NoteProfile() {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    supabase
      .rpc('note_profile')
      .retry(false)
      .then(({ data, error }) => {
        if (!active) return
        if (error) setError(errorText(error))
        else {
          setName(data.display_name)
          setError('')
        }
      })
      .catch((err) => {
        if (active) setError(errorText(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [attempt])
  async function save(event) {
    event.preventDefault()
    if (busy || loading) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { data, error } = await supabase
        .rpc('set_note_display_name', { p_display_name: name.trim() })
        .retry(false)
      if (error) throw error
      setName(data.display_name)
      setMessage('昵称已保存，公开笔记的来源会一起更新。')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="note-profile-panel" aria-label="公开笔记昵称设置">
      <h2>笔记来源昵称</h2>
      <p className="helper">
        昵称会显示在你公开的笔记列表和详情页，私密笔记仍只对自己可见。
      </p>
      {loading ? (
        <p role="status">正在读取昵称…</p>
      ) : (
        <form onSubmit={save}>
          <label htmlFor="note-display-name">公开昵称</label>
          <input
            id="note-display-name"
            value={name}
            required
            maxLength={30}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value)
              setMessage('')
            }}
          />
          <button type="submit" disabled={busy || !name.trim()}>
            {busy ? '正在保存昵称…' : '保存昵称'}
          </button>
        </form>
      )}
      {error && (
        <p role="alert">
          昵称暂不可用：{error}{' '}
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => {
              setLoading(true)
              setError('')
              setMessage('')
              setAttempt((n) => n + 1)
            }}
          >
            重新读取昵称
          </button>
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  )
}
