import { lazy, Suspense } from 'react'
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
import Account from './Account.jsx'
import PublicRecord from './PublicRecord.jsx'
import NoteWriteAccess from './NoteAccess.jsx'
import ThemeToggle from './ThemeToggle.jsx'

const DataBackup = lazy(() => import('./DataBackup.jsx'))
const MarkdownHelp = lazy(() => import('./MarkdownHelp.jsx'))
const AuthPages = lazy(() => import('./AuthPages.jsx'))
const Invitations = lazy(() => import('./Invitations.jsx'))

function Header() {
  const auth = useAuth()
  return (
    <header className="site-header">
      <a className="logo" href="/">
        Re:代码生活
      </a>

      <nav aria-label="主导航">
        <a href="#about">关于我</a>
        <a href="/?view=showcase">练习</a>
        <a href="#contact">联系我</a>
        {auth.user && <a href="/?view=records">我的记录</a>}
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

        <section id="about">
          <h2>关于我</h2>
          <p>好像还没啥可说的。</p>
        </section>

        <Projects />

        <section id="contact">
          <h2>联系我</h2>
          <p>QQ群:902722762</p>
        </section>
      </main>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <Pages />
    </AuthProvider>
  )
}

export default App
