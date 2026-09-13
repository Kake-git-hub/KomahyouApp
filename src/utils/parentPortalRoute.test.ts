import { describe, expect, it } from 'vitest'
import { PARENT_PORTAL_TOKEN_PATTERN, extractParentPortalToken } from './parentPortalRoute'

// docs/spec-parent-portal.md §C: `/p/{token}`(本番)と `#/parent/{token}`(ローカル)。講習提出 `/s/` は拾わない(§K-6)。
const token32 = 'AbCdEfGhIjKlMnOpQrStUvWxYz01_-45' // base64url 32 文字(記号 _ と - を含む)

describe('PARENT_PORTAL_TOKEN_PATTERN', () => {
  it('base64url 32 文字を受理し、16〜64 文字の範囲で許容する', () => {
    expect(PARENT_PORTAL_TOKEN_PATTERN.test(token32)).toBe(true)
    expect(PARENT_PORTAL_TOKEN_PATTERN.test('a'.repeat(16))).toBe(true)
    expect(PARENT_PORTAL_TOKEN_PATTERN.test('a'.repeat(64))).toBe(true)
    expect(PARENT_PORTAL_TOKEN_PATTERN.test('a'.repeat(15))).toBe(false)
    expect(PARENT_PORTAL_TOKEN_PATTERN.test('a'.repeat(65))).toBe(false)
  })
  it('文字集合外(スラッシュ・ドット・空白・日本語・%)は拒否する', () => {
    expect(PARENT_PORTAL_TOKEN_PATTERN.test('abcdefghijklmnop/q')).toBe(false)
    expect(PARENT_PORTAL_TOKEN_PATTERN.test('abcdefghijklmnop.q')).toBe(false)
    expect(PARENT_PORTAL_TOKEN_PATTERN.test('abcdefghijklmnop q')).toBe(false)
    expect(PARENT_PORTAL_TOKEN_PATTERN.test('abcdefghijklmnopあ')).toBe(false)
    expect(PARENT_PORTAL_TOKEN_PATTERN.test('abcdefghijklmnop%2F')).toBe(false)
  })
})

describe('extractParentPortalToken', () => {
  it('短縮パス /p/{token} からトークンを取り出す', () => {
    expect(extractParentPortalToken(`/p/${token32}`, '')).toBe(token32)
  })

  it('ハッシュ経路 #/parent/{token} からトークンを取り出す(pathname は / のまま)', () => {
    expect(extractParentPortalToken('/', `#/parent/${token32}`)).toBe(token32)
  })

  it('ハッシュ経路を先に見る(両方あるときは hash が勝つ)', () => {
    const other = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'
    expect(extractParentPortalToken(`/p/${other}`, `#/parent/${token32}`)).toBe(token32)
  })

  it('余分なセグメントや末尾スラッシュが付いた経路は拾わない(anchored)', () => {
    expect(extractParentPortalToken(`/p/${token32}/extra`, '')).toBeNull()
    expect(extractParentPortalToken(`/p/${token32}/`, '')).toBeNull()
    expect(extractParentPortalToken(`/x/p/${token32}`, '')).toBeNull()
    expect(extractParentPortalToken('/', `#/parent/${token32}/extra`)).toBeNull()
    expect(extractParentPortalToken('/', `#/parent/${token32}?x=1`)).toBeNull()
  })

  it('講習提出の /s/{token} と #/submit/{token} は決して拾わない(取り違え防止)', () => {
    expect(extractParentPortalToken(`/s/${token32}`, '')).toBeNull()
    expect(extractParentPortalToken('/', `#/submit/${token32}`)).toBeNull()
  })

  it('長さ・文字集合が規格外のトークンは拾わない', () => {
    expect(extractParentPortalToken(`/p/${'a'.repeat(15)}`, '')).toBeNull()
    expect(extractParentPortalToken(`/p/${'a'.repeat(65)}`, '')).toBeNull()
    expect(extractParentPortalToken(`/p/${'a'.repeat(16)}`, '')).toBe('a'.repeat(16))
    expect(extractParentPortalToken(`/p/${'a'.repeat(64)}`, '')).toBe('a'.repeat(64))
    expect(extractParentPortalToken('/p/abcdefghijklmnop.q', '')).toBeNull()
  })

  it('関係ない経路・空・board-share・大文字 P は null', () => {
    expect(extractParentPortalToken('/', '')).toBeNull()
    expect(extractParentPortalToken('/developer', '')).toBeNull()
    expect(extractParentPortalToken('/board-share/abc', '#/board-share/abc')).toBeNull()
    expect(extractParentPortalToken(`/P/${token32}`, '')).toBeNull()
    expect(extractParentPortalToken('/p/', '')).toBeNull()
    expect(extractParentPortalToken('/p', '')).toBeNull()
  })
})
