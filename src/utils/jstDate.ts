// 日本時間(JST・UTC+9)の日付ユーティリティ。閲覧端末の TZ に依らず日本時間で判定する。
// 「今日」の正本はここ 1 つ(2026-09-15 に billing.ts getJstTodayDateKey と scheduleViewData.ts getScheduleTodayJstKey を統合)。
// ⚠️ 別タブ日程表(scheduleHtml.ts)の埋め込み JS getScheduleTodayJstKey は仕組み上ここを import できない写し。
//    規則(UTC 15:00 で日付が変わる)を変えるときは両方直すこと(jstDate.test.ts が突き合わせる)。
// ⚠️ 保護者QR(parentSchedule.ts toJstDateKey)・台帳(studentLessonLedger.ts toJstDateKey)・functions 側は
//    functions へ複製される自己完結モジュール/サーバー定義と対になっているので、ここへは寄せていない。

const JST_OFFSET_IN_MS = 9 * 60 * 60 * 1000

/** 今日(JST)の日付キー YYYY-MM-DD。 */
export function getJstTodayDateKey(now: Date = new Date()) {
  const jst = new Date(now.getTime() + JST_OFFSET_IN_MS)
  const year = jst.getUTCFullYear()
  const month = `${jst.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${jst.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}
