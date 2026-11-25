import { lazy, Suspense, useState } from 'react'
import './App.css'
import Projects from './Projects.jsx'
import RecordDetail from './RecordDetail.jsx'
import NewRecord from './NewRecord.jsx'
import Login from './Login.jsx'
import EditRecord from './EditRecord.jsx'
import RecordsPage from './RecordsPage.jsx'
import SearchRecords from './SearchRecords.jsx'
import RecordTools, { CoverCleanup, TrashRecords } from './RecordTools.jsx'
import AuthProvider from './AuthProvider.jsx'
import { RequireAccount } from './AuthAccess.jsx'
import { useAuth } from './lib/authContext.js'
import { loginLink } from './lib/navigation.js'
import HomeHero from './HomeHero.jsx'
import HomeAbout from './HomeAbout.jsx'
import Account from './Account.jsx'
import PublicRecord from './PublicRecord.jsx'
import NoteWriteAccess from './NoteAccess.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import SiteChrome from './SiteChrome.jsx'
import FriendsPage from './FriendsPage.jsx'
import PaintingsPage from './PaintingsPage.jsx'
import RecordsLayout from './RecordsLayout.jsx'

const DataBackup = lazy(() => import('./DataBackup.jsx'))
const MarkdownHelp = lazy(() => import('./MarkdownHelp.jsx'))
const AuthPages = lazy(() => import('./AuthPages.jsx'))
const Invitations = lazy(() => import('./Invitations.jsx'))
const MarkdownContentPreview = lazy(() => import('./MarkdownContent.jsx'))

function CoverLoadingPreview() {
  const [finished, setFinished] = useState(false)
  return (
    <RecordsLayout publicPage title="封面加载动画预览" description="动画会持续播放，点击按钮查看加载完成后的效果。" back="/" backLabel="返回主页">
      <article className="record-article">
        <div className="record-cover-hero" style={{ cursor: 'default' }}>
          {!finished && <span className="cover-loading" aria-label="封面加载中" />}
          {finished && <img src="/apple-touch-icon.png" alt="示例封面" style={{ objectFit: 'contain' }} />}
        </div>
        <button type="button" onClick={() => setFinished((value) => !value)}>{finished ? '重新播放动画' : '模拟加载完成'}</button>
      </article>
    </RecordsLayout>
  )
}

function Header() {
  const auth = useAuth()
  return (
    <header className="site-header">
      <a className="logo" href="/">
        Re:代码生活
      </a>

      <nav aria-label="账号和外观">
        <a href={auth.user ? '/?view=account' : loginLink('/')}>
          {auth.status === 'loading' ? '账号' : auth.user ? '我的账号' : '登录'}
        </a>
        <ThemeToggle />
      </nav>
    </header>
  )
}

function Pages() {
  const auth = useAuth()
  const params = new URLSearchParams(window.location.search)
  const recordId = params.get('record')
  const publicId = params.get('show')
  const editId = params.get('edit')
  const isCreating = params.get('new') === '1'
  const isLoggingIn = params.get('login') === '1'
  const view = params.get('view')

  if (import.meta.env.DEV && params.get('coverLoadingPreview') === '1') return <CoverLoadingPreview />

  if (import.meta.env.DEV && params.get('markdownPreview') === '1')
    return (
      <RecordsLayout publicPage title="文章排版预览" description="查看文字、数学公式和代码的显示效果。" back="/" backLabel="返回主页">
        <article className="record-article">
          <Suspense fallback={<p>正在准备文章…</p>}>
            <MarkdownContentPreview content={'## 学习笔记\n\n正文支持**加粗**、列表和表格。\n\n勾股定理：$a^2 + b^2 = c^2$。\n\n```python\nprint("Hello, world!")\n```'} />
          </Suspense>
        </article>
      </RecordsLayout>
    )

  if (import.meta.env.DEV && params.get('articlePreview') === '1')
    return (
      <RecordsLayout
        publicPage
        title="文章阅读预览"
        description="这里仅预览正文底板；没有上传封面时，不会显示封面区域。"
        back="/"
        backLabel="返回主页"
      >
        <article className="record-article">
          <h1>文章正文</h1>
          <p className="record-meta">创建于 2026-11-17 · 阅读时间：2 分钟</p>
          <div className="markdown-body">
            <h2>清晰的阅读区域</h2>
            <p>
              文章内容现在放在独立底板上，底板会跟随浅色或深色主题变化。即使页面使用了自定义壁纸，正文和标题也能保持足够对比度。
            </p>
            <blockquote>
              这段引用用于预览不同文章元素在底板上的显示效果。
            </blockquote>
            <p>这条本地预览没有封面，因此顶部不会出现封面图片或空白封面框。</p>
          </div>
        </article>
      </RecordsLayout>
    )

  if (
    auth.recovery ||
    [
      'reset-password',
      'register',
      'verify-email',
      'forgot-password',
      'auth-confirm',
      'activate',
      'invitations',
    ].includes(view)
  )
    return (
      <Suspense
        fallback={
          <main className="record-page">
            <p role="status">正在准备账号页面…</p>
          </main>
        }
      >
        {auth.recovery || !['activate', 'invitations'].includes(view) ? (
          <AuthPages view={auth.recovery ? 'reset-password' : view} />
        ) : (
          <Invitations manage={view === 'invitations'} />
        )}
      </Suspense>
    )

  if (publicId !== null) return <PublicRecord recordId={publicId} />
  if (view === 'showcase') return <SearchRecords publicView />
  if (view === 'friends') return <FriendsPage />
  if (view === 'paintings') return <PaintingsPage />

  if (isLoggingIn) {
    return <Login />
  }

  if (isCreating) {
    return (
      <RequireAccount>
        <NoteWriteAccess>
          <NewRecord />
        </NoteWriteAccess>
      </RequireAccount>
    )
  }

  if (editId !== null) {
    return (
      <RequireAccount>
        <NoteWriteAccess>
          <EditRecord recordId={editId} key={editId} />
        </NoteWriteAccess>
      </RequireAccount>
    )
  }

  if (recordId !== null) {
    if (params.get('manage') !== '1' && auth.status === 'loading')
      return (
        <main className="record-page">
          <p role="status">正在准备记录…</p>
        </main>
      )
    if (params.get('manage') !== '1' && !auth.user)
      return <PublicRecord recordId={recordId} />
    return (
      <RequireAccount>
        {params.get('manage') === '1' ? (
          <NoteWriteAccess>
            <RecordDetail recordId={recordId} manage />
          </NoteWriteAccess>
        ) : (
          <RecordDetail recordId={recordId} />
        )}
      </RequireAccount>
    )
  }

  if (view === 'records') return <RecordsPage />
  if (view === 'search' || params.has('tag')) return <SearchRecords />
  if (view === 'manage') return <RecordTools />
  if (view === 'trash') return <TrashRecords />
  if (view === 'storage') return <CoverCleanup />
  if (view === 'account') return <Account />
  if (view === 'backup')
    return (
      <Suspense
        fallback={
          <main className="record-page">
            <p role="status">正在准备数据管理…</p>
          </main>
        }
      >
        <DataBackup />
      </Suspense>
    )
  if (view === 'markdown-help')
    return (
      <Suspense
        fallback={
          <main className="record-page">
            <p role="status">正在读取写作说明…</p>
          </main>
        }
      >
        <MarkdownHelp />
      </Suspense>
    )

  return (
    <div className="site">
      <Header />

      <main>
        <HomeHero />

        <HomeAbout />

        <Projects />

        <section id="contact">
          <div className="home-info-panel contact-panel">
            <h2>联系我</h2>
            <p>QQ群:1129774429</p>
          </div>
        </section>
      </main>
    </div>
  )
}

function AppFrame() {
  return (
    <>
      <Pages />
      <SiteChrome />
    </>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppFrame />
    </AuthProvider>
  )
}

export default App
