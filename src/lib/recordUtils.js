export const PAGE_SIZE = 12
export const EMPTY_FORM = {
  title: '',
  tags: '',
  content: '',
  removeCover: false,
}

export function parseTags(text) {
  return [
    ...new Set(
      text
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ]
}

export function validateRecord(form) {
  if (!form.title.trim() || form.title.trim().length > 160)
    throw new Error('标题须为 1～160 个字符。')
  if (form.content.length > 100000)
    throw new Error('正文不能超过 100000 个字符。')
  const tags = parseTags(form.tags)
  if (tags.length > 12 || tags.some((tag) => tag.length > 24))
    throw new Error('最多 12 个标签，每个标签最多 24 个字符。')
  return { title: form.title.trim(), content: form.content, tags }
}

export function errorText(error) {
  if (['PGRST202', '42703', '42883'].includes(error?.code))
    return '云端功能尚未更新，请先执行项目中的数据库升级 SQL。'
  if (error?.code === '40001')
    return '记录已在其他页面或设备修改。草稿已保留，请返回详情重新载入。'
  if (error?.code === '42501')
    return '没有操作权限，请确认已登录，并已执行数据库升级 SQL。'
  return error?.message || '请求未完成，请检查网络后重试。'
}

export function formatDate(value) {
  return new Date(value).toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&')
}
