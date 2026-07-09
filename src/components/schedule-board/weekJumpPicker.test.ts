import { describe, it, expect } from 'vitest'
import { createWeekJumpPicker } from './weekJumpPicker'

describe('createWeekJumpPicker', () => {
  it('stage しただけでは commit まで値を返さない（＝ジャンプしない）', () => {
    const picker = createWeekJumpPicker()
    picker.stage('2026-07-15')
    // stage 中は保留のみ。確定していないので週は変えない前提。
    expect(picker.getPending()).toBe('2026-07-15')
  })

  it('confirm(commit) 時に最後にステージした値へジャンプする', () => {
    const picker = createWeekJumpPicker()
    picker.stage('2026-07-15')
    picker.stage('2026-07-20') // ピッカー操作中の途中値は上書きされる
    expect(picker.commit()).toBe('2026-07-20')
  })

  it('commit は一度だけ値を返し、二度目は null（多重ジャンプ防止）', () => {
    const picker = createWeekJumpPicker()
    picker.stage('2026-07-20')
    expect(picker.commit()).toBe('2026-07-20')
    expect(picker.commit()).toBeNull()
  })

  it('何もステージせず commit しても null（何も起きない）', () => {
    const picker = createWeekJumpPicker()
    expect(picker.commit()).toBeNull()
  })

  it('空値（クリア）は保留せず、commit しても null', () => {
    const picker = createWeekJumpPicker()
    picker.stage('')
    expect(picker.getPending()).toBeNull()
    picker.stage(null)
    picker.stage(undefined)
    expect(picker.commit()).toBeNull()
  })

  it('reset で保留を破棄すると commit は null を返す（キャンセル）', () => {
    const picker = createWeekJumpPicker()
    picker.stage('2026-07-20')
    picker.reset()
    expect(picker.commit()).toBeNull()
  })
})
