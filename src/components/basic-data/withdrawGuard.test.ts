import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isActiveOnDate, isStudentDeletedFromApp, resolveManagedRosterStatus, resolveManagedStudentRosterStatus } from './basicDataModel'
import { applyLockedStudentBirthDateCorrection, applyStudentWithdrawToday, buildStudentWithdrawConfirmation, canDeleteStudentFromApp, canWithdrawStudentToday, filterStudentsVisibleInBasicData, isStudentInWithdrawnRosterList, isStudentRowLockedByWithdrawal, markStudentDeletedFromApp, preserveWithdrawnStudentRowsOnImport } from './withdrawGuard'

const TODAY = '2026-09-13'

describe('canWithdrawStudentToday（退塾ボタンを出す条件）', () => {
  it('退塾日が未定の在籍生徒には出す', () => {
    expect(canWithdrawStudentToday({ withdrawDate: '', birthDate: '2012-05-01' }, TODAY)).toBe(true)
    expect(canWithdrawStudentToday({ withdrawDate: '未定', birthDate: '2012-05-01' }, TODAY)).toBe(true)
  })

  it('将来の退塾日が入っている在籍生徒にも出す（押すと今日付けに置き換え）', () => {
    expect(canWithdrawStudentToday({ withdrawDate: '2026-10-31', birthDate: '2012-05-01' }, TODAY)).toBe(true)
  })

  it('今日付けで退塾済み（当日から非在籍）の生徒には出さない＝二度押し防止', () => {
    expect(canWithdrawStudentToday({ withdrawDate: TODAY, birthDate: '2012-05-01' }, TODAY)).toBe(false)
  })

  it('退塾日を過ぎた非在籍の生徒・高3卒業後の生徒には出さない', () => {
    expect(canWithdrawStudentToday({ withdrawDate: '2026-08-31', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(canWithdrawStudentToday({ withdrawDate: '', birthDate: '2000-05-01' }, TODAY)).toBe(false)
  })
})

describe('isStudentInWithdrawnRosterList（退塾ボタンを押したらすぐ一覧から外す・2026-09-15）', () => {
  it('退塾日が今日の生徒は、押した直後から非在籍一覧に入る（在籍一覧に残らない）', () => {
    const [withdrawn] = applyStudentWithdrawToday([{ id: 's001', withdrawDate: '', birthDate: '2012-05-01' }], 's001', TODAY)
    expect(isStudentInWithdrawnRosterList(withdrawn, TODAY)).toBe(true)
  })

  // 2026-09-15 改定(確認リスト v1.5.527 b-2): 生徒の退塾日は「その日から非在籍」。退塾日は今日のまま記録し(前日付けにしない)、
  // 共有の生徒在籍判定(盤面/請求/保護者QR が使う isActiveOnDate)も今日から非在籍になる＝一覧の特別扱いと食い違わない。
  it('退塾日は今日のまま記録し、共有の生徒在籍判定でも今日から非在籍になる（前日=在籍/当日=非在籍/翌日=非在籍）', () => {
    const [withdrawn] = applyStudentWithdrawToday([{ id: 's001', withdrawDate: '', birthDate: '2012-05-01' }], 's001', TODAY)
    expect(withdrawn.withdrawDate).toBe(TODAY)
    expect(isActiveOnDate('', withdrawn.withdrawDate, withdrawn.birthDate, '2026-09-12')).toBe(true)
    expect(isActiveOnDate('', withdrawn.withdrawDate, withdrawn.birthDate, TODAY)).toBe(false)
    expect(isActiveOnDate('', withdrawn.withdrawDate, withdrawn.birthDate, '2026-09-14')).toBe(false)
    expect(resolveManagedStudentRosterStatus(withdrawn.withdrawDate, withdrawn.birthDate, '2026-09-12')).toBe('在籍')
    expect(resolveManagedStudentRosterStatus(withdrawn.withdrawDate, withdrawn.birthDate, TODAY)).toBe('非在籍')
    expect(isStudentInWithdrawnRosterList(withdrawn, '2026-09-12')).toBe(false)
    expect(isStudentInWithdrawnRosterList(withdrawn, TODAY)).toBe(true)
    expect(isStudentInWithdrawnRosterList(withdrawn, '2026-09-14')).toBe(true)
  })

  // オーナー決定(2026-09-15): 高3卒業の自動補完退塾日は表示 3/31 のまま・3/31 まで在籍。一覧振り分け・削除・退塾ボタンも 3/31 は在籍側。
  it('高3卒業生(退塾日なし)は 3/31 まで在籍側・4/1 から非在籍側(自動補完日だけは「その日まで在籍」)', () => {
    const graduate = { withdrawDate: '', birthDate: '2007-05-20' } // 高3 学年度末 2026-03-31
    expect(isStudentInWithdrawnRosterList(graduate, '2026-03-31')).toBe(false)
    expect(canWithdrawStudentToday(graduate, '2026-03-31')).toBe(true)
    expect(canDeleteStudentFromApp(graduate, '2026-03-31')).toBe(false)
    expect(isStudentInWithdrawnRosterList(graduate, '2026-04-01')).toBe(true)
    expect(canWithdrawStudentToday(graduate, '2026-04-01')).toBe(false)
    expect(canDeleteStudentFromApp(graduate, '2026-04-01')).toBe(true)
    // 手入力の退塾日 3/31 は新定義どおり当日から非在籍。
    const typed = { withdrawDate: '2026-03-31', birthDate: '2007-05-20' }
    expect(isStudentInWithdrawnRosterList(typed, '2026-03-31')).toBe(true)
    expect(canDeleteStudentFromApp(typed, '2026-03-31')).toBe(true)
  })

  it('講師用の判定(退職日当日は在籍)は変えていない＝生徒の一覧振り分けを講師用へ戻すと当日在籍一覧に残る', () => {
    expect(resolveManagedRosterStatus(TODAY, '', TODAY)).toBe('在籍')
  })

  it('未定・将来の退塾日は在籍一覧、過去の退塾日・高3卒業後は非在籍一覧', () => {
    expect(isStudentInWithdrawnRosterList({ withdrawDate: '', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(isStudentInWithdrawnRosterList({ withdrawDate: '未定', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(isStudentInWithdrawnRosterList({ withdrawDate: '2026-09-14', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(isStudentInWithdrawnRosterList({ withdrawDate: '2026-08-31', birthDate: '2012-05-01' }, TODAY)).toBe(true)
    expect(isStudentInWithdrawnRosterList({ withdrawDate: '', birthDate: '2000-05-01' }, TODAY)).toBe(true)
  })

  it('基本データ画面の在籍/非在籍一覧はこの判定で振り分ける（当日在籍の判定に戻さない）', () => {
    const source = readFileSync(fileURLToPath(new URL('./BasicDataScreen.tsx', import.meta.url)), 'utf8')
    expect(source).toContain('filterStudentsVisibleInBasicData(students).filter((student) => !isStudentInWithdrawnRosterList(student, todayReferenceDate))')
    expect(source).toContain('filterStudentsVisibleInBasicData(students).filter((student) => isStudentInWithdrawnRosterList(student, todayReferenceDate))')
  })
})

describe('applyStudentWithdrawToday（押した日を退塾日として記録・データは残す）', () => {
  const students = [
    { id: 's001', name: '生徒A', withdrawDate: '', birthDate: '2012-05-01' },
    { id: 's002', name: '生徒B', withdrawDate: '未定', birthDate: '2011-05-01' },
  ]

  it('対象生徒の退塾日だけを今日にし、行は削除しない', () => {
    const next = applyStudentWithdrawToday(students, 's002', TODAY)
    expect(next).toHaveLength(2)
    expect(next.map((row) => row.id)).toEqual(['s001', 's002'])
    expect(next[1]).toEqual({ ...students[1], withdrawDate: TODAY })
    expect(next[0]).toBe(students[0])
  })

  it('元の配列を書き換えない', () => {
    applyStudentWithdrawToday(students, 's001', TODAY)
    expect(students[0].withdrawDate).toBe('')
  })
})

describe('buildStudentWithdrawConfirmation', () => {
  it('今日の日付と「データは削除されず残る」ことを伝える(掃除フラグ ON の教室)', () => {
    const confirmation = buildStudentWithdrawConfirmation({ name: '生徒A', today: TODAY, currentWithdrawDate: '', autoSweepEnabled: true })
    expect(confirmation.title).toBe('生徒A を退塾にします')
    expect(confirmation.message).toContain(TODAY)
    expect(confirmation.message).toContain('削除されず「退塾生徒」に残ります')
    // 2026-09-20 夜 改定: 一覧の呼び名は「退塾生徒」(旧「非在籍生徒表示」へ戻さない)。
    expect(confirmation.message).toContain('退塾生徒')
    // 2026-09-15 改定: 「本日まで在籍扱い」とは言わず、本日から盤面の通常授業などから外れると伝える。
    expect(confirmation.message).not.toContain('本日まで在籍')
    expect(confirmation.message).toContain('本日から非在籍')
    // 2026-09-20 改定(確認リスト b-2 要改善・オーナー確定): 今日以降の手置きのコマと記録も消える。
    // ★旧案内「手で置いた講習・振替のコマは残ります」へ戻さない(退塾スイープと食い違って室長が誤解する)。
    expect(confirmation.message).not.toContain('講習・振替のコマは残ります')
    expect(confirmation.message).toContain('今日以降の講習・振替などのコマと記録も消えます')
    expect(confirmation.message).toContain('未消化へは戻りません')
    expect(confirmation.message).toContain('昨日以前の記録は残ります')
    // 2026-09-20 夜 改定: 退塾後は退塾日も編集できない=取り消せないので「元に戻せません」と伝える。
    expect(confirmation.message).toContain('退塾にすると元に戻せません')
    expect(confirmation.overwriteNote).toBeNull()
    expect(confirmation.stockWarning).toBeNull()
  })

  it('将来の退塾日が入っているときは置き換えを明示する（未定は置き換え扱いにしない）', () => {
    expect(buildStudentWithdrawConfirmation({ name: 'A', today: TODAY, currentWithdrawDate: '2026-10-31' }).overwriteNote).toContain('2026-10-31')
    expect(buildStudentWithdrawConfirmation({ name: 'A', today: TODAY, currentWithdrawDate: '未定' }).overwriteNote).toBeNull()
  })

  // ★段階導入(レビュー指摘 2026-09-21): 盤面の掃除はフラグ studentWithdrawAutoSweep が ON の教室だけで走る。
  //   OFF の教室で「今日以降のコマと記録も消えます」と案内すると**事実と違う**(手で置いたコマは残る)。
  //   引数を渡し忘れたときも「消えない側」の案内になること(既定 false = 安全側)をここで固定する。
  it('★フラグ OFF の教室では「手で置いた講習・振替のコマは残ります」と案内する(既定も OFF 側)', () => {
    for (const confirmation of [
      buildStudentWithdrawConfirmation({ name: '生徒A', today: TODAY, currentWithdrawDate: '', autoSweepEnabled: false }),
      buildStudentWithdrawConfirmation({ name: '生徒A', today: TODAY, currentWithdrawDate: '' }),
    ]) {
      expect(confirmation.message).toContain('手で置いた講習・振替のコマは残ります')
      expect(confirmation.message).not.toContain('今日以降の講習・振替などのコマと記録も消えます')
      expect(confirmation.message).not.toContain('未消化へは戻りません')
      // 退塾後の行ロックはフラグに依らず全教室で有効なので、「元に戻せません」は OFF でも出す。
      expect(confirmation.message).toContain('退塾にすると元に戻せません')
      expect(confirmation.message).toContain('本日から非在籍')
      expect(confirmation.message).toContain('削除されず「退塾生徒」に残ります')
    }
  })

  it('未消化の講習/振替が残るときは件数を出す', () => {
    const confirmation = buildStudentWithdrawConfirmation({ name: 'A', today: TODAY, currentWithdrawDate: '', stock: { lecture: 4, makeup: 1 } })
    expect(confirmation.stockWarning).toContain('未消化の講習 4 件')
    expect(confirmation.stockWarning).toContain('未消化の振替 1 件')
  })
})

describe('非在籍一覧の削除（アプリ上から消す・データは残す／オーナー指示 2026-09-13）', () => {
  it('削除ボタンは非在籍(退塾済み・高3卒業後)で未削除の生徒だけ', () => {
    expect(canDeleteStudentFromApp({ withdrawDate: '2026-08-31', birthDate: '2012-05-01' }, TODAY)).toBe(true)
    expect(canDeleteStudentFromApp({ withdrawDate: '', birthDate: '2000-05-01' }, TODAY)).toBe(true)
    // 確認リスト v1.5.527 b-2(2026-09-15): 今日付けで退塾した生徒は当日から非在籍なので、非在籍一覧で当日から削除できる
    expect(canDeleteStudentFromApp({ withdrawDate: TODAY, birthDate: '2012-05-01' }, TODAY)).toBe(true)
    // 在籍中(未定・明日以降の退塾日)は削除できない
    expect(canDeleteStudentFromApp({ withdrawDate: '', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(canDeleteStudentFromApp({ withdrawDate: '2026-09-14', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(canDeleteStudentFromApp({ withdrawDate: '2026-10-31', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    // 削除済みは二度出さない
    expect(canDeleteStudentFromApp({ withdrawDate: '2026-08-31', birthDate: '2012-05-01', deletedAt: '2026-09-13T01:00:00.000Z' }, TODAY)).toBe(false)
  })

  it('削除しても行は残り、削除日時だけが記録される（最初の削除日時は上書きしない）', () => {
    const students: Array<{ id: string; name: string; withdrawDate: string; birthDate: string; deletedAt?: string }> = [
      { id: 's001', name: 'A', withdrawDate: '2026-08-31', birthDate: '2012-05-01' },
      { id: 's002', name: 'B', withdrawDate: '2026-08-31', birthDate: '2012-05-01' },
    ]
    const next = markStudentDeletedFromApp(students, 's001', '2026-09-13T01:00:00.000Z')
    expect(next).toHaveLength(2)
    expect(next[0]).toEqual({ ...students[0], deletedAt: '2026-09-13T01:00:00.000Z' })
    expect(next[1]).toBe(students[1])
    const again = markStudentDeletedFromApp(next, 's001', '2026-09-20T01:00:00.000Z')
    expect(again[0].deletedAt).toBe('2026-09-13T01:00:00.000Z')
  })

  it('基本データ画面の一覧からは削除済みを外す（空白だけの deletedAt は未削除扱い）', () => {
    const rows = [{ id: 's001' }, { id: 's002', deletedAt: '2026-09-13T01:00:00.000Z' }, { id: 's003', deletedAt: '  ' }]
    expect(filterStudentsVisibleInBasicData(rows).map((row) => row.id)).toEqual(['s001', 's003'])
    expect(isStudentDeletedFromApp(undefined)).toBe(false)
  })
})

describe('基本データ画面: 生徒は削除せず退塾ボタン（オーナー指示 2026-09-13）', () => {
  const source = readFileSync(fileURLToPath(new URL('./BasicDataScreen.tsx', import.meta.url)), 'utf8')

  it('生徒名簿から行を取り除く削除経路が無い（削除は deletedAt の記録）', () => {
    expect(source).not.toMatch(/onUpdateStudents\(\(current\) => current\.filter\(/)
    expect(source).toContain('markStudentDeletedFromApp(current, id, new Date().toISOString())')
  })

  it('★退塾生徒(非在籍)の行は生年月日以外の入力を出さない(オーナー確定 2026-09-20 夜・案2 2026-09-21 で生年月日だけ解禁)', () => {
    // 退塾すると今日以降の盤面の痕跡が消える=元に戻せないので、退塾日も含めて編集不可。残す操作は「削除」だけ。
    expect(source).toContain('const isStudentRowLocked = (row: StudentRow) => isStudentRowLockedByWithdrawal(row, todayReferenceDate)')
    expect(source).toContain("const isStudentRowInputVisible = (row: StudentRow) => isRowEditing('student', row.id) && !isStudentRowLocked(row)")
    // 案2: 編集ボタンは退塾生徒にも出す(ラベルは「生年月日を修正」)。入力が出るのは生年月日のセルだけ。
    expect(source).not.toContain('{isStudentRowLocked(row) ? null : (')
    expect(source).toContain("isStudentRowLocked(row) ? '生年月日を修正' : '編集'")
    expect(source).toContain("const isStudentBirthDateInputVisible = (row: StudentRow) => isRowEditing('student', row.id)")
    expect(source.split('{isStudentBirthDateInputVisible(row)')).toHaveLength(2)
    expect(source).toContain('onChange={(value) => updateStudentBirthDate(row, value)}')
    expect(source).toContain('applyLockedStudentBirthDateCorrection(entry, value, todayReferenceDate)')
    // 生徒行のセルはすべて lock を通した判定を使う(素の isRowEditing で入力を出す穴を残さない)。
    expect(source.match(/isStudentRowInputVisible\(row\)/g)).toHaveLength(6)
    expect(source).not.toMatch(/\{isRowEditing\('student', row\.id\)\r?\n {22}\?/)
    // 文言は「退塾生徒」(testid は変えない)。
    expect(source).toContain('data-testid="basic-data-student-roster-withdrawn">退塾生徒</button>')
    expect(source).toContain("'退塾生徒を氏名・表示名で絞り込み'")
    expect(source).toContain("'退塾生徒はまだありません。'")
    expect(source).not.toContain('非在籍生徒表示')
  })

  it('削除ボタンは非在籍一覧だけに出し、在籍/非在籍の両一覧から削除済みを外す', () => {
    expect(source).toContain("studentRosterView === 'withdrawn' && canDeleteStudentFromApp(row, todayReferenceDate)")
    expect(source.match(/filterStudentsVisibleInBasicData\(students\)\.filter\(/g)).toHaveLength(2)
  })

  it('退塾ボタンが applyStudentWithdrawToday で退塾日を記録する', () => {
    expect(source).toContain('basic-data-withdraw-student-')
    expect(source).toContain('applyStudentWithdrawToday(current, withdrawModalState.id, today)')
  })
})

describe('退塾後の行ロックと取り込みガード(オーナー確定 2026-09-20 夜)', () => {
  const ROW = { id: 's001', withdrawDate: '', birthDate: '2012-05-01' }

  it('在籍中(退塾日が未来)は編集できる。退塾日当日以降(非在籍)はロックする', () => {
    expect(isStudentRowLockedByWithdrawal({ ...ROW, withdrawDate: '' }, TODAY)).toBe(false)
    expect(isStudentRowLockedByWithdrawal({ ...ROW, withdrawDate: '未定' }, TODAY)).toBe(false)
    expect(isStudentRowLockedByWithdrawal({ ...ROW, withdrawDate: '2026-10-31' }, TODAY)).toBe(false)
    // 退塾日当日から非在籍(共有判定 resolveManagedStudentRosterStatus と同じ境界)。
    expect(isStudentRowLockedByWithdrawal({ ...ROW, withdrawDate: TODAY }, TODAY)).toBe(true)
    expect(isStudentRowLockedByWithdrawal({ ...ROW, withdrawDate: '2026-08-31' }, TODAY)).toBe(true)
    // 高3卒業(退塾日が未入力でも非在籍)もロックする。
    expect(isStudentRowLockedByWithdrawal({ ...ROW, birthDate: '2000-05-01' }, TODAY)).toBe(true)
  })

  it('Excel 差分取り込みは退塾済みの行を変更しない(退塾日が消える/変わる裏口を作らない)', () => {
    const current = [
      { id: 's001', withdrawDate: '2026-08-31', birthDate: '2012-05-01', name: '退塾済み' },
      { id: 's002', withdrawDate: '', birthDate: '2012-05-01', name: '在籍' },
    ]
    const imported = [
      { id: 's001', withdrawDate: '', birthDate: '2012-05-01', name: '退塾済み(取り込みで退塾日が消えた)' },
      { id: 's002', withdrawDate: '2026-12-31', birthDate: '2012-05-01', name: '在籍(更新)' },
      { id: 's003', withdrawDate: '', birthDate: '2013-05-01', name: '新規' },
    ]
    const merged = preserveWithdrawnStudentRowsOnImport(imported, current, TODAY)
    expect(merged[0]).toBe(current[0]) // 退塾済みは取り込み前のまま(同じ参照)
    expect(merged[1]).toEqual(imported[1]) // 在籍中は取り込みどおり更新
    expect(merged[2]).toEqual(imported[2])
  })

  it('取り込み結果に無い退塾済みの行は落とさずに残す(名簿から消える方が危険=安全側)', () => {
    const current = [{ id: 's001', withdrawDate: '2026-08-31', birthDate: '2012-05-01' }]
    const merged = preserveWithdrawnStudentRowsOnImport([], current, TODAY)
    expect(merged).toEqual([current[0]])
    // 退塾済みが 1 人も居なければ取り込み結果そのまま(余計なコピー以外の変化なし)。
    expect(preserveWithdrawnStudentRowsOnImport([{ id: 's002', withdrawDate: '', birthDate: '2012-05-01' }], [], TODAY))
      .toEqual([{ id: 's002', withdrawDate: '', birthDate: '2012-05-01' }])
  })

  it('退塾の確認文は「元に戻せません」と伝え、一覧の呼び名も「退塾生徒」に揃える', () => {
    const confirmation = buildStudentWithdrawConfirmation({ name: '山田 太郎', today: TODAY, currentWithdrawDate: '', autoSweepEnabled: true })
    expect(confirmation.message).toContain('退塾にすると元に戻せません')
    expect(confirmation.message).toContain('退塾生徒')
    expect(confirmation.message).not.toContain('非在籍生徒表示')
    expect(confirmation.message).not.toContain('退塾日を消してください')
  })
})

// 案2(オーナー確定 2026-09-21): 退塾後も生年月日だけは直せる。誤入力で卒業扱いになった生徒を「削除して作り直す」以外で救う。
describe('applyLockedStudentBirthDateCorrection(退塾生徒の生年月日の修正)', () => {
  const TODAY_KEY = '2027-04-10'
  const base = { id: 's001', withdrawDate: '2027-03-31', birthDate: '2007-05-01', graduationWithdrawAutoFilledAt: '2027-04-01T00:00:00.000Z' }

  it('卒業で自動入力された退塾日は、生年月日を直して卒業扱いでなくなったら印ごと外す(行のロックが解ける)', () => {
    const next = applyLockedStudentBirthDateCorrection(base, '2017-05-01', TODAY_KEY)
    expect(next.birthDate).toBe('2017-05-01')
    expect(next.withdrawDate).toBe('')
    expect('graduationWithdrawAutoFilledAt' in next).toBe(false)
    expect(isStudentRowLockedByWithdrawal(next, TODAY_KEY)).toBe(false)
  })

  it('直しても卒業扱いのままなら退塾日は外さない', () => {
    const next = applyLockedStudentBirthDateCorrection(base, '2007-06-01', TODAY_KEY)
    expect(next).toMatchObject({ birthDate: '2007-06-01', withdrawDate: '2027-03-31', graduationWithdrawAutoFilledAt: base.graduationWithdrawAutoFilledAt })
  })

  it('★室長が手で入れた退塾日(印なし)は、生年月日を直しても外さない(退塾は元に戻せない)', () => {
    const manual = { id: 's002', withdrawDate: '2027-03-31', birthDate: '2007-05-01' }
    const next = applyLockedStudentBirthDateCorrection(manual, '2017-05-01', TODAY_KEY)
    expect(next.withdrawDate).toBe('2027-03-31')
    expect(isStudentRowLockedByWithdrawal(next, TODAY_KEY)).toBe(true)
  })

  it('入力を破壊しない', () => {
    const frozen = Object.freeze({ ...base })
    applyLockedStudentBirthDateCorrection(frozen, '2017-05-01', TODAY_KEY)
    expect(frozen.withdrawDate).toBe('2027-03-31')
  })
})
