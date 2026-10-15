import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthContext, isSessionError } from './lib/authContext.js'
import { supabase } from './lib/supabaseClient.js'
import { currentUser } from './lib/recordsApi.js'
import { errorText } from './lib/recordUtils.js'

export default function AuthProvider({ children }) {
  const [state, setState] = useState({
    user: null,
    status: 'loading',
    message: '',
  })
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const user = await currentUser()
      if (request === generation.current)
        setState({ user, status: user ? 'ready' : 'signed-out', message: '' })
    } catch (err) {
      if (request === generation.current)
        setState({
          user: null,
          status: isSessionError(err) ? 'signed-out' : 'error',
          message: isSessionError(err)
            ? '登录已过期，请重新登录。'
            : errorText(err),
        })
    }
  }, [])
  const invalidate = useCallback(() => {
    generation.current++
  }, [])
  const retry = useCallback(() => {
    setState((old) => ({ ...old, status: 'loading', message: '' }))
    refresh()
  }, [refresh])
  useEffect(() => {
    let initialCheck
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Keep this callback synchronous; SDK calls inside it can hold the auth lock.
      if (event === 'INITIAL_SESSION') {
        initialCheck = setTimeout(refresh, 0)
        return
      }
      invalidate()
      if (event === 'SIGNED_OUT')
        setState({
          user: null,
          status: 'signed-out',
          message: '登录状态已结束，请重新登录。',
        })
      else if (session?.user)
        setState({ user: session.user, status: 'ready', message: '' })
    })
    return () => {
      clearTimeout(initialCheck)
      invalidate()
      subscription.unsubscribe()
    }
  }, [refresh, invalidate])
  return (
    <AuthContext.Provider value={{ ...state, refresh: retry }}>
      {children}
    </AuthContext.Provider>
  )
}
