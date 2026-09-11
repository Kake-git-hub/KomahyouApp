// 講習履歴パーサ（src/utils/lessonHistory.ts と functions/src/lessonLedgerHistory.ts の複製）が
// **同じ入力で同じ結果を出す**ことを両側のテストで確かめるための共有 fixture。
// 本番の台帳（classroomSnapshots/{id}/lessonLedgerDays）と同じトークン書式を写したもの。
// アプリ本体からは import されない（テスト専用・バンドルには入らない）。

export type LessonHistoryFixtureRow = {
  studentId: string | null
  studentKey: string
  name: string
  subject: string
  makeupBalance: number
  makeupRemaining: string[]
  attended: string[]
  absent: string[]
  absentNoMakeup: string[]
  placed: string[]
}

/** 生徒 s001（2科目）＋別生徒 1 行。実データと同じく各配列はソート済み。 */
export const lessonHistoryFixtureRows: LessonHistoryFixtureRow[] = [
  {
    studentId: 's001',
    studentKey: 's001',
    name: '青木 太郎',
    subject: '数',
    makeupBalance: 1,
    makeupRemaining: ['2026-09-03#|手動調整'],
    attended: ['2026-09-01#1|regular', '2026-09-08#1|regular'],
    absent: ['2026-09-02#2|regular|', '2026-09-15#3|makeup|2026-09-02'],
    absentNoMakeup: ['2026-09-22#1|regular'],
    placed: ['2026-09-10#4|makeup|2026-09-02', '2026-09-29#5|special|', '2026-10-01#2|regular'],
  },
  {
    studentId: 's001',
    studentKey: 's001',
    name: '青木 太郎',
    subject: '英',
    makeupBalance: 0,
    makeupRemaining: [],
    attended: ['2026-09-05#3|regular'],
    absent: [],
    absentNoMakeup: [],
    placed: ['2026-09-05#3'],
  },
  {
    studentId: null,
    studentKey: 'name:未管理 花子',
    name: '未管理 花子',
    subject: '国',
    makeupBalance: 2,
    makeupRemaining: ['2026-08-20#2|休講日', '2026-08-27#|手動調整'],
    attended: ['2026-08-06#1|regular'],
    absent: [],
    absentNoMakeup: [],
    placed: [],
  },
]
