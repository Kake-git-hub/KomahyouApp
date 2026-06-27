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

  it('空の提出({})は既存を消さない(union・回帰防止 2026-06-27 本番データ消失)', () => {
    // この経路は countSubmitted=true(=提出ロック済み)の生徒にだけ走るため、保護者が QR で
    // 参加/オプションを「外す」ことは起こり得ない。空 doc(室長が v1.5.335 以前に登録した中3の
    // 提出ドキュメントは空のまま)が届いても、室長が決めた既存値を上書き消失してはいけない。
    const result = reflectParentOwnedSubmissionFields(
      { optionChecks: { '0': true } },
      { optionChecks: {} },
    )
    // 既存を保全=変化なし=null。
    expect(result).toBeNull()
  })

  it('空 doc は登録済みの集団参加を消さない(緑が丘5名/日大前2名 消失の再現防止)', () => {
    // 実害の再現: 既存ローカルは集団理科/集団社会に参加(室長が日程表で登録)、提出ドキュメントは空 {}。
    // 旧実装は entry({}) で既存を上書きし、起動直後の初回スナップショット反映で集団参加を一括消失させた。
    const result = reflectParentOwnedSubmissionFields(
      { optionChecks: {}, groupClassParticipation: { 集団理科: true, 集団社会: true } },
      { optionChecks: {}, groupClassParticipation: {} },
    )
    expect(result).toBeNull()
  })

  it('既存に entry の新規 true を足す(union・既存は維持)', () => {
    // 室長が集団理科を登録済み、保護者が QR で集団社会を追加 → 両方残す(どちらも消さない)。
    const result = reflectParentOwnedSubmissionFields(
      { groupClassParticipation: { 集団理科: true } },
      { groupClassParticipation: { 集団社会: true } },
    )
    expect(result).not.toBeNull()
    expect(result?.groupClassParticipation).toEqual({ 集団理科: true, 集団社会: true })
  })
})
