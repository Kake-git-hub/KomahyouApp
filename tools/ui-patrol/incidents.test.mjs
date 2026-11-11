// tools/ui-patrol/incidents.mjs(過去の事故の日の形の一覧・第 2 段の順 2)を固定する。純関数。フィクスチャは架空の名前・ID だけ。
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import {
  INCIDENTS_FILE, buildIncidentRunOptions, formatIncidentsSummary, parseIncidentList, resolveIncidentsExitCode, selectIncidents,
} from './incidents.mjs'
import { DEFAULT_CLASSROOMS } from './fetchData.mjs'
import { DEFAULT_SCENARIO_NAMES, parseArgs } from './options.mjs'

const entry = (overrides = {}) => ({
  name: 'room1-2026-11-10-template-save', key: '2026-11-10T03-00', classrooms: ['room1'],
  incident: 'テンプレ保存で手入力の生徒がずれた(v1.5.715〜717)', ...overrides,
})

describe('parseIncidentList(一覧の読み込みと検査)', () => {
  it('正しい一覧はそのまま読む。台本の省略は既定(boot 込み)・classrooms "all" は本番 2 校', () => {
    const { incidents, errors } = parseIncidentList([
      entry(),
      entry({ name: 'all-rooms', classrooms: 'all', scenarios: ['a', 'd'], note: '備考' }),
    ])
    expect(errors).toEqual([])
    expect(incidents[0]).toMatchObject({ name: 'room1-2026-11-10-template-save', key: '2026-11-10T03-00', classrooms: ['room1'], scenarios: [...DEFAULT_SCENARIO_NAMES], note: '' })
    expect(incidents[1].classrooms).toEqual(DEFAULT_CLASSROOMS.map((room) => room.id))
    expect(incidents[1].scenarios).toEqual(['boot', 'a', 'd'])
    expect(incidents[1].note).toBe('備考')
  })

  it('配列でない・空は断る', () => {
    expect(parseIncidentList({}).errors.join('\n')).toContain('配列')
    expect(parseIncidentList([]).errors.join('\n')).toContain('1 件もありません')
  })

  it('名前は英小文字・数字・- だけ(出力のフォルダ名にする)・重複は断る', () => {
    for (const bad of ['', 'A', '../x', 'a b', 'a/b', '-a', '事故']) {
      expect(parseIncidentList([entry({ name: bad })]).errors.join('\n')).toContain('name')
    }
    expect(parseIncidentList([entry(), entry()]).errors.join('\n')).toContain('重複')
  })

  it('時点は YYYY-MM-DDTHH-mm・教室は ID(英数字・_・-)の配列か "all"・事故の説明は必須・台本は知っている名前だけ', () => {
    expect(parseIncidentList([entry({ key: '2026-11-10' })]).errors.join('\n')).toContain('key')
    expect(parseIncidentList([entry({ classrooms: [] })]).errors.join('\n')).toContain('classrooms')
    expect(parseIncidentList([entry({ classrooms: ['../x'] })]).errors.join('\n')).toContain('classrooms')
    expect(parseIncidentList([entry({ classrooms: 'some' })]).errors.join('\n')).toContain('classrooms')
    expect(parseIncidentList([entry({ incident: '' })]).errors.join('\n')).toContain('incident')
    expect(parseIncidentList([entry({ scenarios: ['zzz'] })]).errors.join('\n')).toContain('zzz')
    expect(parseIncidentList([entry({ scenarios: [] })]).errors.join('\n')).toContain('scenarios')
    expect(parseIncidentList([entry({ unknownField: 1 })]).errors.join('\n')).toContain('unknownField')
  })

  it('流す日 today(YYYY-MM-DD・省略可)は、データの時点の日より前にできない', () => {
    expect(parseIncidentList([entry({ today: '2026-11-10' })]).incidents[0].today).toBe('2026-11-10')
    expect(parseIncidentList([entry()]).incidents[0].today).toBe('')
    expect(parseIncidentList([entry({ today: '11/10' })]).errors.join('\n')).toContain('today')
    expect(parseIncidentList([entry({ today: '2026-11-09' })]).errors.join('\n')).toContain('today')
  })

  it('公開リポジトリなので、説明・備考に生徒・講師の ID(s091・t025 の形)を書いたら断る', () => {
    expect(parseIncidentList([entry({ incident: '生徒 s091 の席がずれた' })]).errors.join('\n')).toContain('生徒・講師の ID')
    expect(parseIncidentList([entry({ note: '講師 t025 の机' })]).errors.join('\n')).toContain('生徒・講師の ID')
    // Issue 番号や版は通す
    expect(parseIncidentList([entry({ incident: 'Issue #84・v1.5.719 で修正' })]).errors).toEqual([])
  })
})

describe('リポジトリの一覧(tools/ui-patrol-incidents.json)', () => {
  const file = path.join(import.meta.dirname, '..', '..', INCIDENTS_FILE)
  const parsed = parseIncidentList(JSON.parse(readFileSync(file, 'utf8')))
  it('検査を通る', () => {
    expect(parsed.errors).toEqual([])
  })
  it('最初の 1 件は緑が丘校 2026-11-10T03-00(テンプレ保存の事故・v1.5.715〜717)', () => {
    const first = parsed.incidents[0]
    expect(first.key).toBe('2026-11-10T03-00')
    expect(first.classrooms).toEqual(['KzFnOQoTFLsCxwUp1tvh'])
    expect(first.incident).toContain('v1.5.715')
    // テンプレ保存の事故なので台本 a を流す。事故の印が出る日(来週の月曜が 11/16)に固定する
    expect(first.scenarios).toContain('a')
    expect(first.today).toBe('2026-11-10')
    expect(parsed.incidents.every((item) => item.today)).toBe(true)
  })
  it('緑が丘校 2026-11-11T03-00 の台本 g(Issue #86・#87 の日)を流す', () => {
    const dayOps = parsed.incidents.find((item) => item.name === 'midorigaoka-2026-11-11-day-ops')
    expect(dayOps).toBeDefined()
    expect(dayOps.key).toBe('2026-11-11T03-00')
    expect(dayOps.today).toBe('2026-11-11')
    expect(dayOps.classrooms).toEqual(['KzFnOQoTFLsCxwUp1tvh'])
    expect(dayOps.scenarios).toEqual(['boot', 'g'])
    expect(dayOps.incident).toContain('Issue #86')
    expect(dayOps.incident).toContain('Issue #87')
  })
})

describe('selectIncidents(--incidents の選び方)', () => {
  const { incidents } = parseIncidentList([entry({ name: 'one' }), entry({ name: 'two' }), entry({ name: 'three' })])
  it('true(名前なし)は全部・一覧の順', () => {
    expect(selectIncidents(incidents, true).selected.map((item) => item.name)).toEqual(['one', 'two', 'three'])
  })
  it('名前を挙げたらそれだけ・一覧の順で流す(挙げた順ではない)・重ねて挙げても 1 回', () => {
    expect(selectIncidents(incidents, ['three', 'one', 'three']).selected.map((item) => item.name)).toEqual(['one', 'three'])
  })
  it('一覧に無い名前は断り、選べる名前を出す', () => {
    const { selected, errors } = selectIncidents(incidents, ['one', 'nope'])
    expect(selected).toEqual([])
    expect(errors.join('\n')).toContain('nope')
    expect(errors.join('\n')).toContain('one,two,three')
  })
})

describe('buildIncidentRunOptions(件ごとの引数)', () => {
  it('時点・教室・台本を件のものにし、出力は <out>/<名前>。ほかの引数(移動の数・種・--baseline-ref など)はそのまま', () => {
    const options = parseArgs(['--out', '/tmp/o', '--incidents', '--moves', '3', '--seed', '9', '--baseline-ref', 'origin/main'])
    const [incident] = parseIncidentList([entry({ scenarios: ['a'], today: '2026-11-11' })]).incidents
    const run = buildIncidentRunOptions(options, incident)
    // 流す日: 道具の今日とブラウザの時計(その日の JST 9:00 から進む)
    expect(run.today).toBe('2026-11-11')
    expect(run.clockTime).toBe('2026-11-11T09:00:00+09:00')
    expect(buildIncidentRunOptions(options, parseIncidentList([entry()]).incidents[0])).toMatchObject({ today: '', clockTime: '' })
    expect(run).toMatchObject({ key: '2026-11-10T03-00', classrooms: ['room1'], scenarios: ['boot', 'a'], out: path.join('/tmp/o', 'room1-2026-11-10-template-save'), moves: 3, seed: 9, baselineRef: 'origin/main', incidentName: 'room1-2026-11-10-template-save' })
    // 元の options は書き換えない
    expect(options.out).toBe('/tmp/o')
    expect(options.key).toBe('')
  })
})

describe('resolveIncidentsExitCode(全体の終了コード)', () => {
  it('全部 0 なら 0・空なら 2', () => {
    expect(resolveIncidentsExitCode([{ exitCode: 0 }, { exitCode: 0 }])).toBe(0)
    expect(resolveIncidentsExitCode([])).toBe(2)
  })
  it('どれかに「変」(1)があれば 1。流せなかった件(2)があっても 1 は 2 に隠れない', () => {
    expect(resolveIncidentsExitCode([{ exitCode: 0 }, { exitCode: 1 }])).toBe(1)
    expect(resolveIncidentsExitCode([{ exitCode: 2 }, { exitCode: 1 }])).toBe(1)
    expect(resolveIncidentsExitCode([{ exitCode: 1 }, { exitCode: 2 }])).toBe(1)
  })
  it('変が無く、どれかが流せなければ 2', () => {
    expect(resolveIncidentsExitCode([{ exitCode: 0 }, { exitCode: 2 }])).toBe(2)
  })
  it('変を出したあと途中で止まった件(終了コード 2・変の数 > 0)も 1 として数える', () => {
    expect(resolveIncidentsExitCode([{ exitCode: 0 }, { exitCode: 2, stops: 3 }])).toBe(1)
    expect(resolveIncidentsExitCode([{ exitCode: 0 }, { exitCode: 2, stops: 0 }])).toBe(2)
  })
  it('止めた(130)はほかより先', () => {
    expect(resolveIncidentsExitCode([{ exitCode: 1 }, { exitCode: 130 }])).toBe(130)
  })
})

describe('formatIncidentsSummary', () => {
  it('件ごとに 名前・時点・終了コードの意味・1 行目、最後に全体の終了コード', () => {
    const text = formatIncidentsSummary([
      { name: 'one', key: '2026-11-10T03-00', exitCode: 0, headline: '■ 画面の自動巡回 …: 変 0 件', seconds: 80 },
      { name: 'two', key: '2026-11-11T03-00', exitCode: 2, headline: '', seconds: 3 },
    ])
    expect(text).toContain('one')
    expect(text).toContain('2026-11-10T03-00')
    expect(text).toContain('変なし')
    expect(text).toContain('two')
    expect(text).toContain('流せなかった')
    expect(text).toContain('終了コード 2')
  })
})
