import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listReturn, recordLink } from '../src/lib/navigation.js'

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
