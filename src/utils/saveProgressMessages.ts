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
