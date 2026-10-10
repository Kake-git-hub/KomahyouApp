// QR提出ページ(SubmissionPage.tsx)の利用者向け文言と、実機調整(デバッグ)パネルの廃止を字面で固定する
// (オーナー確定 2026-10-10・文言一覧レビュー #56〜#62/#73/#77〜#79)。
// 描画テスト環境が無いので source-scan で守る(作法は submissionNotification.wiring.test.ts と同じ)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(fileURLToPath(new URL('./SubmissionPage.tsx', import.meta.url)), 'utf8')

describe('QR提出ページの文言', () => {
  it('無効QR・読み込み失敗は「教室へ」「どうすればよいか」を案内し、管理者を出さない', () => {
    expect(SOURCE).toContain("setError('このQRは無効です。教室へお問い合わせください。')")
    expect(SOURCE).toContain("setError('読み込めませんでした。少し待ってから開き直してください。')")
    expect(SOURCE).not.toContain('管理者')
    expect(SOURCE).not.toContain('このリンクは無効です')
    expect(SOURCE).not.toContain("setError('データの読み込みに失敗しました。')")
  })

  it('案内文は短縮版(旧文言が残っていない)', () => {
    expect(SOURCE).toContain('以下の内容で提出済みです（変更はできません）')
    expect(SOURCE).not.toContain('閲覧のみ・編集はできません')
    expect(SOURCE).toContain('黄色は出席可能に変更したコマです。')
    expect(SOURCE).not.toContain('黄色のコマは、提出後に')
    expect(SOURCE).toContain('出席できないコマをタップしてください。')
    expect(SOURCE).not.toContain('日付をタップすると終日不可になります')
    expect(SOURCE).toContain('参加する科目に<strong>チェック</strong>を入れてください。')
    expect(SOURCE).toContain('希望する項目に<strong>チェック</strong>を入れてください。')
    expect(SOURCE).not.toContain('未チェックは不参加')
    expect(SOURCE).not.toContain('未チェックはなし')
  })

  it('#/submit-debug の実機調整パネル(幅・無補正・値をコピー)は廃止済み', () => {
    expect(SOURCE).not.toContain('sub-dbg')
    expect(SOURCE).not.toContain('debugPanel')
    expect(SOURCE).not.toContain('幅(width)')
    expect(SOURCE).not.toContain('無補正')
    expect(SOURCE).not.toContain('値をコピー')
  })
})
