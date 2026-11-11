// tools/ui-patrol/baseline.mjs(変更前の報告との突き合わせ・第 2 段の 2)を固定する。純関数。フィクスチャは架空の ID・場所だけ。
import { describe, it, expect } from 'vitest'
import { checkBaselineUsable, compareWithBaseline, findingKey, seedFingerprint } from './baseline.mjs'

const stop = (overrides = {}) => ({ level: 'stop', code: 'outside-allowed-range', message: '11/19(木) 3限 机1: 変わった', dateKey: '2026-11-19', slotNumber: 3, deskIndex: 0, ...overrides })
const info = (overrides = {}) => ({ level: 'info', code: 'change-summary', message: '変わった机 2 机', ...overrides })
const step = (findings = [], overrides = {}) => ({ name: 'a', title: 'テンプレ保存', durationMs: 1, operations: 1, findings, notes: [], ...overrides })
const room = (steps = [step()], overrides = {}) => ({ classroomId: 'room1', label: '教室A', backupKey: 'seed-file', steps, knownCount: 0, aborted: null, seedFingerprint: 'aaaaaaaaaaaaaaaa', ...overrides })
const patrol = (classrooms) => ({ appVersion: '1.5.720', backupKey: 'seed-file', classrooms })
const stopsOf = (report) => report.classrooms.flatMap((r) => r.steps.flatMap((s) => s.findings.filter((f) => f.level === 'stop')))

describe('seedFingerprint', () => {
  it('種データの教室の data を JSON にした文字列の SHA-256 の先頭 16 桁。流すたびに変わる値(savedAt など)は含めない', () => {
    const a = seedFingerprint({ screen: 'board', n: 1 })
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(seedFingerprint({ screen: 'board', n: 1 })).toBe(a)
    expect(seedFingerprint({ screen: 'board', n: 2 })).not.toBe(a)
  })
})

describe('findingKey', () => {
  it('教室 ID・手順の name・code・dateKey・slotNumber・deskIndex・studentId・message で決まる', () => {
    const base = findingKey('room1', 'a', stop({ studentId: 's1' }))
    expect(findingKey('room1', 'a', stop({ studentId: 's1' }))).toBe(base)
    for (const [roomId, name, finding] of [
      ['room2', 'a', stop({ studentId: 's1' })], ['room1', 'b', stop({ studentId: 's1' })], ['room1', 'a', stop({ studentId: 's1', code: 'manual-input-lost' })],
      ['room1', 'a', stop({ studentId: 's1', dateKey: '2026-11-20' })], ['room1', 'a', stop({ studentId: 's1', slotNumber: 4 })], ['room1', 'a', stop({ studentId: 's1', deskIndex: 1 })],
      ['room1', 'a', stop({ studentId: 's2' })], ['room1', 'a', stop({ studentId: 's1', message: '別の文' })],
    ]) expect(findingKey(roomId, name, finding)).not.toBe(base)
    // 無い項目は空として扱う(undefined でも例外にならない)
    expect(() => findingKey('room1', 'a', { level: 'stop', code: 'page-error', message: 'x' })).not.toThrow()
  })
})

describe('checkBaselineUsable(同じデータでないと比べない)', () => {
  const current = [{ classroomId: 'room1', seedFingerprint: 'aaaaaaaaaaaaaaaa' }]
  it('指紋が同じで、手順が流れていれば問題なし', () => {
    expect(checkBaselineUsable(patrol([room()]), current)).toEqual([])
  })
  it('指紋が違う教室があれば「データが違うので比べられません」', () => {
    const errors = checkBaselineUsable(patrol([room([step()], { seedFingerprint: 'bbbbbbbbbbbbbbbb' })]), current)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('データが違うので比べられません')
    expect(errors[0]).toContain('room1')
  })
  it('前の報告に指紋が無い(古い報告)・教室が無い・手順が中断していた・手順が 0 本、も断る', () => {
    expect(checkBaselineUsable(patrol([room([step()], { seedFingerprint: undefined })]), current)[0]).toContain('指紋')
    expect(checkBaselineUsable(patrol([room([step()], {}), ]), [{ classroomId: 'room9', seedFingerprint: 'aaaaaaaaaaaaaaaa' }])[0]).toContain('教室 room9')
    expect(checkBaselineUsable(patrol([room([step()], { aborted: 'a: 画面が開かない' })]), current)[0]).toContain('中断')
    expect(checkBaselineUsable(patrol([room([])]), current)[0]).toContain('中断')
    expect(checkBaselineUsable(null, current)[0]).toContain('読めません')
    expect(checkBaselineUsable({ classrooms: 'x' }, current)[0]).toContain('読めません')
  })
  it('今回の教室に指紋が無いのも断る(比べる根拠が無い)', () => {
    expect(checkBaselineUsable(patrol([room()]), [{ classroomId: 'room1' }])[0]).toContain('指紋')
  })
  it('baseline にだけある教室は見ない(今回流した教室だけ比べる)', () => {
    expect(checkBaselineUsable(patrol([room(), room([step()], { classroomId: 'room2', seedFingerprint: 'cccccccccccccccc' })]), current)).toEqual([])
  })
})

describe('compareWithBaseline', () => {
  const run = (currentStops, baselineStops, { currentInfos = [], baselineInfos = [] } = {}) => compareWithBaseline(
    patrol([room([step([...currentStops, ...currentInfos])])]), patrol([room([step([...baselineStops, ...baselineInfos])])]), { source: '/x/report.json' },
  )

  it('baseline に無い stop は新しい・ある stop は前から・baseline にだけある stop は消えた', () => {
    const kept = stop({ message: '前からある' })
    const added = stop({ message: '新しく出た' })
    const gone = stop({ message: '直った' })
    const result = run([kept, added], [kept, gone])
    expect(result.ok).toBe(true)
    expect(stopsOf(result.report).map((f) => [f.message, f.baseline])).toEqual([['前からある', 'carried'], ['新しく出た', 'new']])
    expect(result.report.classrooms[0].resolved).toEqual([{ step: 'a', title: 'テンプレ保存', finding: gone }])
    expect(result.report.baseline).toEqual({ source: '/x/report.json', newStops: 1, carriedStops: 1, resolvedStops: 1 })
  })

  it('同じ鍵が複数あれば数で突き合わせる(多重集合): 2 件 → 3 件なら 2 件が前から・1 件が新しい。3 件 → 2 件なら 1 件が消えた', () => {
    const same = () => stop({ message: '同じ' })
    const more = run([same(), same(), same()], [same(), same()])
    expect(stopsOf(more.report).map((f) => f.baseline)).toEqual(['carried', 'carried', 'new'])
    expect(more.report.baseline).toMatchObject({ newStops: 1, carriedStops: 2, resolvedStops: 0 })
    const fewer = run([same(), same()], [same(), same(), same()])
    expect(fewer.report.baseline).toMatchObject({ newStops: 0, carriedStops: 2, resolvedStops: 1 })
  })

  it('手順の name・教室が違えば別の所見(同じ文でも前からにならない)', () => {
    const result = compareWithBaseline(
      patrol([room([step([stop()], { name: 'b' })])]), patrol([room([step([stop()], { name: 'a' })])]), { source: 's' },
    )
    expect(result.report.baseline).toMatchObject({ newStops: 1, carriedStops: 0, resolvedStops: 1 })
  })

  it('info は分けない(baseline の印も付けず、消えたにも数えない)', () => {
    const result = run([], [], { currentInfos: [info()], baselineInfos: [info({ message: '前だけの info' })] })
    expect(result.report.baseline).toEqual({ source: '/x/report.json', newStops: 0, carriedStops: 0, resolvedStops: 0 })
    expect(result.report.classrooms[0].steps[0].findings[0]).not.toHaveProperty('baseline')
    expect(result.report.classrooms[0].resolved).toEqual([])
  })

  it('入力を書き換えない。教室ごとの resolved は stop が 0 でも空の配列で持つ', () => {
    const currentReport = patrol([room([step([stop()])])])
    const snapshot = JSON.stringify(currentReport)
    compareWithBaseline(currentReport, patrol([room([step([])])]), { source: 's' })
    expect(JSON.stringify(currentReport)).toBe(snapshot)
  })

  it('指紋が違えば比べず ok:false と理由(report は返さない)', () => {
    const result = compareWithBaseline(patrol([room()]), patrol([room([step()], { seedFingerprint: 'bbbbbbbbbbbbbbbb' })]), { source: 's' })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('データが違うので比べられません')
    expect(result.report).toBeUndefined()
  })
})
