// 毎月15日の在籍生徒数「恒久記録(台帳)」のサーバー側ロジックのテスト。
//
// 最重要はパリティテスト: サーバーの在籍判定が、請求画面が使っているクライアントの権威関数
// (basicDataModel.ts の isActiveOnDate)と**必ず同じ答え**を返すこと。台帳の人数と画面の
// ライブ計算が食い違うと、恒久記録そのものが信用できなくなる。
// この import は functions の tsconfig で除外される test ファイル限定(ビルド成果物には入らない)。
import { describe, it, expect } from 'vitest'
import { isActiveOnDate } from '../../src/components/basic-data/basicDataModel'
import {
  countActiveStudentsOnDate,
  isFutureSnapshotDate,
  isMonthlyStudentCountSnapshotDate,
  isStudentActiveOnDate,
  MONTHLY_STUDENT_COUNT_SNAPSHOT_DAY,
  normalizeRosterDateText,
  toJstDateKey,
  toLedgerStudentRows,
  toMonthKeyFromDateKey,
} from './monthlyStudentCount'

// 在籍判定の境界を網羅する表。パリティ検証と個別検証の両方でこれを使う。
const rosterCases: Array<{ label: string; entryDate: string; withdrawDate: string; birthDate: string; referenceDate: string }> = [
  { label: '入塾日当日は在籍', entryDate: '2026-08-15', withdrawDate: '未定', birthDate: '2011-05-20', referenceDate: '2026-08-15' },
  { label: '入塾日前日は非在籍', entryDate: '2026-08-16', withdrawDate: '未定', birthDate: '2011-05-20', referenceDate: '2026-08-15' },
  { label: '退塾日当日は在籍', entryDate: '2024-04-01', withdrawDate: '2026-08-15', birthDate: '2011-05-20', referenceDate: '2026-08-15' },
  { label: '退塾日翌日は非在籍', entryDate: '2024-04-01', withdrawDate: '2026-08-14', birthDate: '2011-05-20', referenceDate: '2026-08-15' },
  { label: '入塾日が未定(空)なら入塾前判定をしない', entryDate: '', withdrawDate: '未定', birthDate: '2011-05-20', referenceDate: '2026-08-15' },
  { label: '退塾日が「未定」なら退塾判定をしない', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-05-20', referenceDate: '2026-08-15' },
  { label: 'スラッシュ区切りの日付も正規化して比較', entryDate: '2026/8/16', withdrawDate: '未定', birthDate: '2011-05-20', referenceDate: '2026-08-15' },
  { label: '高3卒業後(4/1以降)は非在籍', entryDate: '2020-04-01', withdrawDate: '未定', birthDate: '2007-05-20', referenceDate: '2026-08-15' },
  { label: '高3在学中は在籍', entryDate: '2020-04-01', withdrawDate: '未定', birthDate: '2008-05-20', referenceDate: '2026-08-15' },
  { label: '生年月日が空なら卒業判定をしない', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '', referenceDate: '2026-08-15' },
  { label: '生年月日が不正なら卒業判定をしない', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: 'あああ', referenceDate: '2026-08-15' },
  { label: '早生まれ(1〜3月)の卒業境界', entryDate: '2020-04-01', withdrawDate: '未定', birthDate: '2008-02-10', referenceDate: '2026-08-15' },
  { label: '年度替わり前(3/31)は卒業していない', entryDate: '2020-04-01', withdrawDate: '未定', birthDate: '2007-05-20', referenceDate: '2026-03-31' },
]

describe('在籍判定のパリティ(サーバー鏡像 vs クライアント権威関数)', () => {
  // 鏡像がクライアントからズレたらここが落ちる。片方だけ直す変更への歯止め。
  it.each(rosterCases)('$label', ({ entryDate, withdrawDate, birthDate, referenceDate }) => {
    expect(isStudentActiveOnDate(entryDate, withdrawDate, birthDate, referenceDate))
      .toBe(isActiveOnDate(entryDate, withdrawDate, birthDate, referenceDate))
  })

  it('全ケースで少なくとも1件ずつ在籍/非在籍が出ている(常に同じ値を返して一致しているだけ、ではない)', () => {
    const results = rosterCases.map((row) => isStudentActiveOnDate(row.entryDate, row.withdrawDate, row.birthDate, row.referenceDate))
    expect(results).toContain(true)
    expect(results).toContain(false)
  })
})

describe('isStudentActiveOnDate の個別境界', () => {
  it('入塾日当日は在籍、前日は非在籍', () => {
    expect(isStudentActiveOnDate('2026-08-15', '未定', '', '2026-08-15')).toBe(true)
    expect(isStudentActiveOnDate('2026-08-16', '未定', '', '2026-08-15')).toBe(false)
  })

  it('退塾日当日は在籍、翌日は非在籍', () => {
    expect(isStudentActiveOnDate('2024-04-01', '2026-08-15', '', '2026-08-15')).toBe(true)
    expect(isStudentActiveOnDate('2024-04-01', '2026-08-14', '', '2026-08-15')).toBe(false)
  })

  it('高3卒業(4/1以降)は非在籍', () => {
    expect(isStudentActiveOnDate('2020-04-01', '未定', '2007-05-20', '2026-03-31')).toBe(true)
    expect(isStudentActiveOnDate('2020-04-01', '未定', '2007-05-20', '2026-04-01')).toBe(false)
  })
})

describe('normalizeRosterDateText', () => {
  it('未定・空・不正は空文字にする', () => {
    expect(normalizeRosterDateText('未定')).toBe('')
    expect(normalizeRosterDateText('   ')).toBe('')
    expect(normalizeRosterDateText('とても昔')).toBe('')
  })

  it('スラッシュ/ドット区切りをゼロ埋めして正規化する', () => {
    expect(normalizeRosterDateText('2026/8/1')).toBe('2026-08-01')
    expect(normalizeRosterDateText('2026.12.31')).toBe('2026-12-31')
    expect(normalizeRosterDateText('2026-08-15')).toBe('2026-08-15')
  })
})

describe('countActiveStudentsOnDate', () => {
  const students = [
    { id: 's001', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-05-20' },
    { id: 's002', entryDate: '2024-04-01', withdrawDate: '2026-08-14', birthDate: '2011-05-20' }, // 前日退塾=非在籍
    { id: 's003', entryDate: '2026-09-01', withdrawDate: '未定', birthDate: '2012-01-10' }, // 未来入塾=非在籍
    { id: 's004', entryDate: '2020-04-01', withdrawDate: '未定', birthDate: '2007-05-20' }, // 高3卒業=非在籍
    { id: 's005', entryDate: '2024-04-01', withdrawDate: '2026-08-15', birthDate: '2010-11-11' }, // 当日退塾=在籍
  ]

  it('指定日に在籍している生徒だけを数え、内訳IDを返す', () => {
    const result = countActiveStudentsOnDate(students, '2026-08-15')
    expect(result.studentCount).toBe(2)
    expect(result.studentIds).toEqual(['s001', 's005'])
  })

  it('集計日が変われば人数も変わる(日付で判定している証明)', () => {
    expect(countActiveStudentsOnDate(students, '2026-08-14').studentCount).toBe(3)
    expect(countActiveStudentsOnDate(students, '2026-09-15').studentCount).toBe(2)
  })

  it('students が配列でなければ0件として扱う(壊れたスナップショットで落ちない)', () => {
    expect(countActiveStudentsOnDate(undefined, '2026-08-15')).toEqual({ studentCount: 0, studentIds: [] })
    expect(countActiveStudentsOnDate(null, '2026-08-15')).toEqual({ studentCount: 0, studentIds: [] })
    expect(countActiveStudentsOnDate({ students: [] }, '2026-08-15')).toEqual({ studentCount: 0, studentIds: [] })
  })

  it('id が無い在籍生徒も人数には数える(内訳IDからは落ちる)', () => {
    const result = countActiveStudentsOnDate([{ entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2011-05-20' }], '2026-08-15')
    expect(result.studentCount).toBe(1)
    expect(result.studentIds).toEqual([])
  })
})

describe('toLedgerStudentRows', () => {
  it('文字列以外のフィールドは空文字に落として判定を壊さない', () => {
    expect(toLedgerStudentRows([{ id: 1, entryDate: null, withdrawDate: undefined, birthDate: {} }])).toEqual([
      { id: '', entryDate: '', withdrawDate: '', birthDate: '' },
    ])
  })

  it('null や非オブジェクトの行は捨てる', () => {
    expect(toLedgerStudentRows([null, 'あ', 42, { id: 's001', entryDate: '', withdrawDate: '', birthDate: '' }])).toHaveLength(1)
  })
})

describe('記録日(JST)の決定', () => {
  it('UTC の瞬間を JST の日付キーへ寄せる', () => {
    // 15日 00:10 JST = 14日 15:10 UTC。UTC のまま日付キーを作ると1日ずれる。
    expect(toJstDateKey(new Date('2026-08-14T15:10:00Z'))).toBe('2026-08-15')
    expect(toJstDateKey(new Date('2026-08-14T14:50:00Z'))).toBe('2026-08-14')
    expect(toJstDateKey(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01')
  })

  it('15日だけを毎月の記録日として認める', () => {
    expect(MONTHLY_STUDENT_COUNT_SNAPSHOT_DAY).toBe(15)
    expect(isMonthlyStudentCountSnapshotDate('2026-08-15')).toBe(true)
    expect(isMonthlyStudentCountSnapshotDate('2026-08-05')).toBe(false)
    expect(isMonthlyStudentCountSnapshotDate('2026-08-25')).toBe(false)
  })

  it('日付キーから請求月キーを取り出す', () => {
    expect(toMonthKeyFromDateKey('2026-08-15')).toBe('2026-08')
  })
})

// write-once の台帳に未来日を先回りで記録すると、その日の定期実行が「既に記録あり」で
// スキップし、本当のその日時点の在籍数が永久に残らなくなる。請求画面の既定集計日は
// 当月15日=月の前半は未来日なので、実際に踏み得る穴。このガードを外さないこと。
describe('未来日の記録禁止', () => {
  it('今日より後の日付は未来日と判定する', () => {
    expect(isFutureSnapshotDate('2026-08-15', '2026-08-08')).toBe(true)
    expect(isFutureSnapshotDate('2026-09-01', '2026-08-31')).toBe(true)
  })

  it('今日ちょうど・過去の日付は記録できる', () => {
    expect(isFutureSnapshotDate('2026-08-08', '2026-08-08')).toBe(false)
    expect(isFutureSnapshotDate('2026-07-15', '2026-08-08')).toBe(false)
    expect(isFutureSnapshotDate('2025-12-31', '2026-01-01')).toBe(false)
  })
})
