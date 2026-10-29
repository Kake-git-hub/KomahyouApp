import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  buildGeneratedContent,
  normalizeToLf,
  WORKSPACE_BACKUP_LAYOUT_HEADER,
  WORKSPACE_BACKUP_LAYOUT_OUTPUT_PATH,
  WORKSPACE_BACKUP_LAYOUT_SOURCE_PATH,
} from '../scripts/sync-shared.mjs'
// ⚠️ アプリ側の実装(正本)。functions 側の生成物がズレたらこのテストが落ちる。
import * as appModule from '../../src/utils/workspaceBackupLayout'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

function readRepoFile(relativePath: string) {
  return normalizeToLf(readFileSync(resolve(repoRoot, relativePath), 'utf8'))
}

const sha256 = (input: string) => createHash('sha256').update(input, 'utf8').digest('hex')

// 自動バックアップの教室別化(docs/spec-save-restore.md §10): パスの組み立て・教室ファイルと目次の形・3 点照合・全体の組み立て直しは
// **サーバー 1 つ・クライアント 1 つ**。片側だけ規則を変えると、サーバーが書いた教室ファイルをクライアントが組み立てられない
// (または別教室の照合がすり抜ける)。
describe('functions/src/generated/workspaceBackupLayout.ts は src/utils/workspaceBackupLayout.ts の複製(sync-shared)', () => {
  it('生成物 = ヘッダ 1 行 + 元ファイル(ズレていたら `npm --prefix functions run sync-shared` を実行してコミット)', () => {
    const source = readRepoFile(WORKSPACE_BACKUP_LAYOUT_SOURCE_PATH)
    const generated = readRepoFile(WORKSPACE_BACKUP_LAYOUT_OUTPUT_PATH)
    expect(generated.split('\n')[0]).toBe(WORKSPACE_BACKUP_LAYOUT_HEADER)
    expect(generated).toBe(`${WORKSPACE_BACKUP_LAYOUT_HEADER}\n${source}`)
    expect(generated).toBe(buildGeneratedContent(source, WORKSPACE_BACKUP_LAYOUT_SOURCE_PATH))
  })

  it('元ファイルは自己完結(import / ビルド時メタ情報 / CommonJS 読み込み / TextEncoder なし)で、複製先でも解決できる', () => {
    const source = readRepoFile(WORKSPACE_BACKUP_LAYOUT_SOURCE_PATH)
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toContain('import.' + 'meta')
    expect(source).not.toMatch(/\brequire\s*\(/)
    // functions の tsconfig(lib ES2022)には DOM の型が無いので、ブラウザ/DOM 由来のグローバルを使わない。
    expect(source).not.toMatch(/new\s+Text(En|De)coder\b/)
  })

  it('生成物を動的 import しても同じ export を持ち、同じ入力に同じパス・同じ教室ファイル・同じ組み立てを返す', async () => {
    const generatedModule = await import('./generated/workspaceBackupLayout') as typeof appModule
    expect(Object.keys(generatedModule).sort()).toEqual(Object.keys(appModule).sort())
    expect(generatedModule.WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM).toBe(appModule.WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM)
    expect(generatedModule.buildWorkspaceBackupClassroomStoragePath('main', '2026-10-29T15-00', 'c1')).toBe(appModule.buildWorkspaceBackupClassroomStoragePath('main', '2026-10-29T15-00', 'c1'))

    const classroom = { id: 'c1', name: '教室1', contractStatus: 'active', contractStartDate: '', contractEndDate: '', managerUserId: 'u1', isTemporarilySuspended: false, temporarySuspensionReason: '', data: { students: [{ id: 's1', name: '生徒A' }] } }
    const params = { workspaceKey: 'main', backupDateKey: '2026-10-29T15-00', savedAt: '2026-10-29T06:00:00.000Z', sourceSavedAt: 'src', classroom }
    const appJson = appModule.serializeWorkspaceBackupValue(appModule.buildWorkspaceBackupClassroomFile(params))
    const generatedJson = generatedModule.serializeWorkspaceBackupValue(generatedModule.buildWorkspaceBackupClassroomFile(params))
    expect(generatedJson).toBe(appJson)
    expect(generatedModule.measureWorkspaceBackupJsonBytes(appJson)).toBe(Buffer.byteLength(appJson, 'utf8'))

    const row = appModule.buildWorkspaceBackupIndexClassroom({ classroom, bytes: appModule.measureWorkspaceBackupJsonBytes(appJson), sha256: sha256(appJson), sourceSavedAt: 'src' })
    const index = appModule.buildWorkspaceBackupIndex({ workspaceKey: 'main', backupDateKey: '2026-10-29T15-00', savedAt: params.savedAt, sourceSavedAt: 'src', users: [], classrooms: [row], missingClassrooms: [] })
    const appAssembled = appModule.assembleWorkspaceBackupFromClassroomFiles(index, [{ classroomId: 'c1', json: appJson }], sha256)
    const generatedAssembled = generatedModule.assembleWorkspaceBackupFromClassroomFiles(generatedModule.validateWorkspaceBackupIndex(JSON.parse(JSON.stringify(index))), [{ classroomId: 'c1', json: generatedJson }], sha256)
    expect(generatedModule.stableStringifyWorkspaceBackupValue(generatedAssembled)).toBe(appModule.stableStringifyWorkspaceBackupValue(appAssembled))
    // 3 点照合は両側で同じ理由を返す。
    expect(() => generatedModule.validateWorkspaceBackupClassroomFile(JSON.parse(generatedJson), { workspaceKey: 'main', backupDateKey: '2026-10-29T15-00', classroomId: 'c2' })).toThrowError(expect.objectContaining({ reason: 'classroom-file-mismatch' }))
  })
})
