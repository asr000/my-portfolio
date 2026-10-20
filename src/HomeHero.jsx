import { useEffect, useRef, useState } from 'react'
import { useAuth } from './lib/authContext.js'
import { supabase } from './lib/supabaseClient.js'
import { HERO_TITLE, HERO_LINK_LABEL } from './lib/heroText.js'
import { FORTUNES, fortuneError } from './lib/dailyFortune.js'
import { loginLink } from './lib/navigation.js'
import './homeHero.css'

async function fortuneRpc(name) {
  const { data, error } = await supabase.rpc(name).retry(false)
  if (error) throw error
  return data
}

function FortuneDialog({ auth, onClose, onProgress }) {
  const dialog = useRef(null)
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const verified = !!auth.user?.email_confirmed_at
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])
  useEffect(() => {
    if (!verified) return
    let active = true
    fortuneRpc('draw_daily_note_fortune').then((data) => {
      if (active) { setResult(data); setMessage(''); onProgress(data) }
    }).catch((error) => {
      if (active) setMessage(fortuneError(error))
    })
    return () => { active = false }
  }, [verified, attempt, onProgress])
  const fortune = result && FORTUNES[result.fortune_index]
  function close() {
    // Close before unmounting so the browser restores focus to the title button.
    dialog.current.close()
    onClose()
  }
  return (
    <dialog ref={dialog} className="fortune-dialog" aria-labelledby="fortune-title"
      onCancel={(event) => { event.preventDefault(); close() }}>
      <button type="button" className="fortune-close" aria-label="关闭今日签" onClick={close} autoFocus>×</button>
      <span className="fortune-eyebrow">你发现了标题里的小秘密</span>
      <h2 id="fortune-title">今日一签</h2>
      {!auth.user ? <div className="fortune-message"><p>登录后，给今天留一支签。</p><p>每天一签，手机和电脑共享同一份签到。</p><a className="hero-link" href={loginLink('/')}>登录后抽签</a></div>
        : !verified ? <div className="fortune-message"><p>先完成邮箱验证，就可以抽取今日签。</p><a className="text-link" href="/?view=verify-email">去验证邮箱</a></div>
          : message ? <div className="fortune-message"><p role="alert">{message}</p><button className="hero-link" onClick={() => { setMessage(''); setAttempt((n) => n + 1) }}>重试抽签</button></div>
            : !fortune ? <p className="fortune-loading" role="status">正在为今天抽一支签…</p>
              : <>
                <p className="fortune-date">{result.day} · 今日已签到</p>
                <div className="fortune-paper">
                  <span className="fortune-number">第 {String(result.fortune_index + 1).padStart(2, '0')} 签</span>
                  <h3>{fortune.title}</h3>
                  <div className="fortune-luck" data-luck={fortune.luck} aria-label={`今日运势：${fortune.luck}`}>
                    <span>今日运势</span><strong>{fortune.luck}</strong>
                  </div>
                  <p className="fortune-outlook">{fortune.outlook}</p>
                  <p>{fortune.text}</p>
                  <div className="fortune-task"><span>今日小事</span><p>{fortune.task}</p></div>
                </div>
                <p className="fortune-count">已经相遇 {result.checkin_days} 天 · 发布练习 {result.publish_days} 天</p>
                <p className="fortune-footnote">今天再来，还是这支签。小小鼓励，愿你写得开心。</p>
              </>}
    </dialog>
  )
}

function HeroContent({ auth }) {
  const [progress, setProgress] = useState(null)
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (auth.status === 'loading' || auth.status === 'error') return
    let active = true
    let request = 0
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      const current = ++request
      fortuneRpc('note_garden_progress').then((data) => {
        if (active && current === request) { setProgress(data); setMessage('') }
      }).catch((error) => {
        if (active && current === request) setMessage(fortuneError(error))
      })
    }
    refresh()
    // Returning from publishing in another tab also refreshes the personal count.
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = setInterval(refresh, 60000)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [auth.status, attempt])
  const [before, after] = HERO_TITLE.split('0')
  return (
    <section className="hero home-hero" aria-label="代码生活">
      <div className="hero-title-side">
        <h1 className="hero-title"><button type="button" className="hero-fortune-trigger" aria-haspopup="dialog"
          aria-label={`${before}${progress?.publish_days ?? '…'}${after}，点击抽取今日签`}
          disabled={auth.status === 'loading'} onClick={() => setOpen(true)}>
          {before}<span className="highlight-char hero-day-count">{progress?.publish_days ?? '…'}</span>{after}
        </button></h1>
        <span className="hero-secret-hint">轻点标题 · 遇见今日签</span>
      </div>
      <div className="hero-bottom">
        <p className="hero-progress" role="status">{progress
          ? `${progress.scope === 'self' ? '你' : '站长'}已在 ${progress.publish_days} 个日子里发布练习${progress.published_today ? ' · 今天已发布新练习' : ''}`
          : auth.status === 'error' ? '登录状态暂时未能确认。'
            : message || '正在读取发布天数…'}
          {message && <button className="hero-retry" onClick={() => setAttempt((n) => n + 1)}>重试日历</button>}
        </p>
        <a className="hero-link" href="/?view=showcase">{HERO_LINK_LABEL}</a>
      </div>
      {open && <FortuneDialog auth={auth} onClose={() => setOpen(false)} onProgress={setProgress} />}
    </section>
  )
}

export default function HomeHero() {
  const auth = useAuth()
  // Account changes discard the previous user's count and any open daily draw.
  return <HeroContent key={auth.user?.id || auth.status} auth={auth} />
}
