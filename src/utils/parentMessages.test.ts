import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { StudentRow } from '../components/basic-data/basicDataModel'
import {
  PARENT_MESSAGE_SENDER_FALLBACK,
  PARENT_MESSAGE_SENDER_UNVERIFIED_NOTE,
  PARENT_MESSAGE_STUDENT_NAME_FALLBACK,
  PARENT_MESSAGE_URL_WARNING,
  buildParentMessageNotifications,
  chunkParentMessageIds,
  PARENT_MESSAGE_MARK_NOTIFIED_CHUNK_SIZE,
  mergeParentMessageNotifications,
  parseParentMessageEntry,
  selectUnnotifiedParentMessages,
  type ParentMessageEntry,
  type ParentMessageNotification,
} from './parentMessages'

// docs/spec-parent-portal.md §E-2「室長への通知(三点セット)」の選別・組み立て・重複排除(純関数)。
function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return { id: 's001', name: '青木 太郎', displayName: '青木', email: '', entryDate: '2026-04-01', withdrawDate: '未定', birthDate: '2012-05-01', ...overrides }
}

function createEntry(overrides: Partial<ParentMessageEntry> = {}): ParentMessageEntry {
  return {
    id: 'm1',
    classroomId: 'dev',
    studentId: 's001',
    studentName: '青木(送信時)',
    body: '明日は欠席します',
    senderName: '青木母',
    createdAt: '2026-09-13T01:00:00.000Z',
    notifiedAt: null,
    containsUrl: false,
    ...overrides,
  }
}

describe('parseParentMessageEntry', () => {
  it('Firestore doc を ParentMessageEntry に読み替える(notifiedAt 未設定は null・containsUrl は true のみ真)', () => {
    const entry = parseParentMessageEntry('m1', { classroomId: 'dev', studentId: 's001', studentName: '青木', body: 'x', senderName: '母', createdAt: '2026-09-13T01:00:00.000Z' })
    expect(entry).toEqual({ id: 'm1', classroomId: 'dev', studentId: 's001', studentName: '青木', body: 'x', senderName: '母', createdAt: '2026-09-13T01:00:00.000Z', notifiedAt: null, containsUrl: false })
    expect(parseParentMessageEntry('m2', { classroomId: 'dev', studentId: 's001', body: 'x', createdAt: 'c', notifiedAt: '2026-09-13T02:00:00.000Z', containsUrl: true })).toMatchObject({ notifiedAt: '2026-09-13T02:00:00.000Z', containsUrl: true })
    expect(parseParentMessageEntry('m3', { classroomId: 'dev', studentId: 's001', body: 'x', createdAt: 'c', notifiedAt: null, containsUrl: 'yes' })).toMatchObject({ notifiedAt: null, containsUrl: false })
  })
  it('必須項目(classroomId/studentId/createdAt)が無い・型が崩れた doc は null', () => {
    expect(parseParentMessageEntry('m1', null)).toBeNull()
    expect(parseParentMessageEntry('m1', 'text')).toBeNull()
    expect(parseParentMessageEntry('', { classroomId: 'dev', studentId: 's001', createdAt: 'c' })).toBeNull()
    expect(parseParentMessageEntry('m1', { studentId: 's001', createdAt: 'c' })).toBeNull()
    expect(parseParentMessageEntry('m1', { classroomId: 'dev', createdAt: 'c' })).toBeNull()
    expect(parseParentMessageEntry('m1', { classroomId: 'dev', studentId: 's001' })).toBeNull()
    expect(parseParentMessageEntry('m1', { classroomId: 123, studentId: 's001', createdAt: 'c' })).toBeNull()
  })
  it('本文が空でも(サーバー検証で通らないはずだが)落とさずに空文字で保つ', () => {
    expect(parseParentMessageEntry('m1', { classroomId: 'dev', studentId: 's001', createdAt: 'c' })?.body).toBe('')
  })
})

describe('selectUnnotifiedParentMessages', () => {
  it('notifiedAt が null/空の連絡だけ残し、既読済みは落とす(再通知しない)', () => {
    const entries = [
      createEntry({ id: 'a', notifiedAt: null }),
      createEntry({ id: 'b', notifiedAt: '2026-09-13T02:00:00.000Z' }),
      createEntry({ id: 'c', notifiedAt: '' as unknown as null }),
    ]
    expect(selectUnnotifiedParentMessages(entries).map((entry) => entry.id)).toEqual(['a', 'c'])
  })
  it('入力の順序を保ち、入力配列を破壊しない', () => {
    const entries = [createEntry({ id: 'z' }), createEntry({ id: 'a' })]
    expect(selectUnnotifiedParentMessages(entries).map((entry) => entry.id)).toEqual(['z', 'a'])
    expect(entries).toHaveLength(2)
  })
})

describe('buildParentMessageNotifications', () => {
  it('生徒名は名簿の現在名(表示名)を優先し、教室名を付ける', () => {
    const [notification] = buildParentMessageNotifications([createEntry()], { students: [createStudent({ displayName: '青木(改名後)' })], classroomName: '開発用教室' })
    expect(notification).toEqual({
      id: 'm1',
      studentName: '青木(改名後)',
      senderName: '青木母',
      body: '明日は欠席します',
      createdAt: '2026-09-13T01:00:00.000Z',
      containsUrl: false,
      classroomName: '開発用教室',
    })
  })
  it('名簿の表示名が空なら氏名の先頭語(getStudentDisplayName と同じ規則)', () => {
    const [notification] = buildParentMessageNotifications([createEntry()], { students: [createStudent({ displayName: '' })] })
    expect(notification!.studentName).toBe('青木')
  })
  it('名簿に居ない生徒(削除済み)は doc の studentName、それも空なら固定文言', () => {
    const [gone, unknown] = buildParentMessageNotifications(
      [createEntry({ id: 'a', studentId: 's999' }), createEntry({ id: 'b', studentId: 's998', studentName: '  ' })],
      { students: [createStudent()] },
    )
    expect(gone!.studentName).toBe('青木(送信時)')
    expect(unknown!.studentName).toBe(PARENT_MESSAGE_STUDENT_NAME_FALLBACK)
  })
  it('同名の別生徒が名簿に居ても studentId で引く(名前一致で混同しない)', () => {
    const students = [createStudent({ id: 's001', name: '青木 太郎', displayName: '青木' }), createStudent({ id: 's002', name: '青木 次郎', displayName: '青木' })]
    const [notification] = buildParentMessageNotifications([createEntry({ studentId: 's002' })], { students })
    expect(notification!.studentName).toBe('青木')
    // 名簿の重複 id は先勝ち(後続で上書きしない)
    const dup = [createStudent({ id: 's001', displayName: '先' }), createStudent({ id: 's001', displayName: '後' })]
    expect(buildParentMessageNotifications([createEntry()], { students: dup })[0]!.studentName).toBe('先')
  })
  it('送信者名が空(任意項目)なら固定文言、教室名未指定なら空文字、containsUrl はそのまま通す', () => {
    const [notification] = buildParentMessageNotifications([createEntry({ senderName: '', containsUrl: true })], { students: [], classroomName: null })
    expect(notification!.senderName).toBe(PARENT_MESSAGE_SENDER_FALLBACK)
    expect(notification!.classroomName).toBe('')
    expect(notification!.containsUrl).toBe(true)
  })
  it('内部 ID(studentId / classroomId)を表示データに持ち込まない', () => {
    const [notification] = buildParentMessageNotifications([createEntry()], { students: [createStudent()] })
    expect(Object.keys(notification!).sort()).toEqual(['body', 'classroomName', 'containsUrl', 'createdAt', 'id', 'senderName', 'studentName'])
    expect(JSON.stringify(notification)).not.toContain('s001')
  })
})

describe('mergeParentMessageNotifications', () => {
  function createNotification(overrides: Partial<ParentMessageNotification> = {}): ParentMessageNotification {
    return { id: 'n1', studentName: '青木', senderName: '母', body: 'x', createdAt: '2026-09-13T01:00:00.000Z', containsUrl: false, classroomName: '', ...overrides }
  }
  it('id 重複は新着で置き換え、createdAt 昇順に並べる', () => {
    const current = [createNotification({ id: 'b', createdAt: '2026-09-13T02:00:00.000Z', body: '旧' }), createNotification({ id: 'a', createdAt: '2026-09-13T01:00:00.000Z' })]
    const incoming = [createNotification({ id: 'c', createdAt: '2026-09-13T00:30:00.000Z' }), createNotification({ id: 'b', createdAt: '2026-09-13T02:00:00.000Z', body: '新' })]
    const merged = mergeParentMessageNotifications(current, incoming)
    expect(merged.map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(merged.find((item) => item.id === 'b')!.body).toBe('新')
    expect(merged).toHaveLength(3)
  })
  it('同時刻は id 順で安定し、入力配列を破壊しない', () => {
    const current = [createNotification({ id: 'y' }), createNotification({ id: 'x' })]
    const merged = mergeParentMessageNotifications(current, [])
    expect(merged.map((item) => item.id)).toEqual(['x', 'y'])
    expect(current.map((item) => item.id)).toEqual(['y', 'x'])
    expect(mergeParentMessageNotifications([], [])).toEqual([])
  })
})

// 既読化 callable は 1 回 50 件まで。分割しないと未読 51 件で「すべて確認」が丸ごと失敗し、
// 全画面モーダルが毎起動で残る(レビュー指摘 2026-09-13)。
describe('chunkParentMessageIds(既読化の分割)', () => {
  it('50 件ごとに分け、端数も 1 つのまとまりにする', () => {
    const ids = Array.from({ length: 51 }, (_, index) => `m${index}`)
    const chunks = chunkParentMessageIds(ids)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(PARENT_MESSAGE_MARK_NOTIFIED_CHUNK_SIZE)
    expect(chunks[1]).toEqual(['m50'])
    expect(chunks.flat()).toEqual(ids)
  })

  it('上限以内は 1 つ・空なら空(callable を呼ばない)', () => {
    expect(chunkParentMessageIds(['a', 'b'])).toEqual([['a', 'b']])
    expect(chunkParentMessageIds([])).toEqual([])
    expect(chunkParentMessageIds(Array.from({ length: 50 }, (_, i) => `m${i}`))).toHaveLength(1)
  })

  it('サーバーの上限(50)を超える値にしない', () => {
    expect(PARENT_MESSAGE_MARK_NOTIFIED_CHUNK_SIZE).toBeLessThanOrEqual(50)
    const serverSource = readFileSync(fileURLToPath(new URL('../../functions/src/parentPortal.ts', import.meta.url)), 'utf8')
    expect(serverSource).toContain('PARENT_MESSAGE_MARK_NOTIFIED_MAX_IDS = 50')
  })
})

describe('定型文言', () => {
  it('なりすまし注記とリンク警告の文言(§E-2)を固定する', () => {
    expect(PARENT_MESSAGE_SENDER_UNVERIFIED_NOTE).toBe('送信者は本人確認をしていません')
    expect(PARENT_MESSAGE_URL_WARNING).toBe('リンクが含まれています。開く前にご確認ください')
  })
})
