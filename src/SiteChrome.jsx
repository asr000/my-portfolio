import { useEffect, useRef, useState } from 'react'
import { useAuth } from './lib/authContext.js'
import { loadAppearance, saveAppearance } from './lib/appearanceStore.js'
import './siteChrome.css'

const defaultAppearance = { image: null, avatar: null, opacity: 0.3, clarity: 92 }

async function prepareWallpaper(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('请选择 JPEG、PNG 或 WebP 图片。')
  if (file.size > 12 * 1024 * 1024)
    throw new Error('背景图片不能超过 12 MB。')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const encode = (type, quality) =>
      new Promise((resolve) => canvas.toBlob(resolve, type, quality))
    const webp = await encode('image/webp', 0.82)
    if (webp?.type === 'image/webp' && webp.size <= 8 * 1024 * 1024)
      return webp
    const jpeg = await encode('image/jpeg', 0.78)
    if (!jpeg) throw new Error('无法处理这张图片，请换一张图片。')
    if (jpeg.size > 8 * 1024 * 1024)
      throw new Error('处理后的背景图片仍超过 8 MB。')
    return jpeg
  } finally {
    bitmap.close()
  }
}

async function prepareAvatar(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('请选择 JPEG、PNG 或 WebP 图片。')
  if (file.size > 12 * 1024 * 1024)
    throw new Error('头像图片不能超过 12 MB。')
  const bitmap = await createImageBitmap(file)
  try {
    const edge = Math.min(bitmap.width, bitmap.height)
    const x = (bitmap.width - edge) / 2
    const y = (bitmap.height - edge) / 2
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    canvas.getContext('2d').drawImage(bitmap, x, y, edge, edge, 0, 0, 512, 512)
    const avatar = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.84),
    )
    if (!avatar) throw new Error('无法处理这张头像图片，请换一张图片。')
    if (avatar.size > 2 * 1024 * 1024)
      throw new Error('处理后的头像仍超过 2 MB。')
    return avatar
  } finally {
    bitmap.close()
  }
}

function applyWallpaper(url, opacity, clarity) {
  const style = document.documentElement.style
  style.setProperty('--wallpaper-image', url ? 'url("' + url + '")' : 'none')
  style.setProperty('--wallpaper-opacity', String(opacity))
  style.setProperty('--wallpaper-blur', ((100 - clarity) * 0.08).toFixed(1) + 'px')
}

const links = [
  { zh: '主页', en: 'Home', href: '/' },
  { zh: '记录', en: 'Record', signedIn: '/?view=records', guest: '/?view=showcase' },
  { zh: '朋链', en: 'Friends', href: '/?view=friends' },
  { zh: '绘画作品集', en: 'Paintings', href: '/?view=paintings' },
  { zh: '搜索', en: 'Search', signedIn: '/?view=search', guest: '/?view=showcase' },
  { zh: '关于我', en: 'About', href: '/#about' },
]

export default function SiteChrome() {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [appearance, setAppearance] = useState(defaultAppearance)
  const [loadedFor, setLoadedFor] = useState(null)
  const [imageUrl, setImageUrl] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [message, setMessage] = useState('')
  const dialog = useRef(null)

  useEffect(() => {
    let active = true
    if (auth.status === 'loading') {
      setLoadedFor(null)
      setAppearance(defaultAppearance)
      return () => { active = false }
    }
    if (!auth.user) {
      setLoadedFor('anonymous')
      setAppearance(defaultAppearance)
      return () => { active = false }
    }

    const userId = auth.user.id
    setLoadedFor(null)
    setAppearance(defaultAppearance)
    loadAppearance(userId)
      .then((saved) => {
        if (!active) return
        setAppearance({
          ...defaultAppearance,
          ...saved,
          image: saved?.image || null,
        })
        setLoadedFor(userId)
      })
      .catch((error) => {
        if (!active) return
        setMessage(error.message || '无法读取背景设置。')
        setLoadedFor(userId)
      })
    return () => { active = false }
  }, [auth.status, auth.user?.id])

  useEffect(() => {
    if (!appearance.image) {
      setImageUrl('')
      return undefined
    }
    const url = URL.createObjectURL(appearance.image)
    setImageUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [appearance.image])

  useEffect(() => {
    if (!appearance.avatar) {
      setAvatarUrl('')
      return undefined
    }
    const url = URL.createObjectURL(appearance.avatar)
    setAvatarUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [appearance.avatar])

  useEffect(() => {
    if (
      auth.status !== 'ready' ||
      !auth.user ||
      loadedFor !== auth.user.id
    ) return undefined
    const timer = setTimeout(() => {
      saveAppearance(auth.user.id, appearance).catch((error) =>
        setMessage(error.message || '背景设置保存失败。'),
      )
    }, 250)
    return () => clearTimeout(timer)
  }, [appearance, auth.status, auth.user?.id, loadedFor])

  const isReady = auth.status !== 'loading'
  const ownerTheme = isReady && !auth.user
  const isLoaded = auth.user && loadedFor === auth.user.id
  const wallpaperUrl = ownerTheme
    ? '/owner-wallpaper.svg'
    : isLoaded && imageUrl
  const opacity = ownerTheme ? 0.28 : appearance.opacity
  const clarity = ownerTheme ? 88 : appearance.clarity

  useEffect(() => {
    applyWallpaper(wallpaperUrl, opacity, clarity)
    return () => applyWallpaper('', 0, 100)
  }, [wallpaperUrl, opacity, clarity])

  function openSettings() {
    setMessage('')
    dialog.current?.showModal()
  }

  async function chooseBackground(event) {
    const picker = event.currentTarget
    const file = picker.files?.[0]
    picker.value = ''
    if (!file) return
    try {
      const image = await prepareWallpaper(file)
      setAppearance((old) => ({ ...old, image }))
      setMessage('背景已更换。')
    } catch (error) {
      setMessage(error.message || '背景图片处理失败。')
    }
  }

  async function chooseAvatar(event) {
    const picker = event.currentTarget
    const file = picker.files?.[0]
    picker.value = ''
    if (!file) return
    try {
      const avatar = await prepareAvatar(file)
      setAppearance((old) => ({ ...old, avatar }))
      setMessage('头像已更换。')
    } catch (error) {
      setMessage(error.message || '头像图片处理失败。')
    }
  }

  function changePreference(name, value) {
    setAppearance((old) => ({ ...old, [name]: value }))
    setMessage('')
  }

  return (
    <>
      <nav
        className={'orbit-nav' + (open ? ' is-open' : '')}
        aria-label="快捷导航"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
        }}
      >
        <button
          className="orbit-avatar"
          type="button"
          aria-label={open ? '收起导航' : '展开导航'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <img src={avatarUrl || '/apple-touch-icon.png'} alt="" />
        </button>
        {auth.status === 'ready' && auth.user && (
          <button
            className="orbit-settings"
            type="button"
            aria-label="背景设置"
            title="背景设置"
            onClick={openSettings}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 19 15.5 7.5a2.1 2.1 0 0 1 3 3L7 22H4v-3Z" />
              <path d="m13.8 9.2 3 3M4 5h6M7 2v6" />
            </svg>
          </button>
        )}
        <div className="orbit-links" aria-hidden={!open}>
          {links.map((item) => (
            <a
              key={item.en}
              href={item.href || (auth.user ? item.signedIn : item.guest)}
              tabIndex={open ? 0 : -1}
              onClick={() => setOpen(false)}
            >
              <span>{item.zh}</span>
              <small>{item.en}</small>
            </a>
          ))}
        </div>
      </nav>

      {auth.status === 'ready' && auth.user && (
        <dialog ref={dialog} className="appearance-dialog" aria-labelledby="appearance-title">
          <button
            className="appearance-close"
            type="button"
            aria-label="关闭"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
          <h2 id="appearance-title">背景设置</h2>
          <label className="appearance-upload">
            选择背景图片
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={chooseBackground}
            />
          </label>
          <div className="appearance-avatar-row">
            <img src={avatarUrl || '/apple-touch-icon.png'} alt="当前头像" />
            <label className="appearance-upload appearance-avatar-upload">
              上传头像
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={chooseAvatar}
              />
            </label>
            <button
              className="secondary-button"
              type="button"
              disabled={!appearance.avatar}
              onClick={() => {
                changePreference('avatar', null)
                setMessage('已恢复默认头像。')
              }}
            >
              恢复默认
            </button>
          </div>
          <label className="appearance-range">
            <span>透明度 <output>{Math.round(appearance.opacity * 100)}%</output></span>
            <input
              type="range"
              min="10"
              max="70"
              value={Math.round(appearance.opacity * 100)}
              onChange={(event) =>
                changePreference('opacity', Number(event.target.value) / 100)
              }
            />
          </label>
          <label className="appearance-range">
            <span>清晰度 <output>{appearance.clarity}%</output></span>
            <input
              type="range"
              min="0"
              max="100"
              value={appearance.clarity}
              onChange={(event) =>
                changePreference('clarity', Number(event.target.value))
              }
            />
          </label>
          <div className="appearance-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={!appearance.image}
              onClick={() => {
                changePreference('image', null)
                setMessage('已移除背景图片。')
              }}
            >
              移除背景
            </button>
            <button type="button" onClick={() => dialog.current?.close()}>
              完成
            </button>
          </div>
          {message && <p className="appearance-message" role="status">{message}</p>}
        </dialog>
      )}
    </>
  )
}
