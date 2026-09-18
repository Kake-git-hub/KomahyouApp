import { describe, expect, it } from 'vitest'
import {
  MANAGER_SELF_RESTORE_NOT_RESTORED_ITEMS,
  MANAGER_SELF_RESTORE_WINDOW_DAYS,
  buildManagerSelfRestoreConfirmation,
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

describe('室長の自教室復元: 候補一覧(直近3日)', () => {
  it('窓は 3 日(オーナー指示 2026-09-18・当初 7 日から短縮)。下限 ISO は now - 3日', () => {
    expect(MANAGER_SELF_RESTORE_WINDOW_DAYS).toBe(3)
    expect(resolveManagerSelfRestoreCutoffIso(NOW)).toBe('2026-09-15T12:00:00.000Z')
  })

  it('3 日より前・未来・時刻不明・キー無しを除き、新しい順に並べる', () => {
    const result = listManagerSelfRestoreCandidates([
      summary('old', '2026-09-15T11:59:59.000Z'),
      summary('four-days-ago', '2026-09-14T12:00:00.000Z'),
      summary('edge', '2026-09-15T12:00:00.000Z'),
      summary('recent', '2026-09-18T11:45:00.000Z'),
      summary('middle', '2026-09-17T00:00:00.000Z'),
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

  it('時系列: A 教室で取得して確認待ち → 確定時に B 教室を開いていたら適用しない(確定時の再ガード)', () => {
    // confirmOwnClassroomRestore は target = 取得した教室(A)、acting = いま開いている教室(B) で照合する。
    const result = resolveManagerSelfRestoreGuard({ ...base, assignedClassroomId: 'classroom-b', actingClassroomId: 'classroom-b', targetClassroomId: 'classroom-a' })
    expect(result).toEqual({ ok: false, message: 'いま開いている教室以外は復元できません。' })
    // 開発者でも同じ(開発者は教室を切り替えられるので、ここが実質の砦)。
    expect(resolveManagerSelfRestoreGuard({ ...base, role: 'developer', assignedClassroomId: null, actingClassroomId: 'classroom-b', targetClassroomId: 'classroom-a' }).ok).toBe(false)
  })

  it('サーバー応答の教室IDが開いている教室と違えば読み込まない', () => {
    expect(isRestoreSourceForClassroom('classroom-a', 'classroom-a')).toBe(true)
    expect(isRestoreSourceForClassroom('classroom-b', 'classroom-a')).toBe(false)
    expect(isRestoreSourceForClassroom('', '')).toBe(false)
    expect(isRestoreSourceForClassroom(undefined, 'classroom-a')).toBe(false)
  })
})

describe('室長の自教室復元: 確認モーダルの中身(spec-save-restore §4 の警告必須)', () => {
  const confirmation = buildManagerSelfRestoreConfirmation({
    classroomName: '開発用教室',
    backupLabel: '9/18 11:45',
    sourceSavedAt: '',
    studentCount: 12,
    teacherCount: 3,
    templateCellCount: 40,
  })

  it('「復元しても戻らないもの」を必ず載せる(オーナー指示 2026-09-18)', () => {
    expect(confirmation.notRestoredTitle).toBe('復元しても戻らないもの')
    expect(confirmation.notRestoredItems).toBe(MANAGER_SELF_RESTORE_NOT_RESTORED_ITEMS)
    expect(confirmation.notRestoredItems.length).toBeGreaterThanOrEqual(4)
    const text = confirmation.notRestoredItems.join('\n')
    expect(text).toContain('QRで提出された講習の希望')
    expect(text).toContain('保護者からの連絡')
    expect(text).toContain('「通常授業履歴」')
  })

  it('内部用語(授業台帳・操作ログ・lessonLedger 等)を画面の言葉に出さない(オーナー指示「アプリ上の言葉で」)', () => {
    const text = JSON.stringify(confirmation)
    for (const internalWord of ['授業台帳', '操作ログ', '台帳', 'lessonLedger', 'operationEvents', 'lectureSubmissions']) {
      expect(text, internalWord).not.toContain(internalWord)
    }
  })

  it('見出しに教室名と時点、規模(取り違え防止)、不可逆警告、保存で確定、を含む', () => {
    expect(confirmation.headline).toBe('「開発用教室」を 9/18 11:45 の状態へ戻します。')
    expect(confirmation.scaleLine).toContain('生徒12名 / 講師3名 / 通常授業テンプレ40コマ')
    expect(confirmation.sourceSavedAtLine).toBe('')
    const notes = confirmation.notes.join('\n')
    expect(notes).toContain('この教室だけ')
    expect(notes).toContain('保存していない編集は失われます')
    expect(notes).toContain('「保存」を押すと確定')
    expect(notes).toContain('元に戻せません')
  })

  it('パスワードを求める文言が無い(確認モーダル方式へ変更)', () => {
    expect(JSON.stringify(confirmation)).not.toContain('パスワード')
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
