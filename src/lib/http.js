export async function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort(init.signal.reason)
  if (init.signal?.aborted) abort()
  else init.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(
    () => controller.abort(new Error('请求超时，请检查网络后重试。')),
    30000,
  )
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', abort)
  }
}
