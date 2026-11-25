import { test, expect } from '@playwright/test'

const id = '11111111-1111-4111-8111-111111111111'
const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', is_author: true }
const original = { id, user_id: user.id, title: '预览文章', tags: [], content: '原来的内容', cover_path: null, created_at: '2026-11-20T00:00:00.000Z', updated_at: '2026-11-20T00:00:00.000Z', version: 1, deleted_at: null, is_public: true, author_name: '站长', author_role: 'owner' }

async function setup(page, { signedOut = false, allowed = true } = {}) {
  let record = { ...original }
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === '/api/auth/me') return json({ user: signedOut ? null : user })
    if (path === '/api/note-access') return json({ can_write: true })
    if (path === `/api/public/records/${id}`) return json(record)
    if (path === '/api/public/records' || path === '/api/records') return json([record])
    if (path === '/api/public/tags' || path === '/api/record-tags') return json([])
    if (path === '/api/records/editable') return json({ ids: allowed ? [id] : [] })
    if (path === `/api/records/${id}/edit-access`) return json({ can_edit: allowed })
    if (path === `/api/records/${id}`) return json(record)
    if (path === '/api/records/mutate') {
      const payload = request.postDataJSON()
      record = { ...record, title: payload.title, content: payload.content, tags: payload.tags, version: 2 }
      return json({ record, old_cover_path: null })
    }
    return json({})
  })
}

test('author edits from a public article and returns to it', async ({ page }) => {
  await setup(page)
  await page.goto(`/?show=${id}&back=%2F%3Fview%3Dshowcase`)
  await page.getByRole('link', { name: '编辑记录' }).click()
  await expect(page.getByRole('heading', { name: '编辑记录' })).toBeVisible()
  await page.getByLabel('标题').fill('修改后的标题')
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page).toHaveURL(/show=/)
  await expect(page.getByRole('heading', { name: '修改后的标题' })).toBeVisible()
})

test('visitors and other accounts do not see the edit entry', async ({ page }) => {
  await setup(page, { allowed: false })
  await page.goto(`/?show=${id}`)
  await expect(page.getByRole('heading', { name: '预览文章' })).toBeVisible()
  await expect(page.getByRole('link', { name: '编辑记录' })).toHaveCount(0)
})

test('signed-out visitors do not see the edit entry', async ({ page }) => {
  await setup(page, { signedOut: true })
  await page.goto(`/?show=${id}`)
  await expect(page.getByRole('heading', { name: '预览文章' })).toBeVisible()
  await expect(page.getByRole('link', { name: '编辑记录' })).toHaveCount(0)
})

test('author edits directly from the blog and private record lists', async ({ page }) => {
  await setup(page)
  await page.goto('/?view=showcase')
  await page.getByRole('link', { name: '编辑 预览文章' }).click()
  await expect(page.getByRole('heading', { name: '编辑记录' })).toBeVisible()
  await expect(page.getByRole('link', { name: '返回记录列表' })).toHaveAttribute('href', '/?view=showcase')
  await page.getByRole('link', { name: '返回记录列表' }).click()
  await page.goto('/?view=records')
  await page.getByRole('link', { name: '编辑 预览文章' }).click()
  await expect(page.getByRole('heading', { name: '编辑记录' })).toBeVisible()
  await expect(page.getByRole('link', { name: '返回记录列表' })).toHaveAttribute('href', '/?view=records')
})

test('other users do not see an edit entry on public record cards', async ({ page }) => {
  await setup(page, { allowed: false })
  await page.goto('/?view=showcase')
  await expect(page.getByRole('link', { name: /预览文章/ }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: '编辑 预览文章' })).toHaveCount(0)
})

test('the list edit link fits on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await setup(page)
  await page.goto('/?view=showcase')
  const edit = page.getByRole('link', { name: '编辑 预览文章' })
  await expect(edit).toBeVisible()
  const box = await edit.boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(375)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})
