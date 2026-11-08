// tools/feature-flag-rollback.mjs(全教室へ出した機能フラグを 1 本ずつ戻すスクリプト)の純関数を固定する。
// フィクスチャは実ファイルを読まず、該当ブロックだけを模した短い文字列(架空)を使う。
// ★vitest で書く(vitest.config.ts が tools/**/*.test.mjs を拾うため。node:test で書くと npm run test:unit が
//   「テストが無いファイル」で落ちる)。実行: npx vitest run tools/feature-flag-rollback.test.mjs
import { describe, it, expect } from 'vitest'
import {
  applyFeatureFlagRollback,
  FLAG_DISPLAY_NAMES,
  PREVIOUS_SCOPES,
  ROLLBACK_FILE_PATHS,
  parseArgs,
  summarizeChange,
} from './feature-flag-rollback.mjs'

const FEATURE_ROLLOUT = [
  'export const featureRolloutRegistry = {',
  '  otherFlag: {',
  "    scope: 'all-classrooms',",
  "    description: 'other',",
  '  },',
  '  parentPortalQr: {',
  "    scope: 'all-classrooms',",
  "    description: 'parent portal',",
  '  },',
  '  templateDiffApply: {',
  "    scope: 'all-classrooms',",
  "    description: 'template diff',",
  '  },',
  '  lectureSchedulePublishToggle: {',
  "    scope: 'all-classrooms',",
  "    description: 'publish',",
  '  },',
  '  teacherOnlySpecialSession: {',
  "    scope: 'development-only',",
  "    description: 'teacher only',",
  '  },',
  '}',
  '',
  'export const FEATURE_ROLLBACKS: Partial<Record<FeatureRolloutKey, FeatureRollbackRecord>> = {}',
  '',
  '// 波括弧の外の似た字面(書き換えない)',
  "const decoy = { templateDiffApply: { from: 'all-classrooms', to: 'x' } }",
  '',
].join('\n')

const PARENT_PORTAL = [
  "export const PARENT_PORTAL_STAGING_PROJECT_ID = 'komahyouapp-staging'",
  "export const PARENT_PORTAL_BASE_SCOPE: 'staging-environment' | 'all-classrooms' = 'all-classrooms'",
  '',
].join('\n')

const LEDGER = [
  "import type { FeatureRolloutKey } from './featureRollout'",
  '',
  'export const DEVELOPMENT_STATUS_LEDGER: readonly DevelopmentStatusEntry[] = [',
  '  // ── 開発・テスト教室だけで動いている機能 ──',
  '  // 次の先行機能はここへ足す。',
  '  {',
  "    id: 'existing-row',",
  "    title: '既存の行',",
  '  },',
  ']',
  '',
].join('\n')

const CHANGELOG = ['# 更新リスト', '', '## 未リリース', '', '- fix: 既存の行', '', '## v1.0.0 (2026-01-01)', ''].join('\n')

function makeFiles() {
  return {
    'src/utils/featureRollout.ts': FEATURE_ROLLOUT,
    'functions/src/parentPortal.ts': PARENT_PORTAL,
    'src/utils/developmentStatusLedger.ts': LEDGER,
    'CHANGELOG.md': CHANGELOG,
  }
}

function run(overrides = {}) {
  return applyFeatureFlagRollback({ files: makeFiles(), flagKey: 'templateDiffApply', toScope: 'development-only', reason: '予行', today: '2026-11-08', ...overrides })
}

function scopeOf(source, key) {
  const match = new RegExp(`\\n  ${key}: \\{\\n    scope: '([a-z-]+)'`, 'u').exec(source)
  return match?.[1]
}

function rollbacksBlockOf(source) {
  return /export const FEATURE_ROLLBACKS: [^=\n]*= \{([\s\S]*?)\n?\}\n/u.exec(source)?.[1] ?? null
}

// 台帳に足した行(TS のオブジェクトリテラル)を取り出して評価する(架空データ・自前で書いた文字列だけ)。
function parseLedgerRow(rowText) {
  return new Function(`return (${rowText.trim().replace(/,\s*$/u, '')})`)()
}

describe('applyFeatureFlagRollback', () => {
  it('ファイルの組は 4 つの相対パスに固定', () => {
    expect([...ROLLBACK_FILE_PATHS].sort()).toEqual(Object.keys(makeFiles()).sort())
    expect(PREVIOUS_SCOPES).toEqual({
      parentPortalQr: 'staging-environment',
      lectureSchedulePublishToggle: 'staging-environment',
      teacherOnlySpecialSession: 'staging-environment',
      templateDiffApply: 'development-only',
    })
    expect(Object.keys(FLAG_DISPLAY_NAMES).sort()).toEqual(Object.keys(PREVIOUS_SCOPES).sort())
  })

  it('templateDiffApply を development-only へ: featureRollout.ts の scope だけが変わり parentPortal.ts は不変', () => {
    const result = run()
    const rollout = result.files['src/utils/featureRollout.ts']
    expect(scopeOf(rollout, 'templateDiffApply')).toBe('development-only')
    // 他のフラグに触れない
    expect(scopeOf(rollout, 'otherFlag')).toBe('all-classrooms')
    expect(scopeOf(rollout, 'parentPortalQr')).toBe('all-classrooms')
    expect(scopeOf(rollout, 'lectureSchedulePublishToggle')).toBe('all-classrooms')
    // scope の 1 行と FEATURE_ROLLBACKS の中身だけが変わる(戻すと元の文字列と完全一致)
    expect(
      rollout
        .replace("templateDiffApply: {\n    scope: 'development-only'", "templateDiffApply: {\n    scope: 'all-classrooms'")
        .replace(/(export const FEATURE_ROLLBACKS: [^=\n]*= )\{[\s\S]*?\n\}\n/u, '$1{}\n'),
    ).toBe(FEATURE_ROLLOUT)
    expect(result.files['functions/src/parentPortal.ts']).toBe(PARENT_PORTAL)
    expect(result.changedPaths).toEqual(['src/utils/featureRollout.ts', 'src/utils/developmentStatusLedger.ts', 'CHANGELOG.md'])
  })

  it('parentPortalQr を staging-environment へ: featureRollout.ts と parentPortal.ts の PARENT_PORTAL_BASE_SCOPE の両方が変わる', () => {
    const result = run({ flagKey: 'parentPortalQr', toScope: 'staging-environment' })
    expect(scopeOf(result.files['src/utils/featureRollout.ts'], 'parentPortalQr')).toBe('staging-environment')
    expect(scopeOf(result.files['src/utils/featureRollout.ts'], 'templateDiffApply')).toBe('all-classrooms')
    const server = result.files['functions/src/parentPortal.ts']
    // featureRollout.test.ts と同じ正規表現で読む(字面の突合が通る形)
    expect(/export const PARENT_PORTAL_BASE_SCOPE[^=]*= '([a-z-]+)'/u.exec(server)?.[1]).toBe('staging-environment')
    // 型注釈は変えない
    expect(server).toContain("PARENT_PORTAL_BASE_SCOPE: 'staging-environment' | 'all-classrooms' = 'staging-environment'")
    expect(server.replace("= 'staging-environment'\n", "= 'all-classrooms'\n")).toBe(PARENT_PORTAL)
    expect(result.changedPaths).toEqual(['src/utils/featureRollout.ts', 'functions/src/parentPortal.ts', 'src/utils/developmentStatusLedger.ts', 'CHANGELOG.md'])
  })

  it('FEATURE_ROLLBACKS の波括弧の中へ { from, to, date, reason } を 1 項目足す(外の似た字面は書き換えない)', () => {
    const first = run({ reason: "講師の机が 'A' に" })
    const rollout = first.files['src/utils/featureRollout.ts']
    expect(rollbacksBlockOf(rollout)).toBe("\n  templateDiffApply: { from: 'all-classrooms', to: 'development-only', date: '2026-11-08', reason: '講師の机が \\'A\\' に' },")
    expect(rollout).toContain("const decoy = { templateDiffApply: { from: 'all-classrooms', to: 'x' } }")
    // 2 本目は同じ波括弧の末尾へ足す
    const second = applyFeatureFlagRollback({ files: first.files, flagKey: 'parentPortalQr', toScope: 'staging-environment', reason: '予行', today: '2026-11-09' })
    const block = rollbacksBlockOf(second.files['src/utils/featureRollout.ts'])
    expect(block.split('\n').filter(Boolean)).toEqual([
      "  templateDiffApply: { from: 'all-classrooms', to: 'development-only', date: '2026-11-08', reason: '講師の机が \\'A\\' に' },",
      "  parentPortalQr: { from: 'all-classrooms', to: 'staging-environment', date: '2026-11-09', reason: '予行' },",
    ])
    // 記録を TS として評価すると型どおりの値になる
    const evaluated = new Function(`return {${block}}`)()
    expect(evaluated.templateDiffApply).toEqual({ from: 'all-classrooms', to: 'development-only', date: '2026-11-08', reason: "講師の机が 'A' に" })
  })

  it('同じキーの記録が既にあり戻し先が違うときはエラー(scope は新しい値・記録は古い値の半端な状態を作らない)', () => {
    const files = makeFiles()
    files['src/utils/featureRollout.ts'] = FEATURE_ROLLOUT.replace(
      'export const FEATURE_ROLLBACKS: Partial<Record<FeatureRolloutKey, FeatureRollbackRecord>> = {}',
      "export const FEATURE_ROLLBACKS: Partial<Record<FeatureRolloutKey, FeatureRollbackRecord>> = {\n  lectureSchedulePublishToggle: { from: 'all-classrooms', to: 'development-only', date: '2026-11-08', reason: '前回' },\n}",
    )
    expect(() => applyFeatureFlagRollback({ files, flagKey: 'lectureSchedulePublishToggle', toScope: 'staging-environment', reason: 'x', today: '2026-11-09' })).toThrow(/記録/u)
    // 同じ戻し先なら記録はそのまま(scope だけ戻し先へ)
    const same = applyFeatureFlagRollback({ files, flagKey: 'lectureSchedulePublishToggle', toScope: 'development-only', reason: 'x', today: '2026-11-09' })
    expect(same.files['src/utils/featureRollout.ts']).toContain("reason: '前回' },")
    expect(same.files['src/utils/featureRollout.ts'].match(/lectureSchedulePublishToggle: \{ from/gu)).toHaveLength(1)
  })

  it('FEATURE_ROLLBACKS が無い featureRollout.ts はエラー(何も書かない)', () => {
    const files = { ...makeFiles(), 'src/utils/featureRollout.ts': FEATURE_ROLLOUT.replace(/export const FEATURE_ROLLBACKS[^\n]*\n/u, '') }
    expect(() => applyFeatureFlagRollback({ files, flagKey: 'templateDiffApply', toScope: 'development-only', reason: 'x', today: '2026-11-08' })).toThrow(/FEATURE_ROLLBACKS/u)
  })

  it('parentPortalQr を development-only へは戻せない(サーバーの型と述語が staging も通すため・何も書かない)', () => {
    expect(() => run({ flagKey: 'parentPortalQr', toScope: 'development-only' })).toThrow(/development-only/u)
  })

  it('台帳に stage=development-only・featureKeys=[flagKey] の行を 1 つ足し、title<=40・summary<=140・nextAction<=110 で社内記号を含まない', () => {
    const jargon = /\b[a-z]{1,3}(?:-[a-z]{1,3})?-\d+\b|§|\bQ\d+|\bv\d+\.\d+\.\d+|INV-\d+/u
    for (const [flagKey, toScope] of Object.entries(PREVIOUS_SCOPES)) {
      for (const reason of ['予行', 'Q40 の件で tp-51 が v1.5.711 から崩れた。'.repeat(8)]) {
        const files = makeFiles()
        // teacherOnlySpecialSession はフィクスチャで development-only なので all-classrooms にしてから当てる
        files['src/utils/featureRollout.ts'] = FEATURE_ROLLOUT.replace("teacherOnlySpecialSession: {\n    scope: 'development-only'", "teacherOnlySpecialSession: {\n    scope: 'all-classrooms'")
        const result = applyFeatureFlagRollback({ files, flagKey, toScope, reason, today: '2026-11-08' })
        const ledger = result.files['src/utils/developmentStatusLedger.ts']
        // 先頭の欄(コメントの後ろ・既存の行の前)へ 1 行だけ足す
        expect(ledger.split("    id: '").length - 1).toBe(2)
        expect(ledger.indexOf(result.ledgerRow.trim())).toBeGreaterThan(ledger.indexOf('次の先行機能はここへ足す。'))
        expect(ledger.indexOf(result.ledgerRow.trim())).toBeLessThan(ledger.indexOf("id: 'existing-row'"))
        const row = parseLedgerRow(result.ledgerRow)
        expect(row.stage).toBe('development-only')
        expect(row.featureKeys).toEqual([flagKey])
        expect(row.id).toMatch(/^[a-z0-9-]+$/u)
        expect(row.updatedOn).toBe('2026-11-08')
        expect(row.references.length).toBeGreaterThan(0)
        expect(row.title).toContain(FLAG_DISPLAY_NAMES[flagKey])
        expect(row.title.length).toBeLessThanOrEqual(40)
        expect(row.summary.length).toBeLessThanOrEqual(140)
        expect(row.nextAction.length).toBeLessThanOrEqual(110)
        for (const text of [row.title, row.summary, row.nextAction]) expect(text).not.toMatch(jargon)
        // 理由の全文は notes に残す
        expect(row.notes).toContain(reason.trim())
      }
    }
  })

  it('理由に引用符・バックスラッシュ・改行があっても台帳の行は正しい文字列になる', () => {
    const reason = "室長の 'A' が\\困った\n2 行目"
    const row = parseLedgerRow(run({ reason }).ledgerRow)
    expect(row.notes).toContain("室長の 'A' が\\困った 2 行目")
  })

  it('CHANGELOG の「## 未リリース」節の末尾(次の見出しの直前)に "- fix: 機能フラグ <key> を全教室から <scope> へ戻す(理由: <reason>・戻し手順書)" を 1 行入れる', () => {
    const result = run({ reason: '講師の机が消えた' })
    const expectedLine = '- fix: 機能フラグ templateDiffApply を全教室から development-only へ戻す(理由: 講師の机が消えた・戻し手順書)'
    expect(result.files['CHANGELOG.md']).toBe(['# 更新リスト', '', '## 未リリース', '', '- fix: 既存の行', expectedLine, '', '## v1.0.0 (2026-01-01)', ''].join('\n'))
    // 節が空のとき・後ろに見出しが無いとき
    const empty = run({ files: { ...makeFiles(), 'CHANGELOG.md': '## 未リリース\n\n## v1.0.0\n' } }).files['CHANGELOG.md']
    expect(empty).toBe(`## 未リリース\n\n${expectedLine.replace('講師の机が消えた', '予行')}\n\n## v1.0.0\n`)
    const last = run({ files: { ...makeFiles(), 'CHANGELOG.md': '## 未リリース\n\n- a\n' } }).files['CHANGELOG.md']
    expect(last).toBe(`## 未リリース\n\n- a\n${expectedLine.replace('講師の机が消えた', '予行')}\n`)
  })

  it('未知のキー・all-classrooms でないフラグ・reason 空はエラー(何も書かない)', () => {
    const files = makeFiles()
    const snapshot = JSON.stringify(files)
    expect(() => applyFeatureFlagRollback({ files, flagKey: 'otherFlag', toScope: 'development-only', reason: 'x', today: '2026-11-08' })).toThrow(/未知/u)
    expect(() => applyFeatureFlagRollback({ files, flagKey: 'nope', toScope: 'development-only', reason: 'x', today: '2026-11-08' })).toThrow(/未知/u)
    // teacherOnlySpecialSession はフィクスチャで development-only(all-classrooms でない・行き先とも違う)
    expect(() => applyFeatureFlagRollback({ files, flagKey: 'teacherOnlySpecialSession', toScope: 'staging-environment', reason: 'x', today: '2026-11-08' })).toThrow(/all-classrooms/u)
    expect(() => applyFeatureFlagRollback({ files, flagKey: 'templateDiffApply', toScope: 'development-only', reason: '   ', today: '2026-11-08' })).toThrow(/理由/u)
    expect(() => applyFeatureFlagRollback({ files, flagKey: 'templateDiffApply', toScope: 'all-classrooms', reason: 'x', today: '2026-11-08' })).toThrow(/戻し先/u)
    expect(() => applyFeatureFlagRollback({ files, flagKey: 'templateDiffApply', toScope: 'development-only', reason: 'x', today: '11/8' })).toThrow(/日付/u)
    const broken = { ...makeFiles(), 'CHANGELOG.md': '# 未リリースの見出しが無い\n' }
    expect(() => applyFeatureFlagRollback({ files: broken, flagKey: 'templateDiffApply', toScope: 'development-only', reason: 'x', today: '2026-11-08' })).toThrow(/未リリース/u)
    const missing = { ...makeFiles() }
    delete missing['functions/src/parentPortal.ts']
    expect(() => applyFeatureFlagRollback({ files: missing, flagKey: 'templateDiffApply', toScope: 'development-only', reason: 'x', today: '2026-11-08' })).toThrow(/parentPortal/u)
    expect(JSON.stringify(files)).toBe(snapshot)
  })

  it('同じ入力を 2 回当てても 2 回目は何も変えない(冪等)', () => {
    for (const [flagKey, toScope] of [['templateDiffApply', 'development-only'], ['parentPortalQr', 'staging-environment']]) {
      const first = run({ flagKey, toScope })
      const second = applyFeatureFlagRollback({ files: first.files, flagKey, toScope, reason: '予行', today: '2026-11-08' })
      expect(second.changedPaths).toEqual([])
      expect(second.files).toEqual(first.files)
    }
  })
})

describe('parseArgs', () => {
  it('フラグ・理由・戻し先・dry-run を読む。戻し先の既定は昇格前の scope', () => {
    expect(parseArgs(['templateDiffApply', '--reason', '予行', '--dry-run'])).toEqual({ flagKey: 'templateDiffApply', reason: '予行', toScope: 'development-only', dryRun: true })
    expect(parseArgs(['parentPortalQr', '--reason=予行'])).toEqual({ flagKey: 'parentPortalQr', reason: '予行', toScope: 'staging-environment', dryRun: false })
    expect(parseArgs(['lectureSchedulePublishToggle', '--reason', 'x', '--to', 'development-only']).toScope).toBe('development-only')
  })
  it('フラグ名や --reason が無ければエラー', () => {
    expect(() => parseArgs([])).toThrow(/使い方/u)
    expect(() => parseArgs(['templateDiffApply'])).toThrow(/--reason/u)
    expect(() => parseArgs(['templateDiffApply', '--reason', 'x', '--bogus'])).toThrow(/--bogus/u)
  })
})

describe('summarizeChange', () => {
  it('離れた 2 か所の変更を別の塊で出す(間の行は出さない)', () => {
    const before = ['a', 'b', 'x', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n')
    const after = ['a', 'b', 'y', 'c', 'd', 'e', 'f', 'g', 'new', 'h'].join('\n')
    expect(summarizeChange(before, after)).toBe(['  @@ 3 行目から', '  - x', '  + y', '  @@ 9 行目から', '  + new'].join('\n'))
  })
  it('同じなら空', () => {
    expect(summarizeChange('a\nb', 'a\nb')).toBe('')
  })
})
