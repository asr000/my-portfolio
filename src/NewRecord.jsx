import { useEffect, useState } from 'react'

function NewRecord() {

  const [coverFile, setCoverFile] = useState(null)
  const [coverPreview, setCoverPreview] = useState('')

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

  return (
    <main className="record-page">
      <a className="record-back" href="/#projects">
        ← 返回项目记录
      </a>

      <div className="record-editor">
        <h1>新增记录</h1>

        <div className="record-fields">
          <label htmlFor="new-title">标题</label>
          <input
            id="new-title"
            name="title"
            type="text"
            placeholder="今天完成了什么？"
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

        </div>
      </div>
    </main>
  )
}

export default NewRecord