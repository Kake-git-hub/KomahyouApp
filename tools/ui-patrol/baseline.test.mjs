// tools/ui-patrol/baseline.mjs(変更前の報告との突き合わせ・第 2 段の 2)を固定する。純関数。フィクスチャは架空の ID・場所だけ。
import { describe, it, expect } from 'vitest'
import { buildPatrolConditions, checkBaselineConditions, checkBaselineUsable, compareWithBaseline, findingKey, seedFingerprint } from './baseline.mjs'

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

describe('findingKey(手順の見分け)', () => {
  it('同じ台本の中の別の手順(題名が違う)は別の鍵。題名が無い古い形は name だけで今までどおり', () => {
    const a1 = findingKey('room1', { name: 'b', title: '生徒の移動 1(通常・同じコマ)' }, stop())
    const a2 = findingKey('room1', { name: 'b', title: '生徒の移動 2(通常・別の日)' }, stop())
    expect(a1).not.toBe(a2)
    expect(findingKey('room1', { name: 'b' }, stop())).toBe(findingKey('room1', 'b', stop()))
  })
})

describe('buildPatrolConditions / checkBaselineConditions(--baseline の条件の突き合わせ)', () => {
  const conditions = (overrides = {}) => buildPatrolConditions({ scenarios: ['boot', 'c', 'a'], moves: 6, seed: 1, random: 0, classrooms: ['room1'], ...overrides }, { backupKey: '2026-11-10T03-00', today: '2026-11-11' })
  it('台本(並びは流れる順にそろえる)・移動の数・乱数の種・でたらめの数・データの時点・今日・教室を記録する', () => {
    expect(conditions()).toEqual({ scenarios: ['boot', 'c', 'a'], moves: 6, seed: 1, random: 0, backupKey: '2026-11-10T03-00', today: '2026-11-11', classrooms: ['room1'] })
    expect(conditions({ scenarios: ['boot', 'a', 'c'] }).scenarios).toEqual(['boot', 'c', 'a'])
  })
  it('同じ条件なら問題なし', () => {
    expect(checkBaselineConditions({ conditions: conditions() }, conditions())).toEqual([])
  })
  it('条件の無い古い報告は「条件が記録されていない報告とは比べられない(取り直す)」で断る', () => {
    expect(checkBaselineConditions(patrol([room()]), conditions()).join('\n')).toContain('条件が記録されていない報告とは比べられません')
  })
  it('台本・移動の数・乱数の種・でたらめの数・今日が違えば、何が違うかを出して断る', () => {
    const base = { conditions: conditions() }
    expect(checkBaselineConditions(base, conditions({ scenarios: ['boot', 'a'] })).join('\n')).toContain('台本')
    expect(checkBaselineConditions(base, conditions({ moves: 3 })).join('\n')).toContain('移動の数')
    expect(checkBaselineConditions(base, conditions({ seed: 2 })).join('\n')).toContain('乱数の種')
    expect(checkBaselineConditions(base, conditions({ random: 5 })).join('\n')).toContain('でたらめ操作')
    const otherDay = buildPatrolConditions({ scenarios: ['boot', 'c', 'a'], moves: 6, seed: 1, random: 0, classrooms: ['room1'] }, { backupKey: '2026-11-10T03-00', today: '2026-11-12' })
    expect(checkBaselineConditions(base, otherDay).join('\n')).toContain('今日')
  })
  it('データの時点は両方が本物の時点のときだけ比べる(--seed-file で流した側は seed-file・同じデータかは種データの指紋が見る)', () => {
    const base = { conditions: conditions() }
    const other = buildPatrolConditions({ scenarios: ['boot', 'c', 'a'], moves: 6, seed: 1, random: 0, classrooms: ['room1'] }, { backupKey: '2026-11-11T03-00', today: '2026-11-11' })
    expect(checkBaselineConditions(base, other).join('\n')).toContain('データの時点')
    const seedFile = buildPatrolConditions({ scenarios: ['boot', 'c', 'a'], moves: 6, seed: 1, random: 0, classrooms: ['room1'] }, { backupKey: 'seed-file', today: '2026-11-11' })
    expect(checkBaselineConditions(base, seedFile)).toEqual([])
  })
  it('今回の教室が比べる報告に無ければ断る(比べる報告にだけある教室はかまわない)', () => {
    const base = { conditions: conditions({ classrooms: ['room1', 'room2'] }) }
    expect(checkBaselineConditions(base, conditions({ classrooms: ['room2'] }))).toEqual([])
    expect(checkBaselineConditions(base, conditions({ classrooms: ['room3'] })).join('\n')).toContain('教室')
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

  it('2 段で突き合わせる(手直し 1・Important-2): 手順の本数・順がずれても、同じ台本の同じ場所の同じ所見は「前から(別の手順)」で新しい変に数えない', () => {
    // (i) 変更前は移動 1 で出ていた所見が、今は移動 2 で出た(候補の数・順のずれ) → 前から 1・新しい 0・消えた 0
    const result = compareWithBaseline(
      patrol([room([step([], { name: 'b', title: '生徒の移動 1(通常・同じコマ)' }), step([stop()], { name: 'b', title: '生徒の移動 2(通常・別の日)' })])]),
      patrol([room([step([stop()], { name: 'b', title: '生徒の移動 1(通常・同じコマ)' }), step([], { name: 'b', title: '生徒の移動 2(通常・別の日)' })])]),
      { source: 's' },
    )
    expect(result.report.baseline).toMatchObject({ newStops: 0, carriedStops: 1, resolvedStops: 0 })
    expect(stopsOf(result.report)[0]).toMatchObject({ baseline: 'carried', baselineMatch: 'other-step' })
    // 手順の本数が違う(変更前は移動が 1 本少ない)
    const shifted = compareWithBaseline(
      patrol([room([step([], { name: 'f', title: '講師 1(移動)' }), step([], { name: 'f', title: '講師 2(入替)' }), step([stop({ message: '机2 が変わった' })], { name: 'f', title: '講師 3(休み)' })])]),
      patrol([room([step([], { name: 'f', title: '講師 1(入替)' }), step([stop({ message: '机2 が変わった' })], { name: 'f', title: '講師 2(休み)' })])]),
      { source: 's' },
    )
    expect(shifted.report.baseline).toMatchObject({ newStops: 0, carriedStops: 1, resolvedStops: 0 })
  })

  it('2 段目でも、本当に新しい所見(別の机・別の文)は「新しい」のまま。別の台本の同じ所見も拾わない', () => {
    const result = compareWithBaseline(
      patrol([room([step([stop({ deskIndex: 3 }), stop({ message: '別の文' })], { name: 'b', title: '生徒の移動 2(通常・別の日)' })])]),
      patrol([room([step([stop()], { name: 'b', title: '生徒の移動 1(通常・同じコマ)' })])]),
      { source: 's' },
    )
    expect(result.report.baseline).toMatchObject({ newStops: 2, carriedStops: 0, resolvedStops: 1 })
    const otherScenario = compareWithBaseline(patrol([room([step([stop()], { name: 'f', title: '講師 1' })])]), patrol([room([step([stop()], { name: 'b', title: '生徒の移動 1' })])]), { source: 's' })
    expect(otherScenario.report.baseline).toMatchObject({ newStops: 1, carriedStops: 0, resolvedStops: 1 })
  })

  it('1 段目(手順の題名・何本目か)が先: 同じ台本の別の手順の同じ机の別の文は区別され、同じ手順どうしが先に組になる', () => {
    // (iii) 同じ机で、移動 1 は文 A・移動 2 は文 B。今は移動 1 が文 B・移動 2 が文 A → 2 段目で組になり新しい 0(文が同じものどうし)
    const a = stop({ message: '文 A' })
    const b = stop({ message: '文 B' })
    const crossed = compareWithBaseline(
      patrol([room([step([b], { name: 'b', title: '生徒の移動 1' }), step([a], { name: 'b', title: '生徒の移動 2' })])]),
      patrol([room([step([a], { name: 'b', title: '生徒の移動 1' }), step([b], { name: 'b', title: '生徒の移動 2' })])]),
      { source: 's' },
    )
    expect(crossed.report.baseline).toMatchObject({ newStops: 0, carriedStops: 2, resolvedStops: 0 })
    // 同じ手順に同じ所見があれば 1 段目で組になる(「別の手順」の印は付かない)
    const same = compareWithBaseline(
      patrol([room([step([a], { name: 'b', title: '生徒の移動 1' }), step([a], { name: 'b', title: '生徒の移動 2' })])]),
      patrol([room([step([a], { name: 'b', title: '生徒の移動 1' })])]),
      { source: 's' },
    )
    expect(same.report.baseline).toMatchObject({ newStops: 1, carriedStops: 1, resolvedStops: 0 })
    expect(stopsOf(same.report).map((f) => [f.baseline, f.baselineMatch ?? ''])).toEqual([['carried', ''], ['new', '']])
    // 別の机の別の文は区別される
    const distinct = compareWithBaseline(patrol([room([step([stop({ deskIndex: 1, message: '文 C' })], { name: 'b', title: '生徒の移動 2' })])]), patrol([room([step([a], { name: 'b', title: '生徒の移動 1' })])]), { source: 's' })
    expect(distinct.report.baseline).toMatchObject({ newStops: 1, carriedStops: 0, resolvedStops: 1 })
  })

  it('同じ手順の同じ所見は今までどおり「前から」', () => {
    const result = compareWithBaseline(
      patrol([room([step([stop()], { name: 'b', title: '生徒の移動 1(通常・同じコマ)' })])]),
      patrol([room([step([stop()], { name: 'b', title: '生徒の移動 1(通常・同じコマ)' })])]),
      { source: 's' },
    )
    expect(result.report.baseline).toMatchObject({ newStops: 0, carriedStops: 1, resolvedStops: 0 })
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
