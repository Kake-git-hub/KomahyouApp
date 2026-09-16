import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isInvokedDirectly } from './invoked-directly.mjs'

// CLI ツールの「直接実行されたときだけ動かす」判定の共通ヘルパ(2026-09-16)。
// 集約前は 3 通りの書き方が混在し、シンボリックリンク/ジャンクション越しの起動や相対パス起動で
// 不一致になり、ツールが**何も出力せず exit 0** で終わっていた(「実行したのに何も起きない」)。

const HELPER_PATH = fileURLToPath(new URL('./invoked-directly.mjs', import.meta.url))
const HELPER_URL = new URL('./invoked-directly.mjs', import.meta.url).href
const TOOLS_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(TOOLS_DIR, '..')

describe('isInvokedDirectly', () => {
  it('argv[1] が同一ファイルなら true', () => {
    expect(isInvokedDirectly(HELPER_URL, HELPER_PATH)).toBe(true)
  })

  it('argv[1] が別ファイルなら false(テストから import しても実行しない)', () => {
    expect(isInvokedDirectly(HELPER_URL, fileURLToPath(import.meta.url))).toBe(false)
    expect(isInvokedDirectly(HELPER_URL, join(TOOLS_DIR, 'uptime-check.mjs'))).toBe(false)
  })

  it('argv[1] が未定義・空なら false(REPL / node -e)', () => {
    expect(isInvokedDirectly(HELPER_URL, undefined)).toBe(false)
    expect(isInvokedDirectly(HELPER_URL, '')).toBe(false)
    expect(isInvokedDirectly(HELPER_URL, '   ')).toBe(false)
  })

  it('import.meta.url が空・不正でも落ちずに false', () => {
    expect(isInvokedDirectly('', HELPER_PATH)).toBe(false)
    expect(isInvokedDirectly('not-a-url', HELPER_PATH)).toBe(false)
  })

  // 旧方式 B(`process.argv[1] === fileURLToPath(import.meta.url)`)はここで落ちた。
  it('相対パスで起動しても true(`node tools/invoked-directly.mjs`)', () => {
    const relativeFromRepoRoot = 'tools/invoked-directly.mjs'
    const previousCwd = process.cwd()
    process.chdir(REPO_ROOT)
    try {
      expect(isInvokedDirectly(HELPER_URL, relativeFromRepoRoot)).toBe(true)
      // バックスラッシュ区切りは Windows だけの表記(Linux の CI ではファイル名の一部になり不一致が正)。
      if (process.platform === 'win32') {
        expect(isInvokedDirectly(HELPER_URL, `.\\${relativeFromRepoRoot.replace('/', '\\')}`)).toBe(true)
      }
    } finally {
      process.chdir(previousCwd)
    }
  })

  // 旧方式 C(``new URL(`file://${process.argv[1]}`).href``)は Windows のドライブレターや
  // 空白・日本語を含むパスでここが食い違った。
  it('区切り文字の違い(スラッシュ/バックスラッシュ)を吸収する', () => {
    expect(isInvokedDirectly(HELPER_URL, HELPER_PATH.replace(/\\/gu, '/'))).toBe(true)
  })

  // 本命: リンク越しの起動で無言 exit 0 しない。
  it('ジャンクション/シンボリックリンク越しの argv[1] でも true', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'invoked-directly-'))
    const linkPath = join(tempRoot, 'tools-link')
    try {
      symlinkSync(TOOLS_DIR, linkPath, 'junction')
    } catch {
      // 権限が無い環境ではリンクを作れない。判定の実装(realpathSync)自体は他のケースで担保済み。
      rmSync(tempRoot, { recursive: true, force: true })
      return
    }
    try {
      expect(isInvokedDirectly(HELPER_URL, join(linkPath, 'invoked-directly.mjs'))).toBe(true)
      // リンク越しでも「別ファイル」は false のまま(実体比較なので緩くならない)。
      expect(isInvokedDirectly(HELPER_URL, join(linkPath, 'uptime-check.mjs'))).toBe(false)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})

// 判定を再び各ツールへ手書きさせない(3 方式の混在に戻さない)。
describe('CLI ツールの直接実行判定は共通ヘルパ 1 方式に揃える', () => {
  const scanTargets = [
    ...readdirSync(TOOLS_DIR).filter((name) => name.endsWith('.mjs')).map((name) => join(TOOLS_DIR, name)),
    ...readdirSync(join(REPO_ROOT, 'functions', 'scripts')).filter((name) => name.endsWith('.mjs')).map((name) => join(REPO_ROOT, 'functions', 'scripts', name)),
  ].filter((path) => !path.endsWith('.test.mjs') && path !== HELPER_PATH)

  it('自前の argv[1] 比較(旧 3 方式)が 1 つも残っていない', () => {
    for (const path of scanTargets) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/process\.argv\[1\]\s*===/u)
      expect(source, path).not.toMatch(/resolve\(process\.argv\[1\]\)/u)
      expect(source, path).not.toMatch(/new URL\(`file:\/\/\$\{process\.argv\[1\]\}`\)/u)
    }
  })

  it('直接実行判定を持つツールは共通ヘルパを import している', () => {
    const usingHelper = scanTargets.filter((path) => readFileSync(path, 'utf8').includes('isInvokedDirectly(import.meta.url)'))
    expect(usingHelper.length).toBeGreaterThanOrEqual(8)
    for (const path of usingHelper) {
      expect(readFileSync(path, 'utf8'), path).toMatch(/import \{ isInvokedDirectly \} from '(\.|\.\.\/\.\.\/tools)\/invoked-directly\.mjs'/u)
    }
  })
})
