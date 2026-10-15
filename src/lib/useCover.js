import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient.js'

export function useCover(path) {
  const [state, setState] = useState({ path: null, url: '', error: false })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!path) return
    let active = true
    async function load() {
      try {
        const { data, error } = await supabase.storage
          .from('record-covers')
          .createSignedUrl(path, 3600)
        if (error) throw error
        if (active) setState({ path, url: data.signedUrl, error: false })
      } catch {
        if (active) setState({ path, url: '', error: true })
      }
    }
    load()
    const timer = setInterval(load, 50 * 60 * 1000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [path, attempt])
  const retry = useCallback(() => {
    setState({ path: null, url: '', error: false })
    setAttempt((n) => n + 1)
  }, [])
  const fail = useCallback(
    () => setState((old) => ({ ...old, error: true })),
    [],
  )
  const matching = path && state.path === path
  return {
    url: matching ? state.url : '',
    error: matching ? state.error : false,
    loading: !!path && !matching,
    retry,
    fail,
  }
}
