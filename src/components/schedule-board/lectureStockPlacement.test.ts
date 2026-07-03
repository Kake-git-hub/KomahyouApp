import { describe, expect, it } from 'vitest'
import { resolveSelectedLecturePlacementItem } from './lectureStockPlacement'

type Item = { subject: string; sessionId?: string; tag: string }

const items: Item[] = [
  { subject: '英', sessionId: 's1', tag: '英-s1' },
  { subject: '数', sessionId: 's1', tag: '数-s1' },
  { subject: '国', sessionId: 's1', tag: '国-s1' },
]

describe('resolveSelectedLecturePlacementItem', () => {
  it('選択した科目(数)を返す — 先頭(英)へ落ちない(中3 国→英 事故の回帰防止)', () => {
    // 修正前は常に [0]=英 を返していた。選択キーで 数 を尊重する。
    expect(resolveSelectedLecturePlacementItem(items, { subject: '数', sessionId: 's1' })?.tag).toBe('数-s1')
    expect(resolveSelectedLecturePlacementItem(items, { subject: '国', sessionId: 's1' })?.tag).toBe('国-s1')
  })

  it('未選択(null)なら従来どおり先頭へフォールバック', () => {
    expect(resolveSelectedLecturePlacementItem(items, null)?.tag).toBe('英-s1')
    expect(resolveSelectedLecturePlacementItem(items, undefined)?.tag).toBe('英-s1')
  })

  it('選択科目が一覧に無い場合は安全側で先頭へフォールバック', () => {
    expect(resolveSelectedLecturePlacementItem(items, { subject: '理', sessionId: 's1' })?.tag).toBe('英-s1')
  })

  it('同一科目でも sessionId 違いを区別する', () => {
    const multi: Item[] = [
      { subject: '数', sessionId: 'summer', tag: '数-夏' },
      { subject: '数', sessionId: 'winter', tag: '数-冬' },
    ]
    expect(resolveSelectedLecturePlacementItem(multi, { subject: '数', sessionId: 'winter' })?.tag).toBe('数-冬')
  })

  it('sessionId 未指定同士も一致できる', () => {
    const noSession: Item[] = [
      { subject: '英', tag: '英' },
      { subject: '数', tag: '数' },
    ]
    expect(resolveSelectedLecturePlacementItem(noSession, { subject: '数' })?.tag).toBe('数')
  })

  it('空一覧では null', () => {
    expect(resolveSelectedLecturePlacementItem([], { subject: '数' })).toBeNull()
  })
})
