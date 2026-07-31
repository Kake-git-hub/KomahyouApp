import { describe, expect, it } from 'vitest'
import { compactBoardSharePayload, isExternalBoardShareStudent, normalizeExternalStudentIds, type BoardShareStudentEntry } from '../../integrations/firebase/boardShare'
import { formatStudentLabel, getLessonTypeLabel } from './BoardShareScreen'
import type { LessonType } from '../schedule-board/types'

function createShareStudent(overrides: Partial<BoardShareStudentEntry> = {}): BoardShareStudentEntry {
  return {
    id: 'slot-1',
    name: '山田太郎',
    managedStudentId: 'student-1',
    grade: '中2',
    noteSuffix: '',
    makeupSourceDate: undefined,
    makeupSourceLabel: undefined,
    subject: '英',
    lessonType: 'regular',
    teacherType: 'normal',
    ...overrides,
  }
}

const allLessonTypes: LessonType[] = ['regular', 'makeup', 'special', 'extra', 'trial']

// 配布用盤面(共有URL)の外部生表示。盤面と同じく「表示だけ 外) に置き換える」規則。
describe('配布用盤面の外部生ID', () => {
  // 旧ドキュメントには externalStudentIds が無い。空集合=全員通常表示に倒す(後方互換)。
  it('reads legacy/broken documents as an empty list', () => {
    expect(normalizeExternalStudentIds(undefined)).toEqual([])
    expect(normalizeExternalStudentIds(null)).toEqual([])
    expect(normalizeExternalStudentIds('student-1')).toEqual([])
    expect(normalizeExternalStudentIds([1, null, '', '   '])).toEqual([])
  })

  // 公開時の署名比較が並び順で揺れないよう、重複を落として整列する。
  it('dedupes and sorts the ids', () => {
    expect(normalizeExternalStudentIds(['b', 'a', 'b'])).toEqual(['a', 'b'])
  })

  // compact 化(セルの間引き)で外部生IDを落とさない。落とすと共有画面が 通)/振) のまま取り残される。
  it('survives compactBoardSharePayload', () => {
    const compacted = compactBoardSharePayload({
      schemaVersion: 1,
      token: 'token-1',
      classroomId: 'classroom-1',
      classroomName: '教室',
      sharedAt: '',
      cells: [],
      externalStudentIds: ['student-1'],
    })
    expect(compacted.externalStudentIds).toEqual(['student-1'])
  })

  it('matches students by managedStudentId only', () => {
    const externalIds = new Set(['student-1'])
    expect(isExternalBoardShareStudent(externalIds, createShareStudent())).toBe(true)
    expect(isExternalBoardShareStudent(externalIds, createShareStudent({ managedStudentId: 'student-2' }))).toBe(false)
    // 体験生・メモなど名簿外(managedStudentId なし)は常に通常表示。
    expect(isExternalBoardShareStudent(externalIds, createShareStudent({ managedStudentId: undefined }))).toBe(false)
    expect(isExternalBoardShareStudent(externalIds, null)).toBe(false)
    expect(isExternalBoardShareStudent(new Set<string>(), createShareStudent())).toBe(false)
  })
})

describe('配布用盤面の授業区分表記', () => {
  it('keeps the existing labels for internal students', () => {
    expect(formatStudentLabel(createShareStudent({ lessonType: 'regular' }))).toContain('通) 山田太郎')
    expect(formatStudentLabel(createShareStudent({ lessonType: 'makeup' }))).toContain('振) 山田太郎')
    expect(formatStudentLabel(createShareStudent({ lessonType: 'special' }))).toContain('講) 山田太郎')
    expect(getLessonTypeLabel('regular')).toBe('通常')
    expect(getLessonTypeLabel('makeup')).toBe('振替')
  })

  // 修正なしでは 通)/振)/講) がそのまま出て落ちる回帰防止テスト。
  it('shows 外) for every lesson type when the student is external', () => {
    for (const lessonType of allLessonTypes) {
      expect(formatStudentLabel(createShareStudent({ lessonType }), true)).toContain('外) 山田太郎')
      expect(getLessonTypeLabel(lessonType, true)).toBe('外部生')
    }
  })

  // 授業時間(60分など)や学年は外部生でも従来どおり出す(消してはいけない)。
  it('keeps grade, subject and minutes for external students', () => {
    const label = formatStudentLabel(createShareStudent({ noteSuffix: '60' }), true)
    expect(label).toBe('外) 山田太郎 / 中2 / 英60')
  })
})
