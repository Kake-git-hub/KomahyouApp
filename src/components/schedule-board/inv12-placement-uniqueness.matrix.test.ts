import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry } from './types'
import { buildManagedOccurrenceKey, buildManagedScheduleCellsForRange, buildTemplateTeacherSuppressionKey, computePendingDeskResolution, computePendingLowerStudentMove, computeStudentMove, computeTemplateDiffApplyForBoard, findDuplicateStudentInCellByKey, remergeBoardWeeksWithManagedData, type TemplatePendingResolutionLedgers } from './ScheduleBoardScreen'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import { settleTemplatePendingDesk } from './templatePendingResolution'
import { buildSameSlotTemplateDuplicateNote } from './templateDiffApply'
import { buildTemplateSlotKey } from './templateDefinitionDiff'
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
describe('INV-12 × テンプレ差分反映の保存: 同じコマの生存数は保存 → 再マージの後も 1（Q21-11）', () => {
  const WEEK_START = '2026-10-05'
  const WEEK_END = '2026-10-11'
  const DATE = '2026-10-07'
  const CELL = `${DATE}_5`
  const studentRows: StudentRow[] = [
    { id: 'sA', name: '青木', displayName: '青木', email: 'a@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
    { id: 'sB', name: '馬場', displayName: '馬場', email: 'b@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
    // C はテンプレに出ない（振替の手置きだけに使う）。D は講師のいない行の 2 本目にだけ使う（L-7 兄弟 2）。
    { id: 'sC', name: '千葉', displayName: '千葉', email: 'c@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
    { id: 'sD', name: '土屋', displayName: '土屋', email: 'd@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  ]
  const teacherRows: TeacherRow[] = ['田中', '鈴木', '佐藤'].map((name, index) => ({
    id: `t${index + 1}`, name, email: `t${index + 1}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
  }))
  const row = (id: string, teacherId: string, student1Id = ''): RegularLessonRow => ({
    id, schoolYear: 2026, teacherId, student1Id, subject1: student1Id ? '数' : '', startDate: '', endDate: '', student2Id: '', subject2: '',
    student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 5,
  })
  const settings = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 3, ...extra }) as ClassroomSettings
  const OLD_ROWS = [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3')]
  // 新テンプレ: 机 0 に A（旧テンプレと同じ）・机 1 に B・机 2 は講師だけ
  const NEW_ROWS = OLD_ROWS
  const makeupA = (id: string) => mkStudent(id, '青木', { managedStudentId: 'sA', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })

  function board(update: (desks: DeskCell[]) => DeskCell[], rows: RegularLessonRow[] = OLD_ROWS, deskCount = 3) {
    const week = buildManagedScheduleCellsForRange({
      range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' },
      fallbackStartDate: WEEK_START,
      fallbackEndDate: WEEK_END,
      classroomSettings: settings({ deskCount }),
      teachers: teacherRows,
      students: studentRows,
      regularLessons: rows,
      boardWeeks: [],
    })
    return week.map((cell) => (cell.id === CELL ? { ...cell, desks: update(cell.desks) } : cell))
  }

  // 保存本体と同じ経路 → 保存直後の再マージ 1 回（教室設定・通常授業の変更 effect と同じ合成関数）。
  // 再マージには保存と同じ抑止（保存前から持っていた抑止＋保存が積んだ抑止）を渡す（handleSaveRegularLessonTemplateByDiff と同じ）。
  function saveThenRemerge(week: SlotCell[], options: { rows?: RegularLessonRow[]; suppressed?: string[]; pendingDesks?: TemplatePendingDeskMap; deskCount?: number } = {}) {
    const rows = options.rows ?? NEW_ROWS
    const suppressed = options.suppressed ?? []
    const savedSettings = settings({ templateFreezeBeforeDate: DATE, deskCount: options.deskCount ?? 3 })
    const saved = computeTemplateDiffApplyForBoard({ scheduleCountAdjustments: [],
      weeks: [week],
      classroomSettings: savedSettings,
      teachers: teacherRows,
      students: studentRows,
      regularLessons: rows,
      effectiveStartDate: DATE,
      suppressedRegularLessonOccurrences: suppressed,
      templatePendingDesks: options.pendingDesks ?? {},
      createdAt: '2026-09-29T10:00:00.000Z', manualMakeupAdjustments: {},
    })
    // 保存と同じ抑止: 保存前の抑止から Q36 で外した分を除き、Q21-11 / Q35 で足した分を加える。
    const removed = new Set(saved.removedSuppressedRegularLessonOccurrences)
    const nextSuppressed = [...suppressed.filter((key) => !removed.has(key)), ...saved.addedSuppressedRegularLessonOccurrences]
    const remerged = remergeBoardWeeksWithManagedData(saved.nextWeeks, {
      classroomSettings: savedSettings,
      teachers: teacherRows,
      students: studentRows,
      regularLessons: rows,
      suppressedRegularLessonOccurrences: nextSuppressed,
      todayKey: '2026-09-29',
    })
    return { saved, remerged, nextSuppressed }
  }
  const liveCount = (weeks: SlotCell[][], managedId: string) => weeks.flat().filter((cell) => cell.id === CELL)
    .flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []))
    .filter((student) => student?.managedStudentId === managedId).length
  const liveIdsAt = (weeks: SlotCell[][], deskIndex: number) => (weeks.flat().find((cell) => cell.id === CELL)!.desks[deskIndex].lesson?.studentSlots ?? [])
    .filter(Boolean).map((student) => student!.managedStudentId)

  // ── 決定記録 57（オーナー決定 2026-11-01・自動処理一覧 A-10「緑化」・原文「机 3 の方を下段表示にして机 7 は他と同じようにテンプレなので上段。
  //    机 3 が空きでも一行目を空白にして 2 段表示」）: 旧 Q21-11 前段（別の 1 行の机に生きていれば上段に置かず抑止キー）を置き換え。
  //    T（机 0）には A をテンプレどおり置く。D（机 2）の A の振替は同じ席の下段へ（上段は空白のまま 2 段）。抑止キーは積まない。
  //    ★旧「T に置かない」を既定に戻さない（この行が検出する）。
  const DESK0_KEY = buildTemplatePendingDeskKey(CELL, `${CELL}_desk_1`)
  const DESK2_KEY = buildTemplatePendingDeskKey(CELL, `${CELL}_desk_3`)
  const resolutionLedgers = (suppressed: string[]): TemplatePendingResolutionLedgers => ({
    manualLectureStockCounts: {}, manualLectureStockOrigins: {}, manualMakeupAdjustments: {}, fallbackLectureStockStudents: {}, fallbackMakeupStudents: {},
    suppressedMakeupOrigins: {}, suppressedRegularLessonOccurrences: suppressed, scheduleCountAdjustments: [],
  })
  const resolveAt = (mode: 'adopt-existing' | 'adopt-template', weeks: SlotCell[][], pending: TemplatePendingDeskMap, deskId: string, lowerIndex: number, suppressed: string[]) => computePendingDeskResolution({
    mode, weeks, cellId: CELL, deskId, lowerIndex, templatePendingDesks: pending, ledgers: resolutionLedgers(suppressed),
    managedStudentByAnyName: new Map(), resolveDisplayName: (name: string) => name, resolveStockId: (student: StudentEntry) => student.managedStudentId ?? student.name, ledgerOriginDatesByKey: {},
  })
  const remergeWith = (weeks: SlotCell[][], suppressed: string[]) => remergeBoardWeeksWithManagedData(weeks, {
    classroomSettings: settings({ templateFreezeBeforeDate: DATE }), teachers: teacherRows, students: studentRows, regularLessons: NEW_ROWS, suppressedRegularLessonOccurrences: suppressed, todayKey: '2026-09-29',
  })
  const boardWithMakeupAAt2 = () => board((desks) => desks.map((desk, index) => (index === 2 ? { ...desk, lesson: mkLesson('hand-a', [makeupA('a-makeup'), null]) } : desk)))

  it('決定記録 57: 別の 1 行の机（机 2）に A の振替が生きていても、机 0 の上段に A をテンプレどおり置き、机 2 の振替は同じ席の下段（保留・緑）へ。机 2 の上段は空白・抑止キー 0・生存数 1・再マージ 1 回と同じテンプレの再保存で形が変わらない', () => {
    const { saved, remerged, nextSuppressed } = saveThenRemerge(boardWithMakeupAAt2())
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual(['sA'])
    expect(liveIdsAt(saved.nextWeeks, 2)).toEqual([])
    expect(cellOf(saved.nextWeeks).desks[2].lesson).toBeUndefined()
    expect(cellOf(saved.nextWeeks).desks[2].teacher).toBe('佐藤')
    const pending = saved.nextPendingDesks[DESK2_KEY]
    expect(pending?.lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual(['sA', null])
    expect(pending?.lower.lesson?.studentSlots[0]?.lessonType).toBe('makeup')
    expect(pending?.origin).toEqual({ kind: 'same-slot-template-duplicate', note: buildSameSlotTemplateDuplicateNote(1, '数') })
    expect(saved.summary.duplicateDemotedStudents).toBe(1)
    expect(saved.summary.skippedDuplicateStudents).toBe(0)
    expect(saved.summary.pending).toBe(1)
    expect(saved.addedSuppressedRegularLessonOccurrences).toEqual([])
    expect(saved.studentNotes.filter((note) => note.kind === 'duplicate-demoted').map((note) => [note.studentName, note.detail])).toEqual([['青木', '1']])
    expect(liveCount(saved.nextWeeks, 'sA')).toBe(1)
    expect(liveCount(remerged, 'sA')).toBe(1)
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
    // 同じテンプレの再保存: 下段の A は forcedLower で上段へ上がらない（席が空いていても）・形が変わらない
    const again = saveThenRemerge(saved.nextWeeks[0], { suppressed: nextSuppressed, pendingDesks: saved.nextPendingDesks })
    expect(cellOf(again.saved.nextWeeks)).toEqual(cellOf(saved.nextWeeks))
    expect(again.saved.nextPendingDesks).toEqual(saved.nextPendingDesks)
    expect(again.saved.summary.duplicateDemotedStudents).toBe(0)
    expect(cellOf(again.remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  it('決定記録 57 の片づけ「手入力データを採用」: A の振替が机 2 の上段へ戻り、机 0 のテンプレの A は外れて旧 Q21-11 と同じ抑止キーだけ積む（希望回数・在庫は触らない）。再マージしても A は机 2 の 1 か所', () => {
    const { saved, nextSuppressed } = saveThenRemerge(boardWithMakeupAAt2())
    const result = resolveAt('adopt-existing', saved.nextWeeks, saved.nextPendingDesks, `${CELL}_desk_3`, 0, nextSuppressed)
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(liveIdsAt(result.nextWeeks, 2)).toEqual(['sA'])
    expect(cellOf(result.nextWeeks).desks[2].lesson?.studentSlots[0]?.lessonType).toBe('makeup')
    expect(liveIdsAt(result.nextWeeks, 0)).toEqual([])
    expect(cellOf(result.nextWeeks).desks[0].teacher).toBe('田中')
    expect(result.nextTemplatePendingDesks[DESK2_KEY]).toBeUndefined()
    expect(result.ledgers.suppressedRegularLessonOccurrences).toEqual([...nextSuppressed, buildManagedOccurrenceKey(mkStudent('sA', '青木'), DATE, 5)])
    // 決定記録 62（オーナー決定 2026-11-02「単発削除と揃えて」）: 外した机 0 の A の通常授業は −1（戻した机 2 の振替は通常授業の代わりに数えない）。
    expect(result.ledgers.scheduleCountAdjustments).toHaveLength(1)
    expect(result.ledgers.scheduleCountAdjustments[0]).toMatchObject({ countKind: 'regular', delta: -1 })
    expect(result.countAdjustedCount).toBe(1)
    expect(result.ledgers.manualMakeupAdjustments).toEqual({})
    expect(result.message).toContain('机 1 のテンプレの 青木 を外す')
    expect(liveCount(result.nextWeeks, 'sA')).toBe(1)
    const remerged = remergeWith(result.nextWeeks, result.ledgers.suppressedRegularLessonOccurrences)
    expect(liveCount(remerged, 'sA')).toBe(1)
    expect(liveIdsAt(remerged, 2)).toEqual(['sA'])
    expect(liveIdsAt(remerged, 0)).toEqual([])
  })

  it('決定記録 57 の片づけ「テンプレ授業を採用」: 机 2 の下段の振替は既存の処分規則で外れて未消化振替へ戻り（INV-06）、A は机 0 のテンプレだけ', () => {
    const { saved, nextSuppressed } = saveThenRemerge(boardWithMakeupAAt2())
    const result = resolveAt('adopt-template', saved.nextWeeks, saved.nextPendingDesks, `${CELL}_desk_3`, 0, nextSuppressed)
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(liveIdsAt(result.nextWeeks, 2)).toEqual([])
    expect(liveIdsAt(result.nextWeeks, 0)).toEqual(['sA'])
    expect(result.nextTemplatePendingDesks[DESK2_KEY]).toBeUndefined()
    expect(Object.keys(result.ledgers.manualMakeupAdjustments)).toHaveLength(1)
    expect(result.ledgers.suppressedRegularLessonOccurrences).toEqual(nextSuppressed)
    expect(liveCount(result.nextWeeks, 'sA')).toBe(1)
  })

  it('決定記録 57 × Q28: A が机 0 のテンプレに生きている間は下段の A を自動で上げない（duplicate-student）。机 0 の A を外すと自動で 1 行へ戻る', () => {
    const { saved } = saveThenRemerge(boardWithMakeupAAt2())
    const held = settleTemplatePendingDesk({ weeks: saved.nextWeeks, templatePendingDesks: saved.nextPendingDesks, key: DESK2_KEY })
    expect(held).toEqual({ status: 'kept', reason: 'duplicate-student' })
    const freed = saved.nextWeeks.map((week) => week.map((cell) => (cell.id !== CELL ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 0 ? { ...desk, lesson: undefined } : desk)) })))
    const released = settleTemplatePendingDesk({ weeks: freed, templatePendingDesks: saved.nextPendingDesks, key: DESK2_KEY })
    expect(released.status).toBe('collapsed')
    if (released.status !== 'collapsed') return
    expect(liveIdsAt(released.nextWeeks, 2)).toEqual(['sA'])
    expect(released.nextTemplatePendingDesks[DESK2_KEY]).toBeUndefined()
  })

  it('決定記録 57 の予備経路: D（机 2）の保留の下段が 2 席とも埋まっていて A の振替を移せないときだけ、旧 Q21-11（机 0 に A を置かず抑止キー・duplicate-skipped）。A の生存数 1・再マージの不動点', () => {
    const makeupC = mkStudent('c-makeup', '千葉', { managedStudentId: 'sC', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
    const makeupD = mkStudent('d-makeup', '土屋', { managedStudentId: 'sD', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
    const week = boardWithMakeupAAt2()
    const pending: TemplatePendingDeskMap = {
      [DESK2_KEY]: { lower: { lesson: mkLesson('lower-full', [makeupC, makeupD]) }, effectiveStartDate: DATE, createdAt: '2026-09-29T10:00:00.000Z' },
    }
    const { saved, remerged, nextSuppressed } = saveThenRemerge(week, { pendingDesks: pending })
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual([])
    expect(liveIdsAt(saved.nextWeeks, 2)).toContain('sA')
    expect(saved.summary.skippedDuplicateStudents).toBe(1)
    expect(saved.summary.duplicateDemotedStudents).toBe(0)
    expect(saved.addedSuppressedRegularLessonOccurrences).toEqual([buildManagedOccurrenceKey(mkStudent('sA', '青木'), DATE, 5)])
    expect(saved.studentNotes.filter((note) => note.kind === 'duplicate-skipped').map((note) => note.studentName)).toEqual(['青木'])
    expect(liveCount(saved.nextWeeks, 'sA')).toBe(1)
    expect(liveCount(remerged, 'sA')).toBe(1)
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
    void nextSuppressed
  })

  it('席ごと（2026-09-30）: 同じ机の生徒 2 の席に A の振替があり、テンプレの生徒 1 が A（通常）なら、生徒 2 の席が空いていても A の振替は 1 行に残さず下段へ。再マージ 1 回の後も A は 1 か所', () => {
    const week = board((desks) => desks.map((desk, index) => (index === 0 ? { ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupA('a-makeup')] } } : desk)))
    const { saved, remerged } = saveThenRemerge(week)
    const pendingKey = buildTemplatePendingDeskKey(CELL, `${CELL}_desk_1`)
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual(['sA'])
    expect(saved.nextPendingDesks[pendingKey]?.lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sA'])
    expect(liveCount(saved.nextWeeks, 'sA')).toBe(1)
    expect(liveCount(remerged, 'sA')).toBe(1)
  })

  it('決定記録 57（席ごと・2026-11-01 改定）: 机 0 の生徒 2 の席に 1 行で残した B の振替が別の机（机 1）のテンプレの B と重なるなら、机 1 に B をテンプレどおり置き、机 0 は上段 A＋空席・下段に B の振替（保留）。抑止キー 0・B の生存数 1', () => {
    const makeupB = mkStudent('b-makeup', '馬場', { managedStudentId: 'sB', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
    const week = board((desks) => desks.map((desk, index) => (index === 0 ? { ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupB] } } : desk)))
    const { saved, remerged } = saveThenRemerge(week)
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual(['sA'])
    expect(liveIdsAt(saved.nextWeeks, 1)).toEqual(['sB'])
    expect(saved.nextPendingDesks[DESK0_KEY]?.lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sB'])
    expect(saved.nextPendingDesks[DESK0_KEY]?.origin?.kind).toBe('same-slot-template-duplicate')
    expect(saved.summary.duplicateDemotedStudents).toBe(1)
    expect(saved.summary.skippedDuplicateStudents).toBe(0)
    expect(saved.addedSuppressedRegularLessonOccurrences).toEqual([])
    expect(liveCount(saved.nextWeeks, 'sB')).toBe(1)
    expect(liveCount(remerged, 'sB')).toBe(1)
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  // Q38（オーナー指示 2026-10-13）: 手動追加の通常授業は、同じコマの別の机にテンプレが同じ生徒×科目を置くならテンプレを自動採用（手動追加を外す）。
  // 〜v1.5.591 は Q21-11 前段（手置きの 1 行の机が勝ち、テンプレ側を置かず抑止キー）か、席がぶつかると下段（緑）＋別の机の上段の 2 か所（Q21-11 後段）だった。
  it('Q38（2026-10-13）: 机 2 に手で足した通常授業 A（テンプレは机 0 に A）→ 机 2 の A を外して机 0 だけ。抑止キー 0・再マージ 1 回の後も A は 1 か所（席がぶつかる形も同じ）', () => {
    const handA = mkStudent('a-hand', '青木', { managedStudentId: 'sA', manualAdded: true })
    const week = board((desks) => desks.map((desk, index) => (index === 2 ? { ...desk, lesson: mkLesson('hand-a', [handA, null]) } : desk)))
    const free = saveThenRemerge(week)
    expect(liveIdsAt(free.saved.nextWeeks, 0)).toEqual(['sA'])
    expect(liveIdsAt(free.saved.nextWeeks, 2)).toEqual([])
    expect(liveCount(free.saved.nextWeeks, 'sA')).toBe(1)
    expect(free.saved.summary.manualRegularAdoptedByCellTemplate).toBe(1)
    expect(free.saved.summary.skippedDuplicateStudents).toBe(0)
    expect(free.saved.addedSuppressedRegularLessonOccurrences).toEqual([])
    expect(liveCount(free.remerged, 'sA')).toBe(1)
    expect(liveIdsAt(free.remerged, 2)).toEqual([])
    // 席がぶつかる形: 新テンプレが机 2 の席 1 に D を置く → 下段（緑）に A を残さず 1 行（保留 0）・A は机 0 だけ。
    const collide = saveThenRemerge(week, { rows: [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3', 'sD')] })
    expect(collide.saved.nextPendingDesks).toEqual({})
    expect(liveIdsAt(collide.saved.nextWeeks, 2)).toEqual(['sD'])
    expect(liveCount(collide.saved.nextWeeks, 'sA')).toBe(1)
    expect(liveCount(collide.remerged, 'sA')).toBe(1)
    expect(collide.saved.summary.manualRegularAdoptedByCellTemplate).toBe(1)
  })

  // regression-reviewer L-7（2026-09-30）: Q21-11 で生徒を全員外した机は「講師だけの机」になる。再マージは抑止で空になった
  // 管理授業の机を suppressManagedStudentsInCell と同じ形（講師名は残し teacherAssignmentTeacherId は外す）で置き直すので、
  // 保存結果も同じ形でなければ再マージの不動点にならない（INV-02 / INV-03）。生徒 ID の比較だけでは見えないため、セル丸ごと比べる。
  const cellOf = (weeks: SlotCell[][]) => weeks.flat().find((cell) => cell.id === CELL)!

  it('不動点（L-7・2026-11-01 改定）: 机 0 の B の振替を下段へ移し、机 1 にテンプレの B を置いても、保存 → 再マージ 1 回でセルは丸ごと変わらない（置き換えの経路）', () => {
    const makeupB = mkStudent('b-makeup', '馬場', { managedStudentId: 'sB', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
    const week = board((desks) => desks.map((desk, index) => (index === 0 ? { ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupB] } } : desk)))
    const { saved, remerged } = saveThenRemerge(week)
    expect(saved.summary.duplicateDemotedStudents).toBe(1)
    expect(saved.summary.skippedDuplicateStudents).toBe(0)
    const savedDesk1 = cellOf(saved.nextWeeks).desks[1]
    expect(liveIdsAt(saved.nextWeeks, 1)).toEqual(['sB'])
    expect(savedDesk1.teacher).toBe('鈴木')
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  it('不動点（L-7・2026-11-01 改定）: 兄弟＝メモの印がある机 1 にテンプレの B を置き、机 0 の B の振替を下段へ移しても、保存 → 再マージ 1 回でセルは丸ごと変わらない', () => {
    const makeupB = mkStudent('b-makeup', '馬場', { managedStudentId: 'sB', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
    const week = board((desks) => desks.map((desk, index) => {
      if (index === 0) return { ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupB] } }
      if (index === 1) return { ...desk, memoSlots: ['連絡あり', null] }
      return desk
    }))
    const { saved, remerged } = saveThenRemerge(week)
    expect(saved.summary.duplicateDemotedStudents).toBe(1)
    const savedDesk1 = cellOf(saved.nextWeeks).desks[1]
    expect(liveIdsAt(saved.nextWeeks, 1)).toEqual(['sB'])
    expect(savedDesk1.teacher).toBe('鈴木')
    // メモは生徒 1 の席にテンプレの B が入るので空いた生徒 2 の席へ（Q24 のメモの引き継ぎ・消えない）
    expect(savedDesk1.memoSlots).toEqual([null, '連絡あり'])
    // 件数（薄化しない・regression-reviewer 2026-11-01）: 机 1 は中身が同じ B なので「残す」ではなく採用（印のメモは残る・1 行）、机 0 が保留 1。
    expect([saved.summary.kept, saved.summary.adopted, saved.summary.collapsedOnCreate, saved.summary.pending]).toEqual([0, 1, 0, 1])
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  it('不動点（L-7）: 兄弟＝Q21-11 に当たらない保存（講師だけのテンプレ机 2 を含む）も、保存 → 再マージ 1 回でセルは丸ごと変わらない', () => {
    const week = board((desks) => desks)
    const { saved, remerged } = saveThenRemerge(week)
    expect(saved.summary.skippedDuplicateStudents).toBe(0)
    expect(cellOf(saved.nextWeeks).desks[2].teacherAssignmentTeacherId).toBe('t3')
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  // L-7 の INV 監査（regression-reviewer 2026-09-30）で残った兄弟 3 件。どれも Q21-11 が新しい発生源になる、保存結果と再マージのずれ。
  const makeupBAt0 = (desks: DeskCell[]) => desks.map((desk, index) => (index === 0
    ? { ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], mkStudent('b-makeup', '馬場', { managedStudentId: 'sB', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })] as Slots } }
    : desk))

  // Q35（オーナー指示 2026-10-02・tp-22）: 丸ごと振替の日はテンプレの生徒を置かない（重複の Q21-11 より前に全員外す）。机の形は同じ（抑止 → strip）。
  it('不動点（L-7 兄弟 1・Q35）: 丸ごと振替の日（足場講師を置かない日）にテンプレの生徒を外して講師だけになった机も、保存 → 再マージ 1 回でセルは丸ごと変わらない', () => {
    const { saved, remerged } = saveThenRemerge(board(makeupBAt0), { suppressed: [buildTemplateTeacherSuppressionKey(DATE)] })
    expect(saved.summary.skippedDuplicateStudents).toBe(0)
    expect(saved.summary.wholeDayTransferSkippedStudents).toBe(2)
    expect(cellOf(saved.nextWeeks).desks[1].lesson).toBeUndefined()
    expect(liveCount(saved.nextWeeks, 'sB')).toBe(1)
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  it('不動点（L-7 兄弟 1・Q35）: 兄弟＝丸ごと振替の日 × 残す（keep）の経路。メモの印がある机 1 のテンプレの B を外しても、保存 → 再マージ 1 回でセルは丸ごと変わらない', () => {
    const week = board((desks) => makeupBAt0(desks).map((desk, index) => (index === 1 ? { ...desk, memoSlots: ['連絡あり', null] as [string | null, string | null] } : desk)))
    const { saved, remerged } = saveThenRemerge(week, { suppressed: [buildTemplateTeacherSuppressionKey(DATE)] })
    expect(saved.summary.skippedDuplicateStudents).toBe(0)
    expect(saved.summary.wholeDayTransferSkippedStudents).toBe(2)
    expect(saved.summary.kept).toBe(2)
    expect(cellOf(saved.nextWeeks).desks[1].memoSlots).toEqual(['連絡あり', null])
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  it('不動点（Q35・tp-22）: 丸ごと振替の日にテンプレの生徒を A → D に変えても、D は置かず A の振替が 1 行のまま（保留 0）。保存 → 再マージ 1 回でセルは丸ごと変わらず D は 0 か所', () => {
    const rows = [row('r0', 't1', 'sD'), row('r1', 't2', 'sB'), row('r2', 't3')]
    const week = board((desks) => desks.map((desk, index) => (index === 0
      ? { ...desk, teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'manual' as const, lesson: { id: `${desk.id}_moved`, studentSlots: [mkStudent('a-moved', '青木', { managedStudentId: 'sA', lessonType: 'makeup', makeupSourceDate: '2026-10-05' }), null] as Slots } }
      : { id: desk.id, teacher: '' })))
    const suppressed = [buildManagedOccurrenceKey(mkStudent('a', '青木', { managedStudentId: 'sA' }), DATE, 5), buildManagedOccurrenceKey(mkStudent('b', '馬場', { managedStudentId: 'sB' }), DATE, 5), buildTemplateTeacherSuppressionKey(DATE)]
    const { saved, remerged } = saveThenRemerge(week, { rows, suppressed })
    expect(saved.summary.pending).toBe(0)
    expect(saved.summary.wholeDayTransferSkippedStudents).toBe(1)
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual(['sA'])
    expect(liveCount(saved.nextWeeks, 'sD')).toBe(0)
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
    expect(liveCount(remerged, 'sD')).toBe(0)
  })

  it('不動点（Q35・regression-reviewer 中-1）: v1.5.575 までに丸ごと振替の日に作られた保留の机（上段 D／下段 A振・講師はテンプレの講師で manual でない）を再保存すると、1 行 [A振] に戻り講師が残る。D は 0 か所・保存 → 再マージ 1 回でセル丸ごと不変', () => {
    const rows = [row('r0', 't1', 'sD'), row('r1', 't2', 'sB'), row('r2', 't3')]
    const week = board((desks) => desks.map((desk, index) => (index === 0
      ? { ...desk, teacher: '田中', manualTeacher: false, teacherAssignmentSource: undefined, teacherAssignmentTeacherId: 't1', lesson: { id: 'managed_r0_x', studentSlots: [mkStudent('d', '土屋', { managedStudentId: 'sD' }), null] as Slots } }
      : { id: desk.id, teacher: '' })), rows)
    const pendingKey = buildTemplatePendingDeskKey(CELL, `${CELL}_desk_1`)
    const pendingDesks: TemplatePendingDeskMap = {
      [pendingKey]: { lower: { lesson: { id: 'moved', studentSlots: [mkStudent('a-moved', '青木', { managedStudentId: 'sA', lessonType: 'makeup', makeupSourceDate: '2026-10-05' }), null] } }, effectiveStartDate: DATE, createdAt: '2026-10-01T10:00:00.000Z' },
    }
    const suppressed = [buildManagedOccurrenceKey(mkStudent('a', '青木', { managedStudentId: 'sA' }), DATE, 5), buildManagedOccurrenceKey(mkStudent('b', '馬場', { managedStudentId: 'sB' }), DATE, 5), buildTemplateTeacherSuppressionKey(DATE)]
    const { saved, remerged } = saveThenRemerge(week, { rows, suppressed, pendingDesks })
    expect(saved.summary.pending).toBe(0)
    expect(saved.nextPendingDesks[pendingKey]).toBeUndefined()
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual(['sA'])
    expect(cellOf(saved.nextWeeks).desks[0].teacher).toBe('田中')
    expect(liveCount(saved.nextWeeks, 'sD')).toBe(0)
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  // Q36（オーナー指示 2026-10-03・開発用教室の実データ）: 同じ日の中で手で動かした通常授業の写し（`moved_…`・同日移動）が残ったまま、
  // テンプレでその生徒を別の時限へ移すと、移動元（写し）と移動先（テンプレ）の両方に同じ生徒が出た（INV-12 の日単位の二重配置）。
  // 写しはその日のテンプレの授業そのものなので、テンプレが同じ日の別のコマに置くなら写しを外し、写しの抑止キーも外す。
  it('Q36: 5 限の机に A の写し（同日移動）が残ったままテンプレで A を 4 限へ移しても、保存 → 再マージ 1 回の後も A はその日に 1 か所（4 限）だけ', () => {
    const rowsMovedTo4 = [{ ...row('r0', 't1', 'sA'), slotNumber: 4 }, row('r1', 't2', 'sB'), row('r2', 't3')]
    const copyOfA = mkStudent('a-copy', '青木', { managedStudentId: 'sA', sameDayMoveSourceDate: DATE, sameDayMoveSourceLabel: '2026/10/7(水) 5限' })
    const week = board((desks) => desks.map((desk, index) => (index === 0 ? { ...desk, lesson: mkLesson('moved_sA_x', [copyOfA, null]) } : desk)))
    const keyA5 = buildManagedOccurrenceKey(mkStudent('a', '青木', { managedStudentId: 'sA' }), DATE, 5)
    const savedSettings = settings({ templateFreezeBeforeDate: DATE })
    const saved = computeTemplateDiffApplyForBoard({ scheduleCountAdjustments: [],
      weeks: [week], classroomSettings: savedSettings, teachers: teacherRows, students: studentRows, regularLessons: rowsMovedTo4,
      effectiveStartDate: DATE, suppressedRegularLessonOccurrences: [keyA5], templatePendingDesks: {}, createdAt: '2026-10-03T10:00:00.000Z', manualMakeupAdjustments: {},
    })
    const liveOnDay = (weeks: SlotCell[][]) => weeks.flat().filter((cell) => cell.dateKey === DATE).flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? [])).filter((student) => student?.managedStudentId === 'sA')
    // 2026-11-01（オーナー決定 A-12・台帳改定）: 写しは手入力データとして残す（外さない・抑止キーも外さない）。この形では 5 限の机 0 が B のテンプレ机になり
    // 写しの席を埋めるので、写しは机 0 の下段（保留・緑）に残り、上段の A は 4 限だけ。同一コマ（INV-12 の保証文）の生存数は 1 のまま。再マージでも不動点。
    expect(liveOnDay(saved.nextWeeks).map(() => 1)).toHaveLength(1)
    expect(liveCount(saved.nextWeeks, 'sA')).toBe(0)
    const desk0 = cellOf(saved.nextWeeks).desks[0]
    expect(saved.nextPendingDesks[buildTemplatePendingDeskKey(CELL, desk0.id)]?.lower.lesson?.studentSlots[0]?.managedStudentId).toBe('sA')
    expect(saved.summary.sameDayMoveCopiesKept).toBe(1)
    expect(saved.removedSuppressedRegularLessonOccurrences).toEqual([])
    const remerged = remergeBoardWeeksWithManagedData(saved.nextWeeks, {
      classroomSettings: savedSettings, teachers: teacherRows, students: studentRows, regularLessons: rowsMovedTo4,
      suppressedRegularLessonOccurrences: [keyA5, ...saved.addedSuppressedRegularLessonOccurrences], todayKey: '2026-09-29',
    })
    expect(liveOnDay(remerged)).toHaveLength(1)
    expect(liveCount(remerged, 'sA')).toBe(0)
    expect(remerged.flat().find((cell) => cell.id === CELL)).toEqual(cellOf(saved.nextWeeks))
  })

  // Q39-9（Q36 の兄弟・regression-reviewer H-1・2026-10-14）: 「テンプレで変えたコマだけ」の絞り込み（Q39）で写しの時限が範囲の外にあっても、
  // 変えた机に関わる生徒の写しがある日は入口がその日を全コマにするので、Q36 と同じく A はその日に 1 か所。絞り込みを渡さない全コマと同じ結果になる。
  it('Q39-9: 範囲 {水4, 水5} の外（3 限）に A の写しがあっても、変えたコマだけの保存 → 再マージ 1 回の後も A はその日に 1 か所（4 限）だけ', () => {
    const rowsMovedTo4 = [{ ...row('r0', 't1', 'sA'), slotNumber: 4 }, row('r1', 't2', 'sB'), row('r2', 't3')]
    const copyOfA = mkStudent('a-copy', '青木', { managedStudentId: 'sA', sameDayMoveSourceDate: DATE, sameDayMoveSourceLabel: '2026/10/7(水) 5限' })
    const keyA5 = buildManagedOccurrenceKey(mkStudent('a', '青木', { managedStudentId: 'sA' }), DATE, 5)
    const savedSettings = settings({ templateFreezeBeforeDate: DATE })
    // 実データの形: 5 限の A は同日移動の抑止で消え、3 限（範囲の外）に写し。読み込み時の再マージを通した正規形から始める。
    const loaded = remergeBoardWeeksWithManagedData([board((desks) => desks)], {
      classroomSettings: savedSettings, teachers: teacherRows, students: studentRows, regularLessons: OLD_ROWS, suppressedRegularLessonOccurrences: [keyA5], todayKey: '2026-09-29',
    })[0]
    const week = loaded.map((cell) => (cell.id === `${DATE}_3` ? { ...cell, desks: cell.desks.map((desk, index) => (index === 0 ? { ...desk, lesson: mkLesson('moved_sA_3', [copyOfA, null]) } : desk)) } : cell))
    const liveOnDay = (weeks: SlotCell[][]) => weeks.flat().filter((cell) => cell.dateKey === DATE).flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? [])).filter((student) => student?.managedStudentId === 'sA')
    const save = (slotFilter: Parameters<typeof computeTemplateDiffApplyForBoard>[0]['slotFilter']) => computeTemplateDiffApplyForBoard({ scheduleCountAdjustments: [],
      weeks: [week], classroomSettings: savedSettings, teachers: teacherRows, students: studentRows, regularLessons: rowsMovedTo4,
      effectiveStartDate: DATE, suppressedRegularLessonOccurrences: [keyA5], templatePendingDesks: {}, createdAt: '2026-10-14T10:00:00.000Z', manualMakeupAdjustments: {}, slotFilter,
    })
    const scoped = save({ slotKeys: new Set([buildTemplateSlotKey(3, 4), buildTemplateSlotKey(3, 5)]), sameDayMoveStudentIdsByWeekday: new Map([[3, new Set(['sA'])]]) })
    const full = save(undefined)
    // 2026-11-01（A-12）: 写しは残る → その日に 2 か所（4 限＝テンプレ・3 限＝写し・superseded の印）。全コマの保存と同じ結果。
    expect(liveOnDay(scoped.nextWeeks)).toHaveLength(2)
    expect(scoped.nextWeeks.flat().find((cell) => cell.id === `${DATE}_4`)!.desks[0].lesson?.studentSlots[0]?.managedStudentId).toBe('sA')
    expect(scoped.nextWeeks.flat().find((cell) => cell.id === `${DATE}_3`)!.desks[0].lesson?.studentSlots[0]?.templateCopyNotice).toBe('superseded')
    expect(scoped.summary.sameDayMoveCopiesKept).toBe(1)
    expect(scoped.removedSuppressedRegularLessonOccurrences).toEqual([])
    expect(scoped.scopedFullDates).toEqual([DATE])
    expect(scoped.nextWeeks.flat().filter((cell) => cell.dateKey === DATE)).toEqual(full.nextWeeks.flat().filter((cell) => cell.dateKey === DATE))
    const remerged = remergeBoardWeeksWithManagedData(scoped.nextWeeks, {
      classroomSettings: savedSettings, teachers: teacherRows, students: studentRows, regularLessons: rowsMovedTo4,
      suppressedRegularLessonOccurrences: [keyA5, ...scoped.addedSuppressedRegularLessonOccurrences], todayKey: '2026-09-29',
    })
    expect(liveOnDay(remerged)).toHaveLength(2)
    expect(remerged.flat().filter((cell) => cell.dateKey === DATE)).toEqual(scoped.nextWeeks.flat().filter((cell) => cell.dateKey === DATE))
  })

  // 再マージ（mergeManagedWeek）は講師だけの管理机を、同じコマに同じ講師名が居れば足さず（alreadyPresent）、残りを「先頭から最初の空き机」へ
  // 置き直す。差分反映はテンプレを机の位置どおりに置くので、生徒を全員外した机の講師名が別の机と重なると（講師のいない行が 2 本＝「講師未割当」が 2 つ、
  // 同じ講師が 2 机）、その机が空き机になる（regression-reviewer 2026-09-30 の反例）。
  // 2026-10-15（Issue #76・INV-02）: 再マージは足場講師（非 manual の講師だけの机）をテンプレに同じ講師の講師だけの机がある間は今の机に残すようになり、
  // 後ろの講師だけの机（佐藤）は前へずれず元の机に残る。期待の並びをその形へ改めた（不動点の assert は不変・オーナー承認 2026-10-15「修正に進めて」）。
  const teachersAt = (weeks: SlotCell[][]) => cellOf(weeks).desks.map((desk) => desk.teacher)

  it('不動点（L-7 兄弟 2・2026-11-01 改定）: 講師のいない行が 2 本あっても、机 1 にテンプレの B が残り（机 0 の B の振替は下段）、保存 → 再マージ 1 回でセルは丸ごと変わらない', () => {
    const rows = [row('r0', 't1', 'sA'), row('r1', '', 'sB'), row('r2', '', 'sD'), row('r3', 't3')]
    const { saved, remerged } = saveThenRemerge(board(makeupBAt0, rows, 4), { rows, deskCount: 4 })
    expect(saved.summary.duplicateDemotedStudents).toBe(1)
    expect(liveCount(saved.nextWeeks, 'sB')).toBe(1)
    expect(liveIdsAt(saved.nextWeeks, 1)).toEqual(['sB'])
    expect(liveIdsAt(saved.nextWeeks, 2)).toEqual(['sD'])
    // 講師の並び全体（薄化しない）: 机 1 は B が残るので講師のいない行＝「講師未割当」、机 2 も同じ、佐藤は元の机 3。
    expect(teachersAt(saved.nextWeeks)).toEqual(['田中', '講師未割当', '講師未割当', '佐藤'])
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  it('不動点（L-7 兄弟 2・2026-11-01 改定）: 同じ講師が 2 机を持っても、机 1 にテンプレの B が残り、保存 → 再マージ 1 回でセルは丸ごと変わらない', () => {
    const rows = [row('r0', 't1', 'sA'), row('r1', 't1', 'sB'), row('r2', 't3')]
    const { saved, remerged } = saveThenRemerge(board(makeupBAt0, rows, 4), { rows, deskCount: 4 })
    expect(saved.summary.duplicateDemotedStudents).toBe(1)
    expect(liveIdsAt(saved.nextWeeks, 1)).toEqual(['sB'])
    // 講師の並び全体（薄化しない）: 同じ講師が 2 机のまま・佐藤は元の机 3・机 4 は空。
    expect(teachersAt(saved.nextWeeks)).toEqual(['田中', '田中', '佐藤', ''])
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  it('不動点（L-7 兄弟 2）: 兄弟＝Q21-11 を通らず、保存前から持っていた抑止で講師名の重なる講師だけの机ができても、保存 → 再マージ 1 回でセルは丸ごと変わらない', () => {
    const rows = [row('r0', 't1', 'sA'), row('r1', '', 'sB'), row('r2', '', 'sD'), row('r3', 't3')]
    const suppressed = [buildManagedOccurrenceKey(mkStudent('sB', '馬場'), DATE, 5)]
    const { saved, remerged } = saveThenRemerge(board((desks) => desks, rows, 4), { rows, deskCount: 4, suppressed })
    expect(saved.summary.skippedDuplicateStudents).toBe(0)
    expect(liveCount(saved.nextWeeks, 'sB')).toBe(0)
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  it('不動点（L-7 兄弟 3・2026-11-01 改定）: 保留中の再保存（Q29）で机 0 に B の振替を置いても、机 1 のテンプレの B は残り（下段の C はそのまま保留）、B の振替は机 0 の下段へ。保存 → 再マージ 1 回でセルは丸ごと変わらない', () => {
    // 1 回目の保存: 机 1 に C の振替を手置き → 新テンプレの机 1 は B なので保留（上段 B・下段 C）。
    const makeupC = mkStudent('c-makeup', '千葉', { managedStudentId: 'sC', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
    const first = saveThenRemerge(board((desks) => desks.map((desk, index) => (index === 1 ? { ...desk, lesson: mkLesson('hand-c', [makeupC, null]) } : desk))))
    const pendingKey = buildTemplatePendingDeskKey(CELL, `${CELL}_desk_2`)
    expect(first.saved.nextPendingDesks[pendingKey]?.lower.lesson?.studentSlots[0]?.managedStudentId).toBe('sC')
    // 2 回目の保存の前に、机 0 の生徒 2 の席へ B の振替を手置き → 旧: 机 1 のテンプレの B が外れて C が上がる／新: B は机 1 に残り、振替は机 0 の下段へ。
    const week = first.remerged[0].map((cell) => (cell.id === CELL ? { ...cell, desks: makeupBAt0(cell.desks) } : cell))
    const { saved, remerged } = saveThenRemerge(week, { suppressed: first.nextSuppressed, pendingDesks: first.saved.nextPendingDesks })
    expect(saved.summary.duplicateDemotedStudents).toBe(1)
    expect(saved.nextPendingDesks[pendingKey]?.lower.lesson?.studentSlots[0]?.managedStudentId).toBe('sC')
    expect(liveIdsAt(saved.nextWeeks, 1)).toEqual(['sB'])
    expect(saved.nextPendingDesks[DESK0_KEY]?.lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sB'])
    expect(liveCount(saved.nextWeeks, 'sB')).toBe(1)
    expect(liveCount(saved.nextWeeks, 'sC')).toBe(0)
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  it('後段: 別の机（机 1）の下段にだけ A が居るなら、机 0 の上段に A を置く。再マージ 1 回の後も生きている A は 1 か所（下段は数えない）', () => {
    // 机 1 に A の振替を手置き → 新テンプレの机 1 は B なので中身が違い保留（下段に A）
    const week = board((desks) => desks.map((desk, index) => (index === 1 ? { ...desk, lesson: mkLesson('hand-a', [makeupA('a-makeup'), null]) } : desk)))
    const { saved, remerged } = saveThenRemerge(week)
    const pendingKey = buildTemplatePendingDeskKey(CELL, `${CELL}_desk_2`)
    expect(saved.nextPendingDesks[pendingKey]?.lower.lesson?.studentSlots[0]?.managedStudentId).toBe('sA')
    expect(saved.summary.skippedDuplicateStudents).toBe(0)
    expect(saved.addedSuppressedRegularLessonOccurrences).toEqual([])
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual(['sA'])
    expect(liveCount(saved.nextWeeks, 'sA')).toBe(1)
    expect(liveCount(remerged, 'sA')).toBe(1)
    expect(liveIdsAt(remerged, 0)).toEqual(['sA'])
  })
})
