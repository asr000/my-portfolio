import { useEffect, useRef, useState } from 'react'
import { useAuth } from './lib/authContext.js'
import ImageCropDialog from './ImageCropDialog.jsx'
import {
  loadAppearance,
  removeAppearanceImage,
  saveAppearance,
  uploadAppearanceImage,
} from './lib/appearanceStore.js'
import './siteChrome.css'

const defaultUserAppearance = {
  wallpaperUrl: null,
  mobileWallpaperUrl: null,
  avatarUrl: null,
  opacity: 0.3,
  clarity: 92,
  themeColor: null,
}
const defaultOwnerAppearance = {
  ...defaultUserAppearance,
  opacity: 0.28,
  clarity: 88,
}
const defaultThemeColor = '#925063'

function fromServer(value, defaults) {
  return {
    ...defaults,
    wallpaperUrl: value?.wallpaper_url || null,
    mobileWallpaperUrl: value?.mobile_wallpaper_url || null,
    avatarUrl: value?.avatar_url || null,
    opacity: Number.isFinite(Number(value?.opacity)) ? Number(value.opacity) : defaults.opacity,
    clarity: Number.isFinite(Number(value?.clarity)) ? Number(value.clarity) : defaults.clarity,
    themeColor: value?.theme_color || null,
  }
}

function applyWallpaper(url, mobileUrl, opacity, clarity) {
  const style = document.documentElement.style
  style.setProperty('--wallpaper-image', url ? `url("${url}")` : 'none')
  if (mobileUrl) style.setProperty('--wallpaper-image-mobile', `url("${mobileUrl}")`)
  else style.removeProperty('--wallpaper-image-mobile')
  style.setProperty('--wallpaper-opacity', String(opacity))
  style.setProperty('--wallpaper-blur', `${((100 - clarity) * 0.08).toFixed(1)}px`)
}

function applyThemeColor(color) {
  const style = document.documentElement.style
  if (!color) {
    for (const name of ['--accent', '--link', '--link-hover', '--nav-hover', '--focus', '--button-bg', '--button-hover'])
      style.removeProperty(name)
    return
  }
  style.setProperty('--accent', color)
  style.setProperty('--link', color)
  style.setProperty('--link-hover', `color-mix(in srgb, ${color} 78%, var(--text-strong))`)
  style.setProperty('--nav-hover', `color-mix(in srgb, ${color} 78%, var(--text-strong))`)
  style.setProperty('--focus', color)
  style.setProperty('--button-bg', `color-mix(in srgb, ${color} 24%, var(--surface-panel))`)
  style.setProperty('--button-hover', `color-mix(in srgb, ${color} 36%, var(--surface-panel))`)
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
  const previewMode = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('appearancePreview') === '1'
  const [open, setOpen] = useState(false)
  const [appearance, setAppearance] = useState(defaultUserAppearance)
  const [loadedFor, setLoadedFor] = useState(null)
  const [message, setMessage] = useState('')
  const [cropRequest, setCropRequest] = useState(null)
  const dialog = useRef(null)
  const previewUrls = useRef([])
  const pendingPublicAppearance = useRef(null)

  useEffect(() => {
    if (previewMode) {
      setAppearance(defaultUserAppearance)
      setLoadedFor('preview')
      return undefined
    }
    if (auth.status === 'loading') {
      if (!pendingPublicAppearance.current) {
        const pending = loadAppearance({ publicView: true })
          .then((saved) => {
            // Start downloading the guest wallpaper while authentication is still pending.
            if (pendingPublicAppearance.current === pending) {
              const mobile = window.matchMedia('(max-width: 700px)').matches
              const url = (mobile && saved?.mobile_wallpaper_url) || saved?.wallpaper_url
              if (url) {
                const image = new Image()
                image.src = url
              }
            }
            return saved
          })
          .catch(() => null)
        pendingPublicAppearance.current = pending
      }
      setLoadedFor(null)
      setAppearance(defaultUserAppearance)
      return undefined
    }

    const controller = new AbortController()
    let active = true
    const userId = auth.user?.id
    const defaults = userId ? defaultUserAppearance : defaultOwnerAppearance
    setLoadedFor(null)
    setAppearance(defaults)
    const prefetched = !userId ? pendingPublicAppearance.current : null
    pendingPublicAppearance.current = null
    const request = prefetched
      ? prefetched.then((result) => result || loadAppearance({ publicView: true, signal: controller.signal }))
      : loadAppearance({ publicView: !userId, signal: controller.signal })
    request
      .then((saved) => {
        if (!active) return
        setAppearance(fromServer(saved, defaults))
        setLoadedFor(userId || 'anonymous')
      })
      .catch((error) => {
        if (!active || controller.signal.aborted) return
        setAppearance(defaults)
        setLoadedFor(userId || 'anonymous')
        if (userId) setMessage(error.message || '无法读取主题设置。')
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [auth.status, auth.user?.id, previewMode])

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url)
  }, [])

  useEffect(() => {
    const isOwnerTheme = !previewMode && auth.status !== 'loading' && !auth.user
    const isCurrentUserLoaded = previewMode
      ? loadedFor === 'preview'
      : !!auth.user && loadedFor === auth.user.id
    const isOwnerLoaded = isOwnerTheme && loadedFor === 'anonymous'
    const ready = isCurrentUserLoaded || isOwnerLoaded
    const wallpaper = ready
      ? appearance.wallpaperUrl || (isOwnerTheme ? '/owner-wallpaper.svg' : null)
      : null
    applyWallpaper(wallpaper, ready ? appearance.mobileWallpaperUrl : null, appearance.opacity, appearance.clarity)
    applyThemeColor(ready ? appearance.themeColor : null)
    return () => {
      applyWallpaper('', null, 0, 100)
      applyThemeColor(null)
    }
  }, [appearance, auth.status, auth.user?.id, loadedFor, previewMode])

  useEffect(() => {
    if (
      previewMode || auth.status !== 'ready' || !auth.user ||
      loadedFor !== auth.user.id
    ) return undefined
    const timer = setTimeout(() => {
      saveAppearance({
        opacity: appearance.opacity,
        clarity: appearance.clarity,
        theme_color: appearance.themeColor,
      }).then(() => setMessage('主题设置已同步到账号。'))
        .catch((error) => setMessage(error.message || '主题设置保存失败。'))
    }, 450)
    return () => clearTimeout(timer)
  }, [appearance.opacity, appearance.clarity, appearance.themeColor, auth.status, auth.user?.id, loadedFor, previewMode])

  useEffect(() => {
    if (!previewMode) return undefined
    const frame = requestAnimationFrame(() => dialog.current?.showModal())
    return () => cancelAnimationFrame(frame)
  }, [previewMode])

  const isReady = auth.status !== 'loading'
  const canManageAppearance = previewMode || (isReady && !!auth.user)
  const ownerTheme = isReady && !auth.user && !previewMode
  const avatarReady = previewMode || !auth.user || loadedFor === auth.user.id
  const avatarUrl = avatarReady ? appearance.avatarUrl : null

  function openSettings() {
    setMessage('')
    dialog.current?.showModal()
  }

  function changePreference(name, value) {
    setAppearance((old) => ({ ...old, [name]: value }))
    setMessage(previewMode ? '本地预览中，设置尚未上传。' : '')
  }

  async function chooseImage(event, kind) {
    const picker = event.currentTarget
    const file = picker.files?.[0]
    picker.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setMessage('请选择 JPEG、PNG 或 WebP 图片。')
      return
    }
    if (file.size > 12 * 1024 * 1024) {
      setMessage('图片不能超过 12 MB。')
      return
    }
    setMessage('')
    setCropRequest({ file, kind })
  }

  async function acceptCrop(result) {
    const kind = cropRequest?.kind
    if (!kind) return
    if (kind === 'avatar') {
      if (previewMode) {
        const url = URL.createObjectURL(result)
        previewUrls.current.push(url)
        setAppearance((old) => ({ ...old, avatarUrl: url }))
        setMessage('本地预览中，头像尚未上传。')
      } else {
        const uploaded = await uploadAppearanceImage('avatar', result)
        setAppearance((old) => ({ ...old, avatarUrl: uploaded.avatar_url || old.avatarUrl }))
        setMessage('头像已上传到账号，其他设备刷新后即可看到。')
      }
    } else if (previewMode) {
      const desktopUrl = URL.createObjectURL(result.desktop)
      const mobileUrl = URL.createObjectURL(result.mobile)
      previewUrls.current.push(desktopUrl, mobileUrl)
      setAppearance((old) => ({ ...old, wallpaperUrl: desktopUrl, mobileWallpaperUrl: mobileUrl }))
      setMessage('本地预览中，壁纸尚未上传。')
    } else {
      const desktop = await uploadAppearanceImage('wallpaper', result.desktop)
      setAppearance((old) => ({ ...old, wallpaperUrl: desktop.wallpaper_url || old.wallpaperUrl }))
      const mobile = await uploadAppearanceImage('mobile-wallpaper', result.mobile)
      setAppearance((old) => ({
        ...old,
        wallpaperUrl: desktop.wallpaper_url || old.wallpaperUrl,
        mobileWallpaperUrl: mobile.mobile_wallpaper_url || old.mobileWallpaperUrl,
      }))
      setMessage('电脑和手机壁纸已同步到账号。')
    }
    setCropRequest(null)
  }

  async function removeImage(kind) {
    try {
      if (kind === 'wallpaper') {
        if (!previewMode) {
          await Promise.all([
            removeAppearanceImage('wallpaper'),
            removeAppearanceImage('mobile-wallpaper'),
          ])
        }
        setAppearance((old) => ({ ...old, wallpaperUrl: null, mobileWallpaperUrl: null }))
      } else {
        if (!previewMode) await removeAppearanceImage('avatar')
        setAppearance((old) => ({ ...old, avatarUrl: null }))
      }
      setMessage(previewMode ? '本地预览已恢复默认。' : '已从账号中移除图片。')
    } catch (error) {
      setMessage(error.message || '图片移除失败。')
    }
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
        {canManageAppearance && (
          <button
            className="orbit-settings"
            type="button"
            aria-label="背景与主题设置"
            title="背景与主题设置"
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

      {canManageAppearance && (
        <dialog ref={dialog} className="appearance-dialog" aria-labelledby="appearance-title">
          <button
            className="appearance-close"
            type="button"
            aria-label="关闭"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
          <h2 id="appearance-title">背景与主题</h2>
          {previewMode && (
            <p className="appearance-note">本地预览：图片和设置仅在当前页面生效，不会上传服务器。</p>
          )}
          {ownerTheme && (
            <p className="appearance-note">站长设置的背景和主题色也会显示给未登录访客。</p>
          )}
          <label className="appearance-upload">
            选择背景图片
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => chooseImage(event, 'wallpaper')}
            />
          </label>
          <div className="appearance-avatar-row">
            <img src={avatarUrl || '/apple-touch-icon.png'} alt="当前头像" />
            <label className="appearance-upload appearance-avatar-upload">
              上传头像
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => chooseImage(event, 'avatar')}
              />
            </label>
            <button
              className="secondary-button"
              type="button"
              disabled={!appearance.avatarUrl}
              onClick={() => removeImage('avatar')}
            >
              恢复默认
            </button>
          </div>
          <label className="appearance-theme-row">
            <span>主题色</span>
            <input
              type="color"
              value={appearance.themeColor || defaultThemeColor}
              onChange={(event) => changePreference('themeColor', event.target.value)}
              aria-label="选择主题色"
            />
            <button
              className="secondary-button"
              type="button"
              disabled={!appearance.themeColor}
              onClick={() => changePreference('themeColor', null)}
            >
              恢复默认
            </button>
          </label>
          <label className="appearance-range">
            <span>透明度 <output>{Math.round(appearance.opacity * 100)}%</output></span>
            <input
              type="range"
              min="10"
              max="100"
              value={Math.round(appearance.opacity * 100)}
              onChange={(event) => changePreference('opacity', Number(event.target.value) / 100)}
            />
          </label>
          <label className="appearance-range">
            <span>清晰度 <output>{appearance.clarity}%</output></span>
            <input
              type="range"
              min="0"
              max="100"
              value={appearance.clarity}
              onChange={(event) => changePreference('clarity', Number(event.target.value))}
            />
          </label>
          <div className="appearance-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={!appearance.wallpaperUrl}
              onClick={() => removeImage('wallpaper')}
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
      {cropRequest && (
        <ImageCropDialog
          sourceFile={cropRequest.file}
          kind={cropRequest.kind}
          onCancel={() => setCropRequest(null)}
          onConfirm={acceptCrop}
        />
      )}
    </>
  )
}
