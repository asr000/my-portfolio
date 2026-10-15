import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validatePassword,
  normalizeInvitationCode,
  randomInvitationCode,
  invitationStatus,
  authErrorText,
} from '../src/lib/accountUtils.js'

test('new passwords require matching confirmation and eight characters', () => {
  assert.throws(() => validatePassword('short', 'short'), /8 个字符/)
  assert.throws(() => validatePassword('password1', 'password2'), /不一致/)
  assert.doesNotThrow(() => validatePassword('password1', 'password1'))
})
test('random invitation codes carry 128 bits and normalize separators without accepting arbitrary punctuation', () => {
  const codes = new Set(Array.from({ length: 100 }, randomInvitationCode))
  assert.equal(codes.size, 100)
  for (const code of codes) assert.match(code, /^[0-9A-F]{32}$/)
  assert.equal(normalizeInvitationCode(' abcd-ef01\n '), 'ABCDEF01')
  assert.equal(normalizeInvitationCode('bad!'), 'BAD!')
})
test('invitation states prioritize consumed and revoked codes over expiry', () => {
  const expired = { expires_at: '2000-01-01' }
  assert.equal(invitationStatus(expired), '已过期')
  assert.equal(
    invitationStatus({ ...expired, revoked_at: '2000-01-01' }),
    '已撤销',
  )
  assert.equal(
    invitationStatus({ ...expired, redeemed_at: '2000-01-01' }),
    '已兑换',
  )
  assert.equal(invitationStatus({ expires_at: '2100-01-01' }), '待兑换')
  assert.match(authErrorText({ code: 'email_not_confirmed' }), /尚未验证/)
  assert.match(authErrorText({ status: 429 }), /频繁/)
})
