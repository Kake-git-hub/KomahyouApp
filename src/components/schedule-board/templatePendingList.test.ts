// 保留（2 行・緑）の机の週をまたいだ一覧の回帰防止テスト（決定記録 48 §3・spec-template-behavior §H Q42-6）。
//
// 固定すること:
//   - 行数はバッジの件数（countTemplatePendingDesksOnBoard）と同じ（孤児キー・机の無いキー・反映日より前は出さない）
//   - 週をまたいで日付 → 時限 → 机の順に並ぶ
//   - 下段の生徒・記録・手置き講師と上段の生徒、由来の見出しと理由文（origin の無い保留はテンプレ保存の既定文）
//   - 「このコマへ」に使う机の並び順（deskIndex）
//   - 入力（保留マップ・週データ）を変えない

import { describe, expect, it } from 'vitest'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import { countTemplatePendingDesksOnBoard } from './templatePendingResolution'
import { buildTemplatePendingList, describeTemplatePendingTeacherReason, TEMPLATE_SAVE_PENDING_KIND_LABEL, TEMPLATE_SAVE_PENDING_REASON } from './templatePendingList'

function student(id: string, name: string, subject: StudentEntry['subject'] = '数', lessonType: StudentEntry['lessonType'] = 'regular'): StudentEntry {
  return { id, name, grade: '中1', subject, lessonType, teacherType: 'normal' }
}

function desk(id: string, students: [StudentEntry | null, StudentEntry | null] = [null, null]): DeskCell {
  return { id, teacher: '講師A', ...(students[0] || students[1] ? { lesson: { id: `${id}_lesson`, studentSlots: students } } : {}) }
}

function cell(dateKey: string, slotNumber: number, desks: DeskCell[]): SlotCell {
  const [, month, day] = dateKey.split('-')
  return {
    id: `${dateKey}_${slotNumber}`,
    dateKey,
    dayLabel: '水',
    dateLabel: `${Number(month)}/${Number(day)}`,
    slotLabel: `${slotNumber}限`,
    slotNumber,
    timeLabel: '',
    isOpenDay: true,
    desks,
  }
}

function status(name: string, kind: StudentStatusEntry['status']): StudentStatusEntry {
  return {
    id: `status_${name}`,
    studentId: `sid_${name}`,
    name,
    grade: '中1',
    subject: '英',
    lessonType: 'regular',
    teacherType: 'normal',
    teacherName: '講師A',
    dateKey: '2026-10-07',
    slotNumber: 5,
    recordedAt: '2026-10-01T00:00:00.000Z',
    status: kind,
    sourceLessonId: 'lesson_src',
    sourceManagedLesson: true,
  }
}

const WEEK1 = [
  cell('2026-10-07', 5, [desk('2026-10-07_5_desk_1', [student('s1', '上段一'), student('s2', '上段二')]), desk('2026-10-07_5_desk_2')]),
  cell('2026-10-07', 3, [desk('2026-10-07_3_desk_1', [student('s3', '上段三'), null])]),
]
const WEEK2 = [
  cell('2026-10-14', 2, [desk('2026-10-14_2_desk_1', [student('s4', '上段四', '英'), null]), desk('2026-10-14_2_desk_2', [student('s5', '上段五'), null])]),
]
const WEEKS = [WEEK1, WEEK2]

const CREATED_AT = '2026-10-01T00:00:00.000Z'

const MAP: TemplatePendingDeskMap = {
  // 2 週目（並べ替えで最後に来る）・丸ごと振替の押し出し・2 机目
  [buildTemplatePendingDeskKey('2026-10-14_2', '2026-10-14_2_desk_2')]: {
    lower: { lesson: { id: 'l1', studentSlots: [student('t1', '体験生', '英', 'trial'), null] } },
    effectiveStartDate: '2026-10-14',
    createdAt: CREATED_AT,
    origin: { kind: 'whole-day-transfer-displaced', note: '丸ごと振替(10/13 → 10/14)で振替先に置いていた授業に空き席が無かったため、保留(下段)に残しました。' },
  },
  // 1 週目の 5 限・テンプレ保存の保留（origin なし）・記録と手置き講師
  [buildTemplatePendingDeskKey('2026-10-07_5', '2026-10-07_5_desk_1')]: {
    lower: { lesson: { id: 'l2', studentSlots: [student('m1', '手入力生'), null] }, statusSlots: [null, status('休み生', 'absent')], teacher: { teacher: '手置き講師', manualTeacher: true } },
    effectiveStartDate: '2026-10-07',
    createdAt: CREATED_AT,
  },
  // 1 週目の 3 限・時限変更の追従の満席（5 限より前に並ぶ）
  [buildTemplatePendingDeskKey('2026-10-07_3', '2026-10-07_3_desk_1')]: {
    lower: { lesson: { id: 'l3', studentSlots: [null, student('f1', '追従生', '英', 'makeup')] } },
    effectiveStartDate: '2026-10-07',
    createdAt: CREATED_AT,
    origin: { kind: 'slot-follow-full', note: '時限変更の追従で新しい時限が満席だったため、保留(下段)に置きました。' },
  },
  // 除外: 盤面に無いセル（孤児キー）
  [buildTemplatePendingDeskKey('2026-12-02_5', '2026-12-02_5_desk_1')]: {
    lower: { lesson: { id: 'l4', studentSlots: [student('o1', '孤児'), null] } },
    effectiveStartDate: '2026-12-02',
    createdAt: CREATED_AT,
  },
  // 除外: セルはあるがその机が無い
  [buildTemplatePendingDeskKey('2026-10-07_5', '2026-10-07_5_desk_9')]: {
    lower: { lesson: { id: 'l5', studentSlots: [student('o2', '机なし'), null] } },
    effectiveStartDate: '2026-10-07',
    createdAt: CREATED_AT,
  },
  // 除外: 反映日より前のセル
  [buildTemplatePendingDeskKey('2026-10-07_5', '2026-10-07_5_desk_2')]: {
    lower: { lesson: { id: 'l6', studentSlots: [student('o3', '反映日前'), null] } },
    effectiveStartDate: '2026-10-08',
    createdAt: CREATED_AT,
  },
}

describe('buildTemplatePendingList（保留の机の週をまたいだ一覧・決定記録 48 §3）', () => {
  it('行数はバッジの件数と同じ（孤児キー・机の無いキー・反映日より前は出さない）', () => {
    const rows = buildTemplatePendingList(MAP, WEEKS)
    expect(rows).toHaveLength(3)
    expect(rows).toHaveLength(countTemplatePendingDesksOnBoard(MAP, WEEKS))
    expect(rows.map((row) => row.lowerLabels.join('/'))).not.toContain('孤児（数）')
  })

  it('週をまたいで日付 → 時限 → 机の順に並ぶ', () => {
    const rows = buildTemplatePendingList(MAP, WEEKS)
    expect(rows.map((row) => `${row.dateKey}_${row.slotNumber}_${row.deskIndex}`)).toEqual([
      '2026-10-07_3_0',
      '2026-10-07_5_0',
      '2026-10-14_2_1',
    ])
  })

  it('下段の生徒・記録・手置き講師、上段の生徒、由来と理由文を持つ（origin の無い保留はテンプレ保存の既定文）', () => {
    const [follow, templateSave, displaced] = buildTemplatePendingList(MAP, WEEKS)
    expect(templateSave).toMatchObject({
      cellId: '2026-10-07_5',
      deskId: '2026-10-07_5_desk_1',
      deskIndex: 0,
      dateLabel: '10/7',
      slotLabel: '5限',
      lowerLabels: ['手入力生（数）', '休み生（欠席）', '講師 手置き講師'],
      // tp-64（2026-10-27）: 講師の保留は上の行の講師も並べ、理由文に講師の選び方を足す
      upperLabels: ['上段一（数）', '上段二（数）', '講師 講師A'],
      kindLabel: TEMPLATE_SAVE_PENDING_KIND_LABEL,
      reason: `${TEMPLATE_SAVE_PENDING_REASON}${describeTemplatePendingTeacherReason('講師A', '手置き講師')}`,
    })
    expect(follow).toMatchObject({ lowerLabels: ['追従生（英）'], upperLabels: ['上段三（数）'], kindLabel: '時限変更の追従', reason: '時限変更の追従で新しい時限が満席だったため、保留(下段)に置きました。' })
    expect(displaced).toMatchObject({ deskId: '2026-10-14_2_desk_2', deskIndex: 1, lowerLabels: ['体験生（英）'], upperLabels: ['上段五（数）'], kindLabel: '丸ごと振替' })
    expect(displaced.reason).toContain('丸ごと振替(10/13 → 10/14)')
  })

  it('講師だけが残った保留（生徒の側は片づき済み・tp-64）も行に出て、理由は講師の選び方だけ', () => {
    const key = buildTemplatePendingDeskKey('2026-10-07_5', '2026-10-07_5_desk_1')
    const rows = buildTemplatePendingList({ [key]: { lower: { teacher: { teacher: '手置き講師', manualTeacher: true } }, effectiveStartDate: '2026-10-07', createdAt: CREATED_AT } }, WEEKS)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ lowerLabels: ['講師 手置き講師'], upperLabels: ['上段一（数）', '上段二（数）', '講師 講師A'], kindLabel: TEMPLATE_SAVE_PENDING_KIND_LABEL })
    expect(rows[0].reason).toBe(describeTemplatePendingTeacherReason('講師A', '手置き講師'))
    expect(rows[0].reason).toContain('緑の下の行の講師を押して')
  })

  it('由来の種別ごとに見出しが決まる（振替先が満席・休日解除）', () => {
    const key = buildTemplatePendingDeskKey('2026-10-14_2', '2026-10-14_2_desk_1')
    const base = { lower: { lesson: { id: 'l', studentSlots: [student('x', '生徒X'), null] as [StudentEntry | null, StudentEntry | null] } }, effectiveStartDate: '2026-10-14', createdAt: CREATED_AT }
    expect(buildTemplatePendingList({ [key]: { ...base, origin: { kind: 'transfer-follow-full', note: 'n' } } }, WEEKS)[0].kindLabel).toBe('振替先が満席')
    expect(buildTemplatePendingList({ [key]: { ...base, origin: { kind: 'holiday-release-seat-taken', note: 'n' } } }, WEEKS)[0].kindLabel).toBe('休日解除')
    // 理由文が空の origin は既定文に落ちる（見出しは種別のまま）
    const empty = buildTemplatePendingList({ [key]: { ...base, origin: { kind: 'holiday-release-seat-taken', note: '' } } }, WEEKS)[0]
    expect(empty.kindLabel).toBe('休日解除')
    expect(empty.reason).toBe(TEMPLATE_SAVE_PENDING_REASON)
  })

  it('下段のメモは「メモ:内容」で出る（2026-10-27・丸ごと振替の振替先のメモ／テンプレ保存のメモ。メモだけの席も中身が分かる）', () => {
    const key = buildTemplatePendingDeskKey('2026-10-14_2', '2026-10-14_2_desk_1')
    const rows = buildTemplatePendingList({
      [key]: { lower: { memoSlots: [null, '20分\n遅刻'] }, effectiveStartDate: '2026-10-14', createdAt: CREATED_AT, origin: { kind: 'whole-day-transfer-displaced', note: 'n' } },
    }, WEEKS)
    expect(rows).toHaveLength(1)
    expect(rows[0].lowerLabels).toEqual(['メモ:20分 遅刻'])
    // 空白だけのメモは出さない。
    expect(buildTemplatePendingList({ [key]: { lower: { memoSlots: ['  ', null] }, effectiveStartDate: '2026-10-14', createdAt: CREATED_AT } }, WEEKS)[0].lowerLabels).toEqual([])
  })

  it('保留が無ければ空・入力（保留マップ・週データ）を変えない', () => {
    expect(buildTemplatePendingList(null, WEEKS)).toEqual([])
    expect(buildTemplatePendingList({}, WEEKS)).toEqual([])
    const mapBefore = JSON.stringify(MAP)
    const weeksBefore = JSON.stringify(WEEKS)
    buildTemplatePendingList(MAP, WEEKS)
    expect(JSON.stringify(MAP)).toBe(mapBefore)
    expect(JSON.stringify(WEEKS)).toBe(weeksBefore)
  })
})
