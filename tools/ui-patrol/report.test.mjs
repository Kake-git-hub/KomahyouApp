// tools/ui-patrol/report.mjs(巡回の報告・終了コード)を固定する。
import { describe, it, expect } from 'vitest'
import { addStep, createClassroomReport, createPatrolReport, formatPatrolReportText, resolveExitCode, summarizeReport } from './report.mjs'

function step(overrides = {}) {
  return { name: 'boot', title: '起動', durationMs: 10, operations: 2, findings: [], notes: [], ...overrides }
}

function classroom(steps = [], extra = {}) {
  let report = createClassroomReport({ classroomId: 'room1', label: '教室A', backupKey: '2026-11-10T23-45' })
  for (const item of steps) report = addStep(report, item)
  return { ...report, ...extra }
}

function patrol(classrooms) {
  return { ...createPatrolReport({ appVersion: '1.5.720', backupKey: '2026-11-10T23-45' }), classrooms }
}

describe('終了コード', () => {
  it('変なし 0・変あり 1・中断 2・1 本も流れていない 2', () => {
    expect(resolveExitCode(patrol([classroom([step()])]))).toBe(0)
    expect(resolveExitCode(patrol([classroom([step({ findings: [{ level: 'info', code: 'change-summary', message: '机 3 件が変わった' }] })])]))).toBe(0)
    expect(resolveExitCode(patrol([classroom([step({ findings: [{ level: 'stop', code: 'manual-input-lost', message: '消えた' }] })])]))).toBe(1)
    expect(resolveExitCode(patrol([classroom([step()], { aborted: '画面が開かない' })]))).toBe(2)
    expect(resolveExitCode(patrol([classroom([])]))).toBe(2)
    expect(resolveExitCode(patrol([]))).toBe(2)
  })

  it('2 校のうち 1 校だけ手順 0 本は 2・手順はあるが操作の合計 0 も 2', () => {
    expect(resolveExitCode(patrol([classroom([step()]), classroom([])]))).toBe(2)
    expect(resolveExitCode(patrol([classroom([step({ operations: 0 })])]))).toBe(2)
    expect(resolveExitCode(patrol([classroom([step({ operations: 0 }), step({ operations: 0 })])]))).toBe(2)
  })

  it('全校に手順と操作があれば、変なし 0・変あり 1。操作 0 の校が混ざっても合計が正なら手順と中断で決まる', () => {
    const stopFinding = { level: 'stop', code: 'page-error', message: 'x' }
    expect(resolveExitCode(patrol([classroom([step()]), classroom([step()])]))).toBe(0)
    expect(resolveExitCode(patrol([classroom([step()]), classroom([step({ findings: [stopFinding] })])]))).toBe(1)
  })

  it('選んだ台本(起動のほか)がどれも候補なしで飛んだ教室(noScenarioRan)だけなら 2。1 校でも流れていれば手順の結果で決まる。変があれば 1(変を隠さない)', () => {
    const stopFinding = { level: 'stop', code: 'page-error', message: 'x' }
    expect(resolveExitCode(patrol([classroom([step()], { noScenarioRan: true }), classroom([step()], { noScenarioRan: true })]))).toBe(2)
    expect(resolveExitCode(patrol([classroom([step()], { noScenarioRan: true }), classroom([step()])]))).toBe(0)
    expect(resolveExitCode(patrol([classroom([step({ findings: [stopFinding] })], { noScenarioRan: true })]))).toBe(1)
    // 候補なしで飛んだ台本があっても、ほかの台本が流れていれば(noScenarioRan でない)変の有無で 0／1
    expect(resolveExitCode(patrol([classroom([step({ findings: [stopFinding] })])]))).toBe(1)
  })

  it('中断と変が両方あれば 2(流せなかった巡回の「変なし」「変あり」を信用させない)', () => {
    const stopFinding = { level: 'stop', code: 'page-error', message: 'x' }
    expect(resolveExitCode(patrol([classroom([step({ findings: [stopFinding] })], { aborted: '止まった' })]))).toBe(2)
  })

  it('変があっても中断が優先で 2', () => {
    const stopStep = step({ findings: [{ level: 'stop', code: 'page-error', message: 'x' }] })
    expect(resolveExitCode(patrol([classroom([stopStep]), classroom([step()], { aborted: '止まった' })]))).toBe(2)
  })
})

describe('summarizeReport / formatPatrolReportText', () => {
  it('件数と操作回数は全教室・全手順の合計', () => {
    const stopFinding = { level: 'stop', code: 'manual-input-lost', message: '消えた' }
    const infoFinding = { level: 'info', code: 'change-summary', message: '変わった' }
    const summary = summarizeReport(patrol([classroom([step({ findings: [stopFinding, infoFinding] }), step({ name: 'c', operations: 5 })]), classroom([step({ operations: 1 })])]))
    expect(summary).toEqual({ stop: 1, info: 1, stepsRun: 3, operations: 8, aborted: false })
  })

  it('文: 1 行目に件数。[変] と [知] を分ける。[中断] と理由を出す。既知で外した数を出す', () => {
    const report = patrol([
      classroom([step({ title: '台本 C', operations: 4, findings: [{ level: 'stop', code: 'manual-input-lost', message: '11/19(木) 3限 机5: 手入力が消えた' }, { level: 'info', code: 'change-summary', message: '机 2 件が変わった' }] })], { knownCount: 2 }),
      classroom([], { label: '教室B', aborted: '画面が開かない' }),
    ])
    const lines = formatPatrolReportText(report).split('\n')
    expect(lines[0]).toBe('■ 画面の自動巡回 (アプリ v1.5.720・データ 2026-11-10T23-45): 変 1 件・知らせるだけ 1 件・操作 4 回')
    const text = lines.join('\n')
    expect(text).toContain('[変] 11/19(木) 3限 机5: 手入力が消えた')
    expect(text).toContain('[知] 机 2 件が変わった')
    expect(text).toContain('[中断] 画面が開かない')
    expect(text).toContain('既知で外した 2 件')
  })

  it('addStep は元の報告を書き換えず、手順を足した新しい報告を返す', () => {
    const base = createClassroomReport({ classroomId: 'r', label: 'L', backupKey: 'k' })
    const next = addStep(base, step())
    expect(base.steps).toHaveLength(0)
    expect(next.steps).toHaveLength(1)
  })
})

describe('baseline ありの報告(第 2 段の 2)', () => {
  const stopFinding = (extra = {}) => ({ level: 'stop', code: 'outside-allowed-range', message: '11/19(木) 3限 机1: 変わった', ...extra })
  const infoFinding = { level: 'info', code: 'change-summary', message: '机 2 件が変わった' }
  const withBaseline = (findings, { resolved = [], aborted = null, newStops, carriedStops, resolvedStops } = {}) => ({
    ...patrol([classroom([step({ name: 'a', title: 'テンプレ保存', operations: 4, findings: [...findings, infoFinding] })], { aborted, resolved, seedFingerprint: 'a'.repeat(16) })]),
    baseline: {
      source: '/x/report.json',
      newStops: newStops ?? findings.filter((f) => f.baseline === 'new').length,
      carriedStops: carriedStops ?? findings.filter((f) => f.baseline === 'carried').length,
      resolvedStops: resolvedStops ?? resolved.length,
    },
  })

  it('終了コード: 新しい stop が 1 件でもあれば 1・新しい 0 で前からだけなら 0・中断は 2 が最優先', () => {
    expect(resolveExitCode(withBaseline([stopFinding({ baseline: 'carried' }), stopFinding({ baseline: 'carried' }), stopFinding({ baseline: 'carried' })]))).toBe(0)
    expect(resolveExitCode(withBaseline([stopFinding({ baseline: 'carried' }), stopFinding({ baseline: 'new' })]))).toBe(1)
    expect(resolveExitCode(withBaseline([stopFinding({ baseline: 'new' })], { aborted: '止まった' }))).toBe(2)
    expect(resolveExitCode(withBaseline([], { resolved: [{ step: 'a', title: 'x', finding: stopFinding() }] }))).toBe(0)
  })

  it('baseline なしは今までどおり(stop があれば 1)', () => {
    expect(resolveExitCode(patrol([classroom([step({ findings: [stopFinding()] })])]))).toBe(1)
  })

  it('summarizeReport は baseline があれば 新しい/前から/消えた を足す(無ければ足さない)', () => {
    const summary = summarizeReport(withBaseline([stopFinding({ baseline: 'new' }), stopFinding({ baseline: 'carried' })], { resolved: [{ step: 'a', title: 'x', finding: stopFinding() }] }))
    expect(summary).toMatchObject({ stop: 2, info: 1, newStops: 1, carriedStops: 1, resolvedStops: 1 })
    expect(summarizeReport(patrol([classroom([step()])]))).not.toHaveProperty('newStops')
  })

  it('文: 1 行目に「(新しい a・前から b)・消えた変 c 件」。[変・新]／[変・前]。消えたものは教室ごとに [消えた] で 1 件 1 行', () => {
    const report = withBaseline(
      [stopFinding({ baseline: 'new', message: '新しい変' }), stopFinding({ baseline: 'carried', message: '前からの変' })],
      { resolved: [{ step: 'a', title: 'テンプレ保存', finding: stopFinding({ message: '直った変' }) }, { step: 'b', title: '生徒の移動 1', finding: stopFinding({ message: 'もう一つ直った' }) }] },
    )
    const lines = formatPatrolReportText(report).split('\n')
    expect(lines[0]).toBe('■ 画面の自動巡回 (アプリ v1.5.720・データ 2026-11-10T23-45): 変 2 件(新しい 1・前から 1)・消えた変 2 件・知らせるだけ 1 件・操作 4 回')
    expect(lines).toContain('    [変・新] 新しい変')
    expect(lines).toContain('    [変・前] 前からの変')
    expect(lines).toContain('    [消えた] テンプレ保存: 直った変')
    expect(lines).toContain('    [消えた] 生徒の移動 1: もう一つ直った')
    expect(lines.filter((line) => line.includes('[消えた]'))).toHaveLength(2)
    expect(lines.some((line) => line.includes('比べた報告'))).toBe(true)
  })

  it('baseline なしの 1 行目・[変] は今までどおり', () => {
    const lines = formatPatrolReportText(patrol([classroom([step({ findings: [stopFinding()] })])])).split('\n')
    expect(lines[0]).toBe('■ 画面の自動巡回 (アプリ v1.5.720・データ 2026-11-10T23-45): 変 1 件・知らせるだけ 0 件・操作 2 回')
    expect(lines).toContain('    [変] 11/19(木) 3限 机1: 変わった')
  })
})
