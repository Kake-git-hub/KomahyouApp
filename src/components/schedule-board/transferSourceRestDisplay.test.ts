// 振替元「休)」表示（オーナー確定 2026-09-16・機能フラグ transferSourceRestDisplay）の表示側ガード。
//
// D1: 「休)」は**表示ラベルだけ**。内部の記録種別(moved)と在庫会計は一切変えない(INV-06)。
//     したがってこのファイルが守るのは「どう見えるか」だけで、在庫の検証は
//     inv06-whole-day-transfer / inv06-holiday-record-retention / makeupStock のマトリクス側にある。
// 兄弟監査(盤面 ⇄ 配布用盤面 ⇄ 机選択モーダル): 同じ記録を別の画面が別のラベルで出すと、
//     室長と講師で認識がズレる。3 画面ぶんをここでまとめて固定する。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { getStudentStatusLabel } from './BoardGrid'
import { createBoardStudentStockIdResolver, toOutstandingMakeupOriginEntries, type MakeupStockEntry } from './makeupStock'
import { buildDeskPickerDesks } from '../schedule-view/scheduleViewMove'
import { featureRolloutRegistry, isFeatureEnabledForClassroom } from '../../utils/featureRollout'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { DeskCell, SlotCell, StudentStatusEntry } from './types'

describe('featureRollout: transferSourceRestDisplay（振替元「休)」表示）', () => {
  it('開発用/テスト教室でのみ有効（本番3教室では従来表示のまま）', () => {
    // 昇格(staging → 全教室)はオーナー確認後。ここを勝手に広げないこと。
    expect(featureRolloutRegistry.transferSourceRestDisplay.scope).toBe('development-only')
    expect(isFeatureEnabledForClassroom('transferSourceRestDisplay', { id: 'v8OZ7zH8vONNHjjYVcR1' }, 'main')).toBe(true)
    expect(isFeatureEnabledForClassroom('transferSourceRestDisplay', { id: 'test_classroom_20260507_dai' }, 'main')).toBe(true)
    for (const id of ['5w5OMueETerSKrSf14HC', 'KzFnOQoTFLsCxwUp1tvh', '6xnnbSTbwgGrBLy0EJKb']) {
      expect(isFeatureEnabledForClassroom('transferSourceRestDisplay', { id }, 'main'), id).toBe(false)
    }
    expect(isFeatureEnabledForClassroom('transferSourceRestDisplay', null, 'main')).toBe(false)
  })
})

describe('盤面の出欠ラベル（BoardGrid.getStudentStatusLabel）', () => {
  it('OFF: 移動元マーカーは従来どおり「移」', () => {
    expect(getStudentStatusLabel('moved')).toBe('移')
    expect(getStudentStatusLabel('moved', false)).toBe('移')
  })

  it('ON: 移動元マーカーは「休」（室長・講師から見れば「その日は休み」）', () => {
    expect(getStudentStatusLabel('moved', true)).toBe('休')
  })

  it('★休日記録(holiday)はフラグに依らず常に「休」', () => {
    expect(getStudentStatusLabel('holiday')).toBe('休')
    expect(getStudentStatusLabel('holiday', true)).toBe('休')
  })

  it('他の種別のラベルは ON/OFF どちらでも変わらない（表示の付け替えを広げない）', () => {
    for (const enabled of [false, true]) {
      expect(getStudentStatusLabel('attended', enabled)).toBe('出')
      expect(getStudentStatusLabel('absent', enabled)).toBe('休')
      expect(getStudentStatusLabel('absent-no-makeup', enabled)).toBe('振無休')
    }
  })
})

// 配布用盤面(公開ページ)は教室設定を読めないので、共有ドキュメントの classroomId で同じ判定をする。
// 盤面と判定式がズレると、同じ記録が盤面では「休」・配布用では「移」になる(講師が混乱する)。
describe('配布用盤面も盤面と同じラベル規則を使う（兄弟監査・字面固定）', () => {
  const BOARD_SHARE = readFileSync(fileURLToPath(new URL('../board-share/BoardShareScreen.tsx', import.meta.url)), 'utf8')

  it('同じ機能フラグを共有ドキュメントの教室IDで判定している', () => {
    expect(BOARD_SHARE).toContain("isFeatureEnabledForClassroom('transferSourceRestDisplay', { id: payload?.classroomId })")
  })

  it('moved はフラグ依存・holiday は常に「休」（盤面 BoardGrid と同じ分岐）', () => {
    expect(BOARD_SHARE).toContain("if (status === 'holiday') return '休'")
    expect(BOARD_SHARE).toContain("if (status === 'moved') return transferSourceRestDisplayEnabled ? '休' : '移'")
  })
})

describe('机選択モーダル（buildDeskPickerDesks）は表示専用の記録を占有扱いしない', () => {
  function statusEntry(status: StudentStatusEntry['status']): StudentStatusEntry {
    return {
      id: `status-${status}`,
      studentId: 'student-1',
      sourceManagedLesson: true,
      name: '大槻 太郎',
      managedStudentId: 'student-1',
      grade: '中1',
      subject: '数',
      lessonType: 'regular',
      teacherType: 'normal',
      teacherName: '田中講師',
      dateKey: '2026-08-05',
      slotNumber: 5,
      recordedAt: '2026-08-04T00:00:00.000Z',
      status,
      sourceLessonId: 'lesson-1',
    }
  }

  function cellWith(desk: DeskCell): SlotCell {
    return {
      id: '2026-08-05_5',
      dateKey: '2026-08-05',
      dayLabel: '水',
      dateLabel: '8/5',
      slotLabel: '5限',
      slotNumber: 5,
      timeLabel: '19:00-20:20',
      isOpenDay: true,
      desks: [desk],
    }
  }

  it('moved / holiday の席はラベルを出さず、選択可のままにする（空席として組める）', () => {
    for (const status of ['moved', 'holiday'] as const) {
      const seats = buildDeskPickerDesks(cellWith({
        id: 'desk-1',
        teacher: '田中講師',
        statusSlots: [statusEntry(status), null],
      }))[0]!.seats
      expect(seats[0]!.statusLabel, status).toBe('')
      expect(seats[0]!.selectable, status).toBe(true)
      expect(seats[0]!.occupied, status).toBe(false)
    }
  })

  it('比較: 休み・振無休は従来どおり名前つきで表示する（ガードを広げすぎていない）', () => {
    const seats = buildDeskPickerDesks(cellWith({
      id: 'desk-1',
      teacher: '田中講師',
      statusSlots: [statusEntry('absent'), statusEntry('absent-no-makeup')],
    }))[0]!.seats
    expect(seats[0]!.statusLabel).toBe('休 大槻 太郎')
    expect(seats[1]!.statusLabel).toBe('振無休 大槻 太郎')
  })
})

// 振替欄の「未定」判定に使う未消化 origin は、**盤面画面と App(別タブ同期)の両方**が同じ権威関数で作る。
// 盤面を閉じて基本データ画面へ移っても別タブは開いたまま更新されるため、App 側だけ渡し忘れると
// 「どちらの同期が最後に走ったか」で振替欄の表示が変わる(移動元マーカーが『未定』ではなく古い移動先を出す)。
describe('未消化 origin の射影(toOutstandingMakeupOriginEntries)と在庫キー解決の共有', () => {
  const stockEntry = (overrides: Partial<MakeupStockEntry> = {}): MakeupStockEntry => ({
    key: 'student-1__数',
    studentId: 'student-1',
    studentName: '大槻 太郎',
    displayName: '大槻',
    subject: '数',
    balance: 2,
    autoShortage: 0,
    absentMakeupOrigins: 0,
    manualAdjustments: 0,
    plannedMakeups: 0,
    totalLessonCount: 0,
    assignedRegularLessons: 0,
    assignedMakeupLessons: 0,
    overAssignedRegularLessons: 0,
    remainingOriginDates: ['2026-08-05', '2026-08-12'],
    remainingOriginSlots: [5, null],
    remainingOriginLabels: [],
    remainingOriginReasonLabels: [],
    nextOriginDate: '2026-08-05',
    nextOriginSlot: 5,
    nextOriginLabel: null,
    nextOriginReasonLabel: null,
    negativeReason: null,
    ...overrides,
  })

  it('残っている元コマを 1 件 1 行にし、時限不明は slotNumber を省く(照合でワイルドカードにする)', () => {
    expect(toOutstandingMakeupOriginEntries([stockEntry()])).toEqual([
      { studentKey: 'student-1', studentName: '大槻', subject: '数', dateKey: '2026-08-05', slotNumber: 5 },
      { studentKey: 'student-1', studentName: '大槻', subject: '数', dateKey: '2026-08-12' },
    ])
  })

  it('名簿外(studentId なし)は studentKey を空にし、表示名で照合させる', () => {
    expect(toOutstandingMakeupOriginEntries([stockEntry({ studentId: null, displayName: '体験 花子', remainingOriginDates: ['2026-08-05'], remainingOriginSlots: [1] })]))
      .toEqual([{ studentKey: '', studentName: '体験 花子', subject: '数', dateKey: '2026-08-05', slotNumber: 1 }])
  })

  // ★在庫キーがズレると同じ生徒の在庫が別人扱いで分裂する。盤面の resolveBoardStudentStockId と同じ式。
  it('在庫キー解決は 登録名/表示名のどちらからも名簿を引き、名簿外は name:表示名(手動追加は manual: 前置)', () => {
    const students = [{ id: 'student-1', name: '大槻 太郎', displayName: '大槻' } as StudentRow]
    const resolve = createBoardStudentStockIdResolver(students)
    expect(resolve({ managedStudentId: 'student-1', name: 'なんでも' })).toBe('student-1')
    expect(resolve({ name: '大槻 太郎' })).toBe('student-1')
    expect(resolve({ name: '大槻' })).toBe('student-1')
    expect(resolve({ name: '名簿外 花子' })).toBe('name:名簿外 花子')
    expect(resolve({ name: '名簿外 花子', manualAdded: true })).toBe('manual:name:名簿外 花子')
  })
})

// 字面ガード(描画テスト環境が無いので wiring テストの作法に合わせる)。
describe('別タブ日程表の同期は 2 経路とも未消化 origin を渡す(兄弟監査)', () => {
  const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')
  const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')

  it('盤面画面は権威関数の射影をそのまま渡す(自前で組み直さない)', () => {
    expect(BOARD_TSX).toContain('toOutstandingMakeupOriginEntries(rawMakeupStockEntries)')
    expect(BOARD_TSX).toContain('outstandingMakeupOrigins: outstandingMakeupOriginEntries,')
  })

  it('App(盤面を閉じていても走る経路)も同じ権威関数で作って渡す', () => {
    expect(APP_TSX).toContain('toOutstandingMakeupOriginEntries(buildMakeupStockEntries({')
    expect(APP_TSX).toContain('resolveStudentKey: createBoardStudentStockIdResolver(students),')
    expect(APP_TSX).toContain('outstandingMakeupOrigins: buildPopupOutstandingMakeupOrigins(),')
  })

  it('盤面の在庫キー解決は共有関数と同じ式のまま(片方だけ変えるとキーが割れる)', () => {
    expect(BOARD_TSX).toContain('const managedId = student.managedStudentId ?? managedStudentByAnyName.get(student.name)?.id')
    expect(BOARD_TSX).toContain('return student.manualAdded ? `manual:${fallbackId}` : fallbackId')
  })
})
