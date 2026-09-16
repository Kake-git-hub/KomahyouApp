import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  buildGeneratedContent,
  DEVELOPMENT_CLASSROOM_REGISTRY_HEADER,
  DEVELOPMENT_CLASSROOM_REGISTRY_OUTPUT_PATH,
  DEVELOPMENT_CLASSROOM_REGISTRY_SOURCE_PATH,
  normalizeToLf,
} from '../scripts/sync-shared.mjs'
// ⚠️ アプリ側の実装(正本)。functions 側の生成物がズレたらこのテストが落ちる。
import * as appModule from '../../src/utils/developmentClassroomRegistry'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

function readRepoFile(relativePath: string) {
  return normalizeToLf(readFileSync(resolve(repoRoot, relativePath), 'utf8'))
}

// 検証用教室の判定はクライアントとサーバーの両方で使うが、**規則は 1 か所**(登録台帳)。
// サーバーは sync-shared の複製を読む。二重実装へ戻ると「片側だけ広い/狭い」の非対称が生まれ、
// 2026-07-09 のQR混入事故と同型の穴になる。
describe('functions/src/generated/developmentClassroomRegistry.ts は src/utils/developmentClassroomRegistry.ts の複製(sync-shared)', () => {
  it('生成物 = ヘッダ 1 行 + 元ファイル(ズレていたら `npm --prefix functions run sync-shared` を実行してコミット)', () => {
    const source = readRepoFile(DEVELOPMENT_CLASSROOM_REGISTRY_SOURCE_PATH)
    const generated = readRepoFile(DEVELOPMENT_CLASSROOM_REGISTRY_OUTPUT_PATH)
    expect(generated.split('\n')[0]).toBe(DEVELOPMENT_CLASSROOM_REGISTRY_HEADER)
    expect(generated).toBe(`${DEVELOPMENT_CLASSROOM_REGISTRY_HEADER}\n${source}`)
    expect(generated).toBe(buildGeneratedContent(source, DEVELOPMENT_CLASSROOM_REGISTRY_SOURCE_PATH))
  })

  it('元ファイルは自己完結(import / ビルド時メタ情報 / CommonJS 読み込みなし)で、複製先でも解決できる', () => {
    const source = readRepoFile(DEVELOPMENT_CLASSROOM_REGISTRY_SOURCE_PATH)
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toContain('import.' + 'meta')
    expect(source).not.toMatch(/\brequire\s*\(/)
  })

  it('生成物を動的 import しても同じ export を持ち、同じ入力に同じ結果を返す(二重実装のドリフト検出)', async () => {
    const generatedModule = await import('./generated/developmentClassroomRegistry') as typeof appModule
    expect(Object.keys(generatedModule).sort()).toEqual(Object.keys(appModule).sort())
    expect(generatedModule.DEVELOPMENT_CLASSROOM_REGISTRY).toEqual(appModule.DEVELOPMENT_CLASSROOM_REGISTRY)

    const workspaceKeys = ['main', 'company-b', '', 'MAIN', ' main ']
    const classroomIds = [
      'v8OZ7zH8vONNHjjYVcR1',
      'test_classroom_20260507_dai',
      '5w5OMueETerSKrSf14HC',
      'KzFnOQoTFLsCxwUp1tvh',
      '6xnnbSTbwgGrBLy0EJKb',
      'development',
      'dev',
      'dev_room_001',
      'classroom-1',
      '',
      '   ',
    ]
    for (const workspaceKey of workspaceKeys) {
      expect(generatedModule.resolveDevelopmentClassroomId(workspaceKey), workspaceKey)
        .toBe(appModule.resolveDevelopmentClassroomId(workspaceKey))
      for (const classroomId of classroomIds) {
        const label = `${workspaceKey}/${classroomId}`
        expect(generatedModule.isRegisteredDevelopmentClassroom(workspaceKey, classroomId), label)
          .toBe(appModule.isRegisteredDevelopmentClassroom(workspaceKey, classroomId))
        expect(generatedModule.findDevelopmentClassroomEntry(workspaceKey, classroomId), label)
          .toEqual(appModule.findDevelopmentClassroomEntry(workspaceKey, classroomId))
      }
    }
  })

  // サーバー側のラッパが「台帳へ委譲するだけ」であること(規則の手書きコピーを再発させない)。
  it('functions/src/developmentClassroomIdentity.ts は生成物へ委譲するだけで、教室ID・教室名を直書きしない', () => {
    const wrapper = readRepoFile('functions/src/developmentClassroomIdentity.ts')
    expect(wrapper).toContain("from './generated/developmentClassroomRegistry'")
    // コメント(行 // と JSDoc)中の説明は除いて、コードとして教室ID・旧規則が現れないこと。
    const code = wrapper.split('\n')
      .filter((line) => {
        const trimmed = line.trimStart()
        return !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')
      })
      .join('\n')
    expect(code).not.toContain('v8OZ7zH8vONNHjjYVcR1')
    expect(code).not.toContain('test_classroom_20260507_dai')
    expect(code).not.toContain('開発用教室')
    expect(code).not.toContain('SANDBOX_CLASSROOM_IDS')
  })
})
