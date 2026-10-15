import { test, expect } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { unzipSync, strFromU8 } from 'fflate'
import fs from 'node:fs/promises'

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID = '11111111-1111-4111-8111-111111111111'
const COVER_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
)
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
  is_public: false,
  ...extra,
})
const invitationMetadata = (item) => ({
  id: item.id,
  created_at: item.created_at,
  expires_at: item.expires_at,
  revoked_at: item.revoked_at,
  redeemed_at: item.redeemed_at,
})

async function setup(page, records = [row()], options = {}) {
  const store = {
    records,
    receipts: new Map(),
    calls: [],
    uploaded: [],
    deleted: [],
    loseResponse: !!options.loseResponse,
    logoutScopes: [],
    listRequests: [],
    failCover: false,
    authorId: USER,
    publicRequests: [],
    members: new Set(options.member === false ? [] : [options.user || USER]),
    emailVerified: options.emailVerified !== false,
    invitations: [],
    authRequests: [],
    passwordUpdates: 0,
    loseInvitationResponse: !!options.loseInvitationResponse,
  }
  await page.addInitScript(
    ({ user, signedOut, verified }) => {
      if (localStorage.getItem('test-auth-initialized')) return
      localStorage.setItem('test-auth-initialized', '1')
      if (signedOut) return
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
          email_confirmed_at: verified ? '2026-10-15T00:00:00Z' : null,
          aud: 'authenticated',
          role: 'authenticated',
        },
      }
      localStorage.setItem(
        'sb-portfolio-test-auth-token',
        JSON.stringify(session),
      )
    },
    {
      user: options.user || USER,
      signedOut: !!options.signedOut,
      verified: store.emailVerified,
    },
  )
  await page.route('https://portfolio-test.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const actor = request.headers().authorization?.startsWith('Bearer test.')
      ? JSON.parse(
          Buffer.from(
            request.headers().authorization.split('.')[1],
            'base64url',
          ).toString(),
        ).sub
      : null
    const json = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(data),
        headers: {
          'Access-Control-Allow-Origin': '*',
          'x-supabase-api-version': '2024-01-01',
          'Access-Control-Expose-Headers': 'X-Supabase-Api-Version',
        },
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
    const authUser = {
      id: options.user || USER,
      email: 'test@example.invalid',
      aud: 'authenticated',
      role: 'authenticated',
      email_confirmed_at: store.emailVerified ? '2026-10-15T00:00:00Z' : null,
    }
    if (url.pathname === '/auth/v1/signup') {
      store.authRequests.push({
        type: 'signup',
        redirect: url.searchParams.get('redirect_to'),
        email: request.postDataJSON().email,
      })
      return json({ ...authUser, email_confirmed_at: null })
    }
    if (
      url.pathname === '/auth/v1/recover' ||
      url.pathname === '/auth/v1/resend'
    ) {
      store.authRequests.push({
        type: url.pathname.endsWith('recover') ? 'recover' : 'resend',
        redirect: url.searchParams.get('redirect_to'),
        email: request.postDataJSON().email,
      })
      if (options.mailError)
        return json(
          { code: 'over_email_send_rate_limit', message: 'Rate limit' },
          429,
        )
      return json({})
    }
    if (url.pathname === '/auth/v1/user' && request.method() === 'PUT') {
      store.passwordUpdates++
      return json(authUser)
    }
    if (url.pathname === '/auth/v1/logout') {
      store.logoutScopes.push(url.searchParams.get('scope'))
      return json({})
    }
    if (url.pathname === '/auth/v1/token') {
      if (options.emailVerified === false)
        return json(
          { code: 'email_not_confirmed', message: 'Email not confirmed' },
          400,
        )
      if (options.rejectLogin)
        return json(
          { code: 'invalid_credentials', message: 'Invalid login credentials' },
          400,
        )
      const body = Buffer.from(
        JSON.stringify({
          sub: options.user || USER,
          exp: Math.floor(Date.now() / 1000) + 3600,
          role: 'authenticated',
        }),
      ).toString('base64url')
      return json({
        access_token: `test.${body}.signature`,
        refresh_token: 'test-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: options.user || USER,
          email: 'test@example.invalid',
          aud: 'authenticated',
          role: 'authenticated',
          email_confirmed_at: authUser.email_confirmed_at,
        },
      })
    }
    if (url.pathname === '/auth/v1/user' && options.expired)
      return json({ code: 'bad_jwt', message: 'JWT expired' }, 401)
    if (url.pathname === '/auth/v1/user') return json(authUser)
    const canWrite =
      actor &&
      (actor === store.authorId ||
        (store.members.has(actor) && store.emailVerified))
    if (url.pathname.endsWith('/rpc/note_access'))
      return json({
        is_author: actor === store.authorId,
        can_write: !!canWrite,
        email_verified: store.emailVerified,
      })
    if (url.pathname.endsWith('/rpc/redeem_note_invitation')) {
      if (!store.emailVerified)
        return json(
          { code: '42501', message: '请先验证邮箱，再兑换邀请码。' },
          403,
        )
      if (canWrite) return json({ ok: true, already_active: true })
      const code = request.postDataJSON().p_code
      const invite = store.invitations.find(
        (item) =>
          item.code === code &&
          !item.redeemed_at &&
          !item.revoked_at &&
          new Date(item.expires_at) > new Date(),
      )
      if (!invite)
        return json({
          ok: false,
          message: '邀请码无效、已使用或已过期，请向网站作者获取新邀请码。',
        })
      invite.redeemed_at = new Date().toISOString()
      store.members.add(actor)
      return json({ ok: true, already_active: false })
    }
    if (url.pathname.endsWith('/rpc/list_note_invitations')) {
      if (actor !== store.authorId)
        return json(
          { code: '42501', message: '只有网站作者可以管理邀请码。' },
          403,
        )
      const cursor = request.postDataJSON() || {}
      let rows = [...store.invitations].sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      )
      if (cursor.p_before_created_at)
        rows = rows.filter(
          (row) =>
            row.created_at < cursor.p_before_created_at ||
            (row.created_at === cursor.p_before_created_at &&
              row.id < cursor.p_before_id),
        )
      return json(rows.slice(0, 21).map(invitationMetadata))
    }
    if (url.pathname.endsWith('/rpc/issue_note_invitation')) {
      if (actor !== store.authorId)
        return json(
          { code: '42501', message: '只有网站作者可以生成邀请码。' },
          403,
        )
      const p = request.postDataJSON()
      let invite = store.invitations.find((row) => row.id === p.p_id)
      if (!invite) {
        invite = {
          id: p.p_id,
          code: p.p_code,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + p.p_days * 86400000).toISOString(),
          revoked_at: null,
          redeemed_at: null,
        }
        store.invitations.unshift(invite)
      }
      if (store.loseInvitationResponse) {
        store.loseInvitationResponse = false
        return route.abort('failed')
      }
      return json(invitationMetadata(invite))
    }
    if (url.pathname.endsWith('/rpc/revoke_note_invitation')) {
      if (actor !== store.authorId)
        return json(
          { code: '42501', message: '只有网站作者可以撤销邀请码。' },
          403,
        )
      const invite = store.invitations.find(
        (row) => row.id === request.postDataJSON().p_id,
      )
      invite.revoked_at = new Date().toISOString()
      return json(null)
    }
    if (url.pathname.endsWith('/rpc/is_portfolio_author'))
      return json(actor === store.authorId)
    if (url.pathname.endsWith('/rpc/public_record_tags')) {
      return json(
        [
          ...new Set(
            store.records
              .filter(
                (r) =>
                  r.user_id === store.authorId && r.is_public && !r.deleted_at,
              )
              .flatMap((r) => r.tags),
          ),
        ]
          .sort()
          .map((tag) => ({ tag })),
      )
    }
    if (url.pathname.endsWith('/rpc/public_record')) {
      store.publicRequests.push(request.url())
      const id = request.postDataJSON().p_record_id
      return json(
        store.records
          .filter(
            (r) =>
              r.id === id &&
              r.user_id === store.authorId &&
              r.is_public &&
              !r.deleted_at,
          )
          .map((r) => ({
            id: r.id,
            title: r.title,
            tags: r.tags,
            content: r.content,
            cover_path: r.cover_path,
            created_at: r.created_at,
            updated_at: r.updated_at,
          })),
      )
    }
    if (url.pathname.endsWith('/rpc/public_records')) {
      store.publicRequests.push(request.url())
      const p = request.postDataJSON()
      let result = store.records.filter(
        (r) => r.user_id === store.authorId && r.is_public && !r.deleted_at,
      )
      if (p.p_query)
        result = result.filter((r) =>
          r.title.toLowerCase().includes(p.p_query.toLowerCase()),
        )
      if (p.p_tag) result = result.filter((r) => r.tags.includes(p.p_tag))
      result.sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      )
      if (p.p_before_created_at)
        result = result.filter(
          (r) =>
            r.created_at < p.p_before_created_at ||
            (r.created_at === p.p_before_created_at && r.id < p.p_before_id),
        )
      return json(
        result.slice(0, Math.min(p.p_limit || 13, 50)).map((r) => ({
          id: r.id,
          title: r.title,
          tags: r.tags,
          cover_path: r.cover_path,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
      )
    }
    if (url.pathname.includes('/rpc/record_tags')) {
      const trash = request.postDataJSON().p_trash
      return json(
        [
          ...new Set(
            store.records
              .filter((r) => r.user_id === actor && !!r.deleted_at === trash)
              .flatMap((r) => r.tags),
          ),
        ]
          .sort()
          .map((tag) => ({ tag })),
      )
    }
    if (
      url.pathname.includes('/rpc/mutate_record') ||
      url.pathname.includes('/rpc/set_record_visibility')
    ) {
      if (!canWrite)
        return json(
          { code: '42501', message: '请先兑换邀请码，开通笔记记录功能。' },
          403,
        )
      const p = request.postDataJSON()
      if (url.pathname.includes('/rpc/set_record_visibility')) {
        if (actor !== store.authorId)
          return json(
            { code: '42501', message: '只有网站作者可以设置公开展示。' },
            403,
          )
        p.p_action = p.p_public ? 'publish' : 'unpublish'
      }
      store.calls.push(p)
      if (store.receipts.has(p.p_request_id))
        return json(store.receipts.get(p.p_request_id))
      let record = store.records.find(
        (r) => r.id === p.p_record_id && r.user_id === actor,
      )
      const old = record?.cover_path || null
      if (p.p_action === 'create') {
        record = row({
          id: p.p_record_id,
          user_id: actor,
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
        if (p.p_action === 'publish' || p.p_action === 'unpublish') {
          if (record.deleted_at)
            return json(
              { code: 'P0001', message: '回收站中的记录不能设置公开。' },
              400,
            )
          record.is_public = p.p_action === 'publish'
        }
        if (p.p_action === 'trash') {
          record.deleted_at = new Date().toISOString()
          record.is_public = false
        }
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
      store.listRequests.push(request.url())
      if (!actor)
        return json(
          { code: '42501', message: 'permission denied for table records' },
          403,
        )
      let result = store.records.filter((r) => r.user_id === actor)
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
    if (
      url.pathname.includes('/storage/v1/object/record-covers/') &&
      request.method() === 'GET'
    ) {
      const path = decodeURIComponent(url.pathname.split('/record-covers/')[1])
      const permitted =
        path.startsWith(actor + '/') ||
        store.records.some(
          (r) =>
            r.user_id === store.authorId &&
            r.is_public &&
            !r.deleted_at &&
            r.cover_path === path,
        )
      return route.fulfill({
        status: permitted && !store.failCover ? 200 : 403,
        contentType: 'image/png',
        body: permitted ? COVER_BYTES : 'Forbidden',
      })
    }
    if (
      url.pathname.includes('/storage/v1/object/sign/') &&
      request.method() === 'GET'
    )
      return route.fulfill({
        status: store.failCover ? 503 : 200,
        contentType: 'image/png',
        body: store.failCover ? 'Unavailable' : COVER_BYTES,
      })
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
      is_public: true,
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
  await page.getByRole('link', { name: '查看全部练习' }).click()
  await expect(page).toHaveURL(/view=showcase/)
  await expect(page.locator('.record-card')).toHaveCount(12)
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('.record-card')).toHaveCount(24)
  await page.goto('/?view=records')
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
  for (const view of [
    'records',
    'search',
    'manage',
    'trash',
    'storage',
    'backup',
  ]) {
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
  expect(store.records[0].is_public).toBe(false)
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
  await page.goto('/?view=records')
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
  const store = await setup(page, [row({ cover_path: path, is_public: true })])
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
  expect(store.records[0].is_public).toBe(false)
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
  expect(store.records[0].is_public).toBe(false)
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

test('homepage downloads the small WOFF2 and never requests the original TTF', async ({
  page,
}) => {
  await setup(page, [], { signedOut: true })
  const requests = []
  page.on('request', (request) => requests.push(request.url()))
  const [font] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('portfolio-hero') &&
        response.request().resourceType() === 'font',
    ),
    page.goto('/'),
  ])
  expect(font.status()).toBe(200)
  expect((await font.body()).length).toBeLessThan(20000)
  await page.evaluate(() => document.fonts.ready)
  expect(requests.some((url) => url.includes('.ttf'))).toBe(false)
  expect(requests.some((url) => url.includes('/MarkdownContent'))).toBe(false)
  expect(
    await page.evaluate(() => document.fonts.check('45px "Portfolio Hero"')),
  ).toBe(true)
  await page.locator('.hero').screenshot({ path: 'test-results/hero-font.png' })
})

test('account shows identity, signs out locally and retains private browser drafts', async ({
  page,
}) => {
  const store = await setup(page)
  await page.goto('/')
  await page.getByRole('link', { name: '我的账号', exact: true }).click()
  await expect(
    page.getByText('test@example.invalid', { exact: true }),
  ).toBeVisible()
  await page.evaluate(() =>
    localStorage.setItem(
      'portfolio:v2:draft:account-test',
      JSON.stringify({ title: '保留草稿' }),
    ),
  )
  await page.screenshot({ path: 'test-results/account.png', fullPage: true })
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(
    page.getByText('已退出当前设备。', { exact: false }),
  ).toBeVisible()
  expect(store.logoutScopes).toEqual(['local'])
  expect(
    await page.evaluate(() =>
      localStorage.getItem('portfolio:v2:draft:account-test'),
    ),
  ).toContain('保留草稿')
  await page.getByRole('link', { name: '返回记录列表', exact: false }).click()
  await expect(
    page.getByRole('link', { name: '登录后查看记录', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.record-card')).toHaveCount(0)
})

test('login restores the requested edit page after authenticating', async ({
  page,
}) => {
  await setup(page, [row()], { signedOut: true })
  const destination = `/?edit=${ID}&back=%2F%3Fview%3Drecords`
  await page.goto(destination)
  await page.getByRole('link', { name: '请先登录', exact: true }).click()
  await expect(page).toHaveURL(/login=1&next=/)
  await page.getByLabel('邮箱', { exact: true }).fill('test@example.invalid')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4179' + destination)
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('原始记录')
})

test('failed credentials stay on login and an expired session cannot read records', async ({
  page,
}) => {
  const store = await setup(page, [row()], { expired: true, rejectLogin: true })
  await page.goto('/?view=records')
  await expect(
    page.getByText('登录已过期，请重新登录。', { exact: true }),
  ).toBeVisible()
  expect(store.listRequests).toHaveLength(0)
  await page.getByRole('link', { name: '登录后查看记录' }).click()
  await page.getByLabel('邮箱', { exact: true }).fill('test@example.invalid')
  await page.getByLabel('密码', { exact: true }).fill('incorrect')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('登录失败：', { exact: false })).toBeVisible()
  await expect(page).toHaveURL(/login=1/)
})

test('signing out in another tab closes the editor and flushes its text draft', async ({
  page,
  context,
}) => {
  await setup(page)
  await page.goto('/?new=1')
  await expect(page.getByLabel('标题', { exact: true })).toBeVisible()
  const other = await context.newPage()
  await setup(other)
  await other.goto('/?view=account')
  await expect(
    other.getByRole('button', { name: '退出登录', exact: true }),
  ).toBeVisible()
  await page.getByLabel('标题', { exact: true }).fill('跨标签退出前的草稿')
  await other.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '请先登录', exact: true }),
  ).toBeVisible()
  const drafts = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith('portfolio:v2:draft:'))
      .map(([, value]) => JSON.parse(value)),
  )
  expect(
    drafts.some((draft) => draft.form?.title === '跨标签退出前的草稿'),
  ).toBe(true)
  await other.close()
})

test('JSON backup reads beyond one page, includes trash optionally and excludes tokens', async ({
  page,
}) => {
  const records = Array.from({ length: 206 }, (_, i) =>
    row({
      id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, '0')}`,
      title: `备份记录 ${i + 1}`,
      created_at: new Date(Date.UTC(2026, 9, 15, 12, -i)).toISOString(),
      deleted_at: i === 205 ? '2026-10-15T13:00:00.000Z' : null,
    }),
  )
  const store = await setup(page, records)
  await page.goto('/?view=manage')
  await page.getByRole('link', { name: '数据备份', exact: false }).click()
  await page.getByRole('button', { name: '生成备份', exact: true }).click()
  await expect(
    page.getByRole('link', { name: '下载备份', exact: true }),
  ).toBeVisible()
  let [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: '下载备份', exact: true }).click(),
  ])
  let backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'))
  expect(backup.records).toHaveLength(206)
  expect(backup.records.some((record) => record.deleted_at)).toBe(true)
  expect(backup.coverFilesIncluded).toBe(false)
  expect(JSON.stringify(backup)).not.toContain('access_token')
  expect(store.listRequests).toHaveLength(2)
  await page.getByLabel('包含回收站中的记录').uncheck()
  await page.getByRole('button', { name: '生成备份', exact: true }).click()
  await expect(
    page.getByRole('link', { name: '下载备份', exact: true }),
  ).toBeVisible()
  ;[download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: '下载备份', exact: true }).click(),
  ])
  backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'))
  expect(backup.records).toHaveLength(205)
  expect(backup.records.some((record) => record.deleted_at)).toBe(false)
  expect(store.calls).toHaveLength(0)
})

test('ZIP backup includes real cover bytes once for shared paths and a readable manifest', async ({
  page,
}) => {
  const path = `${USER}/cover.png`
  await setup(page, [
    row({ cover_path: path }),
    row({
      id: '33333333-3333-4333-8333-333333333333',
      cover_path: path,
      deleted_at: '2026-10-15',
    }),
  ])
  await page.goto('/?view=backup')
  await page.getByLabel('备份格式').selectOption('zip')
  await page.getByRole('button', { name: '生成备份', exact: true }).click()
  await expect(
    page.getByRole('link', { name: '下载备份', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/backup.png', fullPage: true })
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: '下载备份', exact: true }).click(),
  ])
  const files = unzipSync(await fs.readFile(await download.path()))
  const backup = JSON.parse(strFromU8(files['records.json']))
  expect(backup.records).toHaveLength(2)
  expect(backup.coverFilesIncluded).toBe(true)
  expect(
    Object.keys(files).filter((name) => name.startsWith('covers/')),
  ).toHaveLength(1)
  const cover = backup.records[0].cover_file
  expect(backup.records[1].cover_file).toBe(cover)
  expect(Buffer.from(files[cover])).toEqual(COVER_BYTES)
  expect(strFromU8(files['README.txt'])).toContain('当前网站尚无自动导入入口')
})

test('failed cover download never produces a misleading complete ZIP and JSON remains available', async ({
  page,
}) => {
  const store = await setup(page, [row({ cover_path: `${USER}/cover.png` })])
  store.failCover = true
  await page.goto('/?view=backup')
  await page.getByLabel('备份格式').selectOption('zip')
  await page.getByRole('button', { name: '生成备份', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('本次 ZIP 未生成')
  await expect(
    page.getByRole('link', { name: '下载备份', exact: true }),
  ).toHaveCount(0)
  await page.getByLabel('备份格式').selectOption('json')
  await page.getByRole('button', { name: '生成备份', exact: true }).click()
  await expect(
    page.getByRole('link', { name: '下载备份', exact: true }),
  ).toBeVisible()
})

test('backup cancellation stops a pending page without changing cloud records', async ({
  page,
}) => {
  const store = await setup(page)
  let release
  let requestStarted = false
  const gate = new Promise((resolve) => {
    release = resolve
  })
  await page.route('**/rest/v1/records?*', async (route) => {
    requestStarted = true
    await gate
    try {
      await route.fallback()
    } catch {
      /* browser has already cancelled this request */
    }
  })
  await page.goto('/?view=backup')
  await page.getByRole('button', { name: '生成备份', exact: true }).click()
  await expect.poll(() => requestStarted).toBe(true)
  await page.getByRole('button', { name: '取消导出', exact: true }).click()
  await expect(
    page.getByText('导出已取消，云端记录不受影响。', { exact: true }),
  ).toBeVisible()
  release()
  await expect(
    page.getByRole('link', { name: '下载备份', exact: true }),
  ).toHaveCount(0)
  expect(store.calls).toHaveLength(0)
})

test('Markdown preview and saved reading render code, tables and lists without executing HTML', async ({
  page,
}) => {
  const store = await setup(page, [])
  await page.goto('/?new=1')
  await page.getByLabel('标题', { exact: true }).fill('Markdown 记录')
  const markdown = [
    '## 学习笔记',
    '',
    '**重点**与`行内代码`',
    '',
    '- 列表项',
    '',
    '| 项目 | 状态 |',
    '| --- | --- |',
    '| React | 完成 |',
    '',
    '```python',
    'print("Hello")',
    '# ' + '长代码'.repeat(60),
    '```',
    '',
    '```unknown-language',
    '<literal>',
    '```',
    '',
    '[官方资料](https://example.com)',
    '[危险链接](javascript:alert(1))',
    '',
    '<script>window.markdownExecuted = true</script>',
    '<img src=x onerror="window.markdownExecuted=true">',
  ].join('\n')
  await page.getByLabel('详细内容', { exact: true }).fill(markdown)
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '学习笔记', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.markdown-body strong')).toHaveText('重点')
  await expect(page.locator('.markdown-body table')).toBeVisible()
  await expect(
    page.locator('.markdown-body .hljs-built_in').first(),
  ).toBeVisible()
  await expect(page.locator('.markdown-body pre').last()).toContainText(
    '<literal>',
  )
  await expect(page.locator('.markdown-body script')).toHaveCount(0)
  await expect(page.locator('.markdown-body img')).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: '危险链接', exact: true }),
  ).toHaveCount(0)
  expect(await page.evaluate(() => window.markdownExecuted)).toBeUndefined()
  await page.setViewportSize({ width: 375, height: 812 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: 'test-results/markdown-preview.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: '写作', exact: true }).click()
  await expect(page.getByLabel('详细内容', { exact: true })).toHaveValue(
    markdown,
  )
  await page.getByRole('button', { name: '保存记录', exact: true }).click()
  await expect(page).toHaveURL(/\?record=/)
  await expect(
    page.getByRole('heading', { name: '学习笔记', exact: true }),
  ).toBeVisible()
  expect(store.records[0].content).toBe(markdown)
  expect(await page.evaluate(() => window.markdownExecuted)).toBeUndefined()
})

test('guests browse published work and covers without private-table or signed-link requests', async ({
  page,
}) => {
  const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const path = `${USER}/public.png`
  const store = await setup(
    page,
    [
      row({
        title: '公开的练习',
        tags: ['公开标签'],
        content: '## 可以阅读的正文',
        is_public: true,
        cover_path: path,
      }),
      row({
        id: '22222222-2222-4222-8222-222222222222',
        title: '私密标题',
        tags: ['私密标签'],
      }),
      row({
        id: '33333333-3333-4333-8333-333333333333',
        title: '回收站标题',
        is_public: true,
        deleted_at: '2026-10-15',
      }),
      row({
        id: '44444444-4444-4444-8444-444444444444',
        title: '其他作者标题',
        user_id: other,
        is_public: true,
      }),
    ],
    { signedOut: true },
  )
  const requests = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/')
  await expect(page.locator('.record-card')).toHaveCount(1)
  await expect(page.locator('.record-card')).toContainText('公开的练习')
  await page.getByRole('link', { name: '查看全部练习', exact: false }).click()
  await expect(
    page.getByRole('heading', { name: '练习展示', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByLabel('标签', { exact: true }).locator('option'),
  ).toHaveText(['全部标签', '公开标签'])
  await page.locator('.record-card').click()
  await expect(page).toHaveURL(/\?show=/)
  await expect(
    page.getByRole('heading', { name: '可以阅读的正文' }),
  ).toBeVisible()
  await expect(page.getByAltText('公开的练习的封面')).toBeVisible()
  await expect
    .poll(() =>
      page.getByAltText('公开的练习的封面').evaluate((img) => img.naturalWidth),
    )
    .toBe(1)
  await expect(page.getByRole('button', { name: '编辑记录' })).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: '管理记录', exact: false }),
  ).toHaveCount(0)
  expect(store.listRequests).toHaveLength(0)
  expect(store.calls).toHaveLength(0)
  expect(requests.some((url) => url.includes('/object/sign/'))).toBe(false)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: 'test-results/public-reading-mobile.png',
    fullPage: true,
  })
  await page.goto(`/?record=${ID}`)
  await expect(
    page.getByRole('heading', { name: '可以阅读的正文' }),
  ).toBeVisible()
  await page.goto('/?show=22222222-2222-4222-8222-222222222222')
  await expect(
    page.getByText('这条练习未公开、已取消公开或不存在。'),
  ).toBeVisible()
  await expect(page.getByText('私密标题', { exact: true })).toHaveCount(0)
})

test('author confirms publishing, shares a public link and can withdraw it', async ({
  page,
}) => {
  const store = await setup(page)
  await page.goto(`/?record=${ID}&manage=1`)
  await page.getByRole('button', { name: '公开展示', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('标题、标签、正文和封面')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(store.calls).toHaveLength(0)
  await page.getByRole('button', { name: '公开展示', exact: true }).click()
  await page.getByRole('button', { name: '确认公开', exact: true }).click()
  await expect(
    page.getByText('记录已公开，可以复制公开链接分享。'),
  ).toBeVisible()
  expect(store.records[0].is_public).toBe(true)
  expect(store.records[0].version).toBe(2)
  const url = await page.getByLabel('公开链接', { exact: true }).inputValue()
  expect(new URL(url).searchParams.get('show')).toBe(ID)
  expect(new URL(url).searchParams.get('manage')).toBeNull()
  await page.screenshot({
    path: 'test-results/publication-settings.png',
    fullPage: true,
  })
  await page.goto(url)
  await expect(page.locator('.markdown-body')).toContainText('原始正文')
  await expect(
    page.getByRole('link', { name: '管理记录', exact: false }),
  ).toHaveCount(0)
  await page.goto(`/?edit=${ID}`)
  await expect(page.getByText('这条记录已公开', { exact: false })).toBeVisible()
  await page.goto(`/?record=${ID}&manage=1`)
  await page.getByRole('button', { name: '取消公开', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '取消公开', exact: true })
    .click()
  await expect(page.getByText('已取消公开，记录仅自己可见。')).toBeVisible()
  expect(store.records[0].is_public).toBe(false)
  expect(store.records[0].version).toBe(3)
  await page.goto(url)
  await expect(
    page.getByText('这条练习未公开、已取消公开或不存在。'),
  ).toBeVisible()
  expect(store.deleted).toHaveLength(0)
})

test('lost publication response survives reload and replays the same request once', async ({
  page,
}) => {
  const store = await setup(page, [row()], { loseResponse: true })
  await page.goto(`/?record=${ID}&manage=1`)
  await page.getByRole('button', { name: '公开展示', exact: true }).click()
  await page.getByRole('button', { name: '确认公开', exact: true }).click()
  await expect(page.getByRole('button', { name: '重试上次操作' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '重试上次操作' }).click()
  await expect(
    page.getByText('记录已公开，可以复制公开链接分享。'),
  ).toBeVisible()
  expect(store.calls).toHaveLength(2)
  expect(store.calls[0].p_request_id).toBe(store.calls[1].p_request_id)
  expect(store.calls[1].p_action).toBe('publish')
  expect(store.records[0].version).toBe(2)
  expect(store.records[0].is_public).toBe(true)
  await expect(page.getByRole('button', { name: '重试上次操作' })).toHaveCount(
    0,
  )
})

test('other accounts can read public links but never see author management or publish their own work', async ({
  page,
}) => {
  const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const otherId = '22222222-2222-4222-8222-222222222222'
  const store = await setup(
    page,
    [
      row({ is_public: true }),
      row({ id: otherId, user_id: other, title: '另一账号的私密记录' }),
    ],
    { user: other },
  )
  await page.goto(`/?record=${ID}`)
  await expect(page.locator('.public-record-content')).toContainText('原始正文')
  await expect(
    page.getByRole('link', { name: '管理记录', exact: false }),
  ).toHaveCount(0)
  await page.goto(`/?record=${ID}&manage=1`)
  await expect(
    page.getByText('记录不存在，或当前账号没有访问权限。'),
  ).toBeVisible()
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.goto(`/?record=${otherId}&manage=1`)
  await expect(
    page.getByText('此账号的记录保持私密。公开展示由网站作者管理。'),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '公开展示', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: '编辑记录', exact: true }),
  ).toBeVisible()
  expect(store.calls).toHaveLength(0)
})

test('public filters and return links keep their scope and private tags are excluded', async ({
  page,
}) => {
  await setup(
    page,
    [
      row({ title: 'React 100%_ 练习', tags: ['React'], is_public: true }),
      row({
        id: '22222222-2222-4222-8222-222222222222',
        title: 'React 100abc',
        tags: ['CSS'],
        is_public: true,
      }),
      row({
        id: '33333333-3333-4333-8333-333333333333',
        title: 'React 100%_ 私密',
        tags: ['私密标签'],
      }),
    ],
    { signedOut: true },
  )
  await page.goto('/?view=showcase')
  await page.getByLabel('搜索标题', { exact: true }).fill('100%_')
  await page.getByLabel('标签', { exact: true }).selectOption('React')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.locator('.record-card')).toHaveCount(1)
  await page.locator('.record-card').click()
  await page.getByRole('link', { name: '返回练习展示', exact: false }).click()
  await expect(page).toHaveURL(/view=showcase/)
  await expect(page.getByLabel('搜索标题', { exact: true })).toHaveValue(
    '100%_',
  )
  await expect(page.getByLabel('标签', { exact: true })).toHaveValue('React')
  await expect(
    page.getByRole('option', { name: '私密标签', exact: true }),
  ).toHaveCount(0)
})

test('missing publication schema and stale publication changes stay visible and do not break editing', async ({
  page,
}) => {
  const store = await setup(page, [row()])
  let missing = true
  await page.route('**/rest/v1/rpc/is_portfolio_author', (route) =>
    missing
      ? route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'PGRST202',
            message: 'Missing function',
          }),
        })
      : route.fallback(),
  )
  await page.goto(`/?record=${ID}&manage=1`)
  await expect(page.getByRole('alert')).toContainText('云端功能尚未更新')
  await expect(
    page.getByRole('link', { name: '编辑记录', exact: true }),
  ).toBeVisible()
  missing = false
  await page.getByRole('button', { name: '重试公开设置' }).click()
  await page.getByRole('button', { name: '公开展示', exact: true }).click()
  store.records[0].version = 2 // Another device changes the record after this page reads it.
  await page.getByRole('button', { name: '确认公开', exact: true }).click()
  await expect(
    page.getByText('记录已在其他页面或设备修改，请重新读取记录后再操作。'),
  ).toBeVisible()
  expect(store.records[0].is_public).toBe(false)
  await expect(page.getByRole('button', { name: '重试上次操作' })).toHaveCount(
    0,
  )
  await page.getByRole('button', { name: '重新读取记录', exact: true }).click()
  await page.getByRole('button', { name: '公开展示', exact: true }).click()
  await page.getByRole('button', { name: '确认公开', exact: true }).click()
  await expect(
    page.getByText('记录已公开，可以复制公开链接分享。'),
  ).toBeVisible()
  expect(store.records[0].version).toBe(3)
})

test('public reading and cover failures can retry without exposing a partial private record', async ({
  page,
}) => {
  const store = await setup(
    page,
    [row({ is_public: true, cover_path: `${USER}/cover.png` })],
    { signedOut: true },
  )
  let fail = true
  store.failCover = true
  await page.route('**/rest/v1/rpc/public_record', (route) =>
    fail
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: '公开读取暂不可用' }),
        })
      : route.fallback(),
  )
  await page.goto(`/?show=${ID}`)
  await expect(page.getByRole('alert')).toContainText('公开读取暂不可用')
  fail = false
  await page.getByRole('button', { name: '重试读取', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('原始正文')
  await expect(
    page.getByRole('button', { name: '重试封面', exact: true }),
  ).toBeVisible()
  store.failCover = false
  await page.getByRole('button', { name: '重试封面', exact: true }).click()
  await expect(page.getByAltText('原始记录的封面')).toBeVisible()
  store.records[0].is_public = false
  await page.reload()
  await expect(
    page.getByText('这条练习未公开、已取消公开或不存在。'),
  ).toBeVisible()
  await expect(page.locator('.record-cover')).toHaveCount(0)
})

function emailCallback(type, user = USER) {
  const body = Buffer.from(
    JSON.stringify({
      sub: user,
      exp: Math.floor(Date.now() / 1000) + 3600,
      role: 'authenticated',
    }),
  ).toString('base64url')
  return `#${new URLSearchParams({ access_token: `test.${body}.signature`, refresh_token: 'test-refresh', expires_in: '3600', token_type: 'bearer', type })}`
}

test('registration validates confirmation before sending and sends an internal verification callback', async ({
  page,
}) => {
  const store = await setup(page, [], { signedOut: true, member: false })
  await page.goto('/?login=1')
  await page.getByRole('link', { name: '注册账号', exact: true }).click()
  await page.getByLabel('邮箱', { exact: true }).fill('new@example.invalid')
  await page
    .getByLabel('密码（至少 8 个字符）', { exact: true })
    .fill('Test-password-1')
  await page.getByLabel('再次输入密码', { exact: true }).fill('Test-password-2')
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('不一致')
  expect(store.authRequests).toHaveLength(0)
  await page.getByLabel('再次输入密码', { exact: true }).fill('Test-password-1')
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(
    page.getByText('注册请求已提交。', { exact: false }),
  ).toBeVisible()
  expect(store.authRequests).toEqual([
    {
      type: 'signup',
      email: 'new@example.invalid',
      redirect: 'http://127.0.0.1:4179/?view=auth-confirm',
    },
  ])
  expect(store.members.size).toBe(0)
  expect(store.records).toHaveLength(0)
  await page.screenshot({
    path: 'test-results/registration-confirmation.png',
    fullPage: true,
  })
})

test('unconfirmed login offers resend and SMTP rate failures keep the form usable', async ({
  page,
}) => {
  const store = await setup(page, [], {
    signedOut: true,
    emailVerified: false,
    mailError: true,
  })
  await page.goto('/?login=1')
  await page.getByLabel('邮箱', { exact: true }).fill('new@example.invalid')
  await page.getByLabel('密码', { exact: true }).fill('Test-password-1')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('邮箱尚未验证')
  await page.getByRole('link', { name: '验证邮箱', exact: true }).click()
  await page.getByLabel('邮箱', { exact: true }).fill('new@example.invalid')
  await page.getByRole('button', { name: '发送验证邮件', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('请求较频繁')
  await expect(
    page.getByRole('button', { name: '发送验证邮件', exact: true }),
  ).toBeEnabled()
  expect(store.authRequests[0].type).toBe('resend')
  expect(store.authRequests[0].redirect).toBe(
    'http://127.0.0.1:4179/?view=auth-confirm',
  )
})

test('forgot-password is anonymous, uses a safe callback and does not reveal account existence', async ({
  page,
}) => {
  const store = await setup(page, [], { signedOut: true })
  await page.goto('/?view=forgot-password&next=https://example.com')
  await page.getByLabel('邮箱', { exact: true }).fill('unknown@example.invalid')
  await page.getByRole('button', { name: '发送重置邮件', exact: true }).click()
  await expect(
    page.getByText(
      '如果该邮箱已注册，重置密码的邮件将发送到邮箱。请打开邮件中的链接。',
    ),
  ).toBeVisible()
  expect(store.authRequests[0]).toEqual({
    type: 'recover',
    email: 'unknown@example.invalid',
    redirect: 'http://127.0.0.1:4179/?view=reset-password',
  })
  expect(store.passwordUpdates).toBe(0)
  await page.goto(
    '/?view=reset-password#error=access_denied&error_code=otp_expired',
  )
  await expect(page.getByRole('alert')).toContainText('重置链接无效或已过期')
  await expect(
    page.getByRole('button', { name: '更新密码', exact: true }),
  ).toHaveCount(0)
})

test('a real SDK email-confirmation callback signs in, strips tokens and still requires an invitation', async ({
  page,
}) => {
  const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const store = await setup(page, [], {
    signedOut: true,
    user: other,
    member: false,
  })
  await page.goto('/?view=auth-confirm' + emailCallback('signup', other))
  await expect(page.getByText('邮箱验证成功，已登录账号。')).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
  await expect(page.locator('body')).not.toContainText('test-refresh')
  await page
    .getByRole('link', { name: '兑换邀请码，开通笔记', exact: false })
    .click()
  await expect(page.getByLabel('邀请码', { exact: true })).toBeVisible()
  expect(store.members.size).toBe(0)
})

test('password recovery callback opens a password form even at the site root and safely updates it', async ({
  page,
}) => {
  const store = await setup(page, [], { signedOut: true })
  await page.goto('/' + emailCallback('recovery'))
  await expect(
    page.getByRole('heading', { name: '设置新密码', exact: true }),
  ).toBeVisible()
  await page
    .getByLabel('密码（至少 8 个字符）', { exact: true })
    .fill('Updated-password-1')
  await page
    .getByLabel('再次输入密码', { exact: true })
    .fill('Updated-password-2')
  await page.getByRole('button', { name: '更新密码', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('不一致')
  expect(store.passwordUpdates).toBe(0)
  await page
    .getByLabel('再次输入密码', { exact: true })
    .fill('Updated-password-1')
  await page.getByRole('button', { name: '更新密码', exact: true }).click()
  await expect(
    page.getByText('密码已更新。下次登录请使用新密码。'),
  ).toBeVisible()
  expect(store.passwordUpdates).toBe(1)
  expect(new URL(page.url()).hash).toBe('')
  expect(store.calls).toHaveLength(0)
})

test('registered nonmembers cannot open editors and redeem exactly one single-use invitation', async ({
  page,
}) => {
  const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const store = await setup(page, [], { user: other, member: false })
  const code = '0123456789ABCDEF0123456789ABCDEF'
  store.invitations.push({
    id: ID,
    code,
    created_at: new Date().toISOString(),
    expires_at: '2100-01-01T00:00:00Z',
    revoked_at: null,
    redeemed_at: null,
  })
  for (const target of ['/?new=1', `/?edit=${ID}`, `/?record=${ID}&manage=1`]) {
    await page.goto(target)
    await expect(
      page.getByRole('link', { name: '兑换邀请码', exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel('标题', { exact: true })).toHaveCount(0)
  }
  expect(store.calls).toHaveLength(0)
  await page.goto('/?view=activate')
  await page
    .getByLabel('邀请码', { exact: true })
    .fill('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
  await page.getByRole('button', { name: '兑换邀请码', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('邀请码无效')
  await page
    .getByLabel('邀请码', { exact: true })
    .fill('01234567-89abcdef-01234567-89abcdef')
  await page.getByRole('button', { name: '兑换邀请码', exact: true }).click()
  await expect(
    page.getByText('笔记记录功能已开通，可以创建自己的私密笔记。'),
  ).toBeVisible()
  expect(store.members.has(other)).toBe(true)
  await page.getByRole('link', { name: '前往我的记录', exact: true }).click()
  await page.getByRole('link', { name: '＋ 新增记录', exact: true }).click()
  await page.getByLabel('标题', { exact: true }).fill('受邀账号的新笔记')
  await page.getByRole('button', { name: '保存记录', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '受邀账号的新笔记', exact: true }),
  ).toBeVisible()
  expect(store.records[0].user_id).toBe(other)
  expect(store.records[0].is_public).toBe(false)
})

test('unconfirmed members cannot redeem and invitation management is author-only', async ({
  page,
}) => {
  const store = await setup(page, [], {
    user: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    member: false,
    emailVerified: false,
  })
  await page.goto('/?view=activate')
  await expect(page.getByText('请先验证邮箱，再兑换邀请码。')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '兑换邀请码', exact: true }),
  ).toHaveCount(0)
  await page.goto('/?view=invitations')
  await expect(page.getByText('邀请管理仅对网站作者开放。')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '生成随机邀请码', exact: true }),
  ).toHaveCount(0)
  expect(store.invitations).toHaveLength(0)
})

test('author generates random invitations, retries a lost response without duplicating and revokes with confirmation', async ({
  page,
}) => {
  const store = await setup(page, [], { loseInvitationResponse: true })
  await page.goto('/?view=account')
  await page.getByRole('link', { name: '邀请管理', exact: true }).click()
  await page.getByLabel('兑换有效期', { exact: true }).selectOption('30')
  await page
    .getByRole('button', { name: '生成随机邀请码', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: '重试本次生成', exact: true }),
  ).toBeVisible()
  expect(store.invitations).toHaveLength(1)
  await page.getByRole('button', { name: '重试本次生成', exact: true }).click()
  await expect(page.getByLabel('本次邀请码', { exact: true })).toHaveValue(
    /^[0-9A-F]{8}(-[0-9A-F]{8}){3}$/,
  )
  expect(store.invitations).toHaveLength(1)
  expect(
    new Date(store.invitations[0].expires_at) -
      new Date(store.invitations[0].created_at),
  ).toBe(30 * 86400000)
  await expect(page.locator('.invitation-row')).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: 'test-results/invitation-manager-mobile.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: '撤销邀请', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(store.invitations[0].revoked_at).toBeNull()
  await page.getByRole('button', { name: '撤销邀请', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '撤销邀请', exact: true })
    .click()
  await expect(page.locator('.invitation-row')).toContainText('已撤销')
  await expect(page.getByLabel('本次邀请码', { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('本次邀请码', { exact: true })).toHaveCount(0)
  await expect(page.locator('.invitation-row')).toContainText('已撤销')
})

test('missing note access fails closed and a retry restores the authorized editor', async ({
  page,
}) => {
  const store = await setup(page)
  let missing = true
  await page.route('**/rest/v1/rpc/note_access', (route) =>
    missing
      ? route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'PGRST202',
            message: 'Missing function',
          }),
        })
      : route.fallback(),
  )
  await page.goto('/?new=1')
  await expect(page.getByRole('alert')).toContainText('云端功能尚未更新')
  await expect(page.getByLabel('标题', { exact: true })).toHaveCount(0)
  expect(store.calls).toHaveLength(0)
  missing = false
  await page.getByRole('button', { name: '重试笔记权限', exact: true }).click()
  await expect(page.getByLabel('标题', { exact: true })).toBeVisible()
})

test('invitation list paginates tied timestamps and keeps used, revoked and expired codes unavailable', async ({
  page,
}) => {
  const store = await setup(page, [])
  store.invitations = Array.from({ length: 25 }, (_, index) => ({
    id: `${String(index).padStart(8, '0')}-2222-4222-8222-222222222222`,
    created_at: '2026-10-15T00:00:00Z',
    expires_at: index < 23 ? '2000-01-01T00:00:00Z' : '2100-01-01T00:00:00Z',
    redeemed_at: index === 23 ? '2026-10-15T01:00:00Z' : null,
    revoked_at: index === 24 ? '2026-10-15T01:00:00Z' : null,
  }))
  await page.goto('/?view=invitations')
  await expect(page.locator('.invitation-row')).toHaveCount(20)
  await expect(
    page.getByRole('button', { name: '撤销邀请', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '加载更多邀请', exact: true }).click()
  await expect(page.locator('.invitation-row')).toHaveCount(25)
  expect(
    new Set(await page.locator('.invitation-row small').allTextContents()).size,
  ).toBe(25)
  await expect(
    page.getByRole('button', { name: '加载更多邀请', exact: true }),
  ).toHaveCount(0)
})
