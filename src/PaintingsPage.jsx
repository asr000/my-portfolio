import { useEffect, useRef, useState } from 'react'
import { useAuth } from './lib/authContext.js'
import PageTopbar from './PageTopbar.jsx'
import { listPaintings, uploadPainting } from './lib/paintingsApi.js'
import HelpHint from './HelpHint.jsx'
import './paintingsPage.css'

function svgImage(markup) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
}

const previewPaintings = [
  {
    id: 'preview-sunset',
    title: '晚风写给山海',
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
    const toBlob = (type, quality) =>
      new Promise((resolve) => canvas.toBlob(resolve, type, quality))
    const webp = await toBlob('image/webp', 0.88)
    if (webp?.type === 'image/webp' && webp.size <= 7 * 1024 * 1024)
      return webp
    const jpeg = await toBlob('image/jpeg', 0.84)
    if (!jpeg || jpeg.size > 7 * 1024 * 1024)
      throw new Error('压缩后的图片仍超过 7 MB。')
    return jpeg
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
    try {
      const added = []
      for (const file of files) {
        const image = await compressPainting(file)
        if (previewMode) {
          const imageUrl = URL.createObjectURL(image)
          previewObjectUrls.current.push(imageUrl)
          added.push({
            id: `local-${crypto.randomUUID()}`,
            title: titleFromFile(file),
            image_url: imageUrl,
          })
        } else {
          const item = await uploadPainting(image, titleFromFile(file))
          added.push(item)
        }
        completed += 1
        setUploadMessage(`已处理 ${completed}/${files.length} 张`)
      }
      setPaintings((items) => [...added.reverse(), ...items])
      setActiveIndex(0)
      setUploadMessage(previewMode ? '作品已加入本地预览。' : '作品已添加。')
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
                      <img src={painting.image_url} alt={painting.title} draggable="false" />
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
        {current && (
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
