import { describe, expect, it } from 'vitest'
import { reflectParentOwnedSubmissionFields } from './submissionReflection'

describe('reflectParentOwnedSubmissionFields', () => {
  it('登録済みでも保護者のQR optionChecks を反映する(空→{0,1})', () => {
    // 回帰防止(本不具合の本体): 室長ローカルが空のまま、保護者がQRで {0,1} を提出した場合、
    // これを反映しないと手動保存で関数のスナップショット統合値を上書きしQRチェックが消える。
    const result = reflectParentOwnedSubmissionFields(
      { optionChecks: {}, groupClassParticipation: {} },
      { optionChecks: { '0': true, '1': true }, groupClassParticipation: {} },
    )
    expect(result).not.toBeNull()
    expect(result?.optionChecks).toEqual({ '0': true, '1': true })
    expect(result?.groupClassParticipation).toEqual({})
  })

  it('集団参加(groupClassParticipation)の更新も反映する', () => {
    const result = reflectParentOwnedSubmissionFields(
      { optionChecks: {}, groupClassParticipation: {} },
      { optionChecks: {}, groupClassParticipation: { 集団理科: true } },
    )
    expect(result?.groupClassParticipation).toEqual({ 集団理科: true })
  })

  it('変化が無ければ null(再描画・dirty化を避ける)', () => {
    const result = reflectParentOwnedSubmissionFields(
      { optionChecks: { '0': true }, groupClassParticipation: { 集団社会: true } },
      { optionChecks: { '0': true }, groupClassParticipation: { 集団社会: true } },
    )
    expect(result).toBeNull()
  })

  it('true キー集合が同じならキー順が違っても同値扱い(null)', () => {
    const result = reflectParentOwnedSubmissionFields(
      { optionChecks: { '0': true, '2': true } },
      { optionChecks: { '2': true, '0': true } },
    )
    expect(result).toBeNull()
  })

  it('entry 側が欠落(undefined)なら既存を保全する', () => {
    const result = reflectParentOwnedSubmissionFields(
      { optionChecks: { '0': true }, groupClassParticipation: { 集団理科: true } },
      {},
    )
    // 既存と同値＝変化なし＝null(保全)。
    expect(result).toBeNull()
  })

  it('保護者がチェックを外した提出({}）は反映してクリアする', () => {
    const result = reflectParentOwnedSubmissionFields(
      { optionChecks: { '0': true } },
      { optionChecks: {} },
    )
    expect(result).not.toBeNull()
    expect(result?.optionChecks).toEqual({})
  })
})
