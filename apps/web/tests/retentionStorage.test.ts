import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseGalleryResponse } from '../src/services/galleryService.ts'
import {
  buildBucketRotatePayload, formatBytes, formatLocalDateTime, formatRelativeAge, formatRetentionPolicyText,
  getImageRetentionSummary, validateAccountId, validateBucketName, validateCredentialInput, validateRetentionDays,
} from '../src/utils/retentionFormat.ts'

test('retention follows the image promise, including legacy and expiry boundaries', () => {
  const now = Date.UTC(2026, 10, 25)
  const expiry = (hours: number) => new Date(now + hours * 3_600_000).toISOString()
  assert.equal(getImageRetentionSummary().isPermanent, true)
  assert.equal(getImageRetentionSummary(null, null).tone, 'permanent')
  assert.equal(getImageRetentionSummary(7, expiry(25), now).shortLabel, '剩 2 天')
  assert.equal(getImageRetentionSummary(7, expiry(24), now).tone, 'urgent')
  assert.equal(getImageRetentionSummary(7, expiry(0), now).shortLabel, '即将过期')
  assert.equal(formatRetentionPolicyText(null), '永久保存')
  assert.equal(formatRetentionPolicyText(30), '保留 30 天')
  assert.equal(formatLocalDateTime(expiry(0)), formatLocalDateTime(now))
  assert.notEqual(formatLocalDateTime(now), '—')
  assert.equal(formatRelativeAge(now, now + 120_000), '2 分钟前')
  assert.equal(formatBytes(null), '—')
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1024), '1.0 KiB')
})

test('storage form validation and write-only rotation', () => {
  assert.equal(validateAccountId('a'.repeat(32)), null)
  assert.ok(validateAccountId('z'.repeat(32)))
  assert.equal(validateBucketName('app-images'), null)
  for (const name of ['ab', 'A-b', '-ab', 'ab-', 'a'.repeat(64)]) assert.ok(validateBucketName(name))
  for (const days of ['1', '3650']) assert.equal(validateRetentionDays(days).valid, true)
  for (const days of ['0', '1.5', '3651']) assert.equal(validateRetentionDays(days).valid, false)
  assert.equal(validateCredentialInput('example', 'key'), null)
  assert.ok(validateCredentialInput('', 'key'))
  assert.ok(validateCredentialInput('a b', 'key'))
  assert.deepEqual(buildBucketRotatePayload('', '', '', false), {})
  assert.deepEqual(buildBucketRotatePayload('new', '', '', false), { accessKeyId: 'new' })
  assert.deepEqual(buildBucketRotatePayload('', 'new', 'token', false), { secretAccessKey: 'new', analyticsToken: 'token' })
  assert.deepEqual(buildBucketRotatePayload('', '', 'ignored', true), { analyticsToken: null })
})

test('empty gallery preserves both finite and permanent site policy', () => {
  for (const retentionDays of [7, null]) {
    const snapshot = parseGalleryResponse({ images: [], retentionDays })
    assert.deepEqual(snapshot.images, [])
    assert.equal(snapshot.retentionDays, retentionDays)
    assert.equal(snapshot.hasRetentionPolicy, true)
  }
})
