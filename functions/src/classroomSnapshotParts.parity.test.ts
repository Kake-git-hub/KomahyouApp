import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  buildGeneratedContent,
  CLASSROOM_SNAPSHOT_PARTS_HEADER,
  CLASSROOM_SNAPSHOT_PARTS_OUTPUT_PATH,
  CLASSROOM_SNAPSHOT_PARTS_SOURCE_PATH,
  normalizeToLf,
} from '../scripts/sync-shared.mjs'
// ⚠️ アプリ側の実装(正本)。functions 側の生成物がズレたらこのテストが落ちる。
import * as appModule from '../../src/utils/classroomSnapshotParts'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

function readRepoFile(relativePath: string) {
  return normalizeToLf(readFileSync(resolve(repoRoot, relativePath), 'utf8'))
}

function sha256(input: string) {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

async function sha256Subtle(input: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function buildFixturePayload() {
  const week = (dateKey: string) => [1, 2].map((slot) => ({ id: `${dateKey}#${slot}`, dateKey, slotNumber: slot, desks: [{ students: [{ studentId: 's1' }], teacherId: 't1' }] }))
  return {
    screen: 'board',
    classroomSettings: { deskCount: 14, memo: undefined },
    managers: [], teachers: [{ id: 't1', name: '講師A' }], students: [{ id: 's1', name: '生徒A' }],
    regularLessons: [], groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [],
    boardState: {
      weeks: [week('2026-05-11'), { cells: week('2026-05-18') }, week('2026-05-18')],
      weekIndex: 2, selectedCellId: null, suppressedRegularLessonOccurrences: ['x'], groupClassEntries: {},
    },
  }
}

// 週単位の分割保存(docs/spec-save-restore.md §9-5-1): 分割・組み立て・週キー・ハッシュ入力は**サーバー 1 つ・クライアント 1 つ**。
// 片側だけ規則を変えると、クライアントの差分判定とサーバーの照合がずれる(毎回全量送信)か、最悪「読める形が違う」になる。
describe('functions/src/generated/classroomSnapshotParts.ts は src/utils/classroomSnapshotParts.ts の複製(sync-shared)', () => {
  it('生成物 = ヘッダ 1 行 + 元ファイル(ズレていたら `npm --prefix functions run sync-shared` を実行してコミット)', () => {
    const source = readRepoFile(CLASSROOM_SNAPSHOT_PARTS_SOURCE_PATH)
    const generated = readRepoFile(CLASSROOM_SNAPSHOT_PARTS_OUTPUT_PATH)
    expect(generated.split('\n')[0]).toBe(CLASSROOM_SNAPSHOT_PARTS_HEADER)
    expect(generated).toBe(`${CLASSROOM_SNAPSHOT_PARTS_HEADER}\n${source}`)
    expect(generated).toBe(buildGeneratedContent(source, CLASSROOM_SNAPSHOT_PARTS_SOURCE_PATH))
  })

  it('元ファイルは自己完結(import / ビルド時メタ情報 / CommonJS 読み込みなし)で、複製先でも解決できる', () => {
    const source = readRepoFile(CLASSROOM_SNAPSHOT_PARTS_SOURCE_PATH)
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toContain('import.' + 'meta')
    expect(source).not.toMatch(/\brequire\s*\(/)
  })

  it('生成物を動的 import しても同じ export を持ち、同じ教室データに同じ分割・同じハッシュ入力・同じ組み立てを返す', async () => {
    const generatedModule = await import('./generated/classroomSnapshotParts') as typeof appModule
    expect(Object.keys(generatedModule).sort()).toEqual(Object.keys(appModule).sort())
    expect(generatedModule.SNAPSHOT_PARTS_STORAGE_FORMAT).toBe(appModule.SNAPSHOT_PARTS_STORAGE_FORMAT)
    expect(generatedModule.SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION).toBe(appModule.SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION)
    expect([...generatedModule.SNAPSHOT_BOARD_UI_FIELDS]).toEqual([...appModule.SNAPSHOT_BOARD_UI_FIELDS])

    const payload = buildFixturePayload()
    const expectedSplit = appModule.splitClassroomSnapshotPayload(payload)
    const actualSplit = generatedModule.splitClassroomSnapshotPayload(payload)
    expect(actualSplit).toEqual(expectedSplit)
    expect(actualSplit.weeks.map((week) => week.key)).toEqual(['2026-05-11', '2026-05-18', '2026-05-18~2'])

    const expectedContents = appModule.listSnapshotPartContents(expectedSplit)
    const actualContents = generatedModule.listSnapshotPartContents(actualSplit)
    expect(actualContents.map((entry) => entry.partKey)).toEqual(expectedContents.map((entry) => entry.partKey))
    for (let index = 0; index < expectedContents.length; index += 1) {
      expect(generatedModule.buildSnapshotPartHashInput(actualContents[index].content)).toBe(appModule.buildSnapshotPartHashInput(expectedContents[index].content))
    }
    const hashes = expectedContents.map((entry) => [entry.partKey, sha256(appModule.buildSnapshotPartHashInput(entry.content))] as const)
    const compositeInput = {
      ui: expectedSplit.ui,
      hasBoardState: expectedSplit.hasBoardState,
      coreHash: hashes[0][1],
      boardHash: hashes[1][1],
      weeks: hashes.slice(2).map(([partKey, hash]) => [partKey.slice('week:'.length), hash] as const),
    }
    expect(generatedModule.buildSnapshotCompositeHashInput(compositeInput)).toBe(appModule.buildSnapshotCompositeHashInput(compositeInput))

    const assembleInput = { core: expectedSplit.core, board: expectedSplit.board, weeks: expectedSplit.weeks.map((week) => week.cells), ui: expectedSplit.ui, hasBoardState: expectedSplit.hasBoardState }
    expect(generatedModule.stableStringifySnapshotValue(generatedModule.assembleClassroomSnapshotPayload(assembleInput)))
      .toBe(appModule.stableStringifySnapshotValue(appModule.assembleClassroomSnapshotPayload(assembleInput)))
  })

  it('ブラウザ(crypto.subtle)と Node(crypto)の SHA-256 は同じ入力で同じ 16 進になる(クライアントの差分判定とサーバーの照合がずれない)', async () => {
    const input = appModule.buildSnapshotPartHashInput(appModule.splitClassroomSnapshotPayload(buildFixturePayload()).core)
    expect(await sha256Subtle(input)).toBe(sha256(input))
    expect(sha256(input)).toMatch(/^[0-9a-f]{64}$/)
  })
})
