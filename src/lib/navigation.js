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
  if (!['records', 'search', 'trash'].includes(view))
    return `/?view=${fallback}`
  const params = new URLSearchParams({ view })
  if (view === 'search') {
    for (const key of ['q', 'tag']) {
      const filter = target.searchParams.get(key)
      if (filter) params.set(key, filter)
    }
  }
  return `/?${params}`
}

export function recordLink(
  id,
  { back, manage = false, edit = false, notice } = {},
) {
  const params = new URLSearchParams({ [edit ? 'edit' : 'record']: id })
  if (manage) params.set('manage', '1')
  params.set('back', listReturn(back))
  if (notice) params.set('notice', notice)
  return `/?${params}`
}
