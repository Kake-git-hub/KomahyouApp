// 提出用QRの提出状態を端末キャッシュで見せない配線ガード(source-scan・2026-11-03・確認リスト qs-2 要改善)。
//
// オーナー報告: iOS Safari では、日程表で「登録解除」したあと提出用QRを開き直しても「すでに提出済みです」のまま
// (Android は未提出に戻る)。保護者QR(ParentPortalPage / parentPortalApi)はページの fetch に cache:'no-store'、
// 関数に Cache-Control: no-store を付けていたが、提出用QR(SubmissionPage / lectureSubmissionApi)はどちらも無かった。
// 描画テスト環境が無いので字面で固定する(作法は submissionNotification.wiring.test.ts と同じ)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(fileURLToPath(new URL('./SubmissionPage.tsx', import.meta.url)), 'utf8')

describe('提出用QRの読み込みは毎回サーバーから(qs-2)', () => {
  it('提出状態を読む GET は cache: no-store で fetch する', () => {
    const loadData = PAGE.slice(PAGE.indexOf('async function loadData()'), PAGE.indexOf('loadData()\n  }, [apiBase, token, debug])'))
    expect(loadData).toContain("fetch(`${apiBase}/${encodeURIComponent(token)}`, { cache: 'no-store' })")
  })

  it('提出済みの画面のまま bfcache から出てきた(pageshow persisted)ときだけ読み込み直す(入力中の✕は消さない)', () => {
    expect(PAGE).toContain("window.addEventListener('pageshow', handlePageShow)")
    expect(PAGE).toContain('if (event.persisted && submittedRef.current) window.location.reload()')
  })
})
