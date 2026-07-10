import { describe, expect, it } from 'vitest'
import { compareManagedStudentsByGradeThenName, compareStudentsByCurrentGradeThenName, formatStudentSelectionLabel, isActiveOnDate, isStudentVisibleInManagement, isTeacherVisibleInManagement, resolveCurrentStudentGradeLabel, resolveEffectiveManagedWithdrawDate, resolveGraduationWithdrawDate, resolveManagedRosterStatus, resolveManagedStudentGradeLabel, resolveManagementRosterStatusLabel, resolveTeacherRosterStatus, type StudentRow, type TeacherRow } from './basicDataModel'

function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    name: '山田 太郎',
    displayName: '山田',
    email: 'student@example.com',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    birthDate: '2013-05-01',
    ...overrides,
  }
}

function createTeacher(overrides: Partial<TeacherRow> = {}): TeacherRow {
  return {
    id: 'teacher-1',
    name: '山田講師',
    displayName: '山田',
    email: 'teacher@example.com',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
    ...overrides,
  }
}

describe('basicDataModel student labels and sorting', () => {
  it('formats student selection labels with the school-year grade', () => {
    const student = createStudent({ displayName: '山田太郎', birthDate: '2013-05-01' })

    expect(resolveCurrentStudentGradeLabel(student, '2026-03-27')).toBe('小6')
    expect(formatStudentSelectionLabel(student, '2026-03-27')).toBe('山田太郎 (小6)')
  })

  it('does not advance the grade after the birthday inside the same school year', () => {
    const student = createStudent({ birthDate: '2013-05-01' })

    expect(resolveCurrentStudentGradeLabel(student, '2026-05-08')).toBe('中1')
  })

  it('treats April 1 births in the same school-year group as other April births', () => {
    expect(resolveCurrentStudentGradeLabel(createStudent({ id: 'student-a', birthDate: '2012-04-01' }), '2026-05-09')).toBe('中2')
    expect(resolveCurrentStudentGradeLabel(createStudent({ id: 'student-b', birthDate: '2012-04-02' }), '2026-05-09')).toBe('中2')
    expect(resolveCurrentStudentGradeLabel(createStudent({ id: 'student-c', birthDate: '2013-04-01' }), '2026-05-09')).toBe('中1')
    expect(resolveCurrentStudentGradeLabel(createStudent({ id: 'student-d', birthDate: '2013-04-02' }), '2026-05-09')).toBe('中1')
  })

  it('sorts students by smaller current grade first and then by display name', () => {
    const students = [
      createStudent({ id: 'student-1', name: '高橋 花', displayName: '高橋', birthDate: '2009-05-01' }),
      createStudent({ id: 'student-2', name: '青木 太郎', displayName: '青木', birthDate: '2014-05-01' }),
      createStudent({ id: 'student-3', name: '伊藤 次郎', displayName: '伊藤', birthDate: '2014-04-01' }),
    ]

    const sorted = students.slice().sort((left, right) => compareStudentsByCurrentGradeThenName(left, right, '2026-03-27'))

    expect(sorted.map((student) => student.displayName)).toEqual(['伊藤', '青木', '高橋'])
  })

  // 盤面/請求/日程表が使う共有判定は従来どおり入塾日前を '入塾前' として扱う(未来入塾を盤面に先行表示しない)。
  it('keeps the shared board status of upcoming teachers as 入塾前 (unchanged)', () => {
    const upcomingTeacher = createTeacher({ entryDate: '2026-05-01' })

    expect(resolveTeacherRosterStatus(upcomingTeacher, '2026-04-21')).toBe('入塾前')
    expect(resolveManagementRosterStatusLabel(resolveTeacherRosterStatus(upcomingTeacher, '2026-04-21'))).toBe('非在籍')
    expect(resolveManagementRosterStatusLabel('退塾')).toBe('非在籍')
  })

  // 管理データ画面は入塾日を在籍判定に使わない(未来入塾でも在籍として名簿に出す・オーナー指示 2026-07-10)。
  it('shows future-entry teachers/students as 在籍 in management (entry date agnostic)', () => {
    const upcomingTeacher = createTeacher({ entryDate: '2026-05-01' })
    const upcomingStudent = createStudent({ entryDate: '2027-04-01', withdrawDate: '' })

    // 修正前(旧挙動: 入塾前=非在籍で隠す)なら false になり、修正後は true。
    expect(isTeacherVisibleInManagement(upcomingTeacher, '2026-04-21')).toBe(true)
    expect(resolveManagedRosterStatus(upcomingTeacher.withdrawDate, '', '2026-04-21')).toBe('在籍')
    expect(isStudentVisibleInManagement(upcomingStudent, '2026-04-22')).toBe(true)
    // 未来入塾でも現時点の生年月日ベース学年を表示する('入塾前' ラベルにしない)。生年月日 2013-05-01 → 中1。
    expect(resolveManagedStudentGradeLabel(upcomingStudent, '2026-04-22')).toBe('中1')

    // 共有(盤面)側は変わらず '入塾前'。
    expect(resolveCurrentStudentGradeLabel(upcomingStudent, '2026-04-22')).toBe('入塾前')
  })

  // 退塾日当日は在籍・翌日以降は非在籍(オーナー指示 Q3)。
  it('treats the withdraw date itself as 在籍 and the day after as 非在籍 in management', () => {
    const student = createStudent({ withdrawDate: '2026-03-31' })

    expect(resolveManagedRosterStatus(student.withdrawDate, student.birthDate, '2026-03-31')).toBe('在籍')
    expect(isStudentVisibleInManagement(student, '2026-03-31')).toBe(true)
    expect(resolveManagedRosterStatus(student.withdrawDate, student.birthDate, '2026-04-01')).toBe('非在籍')
    expect(resolveManagedStudentGradeLabel(student, '2026-04-01')).toBe('非在籍')
  })

  // 高3卒業は「卒業日(高3学年度末=翌3/31)を退塾日として自動補完」して非在籍にする(Q2)。
  it('auto-fills the graduation date as the effective withdraw date for graduated students', () => {
    const graduated = createStudent({ birthDate: '2006-05-01', withdrawDate: '' }) // 高3卒業済み(卒業=2025-03-31)

    expect(resolveGraduationWithdrawDate('2006-05-01')).toBe('2025-03-31')
    expect(resolveEffectiveManagedWithdrawDate('', '2006-05-01', '2026-04-22')).toBe('2025-03-31')
    expect(resolveManagedRosterStatus('', '2006-05-01', '2026-04-22')).toBe('非在籍')
    expect(isStudentVisibleInManagement(graduated, '2026-04-22')).toBe(false)

    // 在籍中の高3(卒業前)は退塾日を自動補完しない=在籍のまま。
    const current3rd = createStudent({ birthDate: '2008-05-01', withdrawDate: '' })
    expect(resolveEffectiveManagedWithdrawDate('', '2008-05-01', '2026-04-22')).toBe('')
    expect(resolveManagedRosterStatus('', '2008-05-01', '2026-04-22')).toBe('在籍')
    expect(resolveManagedStudentGradeLabel(current3rd, '2026-04-22')).toBe('高3')

    // 明示の退塾日があればそれを優先(卒業日で上書きしない)。
    expect(resolveEffectiveManagedWithdrawDate('2024-06-30', '2006-05-01', '2026-04-22')).toBe('2024-06-30')
  })

  // ★共有判定(盤面/請求/日程表)は入塾日前・退塾翌日・高3卒業で非在籍のまま固定する。
  // 管理画面の入塾日不問ルールを将来ここへ"統一"すると落ちるようにして、意図しない波及を捕捉する。
  it('locks the shared isActiveOnDate: entry date and graduation still gate the board/billing', () => {
    // 入塾日前は非在籍(管理画面と違い共有側は隠す)。
    expect(isActiveOnDate('2027-04-01', '', '2013-05-01', '2026-04-22')).toBe(false)
    // 退塾日当日は在籍・翌日は非在籍。
    expect(isActiveOnDate('2020-04-01', '2026-03-31', '2013-05-01', '2026-03-31')).toBe(true)
    expect(isActiveOnDate('2020-04-01', '2026-03-31', '2013-05-01', '2026-04-01')).toBe(false)
    // 高3卒業(翌4/1以降)は非在籍・卒業日当日(3/31)は在籍。
    expect(isActiveOnDate('2020-04-01', '', '2008-05-01', '2027-03-31')).toBe(true)
    expect(isActiveOnDate('2020-04-01', '', '2008-05-01', '2027-04-01')).toBe(false)
    // 在籍中は true。
    expect(isActiveOnDate('2020-04-01', '', '2013-05-01', '2026-04-22')).toBe(true)
  })

  // 講師(birthDate 空)は卒業補完がスキップされ、明示退塾日のみが効く。
  it('never auto-fills a graduation withdraw date for rows without birthDate (teachers)', () => {
    expect(resolveEffectiveManagedWithdrawDate('', '', '2099-04-22')).toBe('')
    expect(resolveManagedRosterStatus('', '', '2099-04-22')).toBe('在籍')
    expect(resolveEffectiveManagedWithdrawDate('2026-03-31', '', '2099-04-22')).toBe('2026-03-31')
  })

  // 管理データの並び順は未来入塾生徒も学年で並ぶ(末尾に落とさない)。
  it('sorts future-entry students by their current grade in management', () => {
    const students = [
      createStudent({ id: 'future', name: '未来 太郎', displayName: '未来', entryDate: '2027-04-01', withdrawDate: '', birthDate: '2014-05-01' }),
      createStudent({ id: 'senior', name: '先輩 花', displayName: '先輩', birthDate: '2009-05-01' }),
    ]

    const sorted = students.slice().sort((left, right) => compareManagedStudentsByGradeThenName(left, right, '2026-04-22'))
    expect(sorted.map((student) => student.displayName)).toEqual(['未来', '先輩'])
  })

  it('高3卒業後(翌4/1以降)は退塾(非在籍)として扱う / 在籍中の高3は高3表示', () => {
    const current3rd = createStudent({ birthDate: '2008-05-01' }) // 2026年度は高3(在籍中)
    const graduated = createStudent({ birthDate: '2006-05-01' }) // 高3卒業済み
    const withdrawnAdult = createStudent({ id: 'student-w', birthDate: '2006-05-01', withdrawDate: '2025-03-31' })

    expect(resolveCurrentStudentGradeLabel(current3rd, '2026-04-22')).toBe('高3')
    expect(resolveCurrentStudentGradeLabel(graduated, '2026-04-22')).toBe('退塾')
    expect(resolveCurrentStudentGradeLabel(withdrawnAdult, '2026-04-22')).toBe('退塾')
  })
})
