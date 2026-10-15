// Only return to a known record-list page, including its search filters.
export function listReturn(value, fallback = 'records') {
  const base = 'https://portfolio.invalid'
  let target
  try {
    target = new URL(value || `/?view=${fallback}`, base)
  } catch {
    return `/?view=${fallback}`
  }
  if (target.origin !== base || target.pathname !== '/')
    return `/?view=${fallback}`
  const view = target.searchParams.get('view')
  if (!['records', 'search', 'trash', 'showcase'].includes(view))
    return `/?view=${fallback}`
  const params = new URLSearchParams({ view })
  if (view === 'search' || view === 'showcase') {
    for (const key of ['q', 'tag']) {
      const filter = target.searchParams.get(key)
      if (filter) params.set(key, filter)
    }
  }
  return `/?${params}`
}

export function recordLink(
  id,
  { back, manage = false, edit = false, publicView = false, notice } = {},
) {
  if (publicView)
    return `/?${new URLSearchParams({ show: id, back: listReturn(back, 'showcase') })}`
  const params = new URLSearchParams({ [edit ? 'edit' : 'record']: id })
  if (manage) params.set('manage', '1')
  params.set('back', listReturn(back))
  if (notice) params.set('notice', notice)
  return `/?${params}`
}

export function safeDestination(value, fallback = '/?view=records') {
  try {
    if (!value || value.length > 2000) return fallback
    const url = new URL(value, 'https://portfolio.invalid')
    if (
      url.origin !== 'https://portfolio.invalid' ||
      url.pathname !== '/' ||
      url.searchParams.has('login')
    )
      return fallback
    return url.pathname + url.search + url.hash
  } catch {
    return fallback
  }
}

export function loginLink(next) {
  return `/?${new URLSearchParams({ login: '1', next: safeDestination(next) })}`
}
