import { test, expect } from '@playwright/test'
import { Buffer } from 'node:buffer'

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID = '11111111-1111-4111-8111-111111111111'
const row = (extra = {}) => ({
  id: ID,
  user_id: USER,
  title: '原始记录',
  tags: ['React'],
  content: '原始正文',
  cover_path: null,
  created_at: '2026-10-15T00:00:00.000Z',
  updated_at: '2026-10-15T00:00:00.000Z',
  version: 1,
  deleted_at: null,
  ...extra,
})

async function setup(page, records = [row()], options = {}) {
  const store = {
    records,
    receipts: new Map(),
    calls: [],
    uploaded: [],
    deleted: [],
    loseResponse: !!options.loseResponse,
  }
  await page.addInitScript(
    ({ user }) => {
      const body = btoa(
        JSON.stringify({
          sub: user,
          exp: Math.floor(Date.now() / 1000) + 3600,
          role: 'authenticated',
        }),
      )
      const session = {
        access_token: `test.${body}.signature`,
        token_type: 'bearer',
        refresh_token: 'test-refresh',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: user,
          email: 'test@example.invalid',
          aud: 'authenticated',
          role: 'authenticated',
        },
      }
      localStorage.setItem(
        'sb-portfolio-test-auth-token',
        JSON.stringify(session),
      )
    },
    { user: USER },
  )
  await page.route('https://portfolio-test.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(data),
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    if (request.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': '*',
        },
      })
    if (url.pathname === '/auth/v1/user')
      return json({
        id: USER,
        email: 'test@example.invalid',
        aud: 'authenticated',
      })
    if (url.pathname.includes('/rpc/record_tags')) {
      const trash = request.postDataJSON().p_trash
      return json(
        [
          ...new Set(
            store.records
              .filter((r) => !!r.deleted_at === trash)
              .flatMap((r) => r.tags),
          ),
        ]
          .sort()
          .map((tag) => ({ tag })),
      )
    }
    if (url.pathname.includes('/rpc/mutate_record')) {
      const p = request.postDataJSON()
      store.calls.push(p)
      if (store.receipts.has(p.p_request_id))
        return json(store.receipts.get(p.p_request_id))
      let record = store.records.find((r) => r.id === p.p_record_id)
      const old = record?.cover_path || null
      if (p.p_action === 'create') {
        record = row({
          id: p.p_record_id,
          title: p.p_title,
          tags: p.p_tags,
          content: p.p_content,
          cover_path: p.p_cover_path,
        })
        store.records.unshift(record)
      } else {
        if (!record || options.conflict || record.version !== p.p_version)
          return json({ code: '40001', message: '记录已在其他设备修改' }, 409)
        record.version++
        if (p.p_action === 'update')
          Object.assign(record, {
            title: p.p_title,
            tags: p.p_tags,
            content: p.p_content,
            cover_path: p.p_cover_path,
          })
        if (p.p_action === 'trash') record.deleted_at = new Date().toISOString()
        if (p.p_action === 'restore') record.deleted_at = null
        if (p.p_action === 'purge') {
          store.records = store.records.filter((r) => r.id !== record.id)
          record = null
        }
      }
      const result = {
        record: record ? { ...record } : null,
        old_cover_path:
          p.p_action === 'update' || p.p_action === 'purge' ? old : null,
      }
      store.receipts.set(p.p_request_id, result)
      if (store.loseResponse) {
        store.loseResponse = false
        return route.abort('failed')
      }
      return json(result)
    }
    if (url.pathname === '/rest/v1/records') {
      let result = store.records.slice()
      const id = url.searchParams.get('id')?.replace('eq.', '')
      if (id) result = result.filter((r) => r.id === id)
      if (url.searchParams.has('cover_path'))
        result = result.filter(
          (r) => r.cover_path === url.searchParams.get('cover_path').slice(3),
        )
      if (url.searchParams.get('deleted_at') === 'is.null')
        result = result.filter((r) => !r.deleted_at)
      if (url.searchParams.get('deleted_at') === 'not.is.null')
        result = result.filter((r) => r.deleted_at)
      if (url.searchParams.has('title'))
        result = result.filter((r) =>
          r.title.includes(
            url.searchParams.get('title').replace(/^ilike\.%|%$/g, ''),
          ),
        )
      if (url.searchParams.has('tags')) {
        const tag = url.searchParams.get('tags').replace(/^cs\.\{"?|"?\}$/g, '')
        result = result.filter((r) => r.tags.includes(tag))
      }
      result.sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      )
      const cursor = url.searchParams
        .get('or')
        ?.match(/created_at\.lt\.([^,]+)/)?.[1]
      if (cursor) result = result.filter((r) => r.created_at < cursor)
      result = result.slice(0, Number(url.searchParams.get('limit') || 1000))
      return json(
        request.headers().accept?.includes('vnd.pgrst.object')
          ? result[0] || null
          : result,
      )
    }
    if (url.pathname.includes('/storage/v1/object/sign/'))
      return json({
        signedURL: '/object/sign/record-covers/test.webp?token=test',
      })
    if (
      url.pathname === '/storage/v1/object/record-covers' &&
      request.method() === 'DELETE'
    ) {
      store.deleted.push(...request.postDataJSON().prefixes)
      return json([])
    }
    if (
      url.pathname.includes('/storage/v1/object/record-covers/') &&
      request.method() === 'HEAD'
    ) {
      const path = url.pathname.split('/record-covers/')[1]
      return route.fulfill({
        status: store.deleted.includes(path) ? 404 : 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    }
    if (
      url.pathname.includes('/storage/v1/object/record-covers/') &&
      request.method() === 'POST'
    ) {
      store.uploaded.push(url.pathname.split('/record-covers/')[1])
      return json({ Key: url.pathname, Id: crypto.randomUUID() })
    }
    if (url.pathname.includes('/storage/v1/object/sign/'))
      return json({
        signedURL: '/object/sign/record-covers/test.webp?token=test',
      })
    return json(
      {
        message: `Unexpected test request: ${request.method()} ${url.pathname}`,
      },
      404,
    )
  })
  page.on('dialog', (dialog) => dialog.accept())
  return store
}

test('separate record and search pages preserve pagination, filters and mobile square covers', async ({
  page,
}) => {
  const records = Array.from({ length: 25 }, (_, i) =>
    row({
      id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`,
      title: `日志 ${String(i + 1).padStart(2, '0')}`,
      tags: [i % 2 ? 'CSS' : 'React'],
      created_at: new Date(Date.UTC(2026, 9, 15, 0, 30 - i)).toISOString(),
    }),
  )
  await setup(page, records)
  await page.goto('/')
  await expect(page.locator('#projects .record-card')).toHaveCount(12)
  await expect(page.locator('#projects button')).toHaveCount(0)
  await expect(page.getByLabel('搜索标题')).toHaveCount(0)
  const homeList = page.locator('#projects .record-list')
  expect(
    await homeList.evaluate((list) => list.scrollHeight > list.clientHeight),
  ).toBe(true)
  await homeList.evaluate((list) => {
    list.scrollTop = list.scrollHeight
  })
  await expect(page.locator('#projects .record-card')).toHaveCount(24)
  expect(await homeList.evaluate((list) => list.scrollTop)).toBeGreaterThan(0)
  await homeList.evaluate((list) => {
    list.scrollTop = list.scrollHeight
  })
  await expect(page.locator('#projects .record-card')).toHaveCount(25)
  await expect(page.getByText('共 25 条记录', { exact: true })).toBeVisible()
  await page
    .locator('#projects')
    .screenshot({ path: 'test-results/home-scrolling.png' })
  await page.getByRole('link', { name: '查看全部记录' }).click()
  await expect(page).toHaveURL(/view=records/)
  await expect(page.locator('.record-card')).toHaveCount(12)
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('.record-card')).toHaveCount(24)
  await page.getByRole('link', { name: '搜索记录', exact: true }).click()
  await expect(page).toHaveURL(/view=search/)
  await page.getByLabel('搜索标题').fill('日志 02')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page).toHaveURL(/view=search&q=/)
  await expect(page.locator('.record-card')).toHaveCount(1)
  await expect(page.locator('.record-card')).toContainText('日志 02')
  await page.getByRole('link', { name: '清除筛选' }).click()
  await expect(
    page
      .getByLabel('标签', { exact: true })
      .getByRole('option', { name: 'CSS', exact: true }),
  ).toHaveCount(1)
  await page.getByLabel('标签', { exact: true }).selectOption('CSS')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page).toHaveURL(/tag=CSS/)
  await expect(page.locator('.record-card')).toHaveCount(12)
  await expect(page.locator('.record-card').first()).toContainText('日志 02')
  await page.setViewportSize({ width: 375, height: 812 })
  const box = await page.locator('.record-thumbnail').first().boundingBox()
  const info = await page.locator('.record-card-info').first().boundingBox()
  expect(box.width).toBe(box.height)
  expect(info.x).toBeGreaterThan(box.x + box.width)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.locator('.records-page-content').screenshot({
    path: 'test-results/mobile-records.png',
  })
})

test('search filters survive detail, management, edit and return navigation', async ({
  page,
}) => {
  await setup(page)
  await page.goto('/?view=search&q=原始&tag=React')
  await page.locator('.record-card').click()
  await expect(
    page.getByRole('heading', { name: '原始记录', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '移入回收站', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('link', { name: '管理记录', exact: false }).click()
  await expect(page).toHaveURL(/manage=1/)
  await expect(page.getByText('原始正文', { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: '编辑记录', exact: true }).click()
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('原始记录')
  await page.getByRole('link', { name: '返回记录管理', exact: false }).click()
  await page.getByRole('link', { name: '返回记录详情', exact: false }).click()
  await page.getByRole('link', { name: '返回记录列表', exact: false }).click()
  await expect(page).toHaveURL(/view=search/)
  await expect(page.getByLabel('搜索标题')).toHaveValue('原始')
  await expect(page.getByLabel('标签', { exact: true })).toHaveValue('React')
  await expect(page.locator('.record-card')).toHaveCount(1)
  await page.getByRole('link', { name: '清除筛选' }).click()
  await expect(page.getByLabel('搜索标题')).toHaveValue('')
  await page.goBack()
  await expect(page.getByLabel('搜索标题')).toHaveValue('原始')
  await expect(page.getByLabel('标签', { exact: true })).toHaveValue('React')
})

test('management hub links to independent trash and cover-cleanup pages', async ({
  page,
}) => {
  const store = await setup(page)
  await page.goto('/?view=records')
  await page.getByRole('link', { name: '记录管理', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '记录管理', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.getByRole('link', { name: '回收站', exact: false }).click()
  await expect(page).toHaveURL(/view=trash/)
  await expect(page.getByText('回收站是空的。', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '返回记录管理', exact: false }).click()
  await page.getByRole('link', { name: '封面清理', exact: false }).click()
  await expect(page).toHaveURL(/view=storage/)
  await expect(page.getByRole('button')).toHaveCount(1)
  await page.screenshot({
    path: 'test-results/cover-cleanup.png',
    fullPage: true,
  })
  await page
    .getByRole('button', { name: '重试清理旧封面', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('待清理图片已处理')
  expect(store.calls).toHaveLength(0)
})

test('independent feature pages require login and never load private records anonymously', async ({
  page,
}) => {
  let privateRequests = 0
  await page.route('https://portfolio-test.supabase.co/**', (route) => {
    privateRequests++
    return route.abort()
  })
  for (const view of ['records', 'search', 'manage', 'trash', 'storage']) {
    await page.goto(`/?view=${view}`)
    await expect(
      page.getByRole('link', { name: '登录后查看记录' }),
    ).toBeVisible()
    await expect(page.locator('.record-card')).toHaveCount(0)
    await expect(page.getByRole('button')).toHaveCount(0)
  }
  expect(privateRequests).toBe(0)
})

test('new record saves text and restores a browser draft after reload', async ({
  page,
}) => {
  const store = await setup(page, [])
  await page.goto('/?new=1')
  await page.getByLabel('标题', { exact: true }).fill('草稿测试')
  await page.getByLabel('详细内容').fill('第一行\n第二行')
  await page.getByLabel('标签', { exact: false }).fill('React，CSS, React')
  await expect(
    page.getByText('文字草稿已保存在此浏览器。', { exact: false }),
  ).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '恢复草稿' }).click()
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('草稿测试')
  await page.getByRole('button', { name: '保存记录', exact: true }).click()
  await expect(page).toHaveURL(/\?record=/)
  await expect(page.getByRole('heading', { name: '草稿测试' })).toBeVisible()
  expect(store.records).toHaveLength(1)
  expect(store.records[0].tags).toEqual(['React', 'CSS'])
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.includes('portfolio:v2:draft:'),
      ),
    ),
  ).toHaveLength(0)
})

test('lost save response retries the exact mutation without creating duplicate records', async ({
  page,
}) => {
  const store = await setup(page, [], { loseResponse: true })
  await page.goto('/?new=1')
  await page.getByLabel('标题', { exact: true }).fill('只保存一次')
  await page.getByRole('button', { name: '保存记录', exact: true }).click()
  await expect(page.getByRole('button', { name: '重试上次保存' })).toBeVisible()
  await expect(page.getByLabel('标题', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '重试上次保存' }).click()
  await expect(page).toHaveURL(/\?record=/)
  expect(store.records).toHaveLength(1)
  expect(store.calls[0].p_request_id).toBe(store.calls[1].p_request_id)
})

test('edit keeps id, removes cover and cleans the unused file', async ({
  page,
}) => {
  const path = `${USER}/old.webp`
  const store = await setup(page, [row({ cover_path: path })])
  await page.goto(`/?edit=${ID}`)
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('原始记录')
  await page.getByLabel('标题', { exact: true }).fill('修改后的记录')
  await page.screenshot({ path: 'test-results/editor.png', fullPage: true })
  await page.getByRole('button', { name: '移除封面' }).click()
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page).toHaveURL(
    `http://127.0.0.1:4179/?record=${ID}&back=%2F%3Fview%3Drecords`,
  )
  expect(store.records).toHaveLength(1)
  expect(store.records[0].cover_path).toBeNull()
  expect(store.deleted).toContain(path)
})

test('pending save survives a reload and replays its receipt without a duplicate', async ({
  page,
}) => {
  const store = await setup(page, [], { loseResponse: true })
  await page.goto('/?new=1')
  await page.getByLabel('标题', { exact: true }).fill('刷新后继续确认')
  await page.getByRole('button', { name: '保存记录', exact: true }).click()
  await expect(page.getByRole('button', { name: '重试上次保存' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '恢复草稿' }).click()
  await page.getByRole('button', { name: '重试上次保存' }).click()
  await expect(page).toHaveURL(/\?record=/)
  expect(store.records).toHaveLength(1)
  expect(store.calls[0].p_request_id).toBe(store.calls[1].p_request_id)
})

test('stale edit preserves inputs and reports a conflict', async ({ page }) => {
  await setup(page, [row()], { conflict: true })
  await page.goto(`/?edit=${ID}`)
  await page.getByLabel('标题', { exact: true }).fill('不能覆盖他人的新版本')
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(
    page.getByText('记录已在其他页面或设备修改。草稿已保留', { exact: false }),
  ).toBeVisible()
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue(
    '不能覆盖他人的新版本',
  )
  await expect(page.getByLabel('标题', { exact: true })).toBeEnabled()
})

test('cover selection is compressed, replacement saves a new path and cleans old image', async ({
  page,
}) => {
  const oldPath = `${USER}/old.webp`
  const store = await setup(page, [row({ cover_path: oldPath })])
  await page.goto(`/?edit=${ID}`)
  await expect(page.getByLabel('标题', { exact: true })).toBeVisible()
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2000
    canvas.height = 1000
    const context = canvas.getContext('2d')
    context.fillStyle = '#94bac3'
    context.fillRect(0, 0, 2000, 1000)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.getByLabel('封面（可选）').setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  })
  await expect(page.getByText('封面已处理：', { exact: false })).toBeVisible()
  const dimensions = await page
    .getByAltText('将保存的封面')
    .evaluate((img) => ({
      width: img.naturalWidth,
      height: img.naturalHeight,
    }))
  expect(dimensions).toEqual({ width: 1600, height: 800 })
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page).toHaveURL(
    `http://127.0.0.1:4179/?record=${ID}&back=%2F%3Fview%3Drecords`,
  )
  expect(store.records[0].cover_path).toMatch(new RegExp(`^${USER}/.*\\.webp$`))
  expect(store.uploaded).toContain(store.records[0].cover_path)
  expect(store.deleted).toContain(oldPath)
})

test('list failures report errors and retry instead of pretending there are no records', async ({
  page,
}) => {
  await setup(page)
  let fail = true
  await page.route('**/rest/v1/records?*', async (route) => {
    if (!fail) return route.fallback()
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: '测试服务暂不可用' }),
    })
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('测试服务暂不可用')
  await expect(page.getByText('还没有记录，写下第一条吧。')).toHaveCount(0)
  fail = false
  await page
    .getByRole('alert')
    .getByRole('button', { name: '重试', exact: true })
    .click()
  await expect(page.locator('.record-card')).toHaveCount(1)
})

test('trash needs confirmation, retains cover, restore works, then purge cleans cover', async ({
  page,
}) => {
  const path = `${USER}/old.webp`
  const store = await setup(page, [row({ cover_path: path })])
  await page.goto(`/?record=${ID}`)
  await page.getByRole('link', { name: '管理记录', exact: false }).click()
  await page.getByRole('button', { name: '移入回收站', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.screenshot({ path: 'test-results/delete-confirmation.png' })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(store.records[0].deleted_at).toBeNull()
  await page.getByRole('button', { name: '移入回收站', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '移入回收站', exact: true })
    .click()
  await expect(page).toHaveURL(/view=records/)
  expect(store.records[0].deleted_at).toBeTruthy()
  expect(store.deleted).toHaveLength(0)
  await page.getByRole('link', { name: '记录管理', exact: true }).click()
  await page.getByRole('link', { name: '回收站', exact: false }).click()
  await page.locator('.record-card').click()
  await page.getByRole('link', { name: '管理记录', exact: false }).click()
  await page.getByRole('button', { name: '恢复记录' }).click()
  await expect(
    page.getByRole('button', { name: '移入回收站', exact: true }),
  ).toBeVisible()
  expect(store.records[0].deleted_at).toBeNull()
  await page.getByRole('button', { name: '移入回收站', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '移入回收站', exact: true })
    .click()
  await expect(page).toHaveURL(/view=trash/)
  await page.locator('.record-card').click()
  await page.getByRole('link', { name: '管理记录', exact: false }).click()
  await page.getByRole('button', { name: '彻底删除', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '彻底删除', exact: true })
    .click()
  await expect(page).toHaveURL(/view=trash/)
  expect(store.records).toHaveLength(0)
  expect(store.deleted).toContain(path)
})
