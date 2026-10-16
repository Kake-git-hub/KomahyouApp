import { describe, expect, it } from 'vitest'

import type { NormalizedDeveloperReportStudentLedger } from './developerReport'
import { QUESTION_AI_EVAL_NOW, QUESTION_AI_EVAL_STUDENT_LEDGER } from './questionAiEvalCases'
import {
  buildQuestionAiStudentDigest,
  collectStudentLedgerNames,
  findStudentsMentionedInQuestion,
  formatDigestDate,
  QUESTION_AI_DIGEST_NO_STUDENT_NOTE,
  QUESTION_AI_DIGEST_STUDENT_LIMIT,
  resolveJstDateKey,
} from './questionAiStudentDigest'

const NAMES = ['山田 太郎', '佐藤 花子', '佐藤 次郎', '鈴木一郎']

describe('questionAiStudentDigest: 質問に名前が出た生徒のいまの数字(妥協案 B・2026-10-16 夜)', () => {
  it('フルネームは空白の有無を問わず当て、姓だけは同じ姓が 1 人のときだけ当てる', () => {
    expect(findStudentsMentionedInQuestion('山田太郎さんの振替は？', NAMES)).toEqual(['山田 太郎'])
    expect(findStudentsMentionedInQuestion('山田　太郎 の予定', NAMES)).toEqual(['山田 太郎'])
    expect(findStudentsMentionedInQuestion('山田さんの来週は？', NAMES)).toEqual(['山田 太郎'])
    // 佐藤は 2 人いるので姓だけでは当てない(別人の数字を出さない)。フルネームなら当たる。
    expect(findStudentsMentionedInQuestion('佐藤さんの振替は？', NAMES)).toEqual([])
    expect(findStudentsMentionedInQuestion('佐藤花子さんの振替は？', NAMES)).toEqual(['佐藤 花子'])
    // 空白の無い名前は姓を切り出せないのでフルネームだけ。
    expect(findStudentsMentionedInQuestion('鈴木さんは？', NAMES)).toEqual([])
    expect(findStudentsMentionedInQuestion('鈴木一郎くんは？', NAMES)).toEqual(['鈴木一郎'])
    expect(findStudentsMentionedInQuestion('振替が残っている生徒は誰ですか？', NAMES)).toEqual([])
    expect(findStudentsMentionedInQuestion('', NAMES)).toEqual([])
  })

  it('台帳の生徒名を重複なしで集める(講習だけの生徒も含む)', () => {
    const ledger: NormalizedDeveloperReportStudentLedger = {
      computedAt: '2026-10-16T00:00:00.000Z',
      rows: [{ studentId: 's1', name: '山田 太郎', subject: '数', makeupBalance: 0, makeupRemaining: [], attended: [], absent: [], absentNoMakeup: [], placed: [] }],
      lectureRows: [{ studentId: 's9', name: '高橋 三郎', sessionLabel: '冬期', subject: '英', pending: 2, origins: [] }, { studentId: 's1', name: '山田 太郎', sessionLabel: '冬期', subject: '数', pending: 1, origins: [] }],
    }
    expect(collectStudentLedgerNames(ledger)).toEqual(['山田 太郎', '高橋 三郎'])
  })

  it('日付は M/D(曜) に、今日は JST で決める', () => {
    expect(formatDigestDate('2026-10-03')).toBe('10/3(土)')
    expect(formatDigestDate('garbage')).toBe('garbage')
    // UTC 2026-10-15 18:00 は JST 2026-10-16 03:00。
    expect(resolveJstDateKey(new Date('2026-10-15T18:00:00.000Z'))).toBe('2026-10-16')
  })

  it('質問に出た生徒だけ、権威関数の値をそのまま文字にし、他の生徒の名前は止める語として返す', () => {
    const digest = buildQuestionAiStudentDigest({ note: '山田太郎さんの振替は何回残っていますか？', ledger: QUESTION_AI_EVAL_STUDENT_LEDGER, now: QUESTION_AI_EVAL_NOW })!
    expect(digest.mentionedNames).toEqual(['山田 太郎'])
    expect(digest.otherStudentNames).toEqual(['佐藤 花子'])
    expect(digest.text).toContain('(今日は 10/16(金)。')
    expect(digest.text).toContain('## 山田 太郎')
    expect(digest.text).toContain('- 数: 未消化振替 残 2 回(元コマ: 10/2(金) 2限(休み) / 10/9(金) 2限(休み))')
    expect(digest.text).toContain('今日以降の予定(近い 3 件): 10/20(火) 3限 振替(元 10/2(金) 2限) / 10/23(金) 2限 通常 / 10/30(金) 2限 通常')
    expect(digest.text).toContain('休み(振替あり・新しい順): 10/9(金) 2限 通常 / 10/2(金) 2限 通常')
    expect(digest.text).toContain('直近 30 日の出席 2 回')
    expect(digest.text).toContain('- 未消化講習: 夏期講習 英 残 1 回')
    // 質問に出ていない生徒の数字・名前は本文に無い。
    expect(digest.text).not.toContain('佐藤')
    expect(digest.text).not.toContain('10/8')
  })

  it('名前が見つからなければ数字を渡さず決まった一文だけ。台帳が無ければ null', () => {
    const digest = buildQuestionAiStudentDigest({ note: '振替が残っている生徒は誰ですか？', ledger: QUESTION_AI_EVAL_STUDENT_LEDGER, now: QUESTION_AI_EVAL_NOW })!
    expect(digest.text).toBe(QUESTION_AI_DIGEST_NO_STUDENT_NOTE)
    expect(digest.mentionedNames).toEqual([])
    expect(digest.otherStudentNames).toEqual(['山田 太郎', '佐藤 花子'])
    expect(buildQuestionAiStudentDigest({ note: '山田太郎さん', ledger: null })).toBeNull()
  })

  it('名前が多く出ても渡す生徒は上限まで(入力トークンを膨らませない)', () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({ studentId: `s${index}`, name: `生徒 ${index}号`, subject: '数', makeupBalance: index, makeupRemaining: [], attended: [], absent: [], absentNoMakeup: [], placed: [] }))
    const ledger: NormalizedDeveloperReportStudentLedger = { computedAt: '2026-10-16T00:00:00.000Z', rows, lectureRows: [] }
    const digest = buildQuestionAiStudentDigest({ note: rows.map((row) => row.name).join('と'), ledger, now: QUESTION_AI_EVAL_NOW })!
    expect(digest.mentionedNames).toHaveLength(QUESTION_AI_DIGEST_STUDENT_LIMIT)
    expect(QUESTION_AI_DIGEST_STUDENT_LIMIT).toBe(3)
  })
})
