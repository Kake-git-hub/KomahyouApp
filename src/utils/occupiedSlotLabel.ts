// 提出用QR/日程表の「割り振られたコマ」表記を、種別1文字(講/通/振/増)+科目 で作る純関数。
// 例: 講習の数学 → '講数'、通常の英語 → '通英'、振替の国語 → '振国'、増コマの理科 → '増理'。
//
// オーナー指示(2026-07-19): 提出後にQRを再読み込みしたとき、割り振られたコマが「講習/通常」の種別だけでなく
// 科目まで分かるようにする。この表記は生徒の occupiedSlots(提出ドキュメントに載る配布情報)に格納され、
// 提出済みドキュメントでも次回の日程表同期(updateSubmissionOccupiedSlots)で最新表記に更新される。
//
// 種別の全長ラベル(増コマ/通常/振替/講習)は講師 occupiedSlots など別用途で使うため、ここでは触らない。

const LESSON_TYPE_SHORT_LABELS: Record<string, string> = {
  extra: '増',
  regular: '通',
  makeup: '振',
  special: '講',
}

/**
 * 種別1文字 + 科目 の割振コマ表記を返す。
 * - 未知/空の lessonType は種別文字を出さない(科目のみ、両方空なら '')。
 * - subject が空でも種別文字だけは出す(例: 種別のみ判明する将来ケースでも壊れない)。
 */
export function buildOccupiedSlotLabel(lessonType: string | undefined, subject?: string): string {
  const typeShort = LESSON_TYPE_SHORT_LABELS[lessonType ?? ''] ?? ''
  const subjectLabel = (subject ?? '').trim()
  return `${typeShort}${subjectLabel}`
}
