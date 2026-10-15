import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { useAuth } from './lib/authContext.js'
import {
  authErrorText,
  authRedirect,
  validatePassword,
} from './lib/accountUtils.js'
import { initialAuthCallback } from './lib/authCallback.js'
import { AuthNotice } from './AuthAccess.jsx'
import RecordsLayout from './RecordsLayout.jsx'

export default function AuthPages({ view }) {
  if (view === 'register') return <Register />
  if (view === 'verify-email') return <EmailAction verify />
  if (view === 'forgot-password') return <EmailAction />
  if (view === 'auth-confirm') return <AuthConfirm />
  return <ResetPassword />
}

export function Register() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const lock = useRef(false)
  async function submit(event) {
    event.preventDefault()
    if (lock.current) return
    const form = new FormData(event.currentTarget)
    try {
      validatePassword(
        String(form.get('password')),
        String(form.get('confirmation')),
      )
      lock.current = true
      setBusy(true)
      setMessage('')
      const { data, error } = await supabase.auth.signUp({
        email: String(form.get('email')).trim(),
        password: String(form.get('password')),
        options: { emailRedirectTo: authRedirect('auth-confirm') },
      })
      if (error) throw error
      if (data.session) window.location.replace('/?view=account')
      else {
        setSent(true)
        setMessage(
          '注册请求已提交。请到邮箱打开验证链接；如果邮箱已注册，可以直接登录或找回密码。',
        )
        event.target.reset()
      }
    } catch (error) {
      setMessage(authErrorText(error))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <RecordsLayout
      title="注册账号"
      description="所有人都可以注册。笔记记录功能需要另行兑换邀请码。"
      publicPage
      back="/?login=1"
      backLabel="返回登录"
    >
      {sent ? (
        <div className="notice" role="status">
          <p>{message}</p>
          <a className="text-link" href="/?view=verify-email">
            重新发送验证邮件 →
          </a>
          <p>
            <a className="text-link" href="/?login=1">
              前往登录 →
            </a>
          </p>
        </div>
      ) : (
        <form className="record-fields auth-form" onSubmit={submit}>
          <label htmlFor="register-email">邮箱</label>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={busy}
          />
          <PasswordFields disabled={busy} />
          <button disabled={busy}>{busy ? '正在注册…' : '注册账号'}</button>
          {message && <p role="alert">{message}</p>}
        </form>
      )}
    </RecordsLayout>
  )
}

function PasswordFields({ disabled }) {
  return (
    <>
      <label htmlFor="new-password">密码（至少 8 个字符）</label>
      <input
        id="new-password"
        name="password"
        type="password"
        minLength={8}
        autoComplete="new-password"
        required
        disabled={disabled}
      />
      <label htmlFor="confirm-password">再次输入密码</label>
      <input
        id="confirm-password"
        name="confirmation"
        type="password"
        minLength={8}
        autoComplete="new-password"
        required
        disabled={disabled}
      />
    </>
  )
}

export function EmailAction({ verify = false }) {
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(false)
  const lock = useRef(false)
  async function submit(event) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setMessage('')
    setError('')
    const email = String(new FormData(event.currentTarget).get('email')).trim()
    try {
      const result = verify
        ? await supabase.auth.resend({
            type: 'signup',
            email,
            options: { emailRedirectTo: authRedirect('auth-confirm') },
          })
        : await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: authRedirect('reset-password'),
          })
      if (result.error) throw result.error
      setMessage(
        verify
          ? '如果该邮箱有待验证的注册，验证邮件将发送到邮箱。请检查收件箱和垃圾邮件。'
          : '如果该邮箱已注册，重置密码的邮件将发送到邮箱。请打开邮件中的链接。',
      )
      setCooldown(true)
    } catch (err) {
      setError(authErrorText(err))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  // A sent form becomes a success panel; revisiting is deliberate, while server limits remain authoritative.
  return (
    <RecordsLayout
      title={verify ? '验证邮箱' : '忘记密码'}
      description={
        verify ? '重新获取注册验证邮件。' : '通过邮件设置一个新密码。'
      }
      publicPage
      back="/?login=1"
      backLabel="返回登录"
    >
      {cooldown ? (
        <div className="notice" role="status">
          <p>{message}</p>
          <a className="text-link" href="/?login=1">
            返回登录 →
          </a>
        </div>
      ) : (
        <form className="record-fields auth-form" onSubmit={submit}>
          <label htmlFor="action-email">邮箱</label>
          <input
            id="action-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={auth.user?.email || ''}
            disabled={busy}
          />
          <button disabled={busy}>
            {busy ? '正在发送…' : verify ? '发送验证邮件' : '发送重置邮件'}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </RecordsLayout>
  )
}

export function AuthConfirm() {
  const auth = useAuth()
  return (
    <RecordsLayout
      title="邮箱验证"
      description="确认邮箱后，即可登录账号。"
      publicPage
      back="/"
      backLabel="返回首页"
    >
      {initialAuthCallback.failed ? (
        <div role="alert">
          <p>验证链接无效或已过期，请重新发送验证邮件。</p>
          <a className="text-link" href="/?view=verify-email">
            重新发送验证邮件 →
          </a>
        </div>
      ) : auth.status === 'ready' && auth.user?.email_confirmed_at ? (
        <div className="notice">
          <p>邮箱验证成功，已登录账号。</p>
          <a className="record-create-link" href="/?view=account">
            前往我的账号
          </a>
          <p>
            <a className="text-link" href="/?view=activate">
              兑换邀请码，开通笔记 →
            </a>
          </p>
        </div>
      ) : auth.status === 'loading' || auth.status === 'error' ? (
        <AuthNotice />
      ) : (
        <div className="notice">
          <p>请先打开验证邮件中的链接。如果已经验证，请登录账号。</p>
          <a className="text-link" href="/?login=1">
            前往登录 →
          </a>
          <p>
            <a className="text-link" href="/?view=verify-email">
              重新发送验证邮件 →
            </a>
          </p>
        </div>
      )}
    </RecordsLayout>
  )
}

export function ResetPassword() {
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)
  const lock = useRef(false)
  useEffect(() => {
    if (auth.recovery && auth.status === 'ready' && auth.user)
      window.history.replaceState(null, '', '/?view=reset-password')
  }, [auth.recovery, auth.status, auth.user])
  async function submit(event) {
    event.preventDefault()
    if (lock.current) return
    const form = new FormData(event.currentTarget)
    try {
      validatePassword(
        String(form.get('password')),
        String(form.get('confirmation')),
      )
      lock.current = true
      setBusy(true)
      setMessage('')
      const { error } = await supabase.auth.updateUser({
        password: String(form.get('password')),
      })
      if (error) throw error
      event.target.reset()
      setDone(true)
    } catch (error) {
      setMessage(authErrorText(error))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <RecordsLayout
      title="设置新密码"
      description="为当前账号设置一个新密码。"
      publicPage
      back="/"
      backLabel="返回首页"
    >
      {done ? (
        <div className="notice" role="status">
          <p>密码已更新。下次登录请使用新密码。</p>
          <a className="record-create-link" href="/?view=account">
            前往我的账号
          </a>
        </div>
      ) : initialAuthCallback.failed ? (
        <div role="alert">
          <p>重置链接无效或已过期，请重新获取邮件。</p>
          <a className="text-link" href="/?view=forgot-password">
            重新获取重置邮件 →
          </a>
        </div>
      ) : auth.status === 'ready' && auth.user ? (
        <form className="record-fields auth-form" onSubmit={submit}>
          <p className="helper">当前账号：{auth.user.email}</p>
          <PasswordFields disabled={busy} />
          <button disabled={busy}>{busy ? '正在更新…' : '更新密码'}</button>
          {message && <p role="alert">{message}</p>}
        </form>
      ) : (
        <div>
          <AuthNotice label="登录账号" />
          <p className="helper">
            请打开重置邮件中的链接。链接已过期时，需要重新发送邮件。
          </p>
          <a className="text-link" href="/?view=forgot-password">
            重新获取重置邮件 →
          </a>
        </div>
      )}
    </RecordsLayout>
  )
}
