import './App.css'
import Projects from './Projects.jsx'
import RecordDetail from './RecordDetail.jsx'
import NewRecord from './NewRecord.jsx'
import Login from './Login.jsx'
import EditRecord from './EditRecord.jsx'
import RecordsPage from './RecordsPage.jsx'
import SearchRecords from './SearchRecords.jsx'
import RecordTools, { CoverCleanup, TrashRecords } from './RecordTools.jsx'

function Header() {
  return (
    <header className="site-header">
      <a className="logo" href="/">
        Re:代码生活
      </a>

      <nav aria-label="主导航">
        <a href="#about">关于我</a>
        <a href="/?view=records">项目</a>
        <a href="#contact">联系我</a>
        <a href="/?login=1">登录</a>
      </nav>
    </header>
  )
}

function App() {
  const params = new URLSearchParams(window.location.search)
  const recordId = params.get('record')
  const editId = params.get('edit')
  const isCreating = params.get('new') === '1'
  const isLoggingIn = params.get('login') === '1'
  const view = params.get('view')

  if (isLoggingIn) {
    return <Login />
  }

  if (isCreating) {
    return <NewRecord />
  }

  if (editId !== null) {
    return <EditRecord recordId={editId} key={editId} />
  }

  if (recordId !== null) {
    return (
      <RecordDetail recordId={recordId} manage={params.get('manage') === '1'} />
    )
  }

  if (view === 'records') return <RecordsPage />
  if (view === 'search' || params.has('tag')) return <SearchRecords />
  if (view === 'manage') return <RecordTools />
  if (view === 'trash') return <TrashRecords />
  if (view === 'storage') return <CoverCleanup />

  return (
    <div className="site">
      <Header />

      <main>
        <section className="hero">
          <h1 className="hero-title">
            Re:从<span className="highlight-char">0</span>开始的代码生活
          </h1>

          <p>hey？</p>

          <a className="hero-link" href="/?view=records">
            查看我的练习
          </a>
        </section>

        <section id="about">
          <h2>关于我</h2>
          <p>这里以后会介绍我的学习经历和正在练习的技术。</p>
        </section>

        <Projects />

        <section id="contact">
          <h2>联系我</h2>
          <p>这里以后会放邮箱或其他联系方式。</p>
        </section>
      </main>
    </div>
  )
}

export default App
