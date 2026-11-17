import { useEffect, useRef, useState } from 'react'
import { useCover } from './lib/useCover.js'

export default function RecordCoverHero({ coverPath, publicAccess = false }) {
  const cover = useCover(coverPath, { publicAccess })
  const displayedUrl = cover.url
  const [open, setOpen] = useState(false)
  const dialog = useRef(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return undefined
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
    return () => {
      if (element.open) element.close()
    }
  }, [open])

  if (!coverPath) return null

  return (
    <>
      <button
        className="record-cover-hero"
        type="button"
        disabled={!displayedUrl || cover.error}
        aria-label="点击查看封面大图"
        onClick={() => setOpen(true)}
      >
        {displayedUrl && !cover.error ? (
          <img src={displayedUrl} alt="文章封面" />
        ) : (
          <span>{cover.error ? '封面暂不可用' : '封面加载中…'}</span>
        )}
        {displayedUrl && <span className="record-cover-open-hint">查看大图</span>}
      </button>
      <dialog
        ref={dialog}
        className="record-cover-lightbox"
        aria-label="文章封面大图"
        onCancel={(event) => {
          event.preventDefault()
          setOpen(false)
        }}
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false)
        }}
      >
        <button
          type="button"
          className="record-cover-lightbox-close"
          aria-label="关闭大图"
          onClick={() => setOpen(false)}
        >
          ×
        </button>
        {displayedUrl && <img src={displayedUrl} alt="文章封面大图" />}
      </dialog>
    </>
  )
}
