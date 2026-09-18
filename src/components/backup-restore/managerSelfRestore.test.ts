import { describe, expect, it } from 'vitest'
import {
  MANAGER_SELF_RESTORE_MODAL_NOTES,
  MANAGER_SELF_RESTORE_WINDOW_DAYS,
  buildManagerSelfRestoreConfirmLines,
  isRestoreSourceForClassroom,
  listManagerSelfRestoreCandidates,
  replaceClassroomData,
  resolveManagerSelfRestoreCutoffIso,
  resolveManagerSelfRestoreGuard,
} from './managerSelfRestore'

const NOW = new Date('2026-09-18T12:00:00.000Z')

function summary(backupDateKey: string, savedAt: string) {
  return { backupDateKey, displayLabel: backupDateKey, savedAt, sourceSavedAt: '' }
}

describe('室長の自教室復元: 候補一覧(直近7日)', () => {
  it('窓は 7 日(オーナー確定 2026-09-18)。下限 ISO は now - 7日', () => {
    expect(MANAGER_SELF_RESTORE_WINDOW_DAYS).toBe(7)
    expect(resolveManagerSelfRestoreCutoffIso(NOW)).toBe('2026-09-11T12:00:00.000Z')
  })

  it('7 日より前・未来・時刻不明・キー無しを除き、新しい順に並べる', () => {
    const result = listManagerSelfRestoreCandidates([
      summary('old', '2026-09-11T11:59:59.000Z'),
      summary('edge', '2026-09-11T12:00:00.000Z'),
      summary('recent', '2026-09-18T11:45:00.000Z'),
      summary('middle', '2026-09-15T00:00:00.000Z'),
      summary('future', '2026-09-18T12:00:01.000Z'),
      summary('broken', 'not-a-date'),
      summary('', '2026-09-18T10:00:00.000Z'),
    ], NOW)
    expect(result.map((entry) => entry.backupDateKey)).toEqual(['recent', 'middle', 'edge'])
  })

  it('同じ backupDateKey の重複は 1 件にまとめる', () => {
    const result = listManagerSelfRestoreCandidates([
      summary('dup', '2026-09-18T11:00:00.000Z'),
      summary('dup', '2026-09-18T11:00:00.000Z'),
    ], NOW)
    expect(result).toHaveLength(1)
  })
})

describe('室長の自教室復元: 実行ガード(教室取り違え防止・2026-06-06 事故の再発防止)', () => {
  const base = {
    featureEnabled: true,
    isRemoteBackendEnabled: true,
    role: 'manager' as const,
    assignedClassroomId: 'classroom-a',
    actingClassroomId: 'classroom-a',
    targetClassroomId: 'classroom-a',
  }

  it('室長: 担当 = 開いている = 復元対象 の 3 者一致なら許可', () => {
    expect(resolveManagerSelfRestoreGuard(base)).toEqual({ ok: true })
  })

  it('室長: 復元対象が他教室なら拒否', () => {
    const result = resolveManagerSelfRestoreGuard({ ...base, targetClassroomId: 'classroom-b' })
    expect(result.ok).toBe(false)
  })

  it('室長: 開いている教室が担当教室でなければ拒否(対象と開いている教室が一致していても)', () => {
    const result = resolveManagerSelfRestoreGuard({ ...base, actingClassroomId: 'classroom-b', targetClassroomId: 'classroom-b' })
    expect(result).toEqual({ ok: false, message: '自分の担当教室以外は復元できません。' })
  })

  it('室長: 担当教室が未設定なら拒否', () => {
    expect(resolveManagerSelfRestoreGuard({ ...base, assignedClassroomId: null }).ok).toBe(false)
    expect(resolveManagerSelfRestoreGuard({ ...base, assignedClassroomId: '  ' }).ok).toBe(false)
  })

  it('開いている教室・復元対象が空なら拒否', () => {
    expect(resolveManagerSelfRestoreGuard({ ...base, actingClassroomId: null }).ok).toBe(false)
    expect(resolveManagerSelfRestoreGuard({ ...base, targetClassroomId: '' }).ok).toBe(false)
  })

  it('機能フラグ OFF・Firebase 無効・ロール不明は拒否', () => {
    expect(resolveManagerSelfRestoreGuard({ ...base, featureEnabled: false }).ok).toBe(false)
    expect(resolveManagerSelfRestoreGuard({ ...base, isRemoteBackendEnabled: false }).ok).toBe(false)
    expect(resolveManagerSelfRestoreGuard({ ...base, role: null }).ok).toBe(false)
  })

  it('開発者: 開いている教室 = 復元対象なら許可、違えば拒否', () => {
    expect(resolveManagerSelfRestoreGuard({ ...base, role: 'developer', assignedClassroomId: null })).toEqual({ ok: true })
    expect(resolveManagerSelfRestoreGuard({ ...base, role: 'developer', assignedClassroomId: null, targetClassroomId: 'classroom-b' }).ok).toBe(false)
  })

  it('サーバー応答の教室IDが開いている教室と違えば読み込まない', () => {
    expect(isRestoreSourceForClassroom('classroom-a', 'classroom-a')).toBe(true)
    expect(isRestoreSourceForClassroom('classroom-b', 'classroom-a')).toBe(false)
    expect(isRestoreSourceForClassroom('', '')).toBe(false)
    expect(isRestoreSourceForClassroom(undefined, 'classroom-a')).toBe(false)
  })
})

describe('室長の自教室復元: 確認文言(spec-save-restore §4 の警告必須)', () => {
  it('モーダル注意書きは「この教室だけ」「未保存は失われる」「復元対象外」「保存で確定」を含む', () => {
    const text = MANAGER_SELF_RESTORE_MODAL_NOTES.join('\n')
    expect(text).toContain('この教室だけ')
    expect(text).toContain('保存していない編集は失われます')
    expect(text).toContain('復元の対象外')
    expect(text).toContain('「保存」を押すと確定')
  })

  it('最終確認は規模(取り違え防止)と不可逆警告を含む', () => {
    const lines = buildManagerSelfRestoreConfirmLines({
      classroomName: '開発用教室',
      backupLabel: '9/18 11:45',
      sourceSavedAt: '',
      studentCount: 12,
      teacherCount: 3,
      templateCellCount: 40,
    })
    const text = lines.join('\n')
    expect(text).toContain('「開発用教室」を 9/18 11:45 の状態へ戻します。')
    expect(text).toContain('生徒12名 / 講師3名 / テンプレ40コマ')
    expect(text).toContain('元に戻せません')
    expect(text).not.toContain('バックアップ内の最終保存')
  })
})

describe('室長の自教室復元: 差し替えるのは自教室のスロットだけ(INV-08)', () => {
  it('指定した教室の data だけを差し替え、他教室の要素は参照ごと不変', () => {
    const classroomA = { id: 'classroom-a', name: 'A', data: { students: ['a1'] } }
    const classroomB = { id: 'classroom-b', name: 'B', data: { students: ['b1'] } }
    const restored = { students: ['a0'] }
    const result = replaceClassroomData([classroomA, classroomB], 'classroom-a', restored)
    expect(result[0]).toEqual({ id: 'classroom-a', name: 'A', data: restored })
    expect(result[1]).toBe(classroomB)
    expect(result[1].data).toBe(classroomB.data)
    // 元の配列・要素は書き換えない。
    expect(classroomA.data).toEqual({ students: ['a1'] })
  })

  it('該当教室が無ければ全要素を参照ごとそのまま返す', () => {
    const classroomB = { id: 'classroom-b', data: { students: ['b1'] } }
    const result = replaceClassroomData([classroomB], 'classroom-x', { students: ['x1'] })
    expect(result).toEqual([classroomB])
    expect(result[0]).toBe(classroomB)
  })
})
