// 確認リストの「どの教室で確認済みか」callable の純関数(2026-11-03)。
import { describe, expect, it } from 'vitest'

import {
  readVerificationChecklistNoteVersion,
  readVerificationChecklistVersion,
  selectVerificationChecklistStatusReports,
  VERIFICATION_CHECKLIST_STATUS_SELECT_FIELDS,
} from './verificationChecklistStatus'

const DEV = 'dev-classroom'
const SANDBOX = 'test-classroom'
const allowed = (id: string) => id === DEV || id === SANDBOX

function doc(id: string, data: Record<string, unknown>) {
  return { id, data }
}

describe('readVerificationChecklistVersion', () => {
  it('v1.2.3 の形だけ受け付ける', () => {
    expect(readVerificationChecklistVersion('v1.5.672')).toBe('v1.5.672')
    expect(readVerificationChecklistVersion(' v1.5.672 ')).toBe('v1.5.672')
    for (const bad of ['1.5.672', 'v1.5', '', null, 3, 'v1.5.672; drop']) expect(readVerificationChecklistVersion(bad)).toBeNull()
  })
})

describe('readVerificationChecklistNoteVersion', () => {
  it('先頭行のマーカーから版を取り出す(分割番号つきも)', () => {
    expect(readVerificationChecklistNoteVersion('[確認リスト v1.5.672]\n- tp-51 OK')).toBe('v1.5.672')
    expect(readVerificationChecklistNoteVersion('[確認リスト v1.5.672] (2/3)\n- tp-51 OK')).toBe('v1.5.672')
    expect(readVerificationChecklistNoteVersion('ふつうの要望\n[確認リスト v1.5.672]')).toBeNull()
  })
})

describe('selectVerificationChecklistStatusReports', () => {
  const base = { version: 'v1.5.672', isAllowedClassroom: allowed, developmentClassroomId: DEV }

  it('指定版・検証用教室のものだけを、受付が古い順に返し、教室の種類を付ける', () => {
    const result = selectVerificationChecklistStatusReports([
      doc('r3', { reportId: 'r3', classroomId: SANDBOX, classroomName: 'テスト教室', note: '[確認リスト v1.5.672]\n- tp-51 要改善: 消える', recordedAt: '2026-11-03T02:00:00.000Z' }),
      doc('r1', { reportId: 'r1', classroomId: DEV, classroomName: '開発用教室', note: '[確認リスト v1.5.672]\n- tp-51 OK', recordedAt: '2026-11-01T02:00:00.000Z' }),
      doc('old', { reportId: 'old', classroomId: DEV, note: '[確認リスト v1.5.670]\n- tp-51 OK', recordedAt: '2026-11-02T02:00:00.000Z' }),
      doc('prod', { reportId: 'prod', classroomId: 'production', note: '[確認リスト v1.5.672]\n- tp-51 OK', recordedAt: '2026-11-02T03:00:00.000Z' }),
    ], base)
    expect(result.map((report) => report.reportId)).toEqual(['r1', 'r3'])
    expect(result.map((report) => report.classroomKind)).toEqual(['development', 'sandbox'])
  })

  it('送信者・操作痕跡・保存先などは返さない(選ぶフィールドも固定)', () => {
    const [report] = selectVerificationChecklistStatusReports([
      doc('r1', { reportId: 'r1', classroomId: DEV, note: '[確認リスト v1.5.672]\n- a OK', recordedAt: 'x', reporterEmail: 'someone@example.com', recentOperations: [1], snapshotStoragePath: 'p' }),
    ], base)
    expect(Object.keys(report).sort()).toEqual(['classroomId', 'classroomKind', 'classroomName', 'note', 'recordedAt', 'reportId', 'reportedAt'])
    expect([...VERIFICATION_CHECKLIST_STATUS_SELECT_FIELDS].sort()).toEqual(['classroomId', 'classroomName', 'note', 'recordedAt', 'reportId', 'reportedAt'])
  })

  it('上限を超えたら新しい方を残す', () => {
    const docs = Array.from({ length: 5 }, (_, index) => doc(`r${index}`, { classroomId: DEV, note: '[確認リスト v1.5.672]\n- a OK', recordedAt: `2026-11-0${index + 1}T00:00:00.000Z` }))
    const result = selectVerificationChecklistStatusReports(docs, { ...base, limit: 2 })
    expect(result.map((report) => report.reportId)).toEqual(['r3', 'r4'])
  })

  it('開発用教室が未登録の会社では全部 sandbox 扱い', () => {
    const [report] = selectVerificationChecklistStatusReports([doc('r1', { classroomId: DEV, note: '[確認リスト v1.5.672]\n- a OK', recordedAt: 'x' })], { ...base, developmentClassroomId: null })
    expect(report.classroomKind).toBe('sandbox')
  })
})
