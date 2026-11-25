import { useEffect, useRef, useState } from 'react'
import { useAuth } from './lib/authContext.js'
import PageTopbar from './PageTopbar.jsx'
import { listPaintings, updatePaintingDetails, uploadPainting } from './lib/paintingsApi.js'
import HelpHint from './HelpHint.jsx'
import './paintingsPage.css'

function svgImage(markup) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
}

const previewPaintings = [
  {
    id: 'preview-sunset',
    title: '晚风写给山海',
    duration_text: '2 小时 30 分钟',
    stroke_count: 1280,
    description: '用晚霞和海面的颜色，记录一天结束时的安静。',
    image_url: svgImage(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 1000"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#f5b49d"/><stop offset=".55" stop-color="#f8d9a9"/><stop offset="1" stop-color="#9fc9c1"/></linearGradient><linearGradient id="w" x2="0" y2="1"><stop stop-color="#779eac"/><stop offset="1" stop-color="#395b70"/></linearGradient></defs><rect width="1500" height="1000" fill="url(#s)"/><circle cx="1100" cy="250" r="132" fill="#fff1bd"/><path d="M0 650 260 430l210 190 220-290 260 330 210-205 340 240v305H0Z" fill="#a8818f"/><path d="m0 760 290-170 250 132 255-196 245 200 210-128 250 154v248H0Z" fill="#617e8a"/><path d="M0 770c225-85 362 38 560-8s355-67 510 2 274 64 430 10v226H0Z" fill="url(#w)"/><g fill="#f8e8cf" opacity=".8"><circle cx="250" cy="210" r="4"/><circle cx="390" cy="280" r="6"/><circle cx="770" cy="175" r="4"/><circle cx="680" cy="300" r="5"/><circle cx="1360" cy="160" r="4"/></g><path d="M180 1000c80-110 90-208 54-293m64 293c-23-160 1-274 80-363m-29 364c61-114 142-169 234-166" fill="none" stroke="#395b70" stroke-width="8" stroke-linecap="round" opacity=".65"/></svg>`),
  },
  {
    id: 'preview-flower',
    title: '花开的余白',
    image_url: svgImage(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 1000"><defs><linearGradient id="p" x2="1" y2="1"><stop stop-color="#e9d7d4"/><stop offset="1" stop-color="#b8c6bd"/></linearGradient><radialGradient id="f"><stop stop-color="#f7d88f"/><stop offset="1" stop-color="#ce8194"/></radialGradient></defs><rect width="1500" height="1000" fill="url(#p)"/><path d="M0 790c330-160 555-119 790 0s429 166 710 23v187H0Z" fill="#758a78" opacity=".62"/><g fill="url(#f)" stroke="#fff5df" stroke-width="5" opacity=".94"><g transform="translate(440 440)"><ellipse cy="-72" rx="47" ry="91"/><ellipse cy="-72" rx="47" ry="91" transform="rotate(60)"/><ellipse cy="-72" rx="47" ry="91" transform="rotate(120)"/><circle r="35" fill="#f5d38d"/></g><g transform="translate(960 305) scale(.72)"><ellipse cy="-72" rx="47" ry="91"/><ellipse cy="-72" rx="47" ry="91" transform="rotate(60)"/><ellipse cy="-72" rx="47" ry="91" transform="rotate(120)"/><circle r="35" fill="#f5d38d"/></g><g transform="translate(1110 650) scale(.88)"><ellipse cy="-72" rx="47" ry="91"/><ellipse cy="-72" rx="47" ry="91" transform="rotate(60)"/><ellipse cy="-72" rx="47" ry="91" transform="rotate(120)"/><circle r="35" fill="#f5d38d"/></g></g><g fill="none" stroke="#60796b" stroke-width="13" stroke-linecap="round"><path d="M435 1000c20-218 31-390 7-542m509 542c-25-190-7-376 27-607m121 607c-32-147-13-259 18-370"/></g><g fill="#f5f0da" opacity=".55"><circle cx="250" cy="200" r="65"/><circle cx="1250" cy="160" r="38"/><circle cx="785" cy="580" r="26"/></g></svg>`),
  },
]

function titleFromFile(file) {
  return file.name.replace(/\.[^.]+$/, '').trim().slice(0, 120) || '未命名作品'
}

function PaintingDetails({ painting, canManage, onSave }) {
  const [editing, setEditing] = useState(false)
  const [duration, setDuration] = useState(painting.duration_text || '')
  const [strokes, setStrokes] = useState(painting.stroke_count == null ? '' : String(painting.stroke_count))
  const [description, setDescription] = useState(painting.description || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function cancel() {
    setDuration(painting.duration_text || '')
    setStrokes(painting.stroke_count == null ? '' : String(painting.stroke_count))
    setDescription(painting.description || '')
    setError('')
    setEditing(false)
  }

  async function submit(event) {
    event.preventDefault()
    if (saving) return
    const count = strokes.trim() === '' ? null : Number(strokes)
    if (count !== null && (!Number.isInteger(count) || count < 0 || count > 2147483647)) {
      setError('笔数请输入有效的非负整数。')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(painting.id, {
        duration_text: duration.trim(),
        stroke_count: count,
        description: description.trim(),
      })
      setEditing(false)
    } catch (saveError) {
      setError(saveError.message || '作品说明保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="painting-details">
      <div className="painting-details-heading">
        <h2>作品说明</h2>
        {canManage && !editing && <button type="button" onClick={() => setEditing(true)}>编辑说明</button>}
      </div>
      {editing ? (
        <form className="painting-details-form" onSubmit={submit}>
          <div className="painting-details-fields">
            <label>时长<input value={duration} onChange={(event) => setDuration(event.target.value)} maxLength={40} placeholder="例如 2 小时 30 分钟" /></label>
            <label>笔数<input type="number" inputMode="numeric" min="0" max="2147483647" step="1" value={strokes} onChange={(event) => setStrokes(event.target.value)} placeholder="例如 1280" /></label>
          </div>
          <label>内容简述<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={4} placeholder="写一点关于这幅作品的想法…" /></label>
          {error && <p className="painting-details-error" role="alert">{error}</p>}
          <div className="painting-details-actions">
            <button type="button" onClick={cancel} disabled={saving}>取消</button>
            <button type="submit" disabled={saving}>{saving ? '保存中…' : '保存说明'}</button>
          </div>
        </form>
      ) : (
        <>
          <dl className="painting-details-meta">
            {painting.duration_text && <div><dt>时长</dt><dd>{painting.duration_text}</dd></div>}
            {painting.stroke_count != null && <div><dt>笔数</dt><dd>{painting.stroke_count.toLocaleString('zh-CN')}</dd></div>}
          </dl>
          {painting.description ? <p className="painting-details-description">{painting.description}</p> : <p className="painting-details-empty">暂无内容简述。</p>}
        </>
      )}
    </div>
  )
}

async function compressPainting(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('请选择 JPEG、PNG 或 WebP 图片。')
  if (file.size > 20 * 1024 * 1024)
    throw new Error('单张原图不能超过 20 MB。')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const toBlob = (source, type, quality) =>
      new Promise((resolve) => source.toBlob(resolve, type, quality))
    const webp = await toBlob(canvas, 'image/webp', 0.88)
    const original = webp?.type === 'image/webp' && webp.size <= 7 * 1024 * 1024
      ? webp : await toBlob(canvas, 'image/jpeg', 0.84)
    if (!original || original.size > 7 * 1024 * 1024)
      throw new Error('压缩后的图片仍超过 7 MB。')
    const thumbnailCanvas = document.createElement('canvas')
    const thumbnailScale = Math.min(1, 1000 / Math.max(canvas.width, canvas.height))
    thumbnailCanvas.width = Math.max(1, Math.round(canvas.width * thumbnailScale))
    thumbnailCanvas.height = Math.max(1, Math.round(canvas.height * thumbnailScale))
    thumbnailCanvas.getContext('2d').drawImage(canvas, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height)
    const thumbnailWebp = await toBlob(thumbnailCanvas, 'image/webp', 0.75)
    const thumbnail = thumbnailWebp?.type === 'image/webp'
      ? thumbnailWebp : await toBlob(thumbnailCanvas, 'image/jpeg', 0.75)
    return { original, thumbnail }
  } finally {
    bitmap.close()
  }
}

export default function PaintingsPage() {
  const auth = useAuth()
  const previewMode = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('preview') === '1'
  const [paintings, setPaintings] = useState(previewMode ? previewPaintings : [])
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(!previewMode)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const gallery = useRef(null)
  const lightbox = useRef(null)
  const touchStartX = useRef(null)
  const previewObjectUrls = useRef([])
  const canManage = previewMode || (auth.status === 'ready' && auth.user?.is_author)

  useEffect(() => {
    if (previewMode) return undefined
    const controller = new AbortController()
    listPaintings(controller.signal)
      .then((items) => {
        setPaintings(Array.isArray(items) ? items : [])
        setError('')
      })
      .catch((requestError) => {
        if (!controller.signal.aborted)
          setError(requestError.message || '作品暂时无法读取。')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [previewMode])

  useEffect(() => {
    const element = lightbox.current
    if (!element) return undefined
    if (lightboxOpen && !element.open) element.showModal()
    if (!lightboxOpen && element.open) element.close()
    return () => {
      if (element.open) element.close()
    }
  }, [lightboxOpen])

  useEffect(() => () => {
    for (const url of previewObjectUrls.current) URL.revokeObjectURL(url)
  }, [])

  useEffect(() => {
    if (activeIndex >= paintings.length) setActiveIndex(Math.max(0, paintings.length - 1))
  }, [activeIndex, paintings.length])

  function move(direction) {
    if (!paintings.length) return
    setActiveIndex((index) => (index + direction + paintings.length) % paintings.length)
  }

  async function addFiles(event) {
    const input = event.currentTarget
    const files = [...(input.files || [])]
    input.value = ''
    if (!files.length || uploading) return
    setUploading(true)
    setError('')
    setUploadMessage('')
    let completed = 0
    let thumbnailFailures = 0
    try {
      const added = []
      for (const file of files) {
        const { original, thumbnail } = await compressPainting(file)
        if (previewMode) {
          const imageUrl = URL.createObjectURL(original)
          const thumbnailUrl = thumbnail ? URL.createObjectURL(thumbnail) : imageUrl
          previewObjectUrls.current.push(imageUrl)
          if (thumbnailUrl !== imageUrl) previewObjectUrls.current.push(thumbnailUrl)
          added.push({
            id: `local-${crypto.randomUUID()}`,
            title: titleFromFile(file),
            image_url: imageUrl,
            thumbnail_url: thumbnailUrl,
          })
        } else {
          const item = await uploadPainting(original, titleFromFile(file), undefined, thumbnail)
          added.push(item)
          if (item.thumbnail_failed) thumbnailFailures += 1
        }
        completed += 1
        setUploadMessage(`已处理 ${completed}/${files.length} 张`)
      }
      setPaintings((items) => [...added.reverse(), ...items])
      setActiveIndex(0)
      setUploadMessage(previewMode ? '作品已加入本地预览。' : thumbnailFailures
        ? `作品已添加，其中 ${thumbnailFailures} 张缩略图未保存，将显示原图。`
        : '作品已添加。')
    } catch (uploadError) {
      setError(uploadError.message || '作品上传失败。')
    } finally {
      setUploading(false)
    }
  }

  function finishSwipe(event) {
    if (touchStartX.current === null) return
    const delta = event.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(delta) > 45) move(delta < 0 ? 1 : -1)
  }

  function openLarge(index) {
    setActiveIndex(index)
    setLightboxOpen(true)
  }

  async function saveDetails(id, details) {
    const updated = previewMode ? { id, ...details } : await updatePaintingDetails(id, details)
    setPaintings((items) => items.map((item) => item.id === id ? { ...item, ...updated } : item))
  }

  function handleGalleryKey(event) {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      move(-1)
    }
  }

  const current = paintings[activeIndex]

  return (
    <main className="record-page paintings-page">
      <PageTopbar back="/" backLabel="返回主页" />
      <div className="paintings-content">
        <header className="paintings-heading">
          <span className="paintings-eyebrow">DRAWN MOMENTS</span>
          <h1>绘画作品集 <span>| Paintings</span></h1>
          <HelpHint align="start">站长是业余的，轻喷💦</HelpHint>
        </header>

        {canManage && (
          <section className="painting-manager" aria-labelledby="painting-manager-title">
            <div>
              <span className="painting-manager-mark" aria-hidden="true">✳</span>
              <div>
                <h2 id="painting-manager-title">添加作品</h2>
                {previewMode ? (
                  <p>本地交互预览，上传的图片不会保存到网站。</p>
                ) : (
                  <HelpHint align="start">只有站长账号可以添加作品。</HelpHint>
                )}
              </div>
            </div>
            <label className="painting-upload-button">
              {uploading ? '正在添加…' : '选择图片'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={uploading}
                onChange={addFiles}
              />
            </label>
          </section>
        )}

        {uploadMessage && <p className="painting-upload-message" role="status">{uploadMessage}</p>}
        {error && <p className="painting-error" role="alert">{error}</p>}

        {loading ? (
          <div className="painting-empty" role="status">正在读取作品…</div>
        ) : current ? (
          <section className="painting-gallery" aria-label="绘画作品浏览">
            <div
              className="painting-stage"
              onTouchStart={(event) => { touchStartX.current = event.touches[0].clientX }}
              onTouchEnd={finishSwipe}
              onKeyDown={handleGalleryKey}
              ref={gallery}
              role="region"
              aria-roledescription="轮播"
              aria-label={`${current.title}，第 ${activeIndex + 1} 张，共 ${paintings.length} 张`}
              tabIndex={0}
            >
              <div
                className="painting-track"
                style={{ transform: `translateX(-${activeIndex * 100}%)` }}
              >
                {paintings.map((painting, index) => (
                  <figure className="painting-slide" key={painting.id}>
                    <button
                      className="painting-image-button"
                      type="button"
                      onClick={() => openLarge(index)}
                      aria-label={`点击查看大图：${painting.title}`}
                    >
                      {(index === activeIndex || index === (activeIndex + 1) % paintings.length || index === (activeIndex - 1 + paintings.length) % paintings.length) && (
                        <img src={painting.thumbnail_url || painting.image_url} alt={painting.title} draggable="false" decoding="async" />
                      )}
                      <span className="painting-zoom-hint" aria-hidden="true">放大</span>
                    </button>
                    <figcaption>
                      <span>{painting.title}</span>
                      <small>{String(index + 1).padStart(2, '0')} / {String(paintings.length).padStart(2, '0')}</small>
                    </figcaption>
                  </figure>
                ))}
              </div>
              {paintings.length > 1 && (
                <>
                  <button className="painting-arrow is-previous" type="button" onClick={() => move(-1)} aria-label="上一幅作品">←</button>
                  <button className="painting-arrow is-next" type="button" onClick={() => move(1)} aria-label="下一幅作品">→</button>
                </>
              )}
            </div>
            {paintings.length > 1 && (
              <div className="painting-controls">
                <div className="painting-dots" aria-label="选择作品">
                  {paintings.map((painting, index) => (
                    <button
                      className={index === activeIndex ? 'is-active' : ''}
                      key={painting.id}
                      type="button"
                      onClick={() => setActiveIndex(index)}
                      aria-label={`查看第 ${index + 1} 张作品`}
                      aria-current={index === activeIndex ? 'true' : undefined}
                    />
                  ))}
                </div>
                <span aria-live="polite">{activeIndex + 1} / {paintings.length}</span>
              </div>
            )}
            <PaintingDetails key={current.id} painting={current} canManage={canManage} onSave={saveDetails} />
          </section>
        ) : (
          <div className="painting-empty" role={error ? 'status' : undefined}>
            <span className="painting-empty-flower" aria-hidden="true">✳</span>
            <strong>{error ? '作品暂时无法读取' : '作品集正在准备中'}</strong>
            <span>{error || '站长添加作品后，就可以在这里浏览。'}</span>
            {error && <button type="button" onClick={() => window.location.reload()}>重试</button>}
          </div>
        )}
      </div>

      <dialog
        className="painting-lightbox"
        ref={lightbox}
        aria-label="绘画作品大图"
        onCancel={(event) => { event.preventDefault(); setLightboxOpen(false) }}
        onClick={(event) => { if (event.target === lightbox.current) setLightboxOpen(false) }}
      >
        {current && lightboxOpen && (
          <>
            <div className="painting-lightbox-toolbar">
              <span>{current.title}</span>
              <button type="button" aria-label="关闭大图" onClick={() => setLightboxOpen(false)}>×</button>
            </div>
            <img src={current.image_url} alt={current.title} />
            {paintings.length > 1 && (
              <div className="painting-lightbox-controls">
                <button type="button" onClick={() => move(-1)} aria-label="上一幅作品">←</button>
                <span>{activeIndex + 1} / {paintings.length}</span>
                <button type="button" onClick={() => move(1)} aria-label="下一幅作品">→</button>
              </div>
            )}
          </>
        )}
      </dialog>
    </main>
  )
}
