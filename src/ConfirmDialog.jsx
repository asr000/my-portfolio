import { useEffect, useRef } from 'react'

export default function ConfirmDialog({
  title,
  children,
  onConfirm,
  onClose,
  busy,
  confirmLabel = '确认',
}) {
  const dialog = useRef(null)
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => {
      element.close()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <h2 id="confirm-title">{title}</h2>
      <div>{children}</div>
      <div className="actions">
        <button disabled={busy} onClick={onClose} autoFocus>
          取消
        </button>
        <button className="danger-button" disabled={busy} onClick={onConfirm}>
          {busy ? '正在处理…' : confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
