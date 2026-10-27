import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 保存ごとの教室版履歴(2026-10-22 案 1)の配線をソース走査で固定する(regression-reviewer テスト案 1・M-5)。
// mirrorLatestClassroomRollback は「直前ロールバック(手動復旧の最後の砦)」を書くトリガで、版履歴を同居させたが、
// (1) 直前ロールバックを先に書く (2) 版履歴の失敗は握る (3) 直前ロールバックの失敗は従来どおり投げ直す (4) before 無しでは直前ロールバックを書かない。
const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
const trigger = indexTs.slice(indexTs.indexOf('export const mirrorLatestClassroomRollback = onDocumentWritten('), indexTs.indexOf('export const createWorkspaceServerQuarterHourlyBackups = onSchedule('))

describe('mirrorLatestClassroomRollback の配線(版履歴の同居・M-5)', () => {
  it('直前ロールバックを版履歴より先に待つ', () => {
    const rollback = trigger.indexOf('await writeLatestClassroomRollback(')
    const history = trigger.indexOf('await writeClassroomSaveHistory(')
    expect(rollback).toBeGreaterThan(-1)
    expect(history).toBeGreaterThan(rollback)
  })

  it('before 無しでは直前ロールバックを書かず、版履歴は after があれば書く(初回保存も 1 本目として残す)', () => {
    expect(trigger).toContain('if (beforeSnapshot) {\n    try {\n      await writeLatestClassroomRollback(')
    expect(trigger).toContain('if (afterSnapshot) {\n    try {\n      await writeClassroomSaveHistory(')
  })

  it('版履歴の例外は握り(ログだけ)、直前ロールバックの例外は最後に投げ直す', () => {
    const historyBlock = trigger.slice(trigger.indexOf('await writeClassroomSaveHistory('), trigger.indexOf('if (rollbackError) throw rollbackError'))
    expect(historyBlock).toContain("logger.error(`[SaveHistory] Failed to write classroom save history")
    expect(historyBlock).not.toContain('throw')
    expect(trigger).toContain('rollbackError = error')
    // トリガ本体の最後の文で投げ直す(その後ろは次の関数までのコメントだけ)。
    const rethrow = trigger.indexOf('if (rollbackError) throw rollbackError\n})')
    expect(rethrow).toBeGreaterThan(trigger.indexOf('await writeClassroomSaveHistory('))
    expect(trigger.slice(rethrow + 'if (rollbackError) throw rollbackError\n})'.length).trim().split('\n').every((line) => line.trim() === '' || line.trim().startsWith('//'))).toBe(true)
  })

  it('版履歴は旧形式の after 文書(保存形式)をそのまま包み、作り直さない(CPU・メモリ)。分割形式の目次だけは組み立てた教室データ全体を単一文書にして書く(K-7・AC-22)。書くかどうかは純関数 shouldWriteClassroomSaveHistory', () => {
    const writer = indexTs.slice(indexTs.indexOf('async function writeClassroomSaveHistory('), indexTs.indexOf('function deserializeBoardState('))
    expect(writer).toContain("snapshot: isSnapshotPartsManifest(params.afterSnapshot)\n      ? await buildAssembledStoredSnapshotDoc(")
    expect(writer).toContain(': params.afterSnapshot,')
    expect(writer).not.toContain('createStoredSnapshotDoc(')
    // 分割形式の目次(data / compressedData を持たない)も「中身あり」として版履歴の対象にする。
    const decider0 = indexTs.slice(indexTs.indexOf('function shouldWriteClassroomSaveHistory('), indexTs.indexOf('async function writeClassroomSaveHistory('))
    expect(decider0).toContain('|| isSnapshotPartsManifest(after)')
    expect(writer).toContain('if (!shouldWriteClassroomSaveHistory(params.beforeSnapshot ?? null, params.afterSnapshot)) return false')
    const decider = indexTs.slice(indexTs.indexOf('function shouldWriteClassroomSaveHistory('), indexTs.indexOf('async function writeClassroomSaveHistory('))
    // メタだけの更新(版数も保存時刻も同じ)は書かない。版数か保存時刻が進めば書く。
    expect(decider).toContain('return before.version !== after.version || before.savedAt !== after.savedAt')
  })
})
