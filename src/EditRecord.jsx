import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'

function EditRecord({ recordId }) {
  const [record, setRecord] = useState(null)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

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
          .select('id, title, tags, content, cover_path')
          .eq('id', recordId)
          .maybeSingle()

        if (error) {
          throw error
        }

        if (!cancelled) {
          setRecord(data)
          setStatus(data ? 'ready' : 'not-found')
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

  async function handleSubmit(event) {
    event.preventDefault()

    if (isSaving) {
      return
    }

    const formData = new FormData(event.currentTarget)
    const title = String(formData.get('title') ?? '').trim()
    const content = String(formData.get('content') ?? '')
    const tagsText = String(formData.get('tags') ?? '')

    if (!title) {
      setSaveMessage('请填写标题，标题不能只有空格。')
      return
    }

    const tags = [
      ...new Set(
        tagsText
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter((tag) => tag !== '')
      ),
    ]

    setIsSaving(true)
    setSaveMessage('')

    try {
      const { data, error } = await supabase
        .from('records')
        .update({
          title,
          tags,
          content,
        })
        .eq('id', recordId)
        .select('id')
        .single()

      if (error) {
        throw error
      }

      window.location.assign(
        `/?record=${encodeURIComponent(data.id)}`
      )
    } catch (error) {
      setSaveMessage(
        `修改未完成：${error.message || '请检查网络后重试。'}`
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="record-page">
      <a
        className="record-back"
        href={`/?record=${encodeURIComponent(recordId)}`}
      >
        ← 返回记录详情
      </a>

      {status === 'loading' && (
        <p role="status">正在读取原记录…</p>
      )}

      {status === 'signed-out' && (
        <a className="record-create-link" href="/?login=1">
          请先登录
        </a>
      )}

      {status === 'not-found' && (
        <p>记录不存在，或当前账号没有访问权限。</p>
      )}

      {status === 'error' && (
        <p role="alert">读取失败：{message}</p>
      )}

      {status === 'ready' && record && (
        <div className="record-editor">
          <h1>编辑记录</h1>

          <form className="record-fields" onSubmit={handleSubmit}>
            <label htmlFor="edit-title">标题</label>
            <input
              id="edit-title"
              name="title"
              type="text"
              defaultValue={record.title}
              required
              disabled={isSaving}
            />

            <label htmlFor="edit-tags">标签</label>
            <input
              id="edit-tags"
              name="tags"
              type="text"
              disabled={isSaving}
              defaultValue={record.tags.join(', ')}
            />

            <label htmlFor="edit-content">正文</label>
            <textarea
              id="edit-content"
              name="content"
              rows={8}
              defaultValue={record.content}
              disabled={isSaving}
            />

            <button
              className="login-submit"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? '正在保存…' : '保存修改'}
            </button>

            <p className="login-message" role="status">
              {saveMessage}
            </p>
          </form>
        </div>
      )}
    </main>
  )
}

export default EditRecord