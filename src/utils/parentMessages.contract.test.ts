// 休み連絡の「サーバーが書く形」と「盤面側が読む形」の突き合わせ(docs/spec-parent-portal.md §0-5)。
//
// 連絡 doc は Cloud Functions(functions/src/parentPortal.ts)が書き、盤面側(src/utils/parentMessages.ts)が購読で読む。
// 片方だけフィールド名や値の集合を変えると、CI は緑のまま「保護者は送れたのに室長のモーダルに出ない」になる
// (parseParentMessageEntry は形の崩れた doc を黙って捨てるため)。ここで両側を実物どうしで噛み合わせて固定する。
import { describe, expect, it } from 'vitest'
import {
  buildParentAbsenceMessageId,
  buildParentMessageDoc,
  normalizeMarkNotifiedRequest,
  PARENT_MESSAGE_ID_PATTERN,
  resolveParentMessageMarkWrites,
} from '../../functions/src/parentPortal'
import { PARENT_ABSENCE_CHOICES, parseParentMessageEntry, selectUnnotifiedParentMessages } from './parentMessages'

const FINGERPRINT = '0123456789abcdef0123456789abcdef'

function createServerDoc() {
  return buildParentMessageDoc({
    workspaceKey: 'main',
    classroomId: 'v8OZ7zH8vONNHjjYVcR1',
    studentId: 's001',
    studentName: '青木',
    absence: { dateKey: '2026-09-20', slotNumber: 3, subject: '英', lessonKind: 'makeup', isTentative: true },
    createdAt: '2026-09-19T01:00:00.000Z',
    token: 'AbCdEfGhIjKlMnOpQrStUvWxYz012345',
    tokenFingerprint: FINGERPRINT,
  })
}

describe('休み連絡 doc: サーバーが書いた形を盤面側がそのまま読める', () => {
  it('buildParentMessageDoc の出力を parseParentMessageEntry が落とさずに読む', () => {
    const messageId = buildParentAbsenceMessageId(FINGERPRINT, '2026-09-20', 3)
    const entry = parseParentMessageEntry(messageId, createServerDoc())
    expect(entry).toEqual({
      id: messageId,
      classroomId: 'v8OZ7zH8vONNHjjYVcR1',
      studentId: 's001',
      studentName: '青木',
      absence: { dateKey: '2026-09-20', slotNumber: 3, subject: '英', lessonKind: 'makeup', isTentative: true },
      createdAt: '2026-09-19T01:00:00.000Z',
      acknowledgedAt: null,
      resolution: null,
      notifiedAt: null,
    })
    // 作りたての連絡は未処理として一覧に出る(購読の where('notifiedAt','==',null) とも一致する値)。
    expect(createServerDoc().notifiedAt).toBeNull()
    expect(selectUnnotifiedParentMessages([entry!])).toHaveLength(1)
  })

  it('決定的な messageId は、処理済み化 callable が受け付ける ID の形に収まる', () => {
    expect(buildParentAbsenceMessageId(FINGERPRINT, '2026-09-20', 3)).toMatch(PARENT_MESSAGE_ID_PATTERN)
  })
})

describe('状態更新: 盤面側が送る stage / resolution をサーバーが受け付け、書いた結果を盤面側が読める', () => {
  const request = (extra: Record<string, unknown>) => normalizeMarkNotifiedRequest({ workspaceKey: 'main', classroomId: 'dev', messageIds: ['m1'], ...extra })

  it('四択の resolution はすべてサーバーの許可集合に入っている(片側だけ選択肢を増やすと invalid-argument になる)', () => {
    for (const choice of PARENT_ABSENCE_CHOICES) {
      const parsed = request({ stage: choice.resolution === 'manual' ? 'notified' : 'acknowledged', resolution: choice.resolution })
      expect(parsed.ok, choice.resolution).toBe(true)
    }
    // 保存成功時の 'notified' は resolution を付けずに送る。
    expect(request({ stage: 'notified' }).ok).toBe(true)
  })

  it("'acknowledged' の書き込みを重ねた doc は「教室確認済＋選んだ処理」として読め、未処理の一覧には残る", () => {
    const [write] = resolveParentMessageMarkWrites(
      [{ id: 'm1', exists: true, notifiedAt: null, acknowledgedAt: null }],
      { stage: 'acknowledged', resolution: 'makeup-now', nowIso: '2026-09-19T02:00:00.000Z' },
    )
    const entry = parseParentMessageEntry('m1', { ...createServerDoc(), ...write!.update })
    expect(entry).toMatchObject({ acknowledgedAt: '2026-09-19T02:00:00.000Z', resolution: 'makeup-now', notifiedAt: null })
    // ★盤面を保存するまでは未処理のまま(保存せず閉じたら次回もう一度通知する・オーナー確定 2026-09-18)。
    expect(selectUnnotifiedParentMessages([entry!])).toHaveLength(1)
  })

  it("'notified' の書き込みを重ねた doc は処理済みとして一覧から外れ、確認時刻も埋まる", () => {
    const [write] = resolveParentMessageMarkWrites(
      [{ id: 'm1', exists: true, notifiedAt: null, acknowledgedAt: null }],
      { stage: 'notified', resolution: 'manual', nowIso: '2026-09-19T03:00:00.000Z' },
    )
    const entry = parseParentMessageEntry('m1', { ...createServerDoc(), ...write!.update })
    expect(entry).toMatchObject({ notifiedAt: '2026-09-19T03:00:00.000Z', acknowledgedAt: '2026-09-19T03:00:00.000Z', resolution: 'manual' })
    expect(selectUnnotifiedParentMessages([entry!])).toHaveLength(0)
  })
})
