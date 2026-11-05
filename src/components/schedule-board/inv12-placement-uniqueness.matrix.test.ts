import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings, ScheduleCountAdjustmentEntry } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry } from './types'
import { buildManagedOccurrenceKey, buildManagedScheduleCellsForRange, computePendingDeskResolution, computePendingLowerStudentMove, computeStudentMove, computeTemplateDiffApplyForBoard, findDuplicateStudentInCellByKey, remergeBoardWeeksWithManagedData, type TemplatePendingResolutionLedgers } from './ScheduleBoardScreen'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import { collectManualFirstBlockedLessons } from './templateConflictRules'
import { buildTemplateDuplicateStudentsMessage, findTemplateDuplicateStudents } from './templateEditorGuards'

// ============================================================================
// INV-12 操作マトリクス（配置の一意性: 同一生徒を同コマに二重配置しない）
//
// 保証文（docs/spec-invariants.md / 台帳 INV-12・強制・2026-08-29 新設）:
//   同一生徒は同一コマ（日付×時限）に 1 エントリしか配置されない。
//   移動・入れ替え・追加・配置のどの経路でも二重配置を作らない。
//
// 対象バグ（Issue #56 / v1.5.481・第三者手動テスト No.276）:
//   computeStudentMove の入れ替え経路に2つの穴があり、日程表D&Dスワップで同一生徒の講習が
//   同じ日に2枚並んだ（実例=富樫/小林のスワップ）。
//   ①入れ替え相手の着地先（移動元コマ）に重複検査が皆無
//   ②移動先検査が「見つかった最初の1件が相手なら免除」で、同コマ2エントリ目を素通り
//
// 同一性の判定は resolveStockComparableStudentKey（managedStudentId 優先）＝エントリIDが違っても
// 同じ生徒なら二重配置。盤面クリック移動・長押しD&D・日程表D&Dは同じ関数を通る。
// テンプレモード移動（handleTemplateMoveStudent）にも同じ検査を配線済みだが、コンポーネント内関数の
// ため未テスト（末尾の it.todo）。
// ============================================================================

type Slots = [StudentEntry | null, StudentEntry | null]
const mkStudent = (id: string, name: string, extra: Partial<StudentEntry> = {}): StudentEntry => ({
  id, name, managedStudentId: id, grade: '中3', subject: '数', lessonType: 'regular', teacherType: 'normal', ...extra,
})
const mkLesson = (id: string, slots: Slots) => ({ id, studentSlots: slots })
const mkCell = (id: string, dateKey: string, slotNumber: number, desks: unknown[]) =>
  ({ id, dateKey, dayLabel: '', dateLabel: dateKey, slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks }) as unknown as SlotCell
const baseParams = (weeks: SlotCell[][]) => ({
  weeks, weekIndex: 0, cells: weeks[0],
  suppressedRegularLessonOccurrences: [] as string[],
  managedStudentByAnyName: new Map(),
  resolveBoardStudentDisplayName: (n: string) => n,
})
const deskById = (weeks: SlotCell[][], cellId: string, deskId: string) =>
  weeks.flat().find((c) => c.id === cellId)!.desks.find((d) => d.id === deskId)!

describe('INV-12 マトリクス: 同一生徒を同コマに二重配置しない', () => {
  it('同コマに同一生徒(別エントリID・同 managedStudentId)が既にいる移動先はブロックして状態を維持する', () => {
    const weeks: SlotCell[][] = [[
      mkCell('C1', '2026-03-23', 1, [
        { id: 'd0', teacher: '田中', manualTeacher: false, lesson: mkLesson('la', [mkStudent('a', '太郎', { managedStudentId: 'mX' }), null]) },
      ]),
      mkCell('C2', '2026-03-24', 1, [
        { id: 'e0', teacher: '佐藤', manualTeacher: false, lesson: mkLesson('lb', [mkStudent('b', '太郎', { managedStudentId: 'mX' }), null]) },
        { id: 'e1', teacher: '', manualTeacher: false, lesson: undefined },
      ]),
    ]]
    const r = computeStudentMove({ ...baseParams(weeks), movingStudentId: 'a', cellId: 'C2', deskIndex: 1, studentIndex: 0 })
    expect(r.status).toBe('blocked')
    if (r.status !== 'blocked') return
    expect(r.message).toContain('移動できません')
    expect(r.message).toContain('太郎')
  })

  // Issue #56(2026-08-29): 以下2件は旧実装(相手の着地先検査なし+「相手なら免除」)で
  // status='moved'(=二重配置)になり落ちることを mutation で確認済み。
  it('入れ替え相手の着地先(移動元コマ)に相手と同一生徒が既にいる入れ替えはブロックする(Issue #56)', () => {
    // C1(8/25)に「南緒(y2)」と「應佑(x1)」。C2(8/26)に「南緒(y1)」。
    // 應佑(x1) を C2 の南緒(y1)とスワップ → 南緒(y1) が C1 へ着地すると C1 に南緒が2人になる。
    // 旧実装は入れ替え相手の着地先(移動元コマ)を一切検査せず二重配置になっていた。
    const weeks: SlotCell[][] = [[
      mkCell('C1', '2026-08-25', 1, [
        { id: 'd0', teacher: '絹川', manualTeacher: false, lesson: mkLesson('la', [mkStudent('y2', '南緒', { managedStudentId: 'mY' }), null]) },
        { id: 'd1', teacher: '山本', manualTeacher: false, lesson: mkLesson('lb', [mkStudent('x1', '應佑', { managedStudentId: 'mX' }), null]) },
      ]),
      mkCell('C2', '2026-08-26', 1, [
        { id: 'e0', teacher: '村上', manualTeacher: false, lesson: mkLesson('lc', [mkStudent('y1', '南緒', { managedStudentId: 'mY' }), null]) },
      ]),
    ]]
    const r = computeStudentMove({ ...baseParams(weeks), movingStudentId: 'x1', cellId: 'C2', deskIndex: 0, studentIndex: 0 })
    expect(r.status).toBe('blocked')
    if (r.status !== 'blocked') return
    expect(r.message).toContain('南緒')
  })

  it('移動先コマに同一生徒が2エントリ(入れ替え相手+別机)ある入れ替えは免除せずブロックする(Issue #56)', () => {
    // C2 の應佑(x2) を C1 の同キー相手(x1)とスワップしようとするが、C1 の別机にも應佑(x3)が居る。
    // 旧実装は「見つかった1件=相手」で免除し、x3 を見落として二重配置になっていた。
    const weeks: SlotCell[][] = [[
      mkCell('C1', '2026-08-25', 1, [
        { id: 'd0', teacher: '絹川', manualTeacher: false, lesson: mkLesson('la', [mkStudent('x1', '應佑', { managedStudentId: 'mX' }), null]) },
        { id: 'd1', teacher: '山本', manualTeacher: false, lesson: mkLesson('lb', [mkStudent('x3', '應佑', { managedStudentId: 'mX' }), null]) },
      ]),
      mkCell('C2', '2026-08-26', 1, [
        { id: 'e0', teacher: '村上', manualTeacher: false, lesson: mkLesson('lc', [mkStudent('x2', '應佑', { managedStudentId: 'mX' }), null]) },
      ]),
    ]]
    const r = computeStudentMove({ ...baseParams(weeks), movingStudentId: 'x2', cellId: 'C1', deskIndex: 0, studentIndex: 0 })
    expect(r.status).toBe('blocked')
  })

  it('入れ替え相手が移動元コマに重複を作らない通常のスワップは従来どおり成立する(Issue #56 回帰なし)', () => {
    const weeks: SlotCell[][] = [[
      mkCell('C1', '2026-08-25', 1, [
        { id: 'd0', teacher: '絹川', manualTeacher: false, lesson: mkLesson('la', [mkStudent('y1', '南緒', { managedStudentId: 'mY' }), null]) },
      ]),
      mkCell('C2', '2026-08-26', 1, [
        { id: 'e0', teacher: '村上', manualTeacher: false, lesson: mkLesson('lb', [mkStudent('x2', '應佑', { managedStudentId: 'mX' }), null]) },
      ]),
    ]]
    const r = computeStudentMove({ ...baseParams(weeks), movingStudentId: 'x2', cellId: 'C1', deskIndex: 0, studentIndex: 0 })
    expect(r.status).toBe('moved')
    if (r.status !== 'moved') return
    const d0 = deskById(r.nextWeeks, 'C1', 'd0')
    const e0 = deskById(r.nextWeeks, 'C2', 'e0')
    expect(d0.lesson?.studentSlots[0]?.managedStudentId).toBe('mX')
    expect(e0.lesson?.studentSlots[0]?.managedStudentId).toBe('mY')
  })

  // Issue #56 フォローアップ: テンプレモードの移動(handleTemplateMoveStudent)はコンポーネント内関数のため
  // 純関数テストができない。入れ替え着地の重複検査は computeStudentMove と同じ
  // findDuplicateStudentInCellByKey を配線済みだが、テンプレ移動自体の抽出とテストは未着手。
  it.todo('テンプレ移動を純関数へ抽出し「入れ替え相手の着地先に同一生徒 → blocked」を固定する(Issue #56 フォローアップ)')
  // 兄弟被覆(INV監査 2026-08-29): 配置/追加系4経路(未消化振替の配置・未消化講習の配置・生徒手動追加・
  // 自動割当候補探索)は findDuplicateStudentInCell が配線済みでコードに穴は無いが、マトリクスでの
  // ロックは未整備(UIハンドラ内のためテスト不能。純関数化とあわせて上の todo と同時に固定する)。
  it.todo('配置/追加系4経路(振替配置・講習配置・手動追加・自動割当)の重複ガードをマトリクスで固定する')

  // 2026-10-14(確認リスト v1.5.587 その他「テンプレの講師が追従していない日がある」の実データ調査): 開発用教室のテンプレで
  // 金 3 限の机 4 と机 7 に同じ生徒(s017)が入っていた。テンプレ編集の「生徒追加」「生徒変更」に同コマ重複の検査が無く(移動だけ Issue #56 で配線済み)、
  // 盤面生成(buildManagedRegularLessonsRange)が重複行を講師ごと飛ばすため、机 7 の講師が消えて 11/6 以降の金 3 限で講師がテンプレと食い違っていた。
  // 追加・変更の 1 席ぶんの検査は、移動(Issue #56)と同じ権威関数 findDuplicateStudentInCellByKey を使う(写しを作らない・regression-reviewer 指摘)。
  describe('テンプレ編集の追加・変更・保存(findDuplicateStudentInCellByKey / templateEditorGuards)', () => {
    // 盤面と同じ比較キーの形(managedStudentId を優先し、無ければ名前で引く)。
    const byManagedId = (student: StudentEntry) => student.managedStudentId ?? student.name
    const fridayThird = () => mkCell('template_5_3', 'template_5', 3, [
      { id: 't0', teacher: '絹川', manualTeacher: false, lesson: mkLesson('l0', [mkStudent('e1', 'A', { managedStudentId: 's017' }), null]) },
      { id: 't1', teacher: '本宮', manualTeacher: false, lesson: mkLesson('l1', [null, mkStudent('e2', 'B', { managedStudentId: 's020' })]) },
      { id: 't2', teacher: '村上', manualTeacher: false, lesson: undefined },
    ])

    it('追加: 同じコマに同じ生徒(managedStudentId が同じ・エントリ id は別)が既にいれば見つかる(別の生徒なら null)', () => {
      const cell = fridayThird()
      expect(findDuplicateStudentInCellByKey(cell, 's017', byManagedId)?.id).toBe('e1')
      expect(findDuplicateStudentInCellByKey(cell, 's999', byManagedId)).toBeNull()
    })

    it('追加: managedStudentId の無い生徒(名前で引く経路)も同じ名前なら見つかる', () => {
      const cell = fridayThird()
      cell.desks[2].lesson = mkLesson('l2', [mkStudent('e9', 'C', { managedStudentId: undefined }), null])
      expect(findDuplicateStudentInCellByKey(cell, 'C', byManagedId)?.id).toBe('e9')
      expect(findDuplicateStudentInCellByKey(cell, 'D', byManagedId)).toBeNull()
    })

    it('変更: 自分の席(除外 id)は数えず、別の席の同じ生徒だけ見つかる', () => {
      const cell = fridayThird()
      // e2 の席を s020 のまま変更(科目だけ)→ 自分自身は重複にしない。
      expect(findDuplicateStudentInCellByKey(cell, 's020', byManagedId, ['e2'])).toBeNull()
      // e2 の席を s017 に変える → 机 0 の e1 とぶつかる。
      expect(findDuplicateStudentInCellByKey(cell, 's017', byManagedId, ['e2'])?.id).toBe('e1')
    })

    it('保存前の検査: 同じコマに同じ生徒が 2 机にあるテンプレを列挙し、文言にコマと生徒を出す(重複が無ければ空)', () => {
      const clean = fridayThird()
      expect(findTemplateDuplicateStudents([clean], byManagedId)).toEqual([])
      const broken = fridayThird()
      broken.desks[1].lesson = mkLesson('l1', [mkStudent('e3', 'A', { managedStudentId: 's017' }), mkStudent('e2', 'B', { managedStudentId: 's020' })])
      const duplicates = findTemplateDuplicateStudents([broken, fridayThird()], byManagedId)
      expect(duplicates).toHaveLength(1)
      expect(duplicates[0].cell.id).toBe('template_5_3')
      expect(duplicates[0].students.map((student) => student.id)).toEqual(['e1', 'e3'])
      expect(duplicates[0].deskNumbers).toEqual([1, 2])
      const message = buildTemplateDuplicateStudentsMessage(duplicates, (name) => `${name}さん`, (cell) => `金曜 ${cell.slotLabel}`)
      expect(message).toContain('金曜 3限: Aさん(机 1・机 2)')
      expect(message).toContain('保存できません')
      // Excel 取り込み用の文言(オーナー指示 2026-10-14: 取り込みでも止める)
      const importMessage = buildTemplateDuplicateStudentsMessage(duplicates, (name) => `${name}さん`, (cell) => `金曜 ${cell.slotLabel}`, 'import')
      expect(importMessage).toMatch(/^Excel を取り込めません。/u)
      expect(importMessage).toContain('金曜 3限: Aさん(机 1・机 2)')
      expect(importMessage).toContain('Excel を直してください')
      expect(importMessage).not.toContain('保存できません')
    })

    it('保存前の検査: 比較キーが空の生徒は比べない(止めない)', () => {
      const cell = fridayThird()
      cell.desks[2].lesson = mkLesson('l2', [mkStudent('e4', '', { managedStudentId: undefined }), mkStudent('e5', '', { managedStudentId: undefined })])
      expect(findTemplateDuplicateStudents([cell], byManagedId)).toEqual([])
    })
  })
})

// ============================================================================
// INV-12 × テンプレ差分反映の保留（2 行）の解決操作（Issue #72・第 1 段 (B)・spec-template-behavior Q26-4・条件 19）
//
// 保留中の下段は「配置」ではない（INV-13）ので、上段と下段・別の机の 1 行と下段に同じ生徒が並ぶこと自体は違反ではない。
// ただし**解決操作の結果**は INV-12 を満たすこと: 下段を机へ戻す「既存を採用」・下段の「移動」が同じコマに同じ生徒を
// 2 か所で生かすなら止める（findDuplicateStudentInCellByKey と同じ検査）。兄弟: 下段を捨てる「テンプレを採用」は
// 生徒を増やさないので止めない（上段側の 1 か所が残る）。
// ============================================================================
describe('INV-12 × 保留（2 行）の解決操作: 同じコマに同じ生徒を 2 か所で生かさない（Q26-4）', () => {
  const CELL = 'P1'
  const DATE = '2026-10-07'
  const pendingKey = buildTemplatePendingDeskKey(CELL, 'p0')
  const ledgers: TemplatePendingResolutionLedgers = {
    manualLectureStockCounts: {},
    manualLectureStockOrigins: {},
    manualMakeupAdjustments: {},
    fallbackLectureStockStudents: {},
    fallbackMakeupStudents: {},
    suppressedMakeupOrigins: {},
    suppressedRegularLessonOccurrences: [],
    scheduleCountAdjustments: [],
  }
  const context = {
    managedStudentByAnyName: new Map(),
    resolveDisplayName: (name: string) => name,
    resolveStockId: (student: StudentEntry) => student.managedStudentId ?? student.name,
    ledgerOriginDatesByKey: {},
  }
  // 机 p0 = 上段 C（テンプレ）＋下段 A（振替）の 2 行。机 p1 に A が 1 行で生きている（Q21-11 後段の形）。机 p2 は空。
  function fixture(aAlsoOnOneRowDesk: boolean) {
    const weeks: SlotCell[][] = [[
      mkCell(CELL, DATE, 5, [
        { id: 'p0', teacher: '鈴木', lesson: mkLesson('managed_r0', [mkStudent('c1', '千葉', { managedStudentId: 'mC' }), null]) },
        { id: 'p1', teacher: '田中', lesson: aAlsoOnOneRowDesk ? mkLesson('la', [mkStudent('a-live', '青木', { managedStudentId: 'mA', manualAdded: true }), null]) : undefined },
        { id: 'p2', teacher: '佐藤', lesson: undefined },
      ]),
    ]]
    const pending: TemplatePendingDeskMap = {
      [pendingKey]: {
        lower: { lesson: mkLesson('lower', [mkStudent('a-lower', '青木', { managedStudentId: 'mA', lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null]) },
        effectiveStartDate: DATE,
        createdAt: '2026-09-29T10:00:00.000Z',
      },
    }
    return { weeks, pending }
  }
  const liveCount = (weeks: SlotCell[][], managedId: string) => weeks.flat().filter((cell) => cell.id === CELL)
    .flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []))
    .filter((student) => student?.managedStudentId === managedId).length
  const resolveMode = (mode: 'adopt-existing' | 'adopt-template', weeks: SlotCell[][], pending: TemplatePendingDeskMap) => computePendingDeskResolution({
    mode, weeks, cellId: CELL, deskId: 'p0', templatePendingDesks: pending, ledgers, ...context,
  })

  it('既存を採用: 下段の生徒が別の 1 行の机に生きていれば止め、盤面・保留マップ・台帳を変えない', () => {
    const { weeks, pending } = fixture(true)
    const snapshot = JSON.stringify({ weeks, pending, ledgers })
    const r = resolveMode('adopt-existing', weeks, pending)
    expect(r.status).toBe('blocked')
    if (r.status !== 'blocked') return
    expect(r.message).toContain('2 か所')
    expect(r.message).toContain('同じ生徒が 2 か所になります。先に上段を片づけてください')
    expect(JSON.stringify({ weeks, pending, ledgers })).toBe(snapshot)
  })

  it('既存を採用: 重ならなければ成立し、下段の生徒は同じコマに 1 か所だけ生きる', () => {
    const { weeks, pending } = fixture(false)
    const r = resolveMode('adopt-existing', weeks, pending)
    expect(r.status).toBe('applied')
    if (r.status !== 'applied') return
    expect(liveCount(r.nextWeeks, 'mA')).toBe(1)
    expect(liveCount(r.nextWeeks, 'mC')).toBe(0)
    expect(r.nextTemplatePendingDesks).toEqual({})
  })

  it('兄弟: テンプレを採用は下段を捨てるだけなので止めず、別の机の A は 1 か所のまま', () => {
    const { weeks, pending } = fixture(true)
    const r = resolveMode('adopt-template', weeks, pending)
    expect(r.status).toBe('applied')
    if (r.status !== 'applied') return
    expect(liveCount(r.nextWeeks, 'mA')).toBe(1)
    expect(liveCount(r.nextWeeks, 'mC')).toBe(1)
  })

  it('兄弟: 下段の移動も、移動先のコマに同じ生徒が生きていれば止める（上段・別の机を含む実配置で検査）', () => {
    const { weeks, pending } = fixture(true)
    const r = computePendingLowerStudentMove({
      weeks,
      weekIndex: 0,
      cells: weeks[0],
      templatePendingDesks: pending,
      source: { cellId: CELL, deskId: 'p0', lowerIndex: 0 },
      cellId: CELL,
      deskIndex: 2,
      studentIndex: 0,
      suppressedRegularLessonOccurrences: [],
      managedStudentByAnyName: new Map(),
      resolveBoardStudentDisplayName: (n: string) => n,
    })
    expect(r.status).toBe('blocked')
    if (r.status === 'blocked') expect(r.message).toContain('移動できません')
  })

  // ── 決定記録 57（2026-11-01・A-10）と regression-reviewer 2026-11-01 P-2: 「手入力データを採用」が別の机 T のテンプレの通常授業を外すのは、
  //    由来 same-slot-template-duplicate の保留で、T がテンプレ管理の机・T の生徒が手入力の印の無い通常授業・下段の生徒と同じ生徒かつ同じ科目のときだけ。
  //    それ以外は従来どおり Q26-4／INV-12 で止める（2 か所で生きる形を作らない）。
  const DUPLICATE_ORIGIN = { kind: 'same-slot-template-duplicate' as const, note: '同じコマの机 2 にテンプレの通常授業（数）を置いたため、手で置いた授業を下の行（保留・緑）に残しました。' }
  function duplicateFixture(options: { templateStudent?: Partial<StudentEntry>; templateLessonId?: string; origin?: typeof DUPLICATE_ORIGIN | null } = {}) {
    const weeks: SlotCell[][] = [[
      mkCell(CELL, DATE, 5, [
        { id: 'p0', teacher: '鈴木', lesson: undefined },
        { id: 'p1', teacher: '田中', lesson: mkLesson(options.templateLessonId ?? 'managed_r1', [mkStudent('a-template', '青木', { managedStudentId: 'mA', ...options.templateStudent }), null]) },
        { id: 'p2', teacher: '佐藤', lesson: undefined },
      ]),
    ]]
    const origin = options.origin === undefined ? DUPLICATE_ORIGIN : options.origin
    const pending: TemplatePendingDeskMap = {
      [pendingKey]: {
        lower: { lesson: mkLesson('lower', [mkStudent('a-lower', '青木', { managedStudentId: 'mA', lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null]) },
        effectiveStartDate: DATE,
        createdAt: '2026-09-29T10:00:00.000Z',
        ...(origin ? { origin } : {}),
      },
    }
    return { weeks, pending }
  }

  it('決定記録 57: 由来 same-slot-template-duplicate × T がテンプレ管理の通常授業（同じ生徒・同じ科目）→ 既存を採用で T の A を外し、A は p0 の 1 か所・抑止キー 1・希望回数 −1（決定記録 62: 単発削除と揃える）', () => {
    const { weeks, pending } = duplicateFixture()
    const r = resolveMode('adopt-existing', weeks, pending)
    expect(r.status).toBe('applied')
    if (r.status !== 'applied') return
    expect(liveCount(r.nextWeeks, 'mA')).toBe(1)
    expect(deskById(r.nextWeeks, CELL, 'p0').lesson?.studentSlots[0]?.lessonType).toBe('makeup')
    expect(deskById(r.nextWeeks, CELL, 'p1').lesson?.studentSlots.filter(Boolean) ?? []).toEqual([])
    expect(r.ledgers.suppressedRegularLessonOccurrences).toHaveLength(1)
    // 決定記録 62（オーナー決定 2026-11-02）: T から外した通常授業は単発削除と同じく −1（旧: 旧 Q21-11 と同じく触らない）。
    expect(r.ledgers.scheduleCountAdjustments).toHaveLength(1)
    expect(r.ledgers.scheduleCountAdjustments[0]).toMatchObject({ countKind: 'regular', delta: -1 })
    expect(r.nextTemplatePendingDesks[pendingKey]).toBeUndefined()
  })

  it.each([
    ['T の A が別の日から手で動かした通常授業（makeupSourceDate つき・手入力の印）', { templateStudent: { makeupSourceDate: '2026-10-01', makeupSourceLabel: '10/1(木) 5限' } }],
    ['T の A が同じ日の別の時限から動かした写し（sameDayMoveSourceDate）', { templateStudent: { sameDayMoveSourceDate: DATE, sameDayMoveSourceLabel: '3限' } }],
    ['T の A が手動追加の通常授業', { templateStudent: { manualAdded: true } }],
    ['T の A が別の科目（英）', { templateStudent: { subject: '英' as const } }],
    ['T がテンプレ管理でない机（手置きの授業）', { templateLessonId: 'hand_lesson' }],
    ['由来が無い（テンプレ保存の保留）', { origin: null }],
  ] as const)('P-2（regression-reviewer 2026-11-01）: %s → 外さず従来どおり止める（盤面・保留・台帳を変えない）', (_label, options) => {
    const { weeks, pending } = duplicateFixture(options as Parameters<typeof duplicateFixture>[0])
    const snapshot = JSON.stringify({ weeks, pending })
    const r = resolveMode('adopt-existing', weeks, pending)
    expect(r.status).toBe('blocked')
    if (r.status !== 'blocked') return
    expect(r.message).toContain('2 か所')
    expect(JSON.stringify({ weeks, pending })).toBe(snapshot)
  })
})

// ============================================================================
// INV-12 × テンプレ差分反映の**保存**（Issue #72・spec-template-behavior Q21-11 の二段構え・regression-reviewer R-2）
//
// 保存経路（computeTemplateDiffApplyForBoard）→ 保存直後の再マージ（remergeBoardWeeksWithManagedData）1 回を通しても、
// 同じコマの「生きている」同じ生徒は 1 か所だけ（保留中の下段は配置ではない＝INV-13 なので数えない）。
//   前段: 別の 1 行の机に生きている生徒 → 上段に置かない（置かなかった生徒の抑止キーを保存が積むので、再マージでも湧かない）
//   後段: 別の机の下段にだけ生きている生徒 → 上段に置く（置かないと保留中に日程表から消え、下段側でテンプレを採用すると無言で消失する）
// 兄弟: 解決操作の検査は上の describe（Q26-4）。
// ============================================================================
// ============================================================================
// INV-12 × テンプレ反映（第 2 版・docs/spec-template-conflict-v2.md §2-2 生徒の一意・2026-11-05 オーナー承認・§8 の読み替え）
//   同じコマ（日付×時限）に手入力の生徒 S とテンプレの同じ生徒 S がぶつかったら**手入力が勝つ**。テンプレの S はそのコマのどの机にも置かない
//   （予定数に数えない＝§4-2 規則 1 の −1・確認の画面に名前つきの理由）。抑止キーは積まない（再マージが盤面の状態から毎回同じに判定する）。
//   旧 Q21-11（抑止キー）・決定記録 57（A-10＝手入力を下段へ）・Q38（手動追加の通常の自動採用）・Q39-9（写しのある日を全コマ）はこの 1 本規則に置き換えた（§6）。
//   判定は上段（机）と保留の下段の両方の手入力を見る（下段も手入力）。保存 → 再マージ（フラグ ON の規則つき）の後も生存数は 1。
// ============================================================================
describe('INV-12 × テンプレ反映（第 2 版 §2-2）: 手入力の生徒が同じコマに居ればテンプレの同じ生徒は置かない（保存 → 再マージの後も 1 か所）', () => {
  const WEEK_START = '2026-10-05'
  const WEEK_END = '2026-10-11'
  const DATE = '2026-10-07'
  const CELL = `${DATE}_5`
  const studentRows: StudentRow[] = [
    { id: 'sA', name: '青木', displayName: '青木', email: 'a@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
    { id: 'sB', name: '馬場', displayName: '馬場', email: 'b@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
    { id: 'sC', name: '千葉', displayName: '千葉', email: 'c@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  ]
  const teacherRows: TeacherRow[] = ['田中', '鈴木', '佐藤'].map((name, index) => ({
    id: `t${index + 1}`, name, email: `t${index + 1}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
  }))
  const row = (id: string, teacherId: string, student1Id = '', slotNumber = 5): RegularLessonRow => ({
    id, schoolYear: 2026, teacherId, student1Id, subject1: student1Id ? '数' : '', startDate: '', endDate: '', student2Id: '', subject2: '',
    student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber,
  })
  const settings = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 3, ...extra }) as ClassroomSettings
  // テンプレ: 机 0 に A・机 1 に B・机 2 は講師だけ
  const ROWS = [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3')]
  const makeupA = (id: string) => mkStudent(id, '青木', { managedStudentId: 'sA', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })

  function board(update: (desks: DeskCell[]) => DeskCell[], cellId = CELL) {
    const week = buildManagedScheduleCellsForRange({
      range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' }, fallbackStartDate: WEEK_START, fallbackEndDate: WEEK_END,
      classroomSettings: settings(), teachers: teacherRows, students: studentRows, regularLessons: ROWS, boardWeeks: [],
    })
    return week.map((cell) => (cell.id === cellId ? { ...cell, desks: update(cell.desks) } : cell))
  }
  const savedSettings = settings({ templateFreezeBeforeDate: DATE })
  const remergeOn = (weeks: SlotCell[][], suppressed: string[], pendingDesks: TemplatePendingDeskMap) => remergeBoardWeeksWithManagedData(weeks, {
    classroomSettings: savedSettings, teachers: teacherRows, students: studentRows, regularLessons: ROWS, suppressedRegularLessonOccurrences: suppressed, todayKey: '2026-09-29',
    templateOriginRules: { pendingDesks },
  })
  function save(week: SlotCell[] | SlotCell[][], options: { suppressed?: string[]; pendingDesks?: TemplatePendingDeskMap; scheduleCountAdjustments?: ScheduleCountAdjustmentEntry[] } = {}) {
    const weeks = Array.isArray(week[0]) ? week as SlotCell[][] : [week as SlotCell[]]
    return computeTemplateDiffApplyForBoard({
      scheduleCountAdjustments: options.scheduleCountAdjustments ?? [], weeks, classroomSettings: savedSettings, teachers: teacherRows, students: studentRows, regularLessons: ROWS,
      effectiveStartDate: DATE, suppressedRegularLessonOccurrences: options.suppressed ?? [], templatePendingDesks: options.pendingDesks ?? {}, createdAt: '2026-09-29T10:00:00.000Z', manualMakeupAdjustments: {},
    })
  }
  const cellOf = (weeks: SlotCell[][]) => weeks.flat().find((cell) => cell.id === CELL)!
  const liveCount = (weeks: SlotCell[][], managedId: string, pendingDesks: TemplatePendingDeskMap = {}) => {
    const cell = cellOf(weeks)
    const upper = cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? [])
    const lower = cell.desks.flatMap((desk) => pendingDesks[buildTemplatePendingDeskKey(CELL, desk.id)]?.lower.lesson?.studentSlots ?? [])
    return [...upper, ...lower].filter((student) => student?.managedStudentId === managedId).length
  }
  const liveIdsAt = (weeks: SlotCell[][], deskIndex: number) => (cellOf(weeks).desks[deskIndex].lesson?.studentSlots ?? []).filter(Boolean).map((student) => student!.managedStudentId)
  /** 保存 → 再マージ（フラグ ON）→ 同じテンプレの再保存、の 3 つで同じ形（不動点・冪等・2-7）。 */
  function expectStable(saved: ReturnType<typeof save>) {
    const remerged = remergeOn(saved.nextWeeks, saved.addedSuppressedRegularLessonOccurrences, saved.nextPendingDesks)
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
    const again = save(saved.nextWeeks, { suppressed: saved.addedSuppressedRegularLessonOccurrences, pendingDesks: saved.nextPendingDesks, scheduleCountAdjustments: [] })
    expect(cellOf(again.nextWeeks)).toEqual(cellOf(saved.nextWeeks))
    expect(again.nextPendingDesks).toEqual(saved.nextPendingDesks)
    return remerged
  }

  it('§2-2: 別の机（机 2）に A の振替（手入力）があれば、机 0 にテンプレの A を置かない。抑止キー 0・−1 も積まない・確認の画面に名前。再マージ・再保存で形が変わらない', () => {
    const saved = save(board((desks) => desks.map((desk, index) => (index === 2 ? { ...desk, lesson: mkLesson('hand-a', [makeupA('a-makeup'), null]) } : desk))))
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual([])
    expect(cellOf(saved.nextWeeks).desks[0].teacher).toBe('田中')
    expect(liveIdsAt(saved.nextWeeks, 2)).toEqual(['sA'])
    expect(saved.nextPendingDesks).toEqual({})
    expect(saved.addedSuppressedRegularLessonOccurrences).toEqual([])
    expect(saved.studentNotes.filter((note) => note.kind === 'manual-first').map((note) => note.studentName)).toEqual(['青木'])
    // §4-2 規則 1（INV-05）: 置かなかった回は保存で −1 を積まず、盤面の状態から導く（collectManualFirstBlockedLessons）。
    expect(saved.wholeDayTransferCountAdjustments).toEqual([])
    expect(collectManualFirstBlockedLessons({ weeks: saved.nextWeeks, pendingDesks: saved.nextPendingDesks, expected: [{ studentId: 'sA', subject: '数', dateKey: DATE, slotNumber: 5 }] })).toHaveLength(1)
    expect(liveCount(saved.nextWeeks, 'sA')).toBe(1)
    const remerged = expectStable(saved)
    expect(liveCount(remerged, 'sA')).toBe(1)
  })

  // §4-2 規則 1（INV-05・2026-11-05 主セッション指示）: 予定数は積まずに状態から導く。保存でも読み込みでも同じ、手入力を消せば自動で戻る、何回保存しても二重にならない。
  // 削除の記録（「下段(手入力)を採用」で室長が取り下げた授業・単発削除＝抑止キー＋単発削除と同じ −1）がある回は §2-2 の遮断に数えない（二重に引かない）。
  it('§2-2 × §4-2 規則 1: 置かれていない回は盤面の状態から導く（2 回保存しても 1 回・読み込み直しても同じ・手入力を消すと 0・取り下げの記録がある回は数えない）', () => {
    const expected = [{ studentId: 'sA', subject: '数', dateKey: DATE, slotNumber: 5 }]
    const saved = save(board((desks) => desks.map((desk, index) => (index === 2 ? { ...desk, lesson: mkLesson('hand-a', [makeupA('a-makeup'), null]) } : desk))))
    const blocked = (weeks: SlotCell[][], pendingDesks: TemplatePendingDeskMap, suppressed: string[] = []) => collectManualFirstBlockedLessons({ weeks, pendingDesks, expected, suppressedRegularLessonOccurrences: suppressed })
    expect(blocked(saved.nextWeeks, saved.nextPendingDesks)).toHaveLength(1)
    const again = save(saved.nextWeeks, { pendingDesks: saved.nextPendingDesks })
    expect(again.wholeDayTransferCountAdjustments).toEqual([])
    expect(blocked(again.nextWeeks, again.nextPendingDesks)).toHaveLength(1)
    // 読み込み直し（再マージ・フラグ ON）でも同じ
    expect(blocked(remergeOn(saved.nextWeeks, [], saved.nextPendingDesks), saved.nextPendingDesks)).toHaveLength(1)
    // 手入力の A を消すと、再マージでテンプレの A が戻り、遮断の回は 0（予定数も自動で戻る）
    const removed = saved.nextWeeks.map((week) => week.map((cell) => (cell.id !== CELL ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 2 ? { ...desk, lesson: undefined } : desk)) })))
    const back = remergeOn(removed, [], {})
    expect(liveIdsAt(back, 0)).toEqual(['sA'])
    expect(blocked(back, {})).toEqual([])
    // 取り下げの記録（抑止キー）がある回は数えない＝単発削除と同じ −1 の側だけで引く（二重にしない）
    expect(blocked(saved.nextWeeks, saved.nextPendingDesks, [buildManagedOccurrenceKey(makeupA('x'), DATE, 5)])).toEqual([])
  })

  it('§2-2: 同じ机の生徒 2 の席に A の振替（テンプレの生徒 1 が A）→ テンプレの A を置かず、振替は 1 行のまま（2 行にしない）', () => {
    const saved = save(board((desks) => desks.map((desk, index) => (index === 0 ? { ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupA('a-makeup')] } } : desk))))
    expect(cellOf(saved.nextWeeks).desks[0].lesson?.studentSlots.map((student) => student ? `${student.managedStudentId}:${student.lessonType}` : null)).toEqual([null, 'sA:makeup'])
    expect(saved.nextPendingDesks).toEqual({})
    expect(liveCount(saved.nextWeeks, 'sA')).toBe(1)
    expectStable(saved)
  })

  it('§2-2（旧 Q38 は廃止）: 机 2 に手で足した通常授業 A（手動追加）→ 手入力が勝つ。テンプレの A は机 0 に置かない（自動採用しない・決定 3）', () => {
    const manualA = mkStudent('a-manual', '青木', { managedStudentId: 'sA', manualAdded: true })
    const saved = save(board((desks) => desks.map((desk, index) => (index === 2 ? { ...desk, lesson: mkLesson('hand-a', [manualA, null]) } : desk))))
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual([])
    expect(liveIdsAt(saved.nextWeeks, 2)).toEqual(['sA'])
    expect(liveCount(saved.nextWeeks, 'sA')).toBe(1)
    expectStable(saved)
  })

  it('§2-2: 保留の下段にだけ居る手入力の A も手入力（下段も数える）→ テンプレの A は上段に置かない。上段＋下段で A は 1 か所', () => {
    const week = board((desks) => desks)
    const desk1Id = cellOf([week]).desks[1].id
    const pending: TemplatePendingDeskMap = { [buildTemplatePendingDeskKey(CELL, desk1Id)]: { lower: { lesson: { id: 'lower_a', studentSlots: [makeupA('a-lower'), null] } }, effectiveStartDate: DATE, createdAt: 'x' } }
    const saved = save(week, { pendingDesks: pending })
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual([])
    // 下段の A は、テンプレの B と同じ席なので 2 行のまま（§2-1）。
    expect(saved.nextPendingDesks[buildTemplatePendingDeskKey(CELL, desk1Id)]?.lower.lesson?.studentSlots[0]?.managedStudentId).toBe('sA')
    expect(liveCount(saved.nextWeeks, 'sA', saved.nextPendingDesks)).toBe(1)
    expectStable(saved)
  })

  it('§2-1: テンプレ由来の生徒（印＝テンプレ）は置き直されるだけでぶつからない（同じ保存を繰り返しても A は机 0 の 1 か所）', () => {
    const saved = save(board((desks) => desks))
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual(['sA'])
    expect(saved.studentNotes.filter((note) => note.kind === 'manual-first')).toEqual([])
    expect(liveCount(saved.nextWeeks, 'sA')).toBe(1)
    expectStable(saved)
  })

  it('§1-1 #2: 同じ日の中で別の時限へ手で動かしたテンプレの A（印＝テンプレ）は、反映でテンプレの位置（5 限 机 0）へ戻る。移動の抑止キーは外れ、A はその日に 1 か所', () => {
    // A を 5 限 → 4 限 机 1 へ同日移動した盤面（移動は 5 限の抑止キーを積む）。
    const copy = mkStudent('a-copy', '青木', { managedStudentId: 'sA', sameDayMoveSourceDate: DATE, sameDayMoveSourceLabel: '2026/10/7(水) 5限' })
    const week = board((desks) => desks.map((desk, index) => (index === 0 ? { ...desk, lesson: undefined } : desk)))
      .map((cell) => (cell.id === `${DATE}_4` ? { ...cell, desks: cell.desks.map((desk, index) => (index === 1 ? { ...desk, teacher: '鈴木', lesson: mkLesson('moved-a', [copy, null]) } : desk)) } : cell))
    const suppressed = [buildManagedOccurrenceKey(copy, DATE, 5)]
    const saved = save(week, { suppressed })
    expect(saved.removedSuppressedRegularLessonOccurrences).toEqual(suppressed)
    expect(saved.summary.sameDayMoveCopiesReverted).toBe(1)
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual(['sA'])
    const day = saved.nextWeeks.flat().filter((cell) => cell.dateKey === DATE).flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? [])).filter((student) => student?.managedStudentId === 'sA')
    expect(day).toHaveLength(1)
  })

  it('不動点（2-7）: メモのある机・講師のいない行・同じ講師の 2 机があっても、保存 → 再マージ（フラグ ON）→ 再保存でセルは丸ごと変わらない', () => {
    const memoBoard = board((desks) => desks.map((desk, index) => (index === 1 ? { ...desk, memoSlots: ['連絡', null] } : index === 2 ? { ...desk, lesson: mkLesson('hand-a', [makeupA('a-makeup'), null]) } : desk)))
    const memoSaved = save(memoBoard)
    // メモの席にテンプレの B → 机 1 は 2 行（上＝B／下＝メモ）。
    expect(memoSaved.nextPendingDesks[buildTemplatePendingDeskKey(CELL, cellOf(memoSaved.nextWeeks).desks[1].id)]?.lower.memoSlots).toEqual(['連絡', null])
    expectStable(memoSaved)
  })
})
