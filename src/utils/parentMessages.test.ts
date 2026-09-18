import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { StudentRow } from '../components/basic-data/basicDataModel'
import {
  PARENT_CONTACT_HISTORY_CONFIRMED_LIMIT,
  buildParentContactHistory,
  mergeParentMessageEntries,
  PARENT_ABSENCE_CHOICES,
  PARENT_MESSAGE_STUDENT_NAME_FALLBACK,
  addPendingParentAbsenceFinalize,
  buildParentAbsenceUnsavedNote,
  buildParentMessageNotifications,
  chunkParentMessageIds,
  formatParentAbsenceLessonLabel,
  PARENT_MESSAGE_MARK_NOTIFIED_CHUNK_SIZE,
  mergeParentMessageNotifications,
  parseParentMessageEntry,
  selectParentMessagesForClassroom,
  selectUnnotifiedParentMessages,
  splitPendingParentAbsenceFinalize,
  type ParentAbsenceDetail,
  type ParentMessageEntry,
  type ParentMessageNotification,
  type PendingParentAbsenceFinalize,
} from './parentMessages'

// docs/spec-parent-portal.md §0-5・§E-2「室長への通知」の選別・組み立て・重複排除・保存待ちの管理(純関数)。
function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return { id: 's001', name: '青木 太郎', displayName: '青木', email: '', entryDate: '2026-04-01', withdrawDate: '未定', birthDate: '2012-05-01', ...overrides }
}

const ABSENCE: ParentAbsenceDetail = { dateKey: '2026-09-20', slotNumber: 3, subject: '英', lessonKind: 'regular', isTentative: false }

function createEntry(overrides: Partial<ParentMessageEntry> = {}): ParentMessageEntry {
  return {
    id: 'm1',
    classroomId: 'dev',
    studentId: 's001',
    studentName: '青木(送信時)',
    absence: ABSENCE,
    createdAt: '2026-09-13T01:00:00.000Z',
    acknowledgedAt: null,
    resolution: null,
    notifiedAt: null,
    ...overrides,
  }
}

function createDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { classroomId: 'dev', studentId: 's001', studentName: '青木', kind: 'absence', absence: { ...ABSENCE }, createdAt: '2026-09-13T01:00:00.000Z', ...overrides }
}

describe('parseParentMessageEntry', () => {
  it('休み連絡の doc を ParentMessageEntry に読み替える(時刻の未設定は null・resolution の未設定は null)', () => {
    expect(parseParentMessageEntry('m1', createDoc())).toEqual({
      id: 'm1', classroomId: 'dev', studentId: 's001', studentName: '青木', absence: ABSENCE,
      createdAt: '2026-09-13T01:00:00.000Z', acknowledgedAt: null, resolution: null, notifiedAt: null,
    })
    expect(parseParentMessageEntry('m2', createDoc({ acknowledgedAt: '2026-09-13T02:00:00.000Z', resolution: 'makeup-now', notifiedAt: '2026-09-13T03:00:00.000Z' })))
      .toMatchObject({ acknowledgedAt: '2026-09-13T02:00:00.000Z', resolution: 'makeup-now', notifiedAt: '2026-09-13T03:00:00.000Z' })
    // 知らない resolution・空文字の時刻は「未」に丸める
    expect(parseParentMessageEntry('m3', createDoc({ resolution: 'deleted', acknowledgedAt: '' }))).toMatchObject({ resolution: null, acknowledgedAt: null })
  })
  it('必須項目(classroomId/studentId/createdAt)が無い・型が崩れた doc は null', () => {
    expect(parseParentMessageEntry('m1', null)).toBeNull()
    expect(parseParentMessageEntry('m1', 'text')).toBeNull()
    expect(parseParentMessageEntry('', createDoc())).toBeNull()
    expect(parseParentMessageEntry('m1', createDoc({ classroomId: undefined }))).toBeNull()
    expect(parseParentMessageEntry('m1', createDoc({ studentId: undefined }))).toBeNull()
    expect(parseParentMessageEntry('m1', createDoc({ createdAt: undefined }))).toBeNull()
    expect(parseParentMessageEntry('m1', createDoc({ classroomId: 123 }))).toBeNull()
  })
  // 2026-09-18: 自由記述の連絡は廃止。Firestore に残っている旧 doc(kind 無し・body あり)はモーダルに出さない。
  it('旧形式(自由記述)の doc は null(表示しない)', () => {
    expect(parseParentMessageEntry('legacy', { classroomId: 'dev', studentId: 's001', studentName: '青木', body: '欠席します', senderName: '母', createdAt: 'c', notifiedAt: null, containsUrl: false })).toBeNull()
    expect(parseParentMessageEntry('other', createDoc({ kind: 'message' }))).toBeNull()
  })
  it('対象コマが壊れている doc は null(日付の形・時限・種別を検査する)', () => {
    expect(parseParentMessageEntry('m1', createDoc({ absence: undefined }))).toBeNull()
    expect(parseParentMessageEntry('m1', createDoc({ absence: { ...ABSENCE, dateKey: '9/20' } }))).toBeNull()
    expect(parseParentMessageEntry('m1', createDoc({ absence: { ...ABSENCE, slotNumber: 0 } }))).toBeNull()
    expect(parseParentMessageEntry('m1', createDoc({ absence: { ...ABSENCE, slotNumber: '3' } }))).toBeNull()
    expect(parseParentMessageEntry('m1', createDoc({ absence: { ...ABSENCE, lessonKind: 'special' } }))).toBeNull()
    // 科目の欠落と isTentative の欠落は落とさない(表示が少し欠けるだけ)
    expect(parseParentMessageEntry('m1', createDoc({ absence: { dateKey: '2026-09-20', slotNumber: 3, lessonKind: 'makeup' } }))?.absence)
      .toEqual({ dateKey: '2026-09-20', slotNumber: 3, subject: '', lessonKind: 'makeup', isTentative: false })
  })
})

describe('selectUnnotifiedParentMessages', () => {
  it('notifiedAt が null/空の連絡だけ残し、処理済みは落とす(再通知しない)', () => {
    const entries = [
      createEntry({ id: 'a', notifiedAt: null }),
      createEntry({ id: 'b', notifiedAt: '2026-09-13T02:00:00.000Z' }),
      createEntry({ id: 'c', notifiedAt: '' as unknown as null }),
    ]
    expect(selectUnnotifiedParentMessages(entries).map((entry) => entry.id)).toEqual(['a', 'c'])
  })
  // 四択を押すと acknowledgedAt の更新で 'modified' が届く。保存待ちを除かないと、処理したばかりの連絡がモーダルへ戻る。
  it('保存待ち(盤面へ反映済み)の連絡は除く。acknowledgedAt が付いただけでは除かない(=保存されなかった再通知は出す)', () => {
    const entries = [createEntry({ id: 'a', acknowledgedAt: '2026-09-13T02:00:00.000Z', resolution: 'absent' }), createEntry({ id: 'b' })]
    expect(selectUnnotifiedParentMessages(entries, new Set(['a'])).map((entry) => entry.id)).toEqual(['b'])
    expect(selectUnnotifiedParentMessages(entries).map((entry) => entry.id)).toEqual(['a', 'b'])
  })
  it('入力の順序を保ち、入力配列を破壊しない', () => {
    const entries = [createEntry({ id: 'z' }), createEntry({ id: 'a' })]
    expect(selectUnnotifiedParentMessages(entries).map((entry) => entry.id)).toEqual(['z', 'a'])
    expect(entries).toHaveLength(2)
  })
})

describe('buildParentMessageNotifications', () => {
  it('生徒名は名簿の現在名(表示名)を優先し、教室名と対象コマを付ける', () => {
    const [notification] = buildParentMessageNotifications([createEntry()], { students: [createStudent({ displayName: '青木(改名後)' })], classroomName: '開発用教室' })
    expect(notification).toEqual({
      id: 'm1',
      studentId: 's001',
      studentName: '青木(改名後)',
      classroomName: '開発用教室',
      createdAt: '2026-09-13T01:00:00.000Z',
      absence: ABSENCE,
      previousResolution: null,
    })
  })
  it('名簿の表示名が空なら氏名の先頭語(getStudentDisplayName と同じ規則)', () => {
    const [notification] = buildParentMessageNotifications([createEntry()], { students: [createStudent({ displayName: '' })] })
    expect(notification!.studentName).toBe('青木')
  })
  it('名簿に居ない生徒(削除済み)は doc の studentName、それも空なら固定文言。教室名未指定は空文字', () => {
    const [gone, unknown] = buildParentMessageNotifications(
      [createEntry({ id: 'a', studentId: 's999' }), createEntry({ id: 'b', studentId: 's998', studentName: '  ' })],
      { students: [createStudent()], classroomName: null },
    )
    expect(gone!.studentName).toBe('青木(送信時)')
    expect(unknown!.studentName).toBe(PARENT_MESSAGE_STUDENT_NAME_FALLBACK)
    expect(gone!.classroomName).toBe('')
  })
  it('同名の別生徒が名簿に居ても studentId で引く(名前一致で混同しない)', () => {
    const students = [createStudent({ id: 's001', name: '青木 太郎', displayName: '青木' }), createStudent({ id: 's002', name: '青木 次郎', displayName: '青木' })]
    const [notification] = buildParentMessageNotifications([createEntry({ studentId: 's002' })], { students })
    expect(notification!.studentName).toBe('青木')
    expect(notification!.studentId).toBe('s002')
    // 名簿の重複 id は先勝ち(後続で上書きしない)
    const dup = [createStudent({ id: 's001', displayName: '先' }), createStudent({ id: 's001', displayName: '後' })]
    expect(buildParentMessageNotifications([createEntry()], { students: dup })[0]!.studentName).toBe('先')
  })
  // 前回の起動で四択を押したが盤面を保存しなかった連絡は、notifiedAt が無いので再通知される。何を選んだかを添える。
  it('前回の選択(acknowledgedAt あり)は previousResolution として渡す。未確認の resolution は渡さない', () => {
    const [again, fresh] = buildParentMessageNotifications(
      [createEntry({ id: 'a', acknowledgedAt: '2026-09-13T02:00:00.000Z', resolution: 'absent-no-makeup' }), createEntry({ id: 'b', resolution: 'absent' })],
      { students: [] },
    )
    expect(again!.previousResolution).toBe('absent-no-makeup')
    expect(fresh!.previousResolution).toBeNull()
  })
})

describe('formatParentAbsenceLessonLabel / 四択の定義', () => {
  it('「9月20日(日) 3限 英(通常)」の形にする(曜日は UTC で計算し TZ でずれない)', () => {
    expect(formatParentAbsenceLessonLabel(ABSENCE)).toBe('9月20日(日) 3限 英(通常)')
    expect(formatParentAbsenceLessonLabel({ ...ABSENCE, dateKey: '2026-10-01', slotNumber: 5, subject: '数', lessonKind: 'makeup' })).toBe('10月1日(木) 5限 数(振替)')
    expect(formatParentAbsenceLessonLabel({ ...ABSENCE, subject: '', lessonKind: 'extra' })).toBe('9月20日(日) 3限(増コマ)')
  })
  it('四択は 休み / 振無休 / 振替先を今決める / 何もしない の順で、盤面の既存メニューと同じ言葉を使う', () => {
    expect(PARENT_ABSENCE_CHOICES.map((choice) => choice.resolution)).toEqual(['absent', 'absent-no-makeup', 'makeup-now', 'manual'])
    expect(PARENT_ABSENCE_CHOICES.map((choice) => choice.label)).toEqual(['休み', '振無休', '振替先を今決める', '何もしない'])
  })
  it('再通知の注意文は盤面を変える 3 種だけ(何もしない・未選択は空)。「保存されなかった」と断定しない', () => {
    expect(buildParentAbsenceUnsavedNote('absent')).toContain('「休み」')
    expect(buildParentAbsenceUnsavedNote('makeup-now')).toContain('保存された盤面で確認が取れなかった')
    // 保存はできていても確認が取れない経路(ログアウト直前の保存・盤面の「元に戻す」)があるので断定しない(レビュー指摘 2026-09-19)。
    expect(buildParentAbsenceUnsavedNote('makeup-now')).not.toContain('保存されなかった')
    expect(buildParentAbsenceUnsavedNote('manual')).toBe('')
    expect(buildParentAbsenceUnsavedNote(null)).toBe('')
  })
})

describe('mergeParentMessageNotifications', () => {
  function createNotification(overrides: Partial<ParentMessageNotification> = {}): ParentMessageNotification {
    return { id: 'n1', studentId: 's001', studentName: '青木', classroomName: '', createdAt: '2026-09-13T01:00:00.000Z', absence: ABSENCE, previousResolution: null, ...overrides }
  }
  it('id 重複は新着で置き換え、createdAt 昇順に並べる', () => {
    const current = [createNotification({ id: 'b', createdAt: '2026-09-13T02:00:00.000Z', studentName: '旧' }), createNotification({ id: 'a', createdAt: '2026-09-13T01:00:00.000Z' })]
    const incoming = [createNotification({ id: 'c', createdAt: '2026-09-13T00:30:00.000Z' }), createNotification({ id: 'b', createdAt: '2026-09-13T02:00:00.000Z', studentName: '新' })]
    const merged = mergeParentMessageNotifications(current, incoming)
    expect(merged.map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(merged.find((item) => item.id === 'b')!.studentName).toBe('新')
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

// オーナー確定(2026-09-18): 四択で盤面を変えた連絡は「盤面を保存できた時点」で処理済みにする。
// 選んだ瞬間に処理済みにすると、保存し忘れて閉じたとき「連絡は処理済みなのに盤面は休みになっていない」が起きる。
describe('保存待ち(addPendingParentAbsenceFinalize / splitPendingParentAbsenceFinalize)', () => {
  const pending = (overrides: Partial<PendingParentAbsenceFinalize> = {}): PendingParentAbsenceFinalize =>
    ({ messageId: 'm1', classroomId: 'dev', processedAt: '2026-09-18T01:00:00.000Z', studentId: 's001', dateKey: '2026-09-20', slotNumber: 3, ...overrides })
  const recorded = () => true

  it('保存した教室・その保存のスナップショット作成時刻以前に処理した分だけ取り出す', () => {
    const current = [pending({ messageId: 'before' }), pending({ messageId: 'same', processedAt: '2026-09-18T01:05:00.000Z' }), pending({ messageId: 'after', processedAt: '2026-09-18T01:05:00.001Z' })]
    const result = splitPendingParentAbsenceFinalize(current, { classroomId: 'dev', snapshotSavedAt: '2026-09-18T01:05:00.000Z', isRecordedInSavedBoard: recorded })
    expect(result.toFinalize).toEqual(['before', 'same'])
    // 保存の通信中に処理した連絡は、その保存の中身に入っていない → 次の保存まで残す
    expect(result.remaining.map((item) => item.messageId)).toEqual(['after'])
    expect(result.returned).toEqual([])
  })
  // レビュー指摘(2026-09-19): 四択で休みにしたあと盤面の「元に戻す」や休み解除で記録を消してから保存すると、
  // 保存待ちだけが残って連絡が処理済みになり、二度と再通知されなかった。保存した盤面に記録が実在する分だけ処理済みにする。
  it('保存した盤面に休みの記録が無い連絡は処理済みにせず、保存待ちからも外して一覧へ戻す', () => {
    const current = [pending({ messageId: 'kept' }), pending({ messageId: 'undone', dateKey: '2026-09-22' })]
    const result = splitPendingParentAbsenceFinalize(current, {
      classroomId: 'dev',
      snapshotSavedAt: '2026-09-18T02:00:00.000Z',
      isRecordedInSavedBoard: (item) => item.dateKey === '2026-09-20',
    })
    expect(result.toFinalize).toEqual(['kept'])
    expect(result.returned).toEqual(['undone'])
    expect(result.remaining).toEqual([])
  })
  it('まだ判定できない分(他教室・保存の通信中に処理)は、盤面の記録を見ずに残す', () => {
    const seen: string[] = []
    const current = [pending({ messageId: 'other', classroomId: 'other' }), pending({ messageId: 'after', processedAt: '2026-09-18T09:00:00.000Z' })]
    const result = splitPendingParentAbsenceFinalize(current, {
      classroomId: 'dev',
      snapshotSavedAt: '2026-09-18T02:00:00.000Z',
      isRecordedInSavedBoard: (item) => { seen.push(item.messageId); return false },
    })
    expect(result).toEqual({ toFinalize: [], returned: [], remaining: current })
    expect(seen).toEqual([])
  })
  it('別の教室を保存しても処理済みにしない(INV-08)', () => {
    const current = [pending({ messageId: 'dev-notice' }), pending({ messageId: 'other-notice', classroomId: 'other' })]
    const result = splitPendingParentAbsenceFinalize(current, { classroomId: 'other', snapshotSavedAt: '2026-09-18T02:00:00.000Z', isRecordedInSavedBoard: recorded })
    expect(result.toFinalize).toEqual(['other-notice'])
    expect(result.remaining.map((item) => item.messageId)).toEqual(['dev-notice'])
  })
  it('教室・時刻が不明なら何も取り出さない(安全側=再通知に任せる)', () => {
    const current = [pending()]
    expect(splitPendingParentAbsenceFinalize(current, { classroomId: null, snapshotSavedAt: '2026-09-18T02:00:00.000Z', isRecordedInSavedBoard: recorded })).toEqual({ toFinalize: [], returned: [], remaining: current })
    expect(splitPendingParentAbsenceFinalize(current, { classroomId: 'dev', snapshotSavedAt: '', isRecordedInSavedBoard: recorded })).toEqual({ toFinalize: [], returned: [], remaining: current })
  })
  it('同じ連絡のやり直しは新しい processedAt で置き換える(重複させない)。不完全な入力は足さない', () => {
    const first = addPendingParentAbsenceFinalize([], pending())
    const second = addPendingParentAbsenceFinalize(first, pending({ processedAt: '2026-09-18T03:00:00.000Z' }))
    expect(second).toEqual([pending({ processedAt: '2026-09-18T03:00:00.000Z' })])
    expect(addPendingParentAbsenceFinalize(second, pending({ messageId: '' }))).toEqual(second)
    expect(addPendingParentAbsenceFinalize(second, pending({ classroomId: '' }))).toEqual(second)
    expect(addPendingParentAbsenceFinalize(second, pending({ processedAt: '' }))).toEqual(second)
    expect(first).toHaveLength(1) // 入力配列を破壊しない
  })
})

// INV-08(レビュー指摘 2026-09-19): 教室を切り替えた直後の 1 レンダーは、前の教室の連絡と新しい教室の名簿が同時に見える。
// 生徒ID sNNN は教室ごとに独立採番なので、その一瞬に四択を押すと新しい教室の別人を休みにしうる。
describe('selectParentMessagesForClassroom', () => {
  it('開いている教室の連絡だけを残す。教室が未選択なら 1 件も出さない', () => {
    const entries = [createEntry({ id: 'own' }), createEntry({ id: 'previous', classroomId: '5w5OMueETerSKrSf14HC' })]
    expect(selectParentMessagesForClassroom(entries, 'dev').map((entry) => entry.id)).toEqual(['own'])
    expect(selectParentMessagesForClassroom(entries, '5w5OMueETerSKrSf14HC').map((entry) => entry.id)).toEqual(['previous'])
    expect(selectParentMessagesForClassroom(entries, null)).toEqual([])
    expect(selectParentMessagesForClassroom(entries, '')).toEqual([])
  })
})

// 処理済み化 callable は 1 回 50 件まで。分割しないと 51 件で丸ごと失敗する(レビュー指摘 2026-09-13)。
describe('chunkParentMessageIds(処理済み化の分割)', () => {
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

// 盤面ツールバー「保護者連絡」ボタンの履歴(2026-09-19 オーナー指示)。
describe('buildParentContactHistory(保護者連絡の履歴)', () => {
  const at = (n: number) => `2026-09-${String(n).padStart(2, '0')}T01:00:00.000Z`

  it('新しい連絡が上。処理済み=確認済 / 保存待ち / 未確認 を付け、確認済と保存待ちには選んだ処理を添える', () => {
    const rows = buildParentContactHistory([
      createEntry({ id: 'old', createdAt: at(1), notifiedAt: at(2), acknowledgedAt: at(2), resolution: 'absent' }),
      createEntry({ id: 'new', createdAt: at(5) }),
      createEntry({ id: 'mid', createdAt: at(3), acknowledgedAt: at(4), resolution: 'absent-no-makeup' }),
    ], { students: [], pendingIds: new Set(['mid']) })
    expect(rows.map((row) => [row.id, row.status, row.resolution])).toEqual([
      ['new', 'unconfirmed', null],
      ['mid', 'pending-save', 'absent-no-makeup'],
      ['old', 'confirmed', 'absent'],
    ])
  })

  it('前回四択を押したが保存されなかった連絡(acknowledgedAt だけある)は未確認 = モーダルに再表示される集合と同じ', () => {
    const entries = [createEntry({ id: 'm1', acknowledgedAt: at(2), resolution: 'absent' })]
    expect(buildParentContactHistory(entries, { students: [] })[0]).toMatchObject({ status: 'unconfirmed', resolution: null })
    expect(selectUnnotifiedParentMessages(entries).map((entry) => entry.id)).toEqual(['m1'])
  })

  it('処理済み化を送った直後(hiddenIds)は購読が追いつく前でも確認済にする(クリックしてもモーダルに居ない行を作らない)', () => {
    const rows = buildParentContactHistory([createEntry({ id: 'm1' })], { students: [], hiddenIds: new Set(['m1']) })
    expect(rows[0]!.status).toBe('confirmed')
  })

  it('確認済は新しい順に 10 件まで。古い確認済は見た目上消えるが、未確認は古くても残る', () => {
    expect(PARENT_CONTACT_HISTORY_CONFIRMED_LIMIT).toBe(10)
    const confirmed = Array.from({ length: 12 }, (_, index) => createEntry({ id: `c${index + 1}`, createdAt: at(index + 2), notifiedAt: at(index + 2) }))
    const rows = buildParentContactHistory([createEntry({ id: 'u-old', createdAt: at(1) }), ...confirmed], { students: [] })
    expect(rows.filter((row) => row.status === 'confirmed').map((row) => row.id)).toEqual(['c12', 'c11', 'c10', 'c9', 'c8', 'c7', 'c6', 'c5', 'c4', 'c3'])
    expect(rows[rows.length - 1]!.id).toBe('u-old')
    expect(rows).toHaveLength(11)
  })

  it('生徒名は名簿の現在名を優先する(モーダルと同じ解決)', () => {
    const rows = buildParentContactHistory([createEntry({ studentId: 's001', studentName: '旧名' })], { students: [createStudent({ id: 's001', name: '新名', displayName: '新名' })] })
    expect(rows[0]!.studentName).toBe('新名')
  })
})

describe('mergeParentMessageEntries(未処理の購読と履歴の購読の合流)', () => {
  it('id で重複を除き、同じ id は未処理の購読側を採る。履歴にしか無い処理済みも残す', () => {
    const merged = mergeParentMessageEntries(
      [createEntry({ id: 'm1', studentName: '未処理側' }), createEntry({ id: 'm-old-unread' })],
      [createEntry({ id: 'm1', studentName: '履歴側' }), createEntry({ id: 'm2', notifiedAt: '2026-09-13T02:00:00.000Z' })],
    )
    expect(merged.map((entry) => entry.id).sort()).toEqual(['m-old-unread', 'm1', 'm2'])
    expect(merged.find((entry) => entry.id === 'm1')!.studentName).toBe('未処理側')
  })
})
