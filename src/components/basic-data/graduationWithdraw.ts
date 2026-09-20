// 高3卒業の「退塾日 自動入力」(オーナー確定 2026-09-20・案A)。
//
// 何を解くか: 高3の卒業は従来「管理データ画面の**表示上だけ**退塾日(3/31)を補完する」扱いで
// (`resolveEffectiveManagedWithdrawDate`)、実データ `withdrawDate` は空のままだった。そのため
//   ・盤面の痕跡消し(退塾スイープ)の対象にならない(退塾日が無いので非在籍の起点が決まらない)、
//   ・請求・名簿の扱いが「表示は非在籍／データは空」で二重になる、
// という食い違いが残っていた。オーナー確定で **卒業した高3も退塾扱い**にし、4/1 になったら
// `withdrawDate` へ 3/31 を実データとして入れる。
//
// ★守るべき境界と制約:
//   - 判定関数は変えない(`isActiveOnDate` / `resolveManagedStudentRosterStatus` / `hasGraduatedHighSchool` は
//     無改変・ロックテスト維持)。**データ(withdrawDate)を入れることで実現する**。請求の在籍数は withdrawDate に
//     従って自然に外れる。
//   - 4/1 境界: `hasGraduatedHighSchool` がそのまま境界の権威(3/31 は在籍＝入れない・4/1 から入れる)。
//     入れる日付は表示補完と同じ `resolveGraduationWithdrawDate`(高3学年度末=3/31)。
//   - **1 人につき 1 回だけ**: 印 `graduationWithdrawAutoFilledAt` を付け、以後は withdrawDate が空でも触らない
//     (室長が後で退塾日を消しても勝手に戻さない)。
//   - 既に退塾日が入っている生徒は**上書きしない**(室長の入力・退塾ボタンが優先)。
//   - 高3以外(卒業していない生徒)・生年月日が無い生徒は対象外。
import { hasGraduatedHighSchool } from '../../utils/studentGradeSubject'
import { normalizeDateText, resolveGraduationWithdrawDate, type StudentRow } from './basicDataModel'

export type GraduationWithdrawAutoFillResult<T> = {
  /** 1 人でも書き換えたか(false のとき呼び出し側は state を触らない＝開いただけで未保存にしない)。 */
  changed: boolean
  students: T[]
  /** 自動入力した生徒の id(メッセージ・操作ログ用)。 */
  filledStudentIds: string[]
}

export function applyGraduationWithdrawAutoFill<T extends Pick<StudentRow, 'id' | 'withdrawDate' | 'birthDate' | 'graduationWithdrawAutoFilledAt'>>(params: {
  students: ReadonlyArray<T>
  todayKey: string
  nowIso: string
}): GraduationWithdrawAutoFillResult<T> {
  const { students, todayKey, nowIso } = params
  const filledStudentIds: string[] = []
  const nextStudents = students.map((student) => {
    if (student.graduationWithdrawAutoFilledAt?.trim()) return student // 一度入れた生徒は二度と触らない
    if (normalizeDateText(student.withdrawDate)) return student // 既にある退塾日は上書きしない
    if (!hasGraduatedHighSchool(student.birthDate, todayKey)) return student // まだ卒業していない/高3以外
    const graduationWithdrawDate = resolveGraduationWithdrawDate(student.birthDate)
    if (!graduationWithdrawDate) return student // 生年月日が壊れている＝安全側で触らない
    filledStudentIds.push(student.id)
    return { ...student, withdrawDate: graduationWithdrawDate, graduationWithdrawAutoFilledAt: nowIso }
  })
  if (filledStudentIds.length === 0) return { changed: false, students: [...students], filledStudentIds: [] }
  return { changed: true, students: nextStudents, filledStudentIds }
}

/** 室長へ出すメッセージ(自動入力が起きたときだけ)。 */
export function buildGraduationWithdrawAutoFillMessage(filledCount: number): string {
  if (filledCount <= 0) return ''
  return `卒業した高3 ${filledCount} 名に退塾日(3月31日)を自動入力しました。保存してください。`
}
