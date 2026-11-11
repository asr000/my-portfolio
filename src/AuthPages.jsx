import { useEffect, useRef, useState } from 'react'
import { apiPost } from './lib/apiClient.js'
import { useAuth } from './lib/authContext.js'
import {
  authErrorText,
  validatePassword,
} from './lib/accountUtils.js'
import {
  initialAuthCallback,
  verifyEmailCallback,
} from './lib/authCallback.js'
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
      const result = await apiPost('/api/auth/register', {
        email: String(form.get('email')).trim(),
        password: String(form.get('password')),
      })
      setSent(true)
      setMessage(
        result.message || '注册请求已提交。请到邮箱打开验证链接；如果邮箱已注册，可以直接登录或找回密码。',
      )
      event.target.reset()
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
      const result = await apiPost(
        verify ? '/api/auth/resend-verification' : '/api/auth/forgot-password',
        { email },
      )
      setMessage(result.message)
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
  const [verification, setVerification] = useState(
    initialAuthCallback.token ? 'loading' : 'idle',
  )
  const [verificationError, setVerificationError] = useState('')
  useEffect(() => {
    if (!initialAuthCallback.token) return
    let active = true
    verifyEmailCallback()
      .then(() => {
        if (!active) return
        setVerification('success')
        auth.refresh()
      })
      .catch((error) => {
        if (!active) return
        setVerification('error')
        setVerificationError(authErrorText(error))
      })
    return () => {
      active = false
    }
  }, [auth.refresh])
  return (
    <RecordsLayout
      title="邮箱验证"
      description="确认邮箱后，即可登录账号。"
      publicPage
      back="/"
      backLabel="返回首页"
    >
      {initialAuthCallback.failed || verification === 'error' ? (
        <div role="alert">
          <p>{verificationError || '验证链接无效或已过期，请重新发送验证邮件。'}</p>
          <a className="text-link" href="/?view=verify-email">
            重新发送验证邮件 →
          </a>
        </div>
      ) : verification === 'loading' ? (
        <p role="status">正在确认邮箱…</p>
      ) : verification === 'success' || (auth.status === 'ready' && auth.user?.email_confirmed_at) ? (
        <div className="notice">
          <p>邮箱验证成功。现在可以登录账号。</p>
          <a className="record-create-link" href="/?login=1">
            前往登录
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
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)
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
      await apiPost('/api/auth/reset-password', {
        token: initialAuthCallback.token,
        password: String(form.get('password')),
      })
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
      ) : initialAuthCallback.token ? (
        <form className="record-fields auth-form" onSubmit={submit}>
          <p className="helper">请设置新密码。</p>
          <PasswordFields disabled={busy} />
          <button disabled={busy}>{busy ? '正在更新…' : '更新密码'}</button>
          {message && <p role="alert">{message}</p>}
        </form>
      ) : (
        <div>
          <p className="helper">
            {initialAuthCallback.failed
              ? '重置链接无效或已过期，请重新获取邮件。'
              : '请先获取重置邮件，再打开邮件中的链接设置新密码。'}
          </p>
          <a className="text-link" href="/?view=forgot-password">
            重新获取重置邮件 →
          </a>
        </div>
      )}
    </RecordsLayout>
  )
}
