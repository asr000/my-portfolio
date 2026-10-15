import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient.js'

export function useCover(path, { publicAccess = false } = {}) {
  const key = path ? `${publicAccess ? 'public' : 'owner'}:${path}` : null
  const [state, setState] = useState({ path: null, url: '', error: false })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!path) return
    let active = true
    let blobUrl = ''
    async function load() {
      try {
        if (publicAccess) {
          // Each download is checked against current RLS. No long-lived public signed link.
          const { data, error } = await supabase.storage
            .from('record-covers')
            .download(path, {}, { cache: 'no-store' })
          if (error) throw error
          if (active) {
            blobUrl = URL.createObjectURL(data)
            setState({ path: key, url: blobUrl, error: false })
          }
          return
        }
        const { data, error } = await supabase.storage
          .from('record-covers')
          .createSignedUrl(path, 3600)
        if (error) throw error
        if (active) setState({ path: key, url: data.signedUrl, error: false })
      } catch {
        if (active) setState({ path: key, url: '', error: true })
      }
    }
    load()
    const timer = publicAccess ? null : setInterval(load, 50 * 60 * 1000)
    return () => {
      active = false
      clearInterval(timer)
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [path, key, publicAccess, attempt])
  const retry = useCallback(() => {
    setState({ path: null, url: '', error: false })
    setAttempt((n) => n + 1)
  }, [])
  const fail = useCallback(
    () => setState((old) => ({ ...old, error: true })),
    [],
  )
  const matching = path && state.path === key
  return {
    url: matching ? state.url : '',
    error: matching ? state.error : false,
    loading: !!path && !matching,
    retry,
    fail,
  }
}
