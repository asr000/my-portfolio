import { useEffect, useState } from 'react'
import { useAuth } from './authContext.js'
import { apiGet } from './apiClient.js'
import { errorText } from './recordUtils.js'

export function useNoteAccess() {
  const auth = useAuth()
  const [state, setState] = useState({ userId: null, data: null, error: '' })
  const [attempt, setAttempt] = useState(0)
  const userId = auth.status === 'ready' ? auth.user?.id : null
  useEffect(() => {
    if (!userId) return
    let active = true
    apiGet('/api/note-access')
      .then((data) => {
        if (active)
          setState({
            userId,
            data,
            error: '',
          })
      })
      .catch((error) => {
        if (active) setState({ userId, data: null, error: errorText(error) })
      })
    return () => {
      active = false
    }
  }, [userId, attempt])
  const matching = state.userId === userId && !!userId
  return {
    data: matching ? state.data : null,
    error: matching ? state.error : '',
    loading: !!userId && (!matching || (!state.data && !state.error)),
    retry: () => {
      setState({ userId: null, data: null, error: '' })
      setAttempt((n) => n + 1)
    },
  }
}
