import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SAVE_PROGRESS_LABELS,
  SAVE_RESULT_MESSAGES,
  formatCloudSaveNotFinishedMessage,
  formatCloudSavingFallbackStatus,
  formatSaveProgressClassroomLabel,
  formatSaveProgressStatus,
  isSnapshotTooLargeError,
  isTransientFirebaseSyncError,
  SNAPSHOT_TOO_LARGE_ERROR_MARKER,
  SNAPSHOT_TOO_LARGE_GUIDANCE_MESSAGE,
  SNAPSHOT_TOO_LARGE_STATUS_MESSAGE,
} from './saveProgressMessages'

// 2026-10 アプリ内文言見直し(オーナー承認・文言一覧 #109〜#118 / #278〜#280)。
// 室長の画面に Firebase / Cloud Functions / データベース / ブラウザ などの開発用語を出さない。
const DEVELOPER_TERMS = /Firebase|Cloud Functions|Firestore|データベース|ブラウザ|IndexedDB|スナップショット|ワークスペース|JSON/

describe('保存の進捗ラベル(#109〜#113)', () => {
  it('段階ごとのラベルが新文言になっている', () => {
    expect(SAVE_PROGRESS_LABELS.savingOnDevice).toBe('この端末に保存中')
    expect(SAVE_PROGRESS_LABELS.preparing).toBe('保存の準備中')
    expect(formatSaveProgressClassroomLabel(1, 3)).toBe('保存中: 1/3教室')
    expect(SAVE_PROGRESS_LABELS.finished).toBe('保存が完了しました')
  })

  it('進捗バー横の表示は「ラベル(N%)」で、「%完了」を付けない(#278 と揃える)', () => {
    expect(formatSaveProgressStatus(SAVE_PROGRESS_LABELS.preparing, 20)).toBe('保存の準備中(20%)')
    expect(formatSaveProgressStatus(SAVE_PROGRESS_LABELS.finished, 100)).toBe('保存が完了しました(100%)')
    expect(formatCloudSavingFallbackStatus(40)).toBe('クラウドへ保存中(40%)')
  })
})

describe('保存結果の文言(#114〜#118)', () => {
  it('完了・遅延・失敗の文言', () => {
    expect(SAVE_RESULT_MESSAGES.synced).toBe('クラウドに保存しました。')
    expect(SAVE_RESULT_MESSAGES.syncedSwitchingToLatest).toBe('クラウドに保存しました。画面を最新に切り替えています。')
    expect(SAVE_RESULT_MESSAGES.slow).toBe('この端末には保存済みです。クラウドへの保存に時間がかかっています。完了前に閉じるときは確認画面でキャンセルしてください。')
    expect(SAVE_RESULT_MESSAGES.failedFallback).toBe('クラウドへの保存に失敗しました。')
  })

  it('未完了の文言は理由を後ろに付け、バックアップをDLしたときだけ一文足す', () => {
    expect(formatCloudSaveNotFinishedMessage('通信エラー')).toBe('この端末には保存済みです。クラウドへの保存が終わっていません: 通信エラー')
    expect(formatCloudSaveNotFinishedMessage('通信エラー', true)).toBe('この端末には保存済みです。クラウドへの保存が終わっていません: 通信エラー。バックアップを自動ダウンロードしました。')
  })

  it('どの文言にも開発用語が入っていない', () => {
    const all = [
      ...Object.values(SAVE_PROGRESS_LABELS),
      ...Object.values(SAVE_RESULT_MESSAGES),
      formatSaveProgressClassroomLabel(2, 3),
      formatSaveProgressStatus('x', 50),
      formatCloudSavingFallbackStatus(50),
      formatCloudSaveNotFinishedMessage('', true),
    ]
    for (const text of all) expect(text, text).not.toMatch(DEVELOPER_TERMS)
  })
})

describe('配線(App.tsx / BoardToolbar.tsx が共通文言を使う)', () => {
  const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')
  const toolbar = readFileSync(fileURLToPath(new URL('../components/schedule-board/BoardToolbar.tsx', import.meta.url)), 'utf8')

  it('App.tsx の保存経路は共通ラベル・整形関数を使い、旧文言を残していない', () => {
    expect(app).toContain('label: SAVE_PROGRESS_LABELS.savingOnDevice')
    expect(app).toContain('label: SAVE_PROGRESS_LABELS.preparing')
    expect(app).toContain('formatSaveProgressClassroomLabel(classroomIndex + 1, targetClassrooms.length)')
    expect(app).toContain('label: SAVE_PROGRESS_LABELS.finished')
    expect(app).toContain('formatSaveProgressStatus(remoteSyncProgress.label, remoteSyncProgress.percent)')
    expect(app).toContain('formatCloudSaveNotFinishedMessage(message, true)')
    for (const old of [
      'ブラウザへ保存中',
      'データベースへ保存準備中',
      'Cloud Functions 経由で保存',
      'Cloud Functions 経由のデータベース保存完了',
      'Firebase へ同期しました。',
      'Firebase 同期は完了しました',
      'ブラウザ内には保存済みです',
      '%完了)',
    ]) {
      expect(app, old).not.toContain(old)
    }
  })

  it('保存ボタン横・ツールチップ(#278〜#280)', () => {
    expect(toolbar).toContain('formatCloudSavingFallbackStatus(syncProgressPercent)')
    expect(toolbar).toContain("'保存してクラウドへ送ります。'")
    expect(toolbar).toContain("'クラウドと同じ内容です。'")
    expect(toolbar).not.toContain('データベース')
    expect(toolbar).not.toContain('Firebase 同期')
  })
})

describe('容量超過で保存できないときの表示(2026-10-27 日大前校)', () => {
  it('サーバーのマーカー付きエラーだけを容量超過と判定する(INTERNAL などの通信失敗は含めない)', () => {
    expect(isSnapshotTooLargeError(new Error(`${SNAPSHOT_TOO_LARGE_ERROR_MARKER}:教室のデータが保存できる大きさの上限を超えたため、保存できませんでした。`))).toBe(true)
    expect(isSnapshotTooLargeError(new Error('INTERNAL'))).toBe(false)
    expect(isSnapshotTooLargeError(null)).toBe(false)
  })

  it('「接続を確認してもう一度保存」を言わず、閉じない・再読み込みしないを伝える。2 行・開発用語なし', () => {
    expect(SNAPSHOT_TOO_LARGE_GUIDANCE_MESSAGE.split('\n')).toHaveLength(2)
    expect(SNAPSHOT_TOO_LARGE_GUIDANCE_MESSAGE).not.toContain('接続を確認')
    expect(SNAPSHOT_TOO_LARGE_GUIDANCE_MESSAGE).toContain('閉じず')
    expect(SNAPSHOT_TOO_LARGE_GUIDANCE_MESSAGE).toContain('再読み込みもしないで')
    expect(SNAPSHOT_TOO_LARGE_GUIDANCE_MESSAGE).not.toMatch(DEVELOPER_TERMS)
    expect(SNAPSHOT_TOO_LARGE_STATUS_MESSAGE).not.toMatch(DEVELOPER_TERMS)
    expect(SNAPSHOT_TOO_LARGE_STATUS_MESSAGE).toContain('開発者へ自動で連絡済み')
  })

  it('App.tsx の保存失敗の経路が容量超過を見分けて専用の案内を出す(ソース走査)', () => {
    const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')
    expect(app).toContain('const tooLarge = isSnapshotTooLargeError(error)')
    // 2026-10-27: 案内の文は guidance に選んでから、初回は「開発者へ送りますか？」付きの確認、それ以外は alert で出す(unsentCloudSave)。
    expect(app).toContain('const guidance = tooLarge ? SNAPSHOT_TOO_LARGE_GUIDANCE_MESSAGE : SAVE_FAILURE_GUIDANCE_MESSAGE')
    expect(app).toContain('window.alert(guidance)')
    // 再試行の判定は utils の 1 か所(App.tsx に写しを持たない)
    expect(app).toContain('isTransientFirebaseSyncError } from \'./utils/saveProgressMessages\'')
    expect(app).not.toContain('function isTransientFirebaseSyncError(')
  })

  it('自動再試行: 通信・タイムアウト・INTERNAL は再試行、容量超過は文言に何が入っても再試行しない', () => {
    expect(isTransientFirebaseSyncError(new Error('INTERNAL'))).toBe(true)
    expect(isTransientFirebaseSyncError(new Error('UNAVAILABLE'))).toBe(true)
    expect(isTransientFirebaseSyncError(new Error('deadline-exceeded: timed out'))).toBe(true)
    expect(isTransientFirebaseSyncError(new Error(`${SNAPSHOT_TOO_LARGE_ERROR_MARKER}:教室のデータが保存できる大きさの上限を超えたため、保存できませんでした。`))).toBe(false)
    expect(isTransientFirebaseSyncError(new Error(`${SNAPSHOT_TOO_LARGE_ERROR_MARKER}:INTERNAL`))).toBe(false)
    expect(isTransientFirebaseSyncError(new Error('STALE_SNAPSHOT:別の端末で更新'))).toBe(false)
  })
})
