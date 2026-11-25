// 提出用QRへ載せる「組まれたコマ」(日程公開・オーナー確定 2026-11-03)。
import { describe, expect, it } from 'vitest'
import { buildSubmissionOccupiedSlotMaps, type SubmissionOccupiedSlotCell } from './submissionOccupiedSlots'

const student = (id: string, lessonType: string, subject: string) => ({ id: `entry-${id}-${lessonType}`, managedStudentId: id, lessonType, subject })

const cells: SubmissionOccupiedSlotCell[] = [
  // 12/24 1限: 講習の生徒だけの机(講師 A)と、通常の生徒だけの机(講師 B)。
  { dateKey: '2026-12-24', slotNumber: 1, desks: [
    { teacher: '講師A', lesson: { studentSlots: [student('s001', 'special', '数'), student('s002', 'special', '英')] } },
    { teacher: '講師B', lesson: { studentSlots: [student('s003', 'regular', '英'), null] } },
  ] },
  // 12/24 2限: 講習と振替が同じ机(講師 A)。1 人目が講習。
  { dateKey: '2026-12-24', slotNumber: 2, desks: [
    { teacher: '講師A', lesson: { studentSlots: [student('s001', 'special', '国'), student('s004', 'makeup', '数')] } },
    { teacher: '名簿にない講師', lesson: { studentSlots: [student('s005', 'extra', '理'), null] } },
    { teacher: '講師B' },
  ] },
]
const teacherIds: Record<string, string> = { 講師A: 't001', 講師B: 't002' }
const resolveTeacherId = (name: string) => teacherIds[name] ?? null
const toObject = (map: Map<string, Record<string, string>>) => Object.fromEntries(map)

describe('buildSubmissionOccupiedSlotMaps', () => {
  it('公開(includeLectureLessons=true)は切り出し前と同じ: 生徒は種別1文字+科目、講師は机の1人目の種別', () => {
    const { studentOccupiedMap, teacherOccupiedMap } = buildSubmissionOccupiedSlotMaps({ cells, resolveTeacherId, includeLectureLessons: true })
    expect(toObject(studentOccupiedMap)).toEqual({
      s001: { '2026-12-24_1': '講数', '2026-12-24_2': '講国' },
      s002: { '2026-12-24_1': '講英' },
      s003: { '2026-12-24_1': '通英' },
      s004: { '2026-12-24_2': '振数' },
      s005: { '2026-12-24_2': '増理' },
    })
    expect(toObject(teacherOccupiedMap)).toEqual({
      t001: { '2026-12-24_1': '講習', '2026-12-24_2': '講習' },
      t002: { '2026-12-24_1': '通常' },
    })
  })

  it('非公開(includeLectureLessons=false)は講習コマを載せない。通常・振替・増コマは残す', () => {
    const { studentOccupiedMap, teacherOccupiedMap } = buildSubmissionOccupiedSlotMaps({ cells, resolveTeacherId, includeLectureLessons: false })
    expect(toObject(studentOccupiedMap)).toEqual({
      s003: { '2026-12-24_1': '通英' },
      s004: { '2026-12-24_2': '振数' },
      s005: { '2026-12-24_2': '増理' },
    })
    // 講習の生徒しかいない机(12/24 1限 講師A)は載せない。講習と振替の机は振替でラベルを付ける。
    expect(toObject(teacherOccupiedMap)).toEqual({
      t001: { '2026-12-24_2': '振替' },
      t002: { '2026-12-24_1': '通常' },
    })
    expect(JSON.stringify(toObject(studentOccupiedMap))).not.toContain('講')
  })

  describe('生徒1が休みで生徒2が授業を受ける机(講師ラベルは席順で最初にいる生徒)', () => {
    const deskCells = (slots: SubmissionOccupiedSlotCell['desks'][number]['lesson']): SubmissionOccupiedSlotCell[] => [
      { dateKey: '2026-12-26', slotNumber: 1, desks: [{ teacher: '講師A', lesson: slots }] },
    ]
    it.each([
      ['makeup', '振替'],
      ['regular', '通常'],
    ])('生徒1=null・生徒2=%s → 講師ラベル %s(公開・非公開とも)', (lessonType, label) => {
      for (const includeLectureLessons of [true, false]) {
        const { teacherOccupiedMap } = buildSubmissionOccupiedSlotMaps({
          cells: deskCells({ studentSlots: [null, student('s002', lessonType, '英')] }), resolveTeacherId, includeLectureLessons,
        })
        expect(toObject(teacherOccupiedMap)).toEqual({ t001: { '2026-12-26_1': label } })
      }
    })
    it('生徒1がいる机は従来どおり生徒1の種別', () => {
      const { teacherOccupiedMap } = buildSubmissionOccupiedSlotMaps({
        cells: deskCells({ studentSlots: [student('s001', 'regular', '英'), student('s002', 'makeup', '数')] }), resolveTeacherId, includeLectureLessons: true,
      })
      expect(toObject(teacherOccupiedMap)).toEqual({ t001: { '2026-12-26_1': '通常' } })
    })
    it('両席 null の机は載せない', () => {
      const { teacherOccupiedMap } = buildSubmissionOccupiedSlotMaps({
        cells: deskCells({ studentSlots: [null, null] }), resolveTeacherId, includeLectureLessons: true,
      })
      expect(toObject(teacherOccupiedMap)).toEqual({})
    })
    it('メモだけの机(生徒なし)は載せない(オーナー確定・今の仕様)', () => {
      const memoOnly = { studentSlots: [null, null], memoSlots: [{ text: 'メモ' }] } as unknown as NonNullable<SubmissionOccupiedSlotCell['desks'][number]['lesson']>
      const { teacherOccupiedMap } = buildSubmissionOccupiedSlotMaps({
        cells: deskCells(memoOnly), resolveTeacherId, includeLectureLessons: true,
      })
      expect(toObject(teacherOccupiedMap)).toEqual({})
    })
    it('机にメモだけある(授業なし)机は載せない(本番の形: memoSlots は机に付き lesson は無い)', () => {
      const memoDesk = { teacher: '講師A', memoSlots: [null, '手打ちの生徒'] } as unknown as SubmissionOccupiedSlotCell['desks'][number]
      const { teacherOccupiedMap } = buildSubmissionOccupiedSlotMaps({
        cells: [{ dateKey: '2026-12-26', slotNumber: 1, desks: [memoDesk] }], resolveTeacherId, includeLectureLessons: true,
      })
      expect(toObject(teacherOccupiedMap)).toEqual({})
    })
    it('生徒1=null・生徒2=講習 → 公開は「講習」、非公開は載せない', () => {
      const lesson = { studentSlots: [null, student('s002', 'special', '数')] }
      expect(toObject(buildSubmissionOccupiedSlotMaps({ cells: deskCells(lesson), resolveTeacherId, includeLectureLessons: true }).teacherOccupiedMap))
        .toEqual({ t001: { '2026-12-26_1': '講習' } })
      expect(toObject(buildSubmissionOccupiedSlotMaps({ cells: deskCells(lesson), resolveTeacherId, includeLectureLessons: false }).teacherOccupiedMap))
        .toEqual({})
    })
  })

  it('同じコマに 2 つあれば先勝ち(切り出し前と同じ)', () => {
    const doubled: SubmissionOccupiedSlotCell[] = [{ dateKey: '2026-12-25', slotNumber: 3, desks: [
      { teacher: '講師A', lesson: { studentSlots: [student('s001', 'regular', '英'), null] } },
      { teacher: '講師A', lesson: { studentSlots: [student('s001', 'makeup', '数'), null] } },
    ] }]
    const { studentOccupiedMap, teacherOccupiedMap } = buildSubmissionOccupiedSlotMaps({ cells: doubled, resolveTeacherId, includeLectureLessons: true })
    expect(studentOccupiedMap.get('s001')).toEqual({ '2026-12-25_3': '通英' })
    expect(teacherOccupiedMap.get('t001')).toEqual({ '2026-12-25_3': '通常' })
  })
})
