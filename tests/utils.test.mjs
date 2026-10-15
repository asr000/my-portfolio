import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTags,
  validateRecord,
  escapeLike,
} from '../src/lib/recordUtils.js'

test('tags normalize Chinese commas, empty values, whitespace and duplicates', () => {
  assert.deepEqual(parseTags(' React，CSS, React, ,学习 '), [
    'React',
    'CSS',
    '学习',
  ])
})
test('validation rejects blank title and oversized content', () => {
  assert.throws(
    () => validateRecord({ title: ' ', content: '', tags: '' }),
    /标题/,
  )
  assert.throws(
    () =>
      validateRecord({ title: '有效', content: 'x'.repeat(100001), tags: '' }),
    /正文/,
  )
  assert.throws(
    () => validateRecord({ title: '有效', content: '', tags: 'x'.repeat(25) }),
    /标签/,
  )
})
test('search treats SQL wildcard characters as literal user input', () => {
  assert.equal(escapeLike('100%_done\\'), '100\\%\\_done\\\\')
})
