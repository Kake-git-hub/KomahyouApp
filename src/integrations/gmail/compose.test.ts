import { describe, expect, it } from 'vitest'
import { buildGmailComposeUrl } from './compose'

describe('buildGmailComposeUrl', () => {
  it('cc を指定すると Gmail 作成URLに cc が含まれる', () => {
    const url = buildGmailComposeUrl({ to: 'owner@example.com', subject: '件名', body: '本文', cc: 'bkkdmzn@gmail.com' })
    const params = new URL(url).searchParams
    expect(params.get('to')).toBe('owner@example.com')
    expect(params.get('cc')).toBe('bkkdmzn@gmail.com')
  })

  it('cc 未指定なら cc パラメータは付かない', () => {
    const url = buildGmailComposeUrl({ to: 'owner@example.com', subject: '件名', body: '本文' })
    expect(new URL(url).searchParams.has('cc')).toBe(false)
  })
})
