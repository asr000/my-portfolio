import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  listReturn,
  recordLink,
  safeDestination,
  loginLink,
} from '../src/lib/navigation.js'

test('return navigation retains search filters without accepting other page actions', () => {
  const back = listReturn('/?view=search&q=React+练习&tag=前端&new=1')
  assert.equal(
    back,
    '/?view=search&q=React+%E7%BB%83%E4%B9%A0&tag=%E5%89%8D%E7%AB%AF',
  )
  const link = new URL(
    recordLink('record-id', { back, edit: true }),
    'https://portfolio.invalid',
  )
  assert.equal(link.searchParams.get('back'), back)
  assert.equal(link.searchParams.get('edit'), 'record-id')
  assert.equal(link.searchParams.get('record'), null)
})

test('login returns to an internal page and cannot redirect to an external site or itself', () => {
  const next = '/?edit=123&back=%2F%3Fview%3Dsearch#editor'
  assert.equal(
    new URL(loginLink(next), 'https://portfolio.invalid').searchParams.get(
      'next',
    ),
    next,
  )
  for (const value of [
    'https://example.com/',
    '//example.com/',
    'javascript:alert(1)',
    '/?login=1&next=/',
    'http://',
  ]) {
    assert.equal(safeDestination(value), '/?view=records')
  }
})

test('invalid and external return targets fall back to a record-list page', () => {
  for (const value of [
    'https://example.com/?view=records',
    '//example.com/?view=records',
    'http://',
    '/?view=storage',
    '/other?view=records',
  ]) {
    assert.equal(listReturn(value), '/?view=records')
  }
  assert.equal(listReturn(null, 'trash'), '/?view=trash')
})

test('public shares preserve public search filters and contain no management action', () => {
  const back = '/?view=showcase&q=100%25&tag=React&manage=1'
  const target = new URL(
    recordLink('a/b', { back, publicView: true, manage: true }),
    'https://portfolio.invalid',
  )
  assert.equal(target.searchParams.get('show'), 'a/b')
  assert.equal(target.searchParams.get('record'), null)
  assert.equal(target.searchParams.get('manage'), null)
  assert.equal(
    target.searchParams.get('back'),
    '/?view=showcase&q=100%25&tag=React',
  )
  const fallback = new URL(
    recordLink('id', { publicView: true, back: 'https://example.com/' }),
    'https://portfolio.invalid',
  )
  assert.equal(fallback.searchParams.get('back'), '/?view=showcase')
})
