import { describe, expect, it } from 'vitest'
import { buildOccupiedSlotLabel } from './occupiedSlotLabel'

// オーナー指示(2026-07-19): 提出後の再読込画面で割振コマを「種別+科目」で見せる。
// 修正なしで落ち(旧: 種別全長ラベルのみ)・修正ありで通る回帰防止。
describe('buildOccupiedSlotLabel (割振コマ 種別1文字+科目)', () => {
  it('講習+数学 → 講数', () => {
    expect(buildOccupiedSlotLabel('special', '数')).toBe('講数')
  })

  it('通常+英語 → 通英', () => {
    expect(buildOccupiedSlotLabel('regular', '英')).toBe('通英')
  })

  it('振替+国語 → 振国', () => {
    expect(buildOccupiedSlotLabel('makeup', '国')).toBe('振国')
  })

  it('増コマ+理科 → 増理', () => {
    expect(buildOccupiedSlotLabel('extra', '理')).toBe('増理')
  })

  it('合体科目(算国/理社)もそのまま連結する', () => {
    expect(buildOccupiedSlotLabel('special', '算国')).toBe('講算国')
    expect(buildOccupiedSlotLabel('regular', '理社')).toBe('通理社')
  })

  it('科目が空でも種別文字だけは出す', () => {
    expect(buildOccupiedSlotLabel('special', '')).toBe('講')
    expect(buildOccupiedSlotLabel('regular', undefined)).toBe('通')
  })

  it('未知/空の種別は種別文字を出さない(科目のみ、両方空なら空文字)', () => {
    expect(buildOccupiedSlotLabel('unknown', '数')).toBe('数')
    expect(buildOccupiedSlotLabel(undefined, undefined)).toBe('')
    expect(buildOccupiedSlotLabel('', '')).toBe('')
  })
})
