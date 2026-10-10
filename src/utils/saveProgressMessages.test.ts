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
