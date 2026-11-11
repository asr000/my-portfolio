import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthContext, isSessionError } from './lib/authContext.js'
import { currentUser } from './lib/recordsApi.js'
import { errorText } from './lib/recordUtils.js'
import { initialAuthCallback } from './lib/authCallback.js'

export default function AuthProvider({ children }) {
  const [state, setState] = useState({
    user: null,
    status: 'loading',
    message: '',
  })
  const generation = useRef(0)
  const recovery = initialAuthCallback.recovery && !initialAuthCallback.failed
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
    const initialCheck = setTimeout(refresh, 0)
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)
    return () => {
      clearTimeout(initialCheck)
      invalidate()
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [refresh, invalidate])
  return (
    <AuthContext.Provider
      value={{
        ...state,
        refresh: retry,
        recovery,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
