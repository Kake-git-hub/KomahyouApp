// 生徒の退塾判定の「写し」が同じ境界を持つことを 1 つの表で突き合わせる(2026-09-15・確認リスト v1.5.527 b-2)。
// 生徒の退塾日は「その日から非在籍」。高3卒業は hasGraduatedHighSchool の境界どおり 3/31 まで在籍・4/1 から非在籍。
//   権威: src/components/basic-data/basicDataModel.ts isActiveOnDate / isStudentWithdrawnOnDate
//   写し: functions/src/monthlyStudentCount.ts isStudentActiveOnDate(請求の毎月15日記録)
//         src/utils/parentSchedule.ts → functions/src/generated/parentSchedule.ts isParentStudentActiveOnDate(保護者QR)
//         src/utils/scheduleViewData.ts isStudentVisibleInRange(日程表 TS 版)
//         src/utils/scheduleHtml.ts 埋め込み isStudentVisibleInRange(別タブ日程表 JS 版)
// 片方だけ直すとこの表で落ちる。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isActiveOnDate, resolveManagedStudentRosterStatus } from '../components/basic-data/basicDataModel'
import { isStudentActiveOnDate } from '../../functions/src/monthlyStudentCount'
import { isParentStudentActiveOnDate as isGeneratedParentStudentActiveOnDate } from '../../functions/src/generated/parentSchedule'
import { isParentStudentActiveOnDate } from './parentSchedule'
import { isStudentVisibleInRange } from './scheduleViewData'

type Row = { label: string; entryDate: string; withdrawDate: string; birthDate: string; date: string; active: boolean; graduation?: boolean }

const WITHDRAW = '2026-09-15'
// 2007-05-20 生まれ → 高3 の学年度末 2026-03-31。
const GRADUATE_BIRTH = '2007-05-20'

const rows: Row[] = [
  { label: '退塾日の前日', entryDate: '2024-04-01', withdrawDate: WITHDRAW, birthDate: '2012-05-01', date: '2026-09-14', active: true },
  { label: '退塾日当日', entryDate: '2024-04-01', withdrawDate: WITHDRAW, birthDate: '2012-05-01', date: WITHDRAW, active: false },
  { label: '退塾日の翌日', entryDate: '2024-04-01', withdrawDate: WITHDRAW, birthDate: '2012-05-01', date: '2026-09-16', active: false },
  { label: 'スラッシュ表記の退塾日当日', entryDate: '2024-04-01', withdrawDate: '2026/9/15', birthDate: '2012-05-01', date: WITHDRAW, active: false },
  { label: '退塾日 未定', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2012-05-01', date: WITHDRAW, active: true },
  { label: '高3卒業 3/31(在籍)', entryDate: '2020-04-01', withdrawDate: '', birthDate: GRADUATE_BIRTH, date: '2026-03-31', active: true, graduation: true },
  { label: '高3卒業 4/1(非在籍)', entryDate: '2020-04-01', withdrawDate: '', birthDate: GRADUATE_BIRTH, date: '2026-04-01', active: false, graduation: true },
]

function loadEmbeddedStudentVisibleInRange() {
  const source = readFileSync(new URL('./scheduleHtml.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const match = source.match(/function isStudentVisibleInRange\(item, startDate, endDate\)\s*\{([\s\S]*?)\n {6}\}/)
  expect(match).toBeTruthy()
  // 「今日」は表示期間より十分前に固定し、期間判定(退塾日 > 表示開始日)だけを比べる。
  const raw = new Function('getScheduleTodayJstKey', 'item', 'startDate', 'endDate', match![1])
  return (item: { entryDate: string; withdrawDate: string }, date: string) => raw(() => '2000-01-01', item, date, date) as boolean
}

describe('生徒の退塾判定の写し 4 か所 + 権威の一致表', () => {
  const embedded = loadEmbeddedStudentVisibleInRange()

  for (const row of rows) {
    it(row.label, () => {
      expect(isActiveOnDate(row.entryDate, row.withdrawDate, row.birthDate, row.date), 'isActiveOnDate(権威)').toBe(row.active)
      expect(isStudentActiveOnDate(row.entryDate, row.withdrawDate, row.birthDate, row.date), 'functions monthlyStudentCount').toBe(row.active)
      expect(isParentStudentActiveOnDate(row, row.date), 'parentSchedule.ts').toBe(row.active)
      expect(isGeneratedParentStudentActiveOnDate(row, row.date), 'functions 生成物 parentSchedule').toBe(row.active)
      // 基本データの名簿(入塾日不問)も、入塾済みの行では同じ答え。卒業 3/31 は在籍側(自動補完日だけは「その日まで在籍」)。
      expect(resolveManagedStudentRosterStatus(row.withdrawDate, row.birthDate, row.date) === '在籍', '名簿').toBe(row.active)
      // 日程表の表示範囲は退塾日だけを見る(卒業は別経路)ので、卒業行は対象外。
      if (!row.graduation) {
        const item = { entryDate: row.entryDate, withdrawDate: row.withdrawDate.replace(/\//g, '-').replace(/-(\d)(?=-|$)/g, '-0$1') }
        expect(isStudentVisibleInRange(item, row.date, row.date, '2000-01-01'), 'scheduleViewData.ts').toBe(row.active)
        expect(embedded(item, row.date), 'scheduleHtml.ts 埋め込み').toBe(row.active)
      }
    })
  }
})
