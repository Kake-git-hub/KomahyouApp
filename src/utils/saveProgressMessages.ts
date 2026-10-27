// 保存ボタンを押したあとに室長へ見せる進捗・結果の文言(2026-10 文言見直し・オーナー承認)。
// 画面に Firebase / Cloud Functions / データベース / ブラウザ などの開発用語を出さないため、
// App.tsx と BoardToolbar.tsx の両方がここを参照する。進捗の段階(1% → 20% → 教室ごと → 100%)は
// App.tsx 側の数値のまま変えない(ここはラベルだけ)。

export const SAVE_PROGRESS_LABELS = {
  /** 保存ボタン直後。この端末(IndexedDB / localStorage)へ書いている段階。 */
  savingOnDevice: 'この端末に保存中',
  /** クラウド保存キューへ積んだ直後〜教室ごとの送信前。 */
  preparing: '保存の準備中',
  /** 全教室の送信が終わった段階。 */
  finished: '保存が完了しました',
} as const

/** 教室ごとの送信中ラベル(例: 「保存中: 1/3教室」)。 */
export function formatSaveProgressClassroomLabel(classroomNumber: number, classroomCount: number) {
  return `保存中: ${classroomNumber}/${classroomCount}教室`
}

/** 進捗バー横の表示(例: 「保存の準備中(20%)」)。 */
export function formatSaveProgressStatus(label: string, percent: number) {
  return `${label}(${percent}%)`
}

/** BoardToolbar で App からラベルが来ていないときの既定表示(例: 「クラウドへ保存中(40%)」)。 */
export function formatCloudSavingFallbackStatus(percent: number) {
  return `クラウドへ保存中(${percent}%)`
}

export const SAVE_RESULT_MESSAGES = {
  synced: 'クラウドに保存しました。',
  syncedSwitchingToLatest: 'クラウドに保存しました。画面を最新に切り替えています。',
  slow: 'この端末には保存済みです。クラウドへの保存に時間がかかっています。完了前に閉じるときは確認画面でキャンセルしてください。',
  failedFallback: 'クラウドへの保存に失敗しました。',
} as const

/** クラウド保存が失敗したときの表示。理由(error.message)はそのまま後ろに付ける。 */
export function formatCloudSaveNotFinishedMessage(reason: string, downloadedBackup = false) {
  const base = `この端末には保存済みです。クラウドへの保存が終わっていません: ${reason}`
  return downloadedBackup ? `${base}。バックアップを自動ダウンロードしました。` : base
}

/**
 * サーバーが「教室データが 1 文書の上限を超えて保存できない」を表すエラーに付ける安定マーカー(2026-10-27)。
 * functions/src/snapshotCapacity.ts の SNAPSHOT_TOO_LARGE_ERROR_MARKER と一致させること(テストで突合)。
 */
export const SNAPSHOT_TOO_LARGE_ERROR_MARKER = 'SNAPSHOT_TOO_LARGE'

/** 容量超過で保存できなかったエラーか。通信の失敗とは違い、もう一度「保存」しても通らない。 */
export function isSnapshotTooLargeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes(SNAPSHOT_TOO_LARGE_ERROR_MARKER)
}

/** 容量超過のときの画面表示(保存バー横)。開発用語を出さない。 */
export const SNAPSHOT_TOO_LARGE_STATUS_MESSAGE = 'この端末には保存済みです。教室のデータが保存できる大きさの上限に達したため、クラウドへ保存できませんでした。開発者へ自動で連絡済みです。'

/**
 * 容量超過のときのダイアログ(2 行・オーナー指示 2026-10-25「1 行くらいに」)。
 * 「接続を確認してもう一度保存」は誤り(何度押しても通らない)なので、閉じない・待つを伝える。
 */
export const SNAPSHOT_TOO_LARGE_GUIDANCE_MESSAGE = [
  '教室のデータが上限に達したため保存できませんでした。開発者へ自動で連絡済みです。',
  'この画面は閉じず、再読み込みもしないでください（内容はダウンロード済みです）。',
].join('\n')
