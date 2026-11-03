// 提出用QRの「提出後の画面」で、盤面に組まれたコマを見せるかどうか(日程公開・オーナー確定 2026-11-03)。
// React に依存しない判断をここに置き、単体テストで固定する。
//
// - 提出前の画面: 今までどおり occupiedSlots を出す(非公開の講習コマは App 側で文書へ書かないので、ここでは何もしない)。
// - 提出後で非公開(schedulePublished === false): 本人が付けた✕と希望科目数だけ。組まれたコマ(通常も講習も)は出さず、
//   SUBMISSION_SCHEDULE_PENDING_MESSAGE を出す。
// - 提出後で公開(true / 未設定=この項目ができる前の文書): 今までどおり組まれたコマを出す。

export const SUBMISSION_SCHEDULE_PENDING_MESSAGE = '講習の日程は準備中です。日程が決まりましたら、この画面でお知らせします。'

export function isSubmissionSchedulePublished(data: { schedulePublished?: boolean | null }): boolean {
  return data.schedulePublished !== false
}

/** 提出後の画面に出す「組まれたコマ」。非公開の間は空。 */
export function resolveSubmittedViewOccupiedSlots(data: { schedulePublished?: boolean | null; occupiedSlots?: Record<string, string> | null }): Record<string, string> {
  if (!isSubmissionSchedulePublished(data)) return {}
  return data.occupiedSlots ?? {}
}
