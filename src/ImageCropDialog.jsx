import { useEffect, useRef, useState } from 'react'

const cropFrames = {
  avatar: { label: '头像 · 1:1', width: 640, height: 640, outputWidth: 512, outputHeight: 512 },
  desktop: { label: '电脑壁纸 · 16:9', width: 960, height: 540, outputWidth: 1600, outputHeight: 900 },
  mobile: { label: '手机壁纸 · 9:16', width: 540, height: 960, outputWidth: 900, outputHeight: 1600 },
}

function geometryFor(image, frame, zoom, position) {
  const scale = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight) * zoom
  const cropWidth = frame.width / scale
  const cropHeight = frame.height / scale
  const maxX = Math.max(0, image.naturalWidth - cropWidth)
  const maxY = Math.max(0, image.naturalHeight - cropHeight)
  return {
    scale,
    cropWidth,
    cropHeight,
    sourceX: maxX * position.x,
    sourceY: maxY * position.y,
    drawWidth: image.naturalWidth * scale,
    drawHeight: image.naturalHeight * scale,
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

export default function ImageCropDialog({ sourceFile, kind, onCancel, onConfirm }) {
  const dialog = useRef(null)
  const canvas = useRef(null)
  const drag = useRef(null)
  const [image, setImage] = useState(null)
  const [imageError, setImageError] = useState('')
  const [mode, setMode] = useState(kind === 'wallpaper' ? 'desktop' : 'avatar')
  const [zoom, setZoom] = useState({ avatar: 1, desktop: 1, mobile: 1 })
  const [position, setPosition] = useState({
    avatar: { x: 0.5, y: 0.5 },
    desktop: { x: 0.5, y: 0.5 },
    mobile: { x: 0.5, y: 0.5 },
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const frame = cropFrames[mode]
  const currentZoom = zoom[mode]
  const currentPosition = position[mode]

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => {
      if (element?.open) element.close()
    }
  }, [])

  useEffect(() => {
    if (!sourceFile) return undefined
    const url = URL.createObjectURL(sourceFile)
    const nextImage = new Image()
    nextImage.onload = () => {
      setImage(nextImage)
      setImageError('')
    }
    nextImage.onerror = () => setImageError('这张图片无法读取，请换一张图片。')
    nextImage.src = url
    return () => URL.revokeObjectURL(url)
  }, [sourceFile])

  useEffect(() => {
    if (!image || !canvas.current) return
    const target = canvas.current
    target.width = frame.width
    target.height = frame.height
    const context = target.getContext('2d')
    if (!context) {
      setImageError('当前浏览器无法处理图片。')
      return
    }
    const geometry = geometryFor(image, frame, currentZoom, currentPosition)
    context.clearRect(0, 0, target.width, target.height)
    context.drawImage(
      image,
      -geometry.sourceX * geometry.scale,
      -geometry.sourceY * geometry.scale,
      geometry.drawWidth,
      geometry.drawHeight,
    )
  }, [image, frame, currentZoom, currentPosition])

  function handlePointerDown(event) {
    if (!image) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      position: currentPosition,
    }
  }

  function handlePointerMove(event) {
    const start = drag.current
    if (!start || start.id !== event.pointerId || !canvas.current || !image) return
    const bounds = canvas.current.getBoundingClientRect()
    const geometry = geometryFor(image, frame, currentZoom, currentPosition)
    const overflowX = Math.max(0, geometry.drawWidth - frame.width)
    const overflowY = Math.max(0, geometry.drawHeight - frame.height)
    const dx = (event.clientX - start.x) * (frame.width / bounds.width)
    const dy = (event.clientY - start.y) * (frame.height / bounds.height)
    setPosition((old) => ({
      ...old,
      [mode]: {
        x: overflowX ? Math.max(0, Math.min(1, start.position.x - dx / overflowX)) : 0.5,
        y: overflowY ? Math.max(0, Math.min(1, start.position.y - dy / overflowY)) : 0.5,
      },
    }))
  }

  function handlePointerUp(event) {
    if (drag.current?.id === event.pointerId) drag.current = null
  }

  async function createCrop(targetMode) {
    const targetFrame = cropFrames[targetMode]
    const targetZoom = zoom[targetMode]
    const targetPosition = position[targetMode]
    const geometry = geometryFor(image, targetFrame, targetZoom, targetPosition)
    const output = document.createElement('canvas')
    output.width = targetFrame.outputWidth
    output.height = targetFrame.outputHeight
    const context = output.getContext('2d')
    if (!context) throw new Error('当前浏览器无法处理图片。')
    context.drawImage(
      image,
      geometry.sourceX,
      geometry.sourceY,
      geometry.cropWidth,
      geometry.cropHeight,
      0,
      0,
      output.width,
      output.height,
    )

    const maxBytes = kind === 'avatar' ? 2 * 1024 * 1024 : 8 * 1024 * 1024
    const webp = await canvasBlob(output, 'image/webp', 0.88)
    if (webp?.type === 'image/webp' && webp.size <= maxBytes) return webp
    const fallbackType = kind === 'avatar' ? 'image/png' : 'image/jpeg'
    const fallback = await canvasBlob(output, fallbackType, 0.86)
    if (!fallback || fallback.size > maxBytes)
      throw new Error(kind === 'avatar' ? '裁剪后的头像仍超过 2 MB。' : '裁剪后的壁纸仍超过 8 MB。')
    return fallback
  }

  async function finishCrop() {
    if (!image || busy) return
    setBusy(true)
    setMessage('正在生成裁剪图片…')
    try {
      if (kind === 'wallpaper') {
        const desktop = await createCrop('desktop')
        const mobile = await createCrop('mobile')
        await onConfirm({ desktop, mobile })
      } else {
        await onConfirm(await createCrop('avatar'))
      }
    } catch (error) {
      setMessage(error.message || '图片处理失败，请重试。')
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      className="image-crop-dialog"
      aria-labelledby="image-crop-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onCancel()
      }}
      onClick={(event) => {
        if (event.target === dialog.current && !busy) onCancel()
      }}
    >
      <button
        type="button"
        className="image-crop-close"
        aria-label="取消裁剪"
        disabled={busy}
        onClick={onCancel}
      >
        ×
      </button>
      <h2 id="image-crop-title">{kind === 'wallpaper' ? '裁剪背景图片' : '裁剪头像'}</h2>
      <p className="image-crop-hint">
        {kind === 'wallpaper'
          ? '分别调整电脑和手机画面；拖动图片选取位置。'
          : '拖动图片调整头像位置，圆形头像会使用方形裁剪结果。'}
      </p>
      {kind === 'wallpaper' && (
        <div className="image-crop-modes" role="group" aria-label="壁纸设备比例">
          {['desktop', 'mobile'].map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
            >
              {cropFrames[key].label}
            </button>
          ))}
        </div>
      )}
      <div className={`image-crop-frame image-crop-frame-${mode}`}>
        {image ? (
          <canvas
            ref={canvas}
            aria-label={`${frame.label}裁剪预览`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        ) : (
          <span role="status">正在读取图片…</span>
        )}
      </div>
      {imageError && <p className="image-crop-message" role="alert">{imageError}</p>}
      <label className="image-crop-zoom">
        <span>缩放</span>
        <input
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={currentZoom}
          onChange={(event) => setZoom((old) => ({ ...old, [mode]: Number(event.target.value) }))}
        />
      </label>
      {message && <p className="image-crop-message" role="status">{message}</p>}
      <div className="image-crop-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button type="button" disabled={!image || !!imageError || busy} onClick={finishCrop}>
          {busy ? '正在处理…' : '裁剪并使用'}
        </button>
      </div>
    </dialog>
  )
}
