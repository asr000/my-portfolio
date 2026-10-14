import { useState } from 'react'
import { supabase } from './lib/supabaseClient.js'

function Login() {
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

      setMessage('登录成功！可以返回项目记录。')
    } catch {
      setMessage('登录请求未完成，请检查网络后重试。')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="record-page">
      <a className="record-back" href="/#projects">
        ← 返回项目记录
      </a>

      <div className="record-editor">
        <h1>登录</h1>

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
      </div>
    </main>
  )
}

export default Login