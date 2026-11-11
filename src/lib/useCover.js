import { useCallback, useEffect, useState } from 'react'
import { coverUrl } from './recordsApi.js'

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
        blobUrl = await coverUrl(path)
        if (active) setState({ path: key, url: blobUrl, error: false })
        else URL.revokeObjectURL(blobUrl)
      } catch {
        if (active) setState({ path: key, url: '', error: true })
      }
    }
    load()
    return () => {
      active = false
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
