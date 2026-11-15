import { useEffect, useId, useRef, useState } from 'react'
import './helpHint.css'

export default function HelpHint({ children, align = 'start', label = '查看说明' }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <span className={`help-hint help-hint--${align}`} ref={root}>
      <button
        className="help-hint-trigger"
        type="button"
        aria-label={open ? '收起说明' : label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="4 2 16 21" fill="none" aria-hidden="true">
          <path d="M9 18h6m-5 3h4m-5.1-5.7A6 6 0 1 1 15.1 15.3c-.7.6-1.1 1.3-1.1 2.2h-4c0-.9-.4-1.6-1.1-2.2Z" />
        </svg>
      </button>
      <span className="help-hint-popover" id={id} role="note" hidden={!open}>
        {children}
      </span>
    </span>
  )
}
