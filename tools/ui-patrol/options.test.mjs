// tools/ui-patrol/options.mjs(引数・出力先の検査)を固定する。
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { USAGE, assertOutDirOutsideRepo, jstToday, parseArgs, validateArgs } from './options.mjs'

const OUT = ['--out', '/tmp/patrol-out']

describe('parseArgs / validateArgs', () => {
  it('既定: 教室は本番 2 校・台本は boot,c,b,a,d・移動 6・種 1・でたらめ 0・ポート 5199', () => {
    const options = parseArgs(OUT)
    expect(options.classrooms).toEqual(['5w5OMueETerSKrSf14HC', 'KzFnOQoTFLsCxwUp1tvh'])
    // 台本 d(テンプレを実際に変えて保存)は a(何も変えない保存)のあとに流れる(テンプレを変える台本は最後)。
    expect(options.scenarios).toEqual(['boot', 'c', 'b', 'a', 'd'])
    expect(options.moves).toBe(6)
    expect(options.seed).toBe(1)
    expect(options.random).toBe(0)
    expect(options.port).toBe(5199)
    expect(options.known).toBe('tools/ui-patrol-known.json')
    expect(options.key).toBe('')
    expect(options.headed).toBe(false)
    expect(options.prepareOnly).toBe(false)
    expect(validateArgs(options)).toEqual([])
  })

  it('指定した値を読む(--classroom と --seed-file は複数可・--scenario は boot を必ず含める)', () => {
    const options = parseArgs([...OUT, '--classroom', 'a1', '--classroom', 'b2', '--seed-file', '/x/1.json', '--seed-file', '/x/2.json', '--scenario', 'c,a', '--moves', '3', '--seed', '7', '--random', '2', '--key', '2026-11-10T23-45', '--port', '5200', '--headed', '--prepare-only', '--json'])
    expect(options.classrooms).toEqual(['a1', 'b2'])
    expect(options.seedFiles).toEqual(['/x/1.json', '/x/2.json'])
    expect(options.scenarios).toEqual(['boot', 'c', 'a'])
    expect([options.moves, options.seed, options.random, options.port]).toEqual([3, 7, 2, 5200])
    expect(options.key).toBe('2026-11-10T23-45')
    expect([options.headed, options.prepareOnly, options.json]).toEqual([true, true, true])
    expect(validateArgs(options)).toEqual([])
  })

  it('--out が無い・知らないオプション・値の無いオプション・--seed-file と --classroom の数が違う、は日本語で断る', () => {
    expect(validateArgs(parseArgs([])).join('\n')).toContain('--out')
    expect(validateArgs(parseArgs([...OUT, '--nope'])).join('\n')).toContain('--nope')
    expect(validateArgs(parseArgs([...OUT, '--moves'])).join('\n')).toContain('--moves の値がありません')
    expect(validateArgs(parseArgs([...OUT, '--seed-file', '/x/1.json'])).join('\n')).toContain('--seed-file')
    expect(validateArgs(parseArgs([...OUT, '--key', 'yesterday'])).join('\n')).toContain('--key')
    expect(validateArgs(parseArgs([...OUT, '--scenario', 'zzz'])).join('\n')).toContain('--scenario')
    expect(validateArgs(parseArgs([...OUT, '--scenario', 'zzz'])).join('\n')).toContain('boot,c,b,a,d')
    expect(validateArgs(parseArgs([...OUT, '--scenario', 'd']))).toEqual([])
    expect(parseArgs([...OUT, '--scenario', 'd']).scenarios).toEqual(['boot', 'd'])
    expect(validateArgs(parseArgs([...OUT, '--moves', 'abc'])).join('\n')).toContain('--moves')
    expect(validateArgs(parseArgs([...OUT, 'stray'])).join('\n')).toContain('stray')
  })

  it('--classroom は英数字・_・- だけ(`../` などで --out の外の <名前>.seed.json を消したり書いたりさせない)', () => {
    for (const bad of ['../x', '..', 'a/b', 'a\\b', 'a.b', 'a b', '/abs', '教室']) {
      expect(validateArgs(parseArgs([...OUT, '--classroom', bad])).join('\n')).toContain('--classroom')
    }
    expect(validateArgs(parseArgs([...OUT, '--classroom', 'test_classroom_20260507_dai', '--classroom', 'v8OZ7zH8vONNHjjYVcR1', '--classroom', 'a-b']))).toEqual([])
  })
})

describe('assertOutDirOutsideRepo', () => {
  const repo = path.resolve('/work/repo')
  it('出力先がリポジトリの中(リポジトリそのもの・docs/ の下)は throw。外は通す', () => {
    expect(() => assertOutDirOutsideRepo(repo, repo)).toThrow()
    expect(() => assertOutDirOutsideRepo(path.join(repo, 'docs', 'x'), repo)).toThrow()
    expect(() => assertOutDirOutsideRepo(`${repo}/../repo/tmp`, repo)).toThrow()
    expect(() => assertOutDirOutsideRepo(path.join(repo, '..foo'), repo)).toThrow()
    expect(() => assertOutDirOutsideRepo(path.join(repo, '..foo', 'x'), repo)).toThrow()
    expect(() => assertOutDirOutsideRepo('/work/repo-other/out', repo)).not.toThrow()
    expect(() => assertOutDirOutsideRepo('/tmp/patrol', repo)).not.toThrow()
  })
})

describe('assertOutDirOutsideRepo(シンボリックリンク)', () => {
  it('リポジトリの中を指すリンクの下は throw(リンクの外から見ても中)', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'patrol-link-'))
    try {
      const fakeRepo = path.join(base, 'repo')
      mkdirSync(path.join(fakeRepo, 'docs'), { recursive: true })
      const link = path.join(base, 'link')
      try {
        symlinkSync(fakeRepo, link)
      } catch {
        return // リンクを作れない環境は飛ばす
      }
      expect(() => assertOutDirOutsideRepo(path.join(link, 'docs', 'new'), fakeRepo)).toThrow()
      expect(() => assertOutDirOutsideRepo(path.join(base, 'elsewhere'), fakeRepo)).not.toThrow()
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('jstToday', () => {
  it('UTC 15:00 以降は JST の翌日', () => {
    expect(jstToday(Date.parse('2026-11-10T14:59:00Z'))).toBe('2026-11-10')
    expect(jstToday(Date.parse('2026-11-10T15:00:00Z'))).toBe('2026-11-11')
  })
})

describe('--baseline / --baseline-ref(第 2 段の 2)', () => {
  it('既定は無し。値を読む', () => {
    const none = parseArgs(OUT)
    expect([none.baseline, none.baselineRef]).toEqual(['', ''])
    expect(parseArgs([...OUT, '--baseline', '/x/report.json']).baseline).toBe('/x/report.json')
    expect(parseArgs([...OUT, '--baseline-ref', 'origin/main']).baselineRef).toBe('origin/main')
    expect(validateArgs(parseArgs([...OUT, '--baseline', '/x/report.json']))).toEqual([])
    expect(validateArgs(parseArgs([...OUT, '--baseline-ref', 'HEAD']))).toEqual([])
  })

  it('値が無いのは断る', () => {
    expect(validateArgs(parseArgs([...OUT, '--baseline'])).join('\n')).toContain('--baseline の値がありません')
    expect(validateArgs(parseArgs([...OUT, '--baseline-ref'])).join('\n')).toContain('--baseline-ref の値がありません')
  })

  it('--baseline と --baseline-ref の同時指定・--prepare-only との併用は断る', () => {
    expect(validateArgs(parseArgs([...OUT, '--baseline', '/x/r.json', '--baseline-ref', 'HEAD'])).join('\n')).toContain('同時に指定できません')
    expect(validateArgs(parseArgs([...OUT, '--baseline', '/x/r.json', '--prepare-only'])).join('\n')).toContain('--prepare-only')
    expect(validateArgs(parseArgs([...OUT, '--baseline-ref', 'HEAD', '--prepare-only'])).join('\n')).toContain('--prepare-only')
  })

  it('--baseline-ref の値は git のオプションに読まれない形だけ(先頭が - は断る)', () => {
    expect(validateArgs(parseArgs([...OUT, '--baseline-ref', '-x'])).join('\n')).toContain('git の ref')
  })

  it('USAGE に 2 つの引数がある', () => {
    expect(USAGE).toContain('--baseline <')
    expect(USAGE).toContain('--baseline-ref <')
  })
})
