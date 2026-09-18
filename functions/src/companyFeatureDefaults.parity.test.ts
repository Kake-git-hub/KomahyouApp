import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  buildGeneratedContent,
  COMPANY_FEATURE_DEFAULTS_HEADER,
  COMPANY_FEATURE_DEFAULTS_OUTPUT_PATH,
  COMPANY_FEATURE_DEFAULTS_SOURCE_PATH,
  normalizeToLf,
} from '../scripts/sync-shared.mjs'
// ⚠️ アプリ側の実装(正本)。functions 側の生成物がズレたらこのテストが落ちる。
import * as appModule from '../../src/utils/companyFeatureDefaults'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

function readRepoFile(relativePath: string) {
  return normalizeToLf(readFileSync(resolve(repoRoot, relativePath), 'utf8'))
}

// 会社ごとの機能既定と 2 段解決(基本スコープ → 会社既定)はクライアントとサーバーの両方で使うが、**規則は 1 か所**。
// 片側だけ会社既定を変えると「保護者 QR は出るのに API は 403」(またはその逆)の非対称になる(docs/spec-multi-tenant.md §11)。
describe('functions/src/generated/companyFeatureDefaults.ts は src/utils/companyFeatureDefaults.ts の複製(sync-shared)', () => {
  it('生成物 = ヘッダ 1 行 + 元ファイル(ズレていたら `npm --prefix functions run sync-shared` を実行してコミット)', () => {
    const source = readRepoFile(COMPANY_FEATURE_DEFAULTS_SOURCE_PATH)
    const generated = readRepoFile(COMPANY_FEATURE_DEFAULTS_OUTPUT_PATH)
    expect(generated.split('\n')[0]).toBe(COMPANY_FEATURE_DEFAULTS_HEADER)
    expect(generated).toBe(`${COMPANY_FEATURE_DEFAULTS_HEADER}\n${source}`)
    expect(generated).toBe(buildGeneratedContent(source, COMPANY_FEATURE_DEFAULTS_SOURCE_PATH))
  })

  it('元ファイルは自己完結(import / ビルド時メタ情報 / CommonJS 読み込みなし)で、複製先でも解決できる', () => {
    const source = readRepoFile(COMPANY_FEATURE_DEFAULTS_SOURCE_PATH)
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toContain('import.' + 'meta')
    expect(source).not.toMatch(/\brequire\s*\(/)
  })

  it('生成物を動的 import しても同じ export を持ち、同じ入力に同じ結果を返す(二重実装のドリフト検出)', async () => {
    const generatedModule = await import('./generated/companyFeatureDefaults') as typeof appModule
    expect(Object.keys(generatedModule).sort()).toEqual(Object.keys(appModule).sort())
    expect(generatedModule.COMPANY_FEATURE_DEFAULTS).toEqual(appModule.COMPANY_FEATURE_DEFAULTS)

    const workspaceKeys = ['main', 'company-b', '', 'MAIN', ' main ']
    const featureKeys = ['parentPortalQr', 'questionAiAnswer', 'lessonHistory', 'unknown', '']
    for (const workspaceKey of workspaceKeys) {
      expect(generatedModule.resolveCompanyFeatureDefaults(workspaceKey), workspaceKey)
        .toEqual(appModule.resolveCompanyFeatureDefaults(workspaceKey))
      for (const featureKey of featureKeys) {
        const label = `${workspaceKey}/${featureKey}`
        expect(generatedModule.resolveCompanyFeatureDefault(workspaceKey, featureKey), label)
          .toBe(appModule.resolveCompanyFeatureDefault(workspaceKey, featureKey))
      }
    }
    for (const scopeEnabled of [true, false]) {
      for (const companyDefault of ['on', 'off', null] as const) {
        expect(generatedModule.resolveFeatureEnabledByLayers({ scopeEnabled, companyDefault }), `${scopeEnabled}/${companyDefault}`)
          .toBe(appModule.resolveFeatureEnabledByLayers({ scopeEnabled, companyDefault }))
      }
    }
  })
})
