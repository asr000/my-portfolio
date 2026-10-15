import { useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { useAuth } from './lib/authContext.js'
import { safeDestination } from './lib/navigation.js'

function Login() {
  const auth = useAuth()
  const next = safeDestination(
    new URLSearchParams(window.location.search).get('next'),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()

    if (isSubmitting) {
      return
    }

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email')).trim()
    const password = String(formData.get('password'))

    setIsSubmitting(true)
    setMessage('')

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setMessage(`登录失败：${error.message}`)
        return
      }

      window.location.replace(next)
    } catch {
      setMessage('登录请求未完成，请检查网络后重试。')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="record-page">
      <a className="record-back" href={next}>
        ← 返回项目记录
      </a>

      <div className="record-editor">
        <h1>登录</h1>

        {auth.status === 'ready' && auth.user ? (
          <div className="notice">
            <p>当前已登录：{auth.user.email}</p>
            <div className="actions">
              <a className="text-link" href={next}>
                继续前往原页面 →
              </a>
              <a className="text-link" href="/?view=account">
                管理账号
              </a>
            </div>
          </div>
        ) : (
          <>
            {auth.message && <p role="status">{auth.message}</p>}

            <form className="record-fields" onSubmit={handleSubmit}>
              <label htmlFor="login-email">邮箱</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                required
              />

              <label htmlFor="login-password">密码</label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />

              <button
                className="login-submit"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? '正在登录…' : '登录'}
              </button>

              <p className="login-message" role="status">
                {message}
              </p>
            </form>
          </>
        )}
      </div>
    </main>
  )
}

export default Login
