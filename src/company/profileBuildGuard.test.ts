// vite.config.ts のビルド時ガード(P-1): env の会社キーに対応する src/company/profiles/<会社キー>.ts が無ければビルドを止める。
// 実行時の規則(src/company/profile.ts resolveCompanyKeyFromEnv)と同じ優先順・同じ食い違い検査であることをここで固定する。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { resolveCompanyKeyForBuild } from '../../vite.config'
import { resolveCompanyKeyFromEnv } from './profile'

const tempDir = mkdtempSync(join(tmpdir(), 'company-profiles-'))
writeFileSync(join(tempDir, 'main.ts'), '')
writeFileSync(join(tempDir, 'xyz.ts'), '')

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('vite.config.ts resolveCompanyKeyForBuild(ビルド時 fail-closed)', () => {
  it('env 無し → main / VITE_FIREBASE_WORKSPACE_KEY → その会社 / VITE_COMPANY_KEY が最優先(実行時の規則と同じ)', () => {
    const cases: Array<Record<string, string | undefined>> = [
      {},
      { VITE_FIREBASE_WORKSPACE_KEY: 'main' },
      { VITE_FIREBASE_WORKSPACE_KEY: 'xyz' },
      { VITE_COMPANY_KEY: 'xyz' },
      { VITE_COMPANY_KEY: 'xyz', VITE_FIREBASE_WORKSPACE_KEY: 'xyz' },
      { VITE_COMPANY_KEY: ' main ', VITE_FIREBASE_WORKSPACE_KEY: '' },
    ]
    for (const env of cases) {
      expect(resolveCompanyKeyForBuild(env, tempDir), JSON.stringify(env)).toBe(resolveCompanyKeyFromEnv(env))
    }
  })

  it('プロファイルのファイルが無い会社キーはビルド失敗', () => {
    expect(() => resolveCompanyKeyForBuild({ VITE_COMPANY_KEY: 'abc' }, tempDir)).toThrow(/profiles\/abc\.ts がありません/)
  })

  it('会社キーと接続先 workspace の食い違い・命名規則違反はビルド失敗', () => {
    expect(() => resolveCompanyKeyForBuild({ VITE_COMPANY_KEY: 'xyz', VITE_FIREBASE_WORKSPACE_KEY: 'main' }, tempDir)).toThrow(/食い違って/)
    expect(() => resolveCompanyKeyForBuild({ VITE_COMPANY_KEY: 'XYZ' }, tempDir)).toThrow(/命名規則/)
    expect(() => resolveCompanyKeyForBuild({ VITE_COMPANY_KEY: 'ab' }, tempDir)).toThrow(/命名規則/)
    expect(() => resolveCompanyKeyForBuild({ VITE_COMPANY_KEY: '../main' }, tempDir)).toThrow(/命名規則/)
  })

  it('実リポジトリの profiles/ では main が通る(既存運営会社のビルドは常に成立)', () => {
    expect(resolveCompanyKeyForBuild({})).toBe('main')
    expect(resolveCompanyKeyForBuild({ VITE_FIREBASE_WORKSPACE_KEY: 'main' })).toBe('main')
  })
})
