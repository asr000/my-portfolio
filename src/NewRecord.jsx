import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'

function NewRecord() {

  const [coverFile, setCoverFile] = useState(null)
  const [coverPreview, setCoverPreview] = useState('')
  
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')

  function handleCoverChange(event) {
    const file = event.target.files[0]

    if (!file) {
      return
    }

    setCoverFile(file)
    setCoverPreview(URL.createObjectURL(file))
  }

  useEffect(() => {
    return () => {
      if (coverPreview) {
        URL.revokeObjectURL(coverPreview)
      }
    }
  }, [coverPreview])
  
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
      setMessage('请填写标题，标题不能只有空格。')
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
    setMessage('')

    try {
      const { data: userData, error: userError } =
        await supabase.auth.getUser()

      if (userError) {
        throw userError
      }

      if (!userData.user) {
        setMessage('请先登录，再保存记录。')
        return
      }

      let coverPath = null

      if (coverFile) {
        const extensions = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      }

      const extension = extensions[coverFile.type]

      if (!extension) {
        setMessage('封面请选择 JPEG、PNG 或 WebP 图片。')
        return
      }

      if (coverFile.size > 5 * 1024 * 1024) {
        setMessage('封面不能超过 5 MB。')
        return
      }

      const filePath =
        `${userData.user.id}/${crypto.randomUUID()}.${extension}`

      const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from('record-covers')
        .upload(filePath, coverFile, {
          contentType: coverFile.type,
          upsert: false,
        })

      if (uploadError) {
        throw uploadError
      }

      coverPath = uploadData.path
    }

      const { data, error } = await supabase
        .from('records')
        .insert({
          user_id: userData.user.id,
          title,
          tags,
          content,
          cover_path: coverPath,
        })
        .select('id')
        .single()

      if (error) {
        throw error
      }

      window.location.assign(
        `/?record=${encodeURIComponent(data.id)}`
      )
    } catch (error) {
      setMessage(`保存未完成：${error.message || '请检查网络。'}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="record-page">
      <a className="record-back" href="/#projects">
        ← 返回项目记录
      </a>

      <div className="record-editor">
        <h1>新增记录</h1>

        <form className="record-fields" onSubmit={handleSubmit}>
          <label htmlFor="new-title">标题</label>
          <input
            id="new-title"
            name="title"
            type="text"
            placeholder="今天完成了什么？"
            required
          />

          <label htmlFor="new-tags">标签</label>
          <input
            id="new-tags"
            name="tags"
            type="text"
            placeholder="例如：React, CSS, 学习记录"
          />

          <label htmlFor="new-content">详细内容</label>
          <textarea
            id="new-content"
            name="content"
            rows={8}
            placeholder="写下过程、遇到的问题和收获……"
          />
          
          <label htmlFor="new-cover">封面（可选）</label>

          <input
            id="new-cover"
            name="cover"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleCoverChange}
            disabled={isSaving}
          />

          {coverFile && (
              <span className="cover-filename">
              已选择：{coverFile.name}
          </span>
          )}

                    {coverPreview && (
            <img
              className="cover-preview"
              src={coverPreview}
              alt="所选封面的预览"
            />
          )}

          <button
            className="login-submit"
            type="submit"
            disabled={isSaving}
          >
            {isSaving ? '正在保存…' : '保存记录'}
          </button>

          <p className="login-message" role="status">
            {message}
          </p>
        </form>
      </div>
    </main>
  )
}

export default NewRecord