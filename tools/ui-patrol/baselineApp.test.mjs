// tools/ui-patrol/baselineApp.mjs(--baseline-ref: 変更前のアプリを git archive で別の場所へ展開する)を固定する。
// git を使うので、一時フォルダ(mkdtemp)の中に作った git リポジトリだけで試す。このリポジトリ自体の状態には触れない。
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BaselineRefusal, prepareBaselineApp } from './baselineApp.mjs'

// git の hook の中から走ったとき、環境の GIT_DIR などでこのリポジトリを触らないよう消す。
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE'].includes(key)))
const GIT_ENV = { ...CLEAN_ENV, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' }
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env: GIT_ENV, encoding: 'utf8' })

const dirs = []
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'patrol-baseline-test-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 一時のリポジトリ: v1 の中身を commit する。node_modules は無視する実フォルダ(中に印のファイル)。 */
function makeRepo({ lock = 'lock-A', withHook = true } = {}) {
  const repo = tempDir()
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n.env.local\n')
  writeFileSync(path.join(repo, 'package-lock.json'), lock)
  mkdirSync(path.join(repo, 'src', 'utils'), { recursive: true })
  writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const v = 1\n')
  if (withHook) writeFileSync(path.join(repo, 'src', 'utils', 'uiPatrolHook.ts'), 'export {}\n')
  mkdirSync(path.join(repo, 'node_modules', 'dep'), { recursive: true })
  writeFileSync(path.join(repo, 'node_modules', 'dep', 'index.js'), 'module.exports = 1\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'v1')
  return repo
}

const snapshotState = (repo) => ({
  status: git(repo, 'status', '--porcelain', '--ignored'),
  head: git(repo, 'rev-parse', 'HEAD'),
  branches: git(repo, 'branch', '--list'),
  stash: git(repo, 'stash', 'list'),
  worktrees: git(repo, 'worktree', 'list'),
})

describe('prepareBaselineApp', () => {
  it('その ref の追跡ファイルだけを <out>/baseline-app へ展開する(作業ツリーの未コミットの変更は入らない)。node_modules はリポジトリへのリンク', async () => {
    const repo = makeRepo()
    const out = tempDir()
    // 作業ツリーでは v2 に書き換え(未コミット)。ref(HEAD)の v1 が展開されるはず。
    writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const v = 2\n')
    const { appDir, cleanup } = await prepareBaselineApp({ repoRoot: repo, ref: 'HEAD', outDir: out })
    expect(appDir).toBe(path.join(out, 'baseline-app'))
    expect(readFileSync(path.join(appDir, 'src', 'app.ts'), 'utf8')).toBe('export const v = 1\n')
    expect(existsSync(path.join(appDir, 'src', 'utils', 'uiPatrolHook.ts'))).toBe(true)
    expect(lstatSync(path.join(appDir, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(realpathSync(path.join(appDir, 'node_modules'))).toBe(realpathSync(path.join(repo, 'node_modules')))
    expect(readFileSync(path.join(appDir, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('module.exports = 1\n')
    await cleanup()
  })

  it('作業ツリー・index・ブランチ・stash・worktree に触れない(展開の前後で git status と HEAD が同じ)', async () => {
    const repo = makeRepo()
    const out = tempDir()
    writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const v = 2\n')
    writeFileSync(path.join(repo, 'untracked.txt'), 'x')
    git(repo, 'add', 'src/app.ts')
    const before = snapshotState(repo)
    const { cleanup } = await prepareBaselineApp({ repoRoot: repo, ref: 'HEAD', outDir: out })
    expect(snapshotState(repo)).toEqual(before)
    await cleanup()
    expect(snapshotState(repo)).toEqual(before)
    expect(readFileSync(path.join(repo, 'src', 'app.ts'), 'utf8')).toBe('export const v = 2\n')
  })

  it('別のコミットの ref も展開できる(HEAD でない版)', async () => {
    const repo = makeRepo()
    const out = tempDir()
    writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const v = 3\n')
    git(repo, 'commit', '-q', '-am', 'v3')
    const { appDir, cleanup } = await prepareBaselineApp({ repoRoot: repo, ref: 'HEAD~1', outDir: out })
    expect(readFileSync(path.join(appDir, 'src', 'app.ts'), 'utf8')).toBe('export const v = 1\n')
    await cleanup()
  })

  it('cleanup で <out>/baseline-app を消す。node_modules のリンク先(リポジトリの実物)は消さない。2 回呼んでも落ちない', async () => {
    const repo = makeRepo()
    const out = tempDir()
    const { appDir, cleanup } = await prepareBaselineApp({ repoRoot: repo, ref: 'HEAD', outDir: out })
    expect(existsSync(appDir)).toBe(true)
    await cleanup()
    expect(existsSync(appDir)).toBe(false)
    expect(readFileSync(path.join(repo, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('module.exports = 1\n')
    await cleanup()
  })

  it('前回の残り(<out>/baseline-app)があれば消してから展開する', async () => {
    const repo = makeRepo()
    const out = tempDir()
    mkdirSync(path.join(out, 'baseline-app', 'old'), { recursive: true })
    writeFileSync(path.join(out, 'baseline-app', 'old', 'stale.txt'), 'x')
    const { appDir, cleanup } = await prepareBaselineApp({ repoRoot: repo, ref: 'HEAD', outDir: out })
    expect(existsSync(path.join(appDir, 'old'))).toBe(false)
    await cleanup()
  })

  it('追跡されていない .env 系の設定(.env.local)は、今のアプリと同じ設定で動くよう複製する', async () => {
    const repo = makeRepo()
    const out = tempDir()
    writeFileSync(path.join(repo, '.env.local'), 'VITE_X=1\n')
    const { appDir, cleanup } = await prepareBaselineApp({ repoRoot: repo, ref: 'HEAD', outDir: out })
    expect(readFileSync(path.join(appDir, '.env.local'), 'utf8')).toBe('VITE_X=1\n')
    await cleanup()
  })

  it('解決できない ref・package-lock.json が今と違う ref・読み口(uiPatrolHook.ts)が無い ref は BaselineRefusal で断り、展開先を残さない', async () => {
    const repo = makeRepo()
    const out = tempDir()
    await expect(prepareBaselineApp({ repoRoot: repo, ref: 'no-such-ref', outDir: out })).rejects.toThrow(BaselineRefusal)
    await expect(prepareBaselineApp({ repoRoot: repo, ref: 'no-such-ref', outDir: out })).rejects.toThrow('解決できません')
    await expect(prepareBaselineApp({ repoRoot: repo, ref: '--version', outDir: out })).rejects.toThrow(BaselineRefusal)
    // 今の作業ツリーの package-lock.json が ref と違う
    writeFileSync(path.join(repo, 'package-lock.json'), 'lock-B')
    await expect(prepareBaselineApp({ repoRoot: repo, ref: 'HEAD', outDir: out })).rejects.toThrow('package-lock.json')
    expect(existsSync(path.join(out, 'baseline-app'))).toBe(false)
    // 読み口が無い版
    const old = makeRepo({ withHook: false })
    await expect(prepareBaselineApp({ repoRoot: old, ref: 'HEAD', outDir: out })).rejects.toThrow('uiPatrolHook.ts')
    expect(existsSync(path.join(out, 'baseline-app'))).toBe(false)
  })

  it('ref の package-lock.json が無い版も断る', async () => {
    const repo = makeRepo()
    const out = tempDir()
    git(repo, 'rm', '-q', 'package-lock.json')
    git(repo, 'commit', '-q', '-m', 'no lock')
    writeFileSync(path.join(repo, 'package-lock.json'), 'lock-A')
    await expect(prepareBaselineApp({ repoRoot: repo, ref: 'HEAD', outDir: out })).rejects.toThrow('package-lock.json')
  })

  it('outDir が相対 path で、cwd がリポジトリと違っても、tar も展開先も outDir の位置にでき、リポジトリ側に何もできない', async () => {
    const repo = makeRepo()
    const base = tempDir()
    const before = snapshotState(repo)
    const originalCwd = process.cwd()
    process.chdir(base)
    try {
      const { appDir, cleanup } = await prepareBaselineApp({ repoRoot: repo, ref: 'HEAD', outDir: './rel-out' })
      expect(path.isAbsolute(appDir)).toBe(true)
      expect(realpathSync(appDir)).toBe(realpathSync(path.join(base, 'rel-out', 'baseline-app')))
      expect(existsSync(path.join(appDir, 'src', 'app.ts'))).toBe(true)
      expect(existsSync(path.join(repo, 'rel-out'))).toBe(false)
      expect(existsSync(path.join(appDir, '..', 'baseline-app.tar'))).toBe(false)
      await cleanup()
      expect(existsSync(path.join(base, 'rel-out', 'baseline-app'))).toBe(false)
    } finally {
      process.chdir(originalCwd)
    }
    expect(snapshotState(repo)).toEqual(before)
    expect(existsSync(path.join(repo, 'rel-out'))).toBe(false)
  })

  it('node_modules のリンクは絶対パスの実体を指す', async () => {
    const repo = makeRepo()
    const out = tempDir()
    const { appDir, cleanup } = await prepareBaselineApp({ repoRoot: repo, ref: 'HEAD', outDir: out })
    expect(path.isAbsolute(readlinkSync(path.join(appDir, 'node_modules')))).toBe(true)
    await cleanup()
  })
})
