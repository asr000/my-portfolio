import { useEffect, useState } from 'react'

const storageKey = 'portfolio:theme'
const currentTheme = () =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  const color = document.querySelector('meta[name="theme-color"]')
  if (color) color.content = theme === 'dark' ? '#1e3a52' : '#fbf7ef'
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme)
  useEffect(() => {
    function sync(event) {
      if (event.key !== storageKey && event.key !== null) return
      const next = event.newValue === 'dark' ? 'dark' : 'light'
      applyTheme(next)
      setTheme(next)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light'
    applyTheme(next)
    setTheme(next)
    try {
      localStorage.setItem(storageKey, next)
    } catch {
      /* Switching still works if storage is unavailable. */
    }
  }
  const label = theme === 'light' ? '切换为深色模式' : '切换为亮色模式'
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {theme === 'light' ? (
          <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" />
          </>
        )}
      </svg>
      <span>{theme === 'light' ? '深色' : '亮色'}</span>
    </button>
  )
}
