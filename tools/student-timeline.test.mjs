// tools/student-timeline.mjs(生徒ごとの経緯ツール)と tools/studentTimeline.lib.mjs(純関数)を固定する。
// フィクスチャはこのファイル内の架空データだけ(生徒A・生徒B・講師A と ID)。ネットワークには出ない。
// import しても main() が走らない(isInvokedDirectly ガード)ことも確かめる(走るとトークン取得や通信でテストが壊れる)。
import { describe, it, expect, vi } from 'vitest'
import {
  buildStudentTimeline,
  filterStudentDesks,
  filterStudentEvents,
  filterStudentTraceEntries,
  findLedgerChangeDays,
  formatTimelineText,
  maskNames,
  parseSaveHistoryObjectName,
  planVersionDownloads,
  summarizeLedgerDays,
} from './studentTimeline.lib.mjs'
import { createReadOnlyHttp, parseArgs, validateArgs } from './student-timeline.mjs'

const ROSTER = [
  { id: 's001', name: '生徒A', displayName: 'Aさん' },
  { id: 's002', name: '生徒B' },
  { id: 't001', name: '講師A' },
]
const ALL_NAMES = ['生徒A', 'Aさん', '生徒B', '講師A']

function ledgerDay(dateKey, savedAt, rows, lectureRows = []) {
  return { dateKey, savedAt, rows, lectureRows }
}

function mathRow(overrides = {}) {
  return {
    studentId: 's001',
    studentKey: 's001',
    name: '生徒A',
    subject: '数学',
    makeupBalance: 1,
    makeupRemaining: ['2026-11-02#3|休み'],
    attended: [],
    absent: ['2026-11-02#3|regular||'],
    absentNoMakeup: [],
    placed: [],
    ...overrides,
  }
}

function otherRow(overrides = {}) {
  return { ...mathRow({ studentId: 's002', studentKey: 's002', name: '生徒B', makeupBalance: 0, makeupRemaining: [], absent: [] }), ...overrides }
}

describe('名前の置き換え maskNames', () => {
  it('名簿の名前・表示名を ID に置き換える(他の生徒・講師も)', () => {
    const text = '生徒A(Aさん)と 生徒B を 講師A の机へ'
    const masked = maskNames(text, ROSTER)
    expect(masked).toBe('s001(s001)と s002 を t001 の机へ')
  })

  it('「名前#ID」は ID だけにする(名簿に無い名前でも #ID の前は伏せる)', () => {
    expect(maskNames('移動 生徒A#s001 → 机2 / 生徒B#s002', ROSTER)).toBe('移動 s001 → 机2 / s002')
    expect(maskNames('削除 名簿外の子#s999 を消した', ROSTER)).toBe('削除 s999 を消した')
  })

  it('名前の空白の有無が違っても置き換える', () => {
    const roster = [{ id: 's010', name: '山 田 花' }]
    expect(maskNames('山田花 と 山 田 花 と 山　田　花', roster)).toBe('s010 と s010 と s010')
  })

  it('台帳のコマ「日付#限」は名前と取り違えない', () => {
    expect(maskNames('元コマ 2026-11-02#3 を消した(未消化の元コマ -2026-11-02#3)', ROSTER)).toBe('元コマ 2026-11-02#3 を消した(未消化の元コマ -2026-11-02#3)')
  })

  it('except に渡した生徒だけは名前を残す', () => {
    expect(maskNames('生徒A#s001 と 生徒B#s002', ROSTER, { except: 's001' })).toBe('生徒A#s001 と s002')
  })
})

describe('名前の置き換え 修正ラウンド 1(本番予行で見つかった漏れ)', () => {
  const roster = [{ id: 's060', name: '山田' }, { id: 's001', name: '生徒A' }]

  it('名簿に無い体験生の「名前#エントリID」は名前を「体験生」にし、別人の ID を付けない', () => {
    const text = '11/5 5限 机8: 講師なし: 山田花子#2026-11-05_5_8_0_mvhrov5d(trial 英) / 空'
    const masked = maskNames(text, roster)
    expect(masked).not.toContain('山田')
    expect(masked).not.toContain('花子')
    expect(masked).not.toContain('s060')
    expect(masked).toContain('体験生#2026-11-05_5_8_0_mvhrov5d(trial 英)')
  })

  it('# の後ろが生徒 ID でなく体験と分からないときは「名簿外」にする', () => {
    const masked = maskNames('講師なし: 誰か#b_17(通常 数学)', roster)
    expect(masked).toBe('講師なし: 名簿外#b_17(通常 数学)')
  })

  it('名簿外の名前に空白があっても(姓 名#ID)姓を残さない', () => {
    const masked = maskNames('講師なし: 鈴木 一郎#b_17(trial 数学)', roster)
    expect(masked).not.toContain('鈴木')
    expect(masked).not.toContain('一郎')
  })

  it('名簿の「山田」と体験生「山田花子」がいても「山田花子」を sNNN花子 にしない(部分一致を当てない)', () => {
    const masked = maskNames('山田花子 と 山田 が来た', roster)
    expect(masked).not.toContain('s060花子')
    expect(masked).toContain('s060 が来た')
  })

  it('「名前#sNNN」は sNNN になる(名簿外の名前でも)', () => {
    expect(maskNames('講師A: 生徒A#s001(通常 数学) / 消えた子#s123(振替 英語)', roster)).toBe('講師A: s001(通常 数学) / s123(振替 英語)')
  })

  it('痕跡の operation-event の「studentName=名前」は名簿に無くても伏せる', () => {
    const masked = maskNames('status-mark action=absent studentName=体験の子 displacedStudentName=生徒A dateKey=2026-11-05', roster)
    expect(masked).not.toContain('体験の子')
    expect(masked).toContain('displacedStudentName=s001')
    expect(masked).toContain('dateKey=2026-11-05')
  })
})

describe('台帳から変化日を出す', () => {
  const days = [
    ledgerDay('2026-11-01', '2026-11-01T09:00:00.000Z', [mathRow(), otherRow()]),
    // 生徒B だけ変わった日 → 生徒A の変化日ではない
    ledgerDay('2026-11-02', '2026-11-02T09:00:00.000Z', [mathRow(), otherRow({ makeupBalance: 2 })]),
    // 生徒A の未消化振替が 1 → 0(元コマが消えた)
    ledgerDay('2026-11-04', '2026-11-04T09:00:00.000Z', [mathRow({ makeupBalance: 0, makeupRemaining: [] }), otherRow({ makeupBalance: 2 })]),
    // 生徒A に講習の未消化が出た
    ledgerDay('2026-11-06', '2026-11-06T09:00:00.000Z', [mathRow({ makeupBalance: 0, makeupRemaining: [] }), otherRow({ makeupBalance: 2 })], [
      { studentId: 's001', name: '生徒A', sessionId: 'w1', sessionLabel: '冬期講習', subject: '英語', pending: 3, origins: [] },
    ]),
  ]

  it('前の台帳の日から変わった日だけを変化日にする(最初の日は比べる相手が無いので基準)', () => {
    expect(findLedgerChangeDays(days, 's001')).toEqual(['2026-11-04', '2026-11-06'])
  })

  it('変化日の行に、何がいくつからいくつへ変わったか・消えた元コマを出す', () => {
    const summary = summarizeLedgerDays(days, 's001')
    expect(summary[0].kind).toBe('baseline')
    const change = summary.find((day) => day.dateKey === '2026-11-04')
    expect(change.kind).toBe('change')
    const text = change.lines.join('\n')
    expect(text).toContain('数学')
    expect(text).toContain('未消化振替 1→0')
    expect(text).toContain('2026-11-02#3')
    const lecture = summary.find((day) => day.dateKey === '2026-11-06').lines.join('\n')
    expect(lecture).toContain('冬期講習')
    expect(lecture).toContain('台帳に行が現れた')
    expect(lecture).toContain('未消化講習 3')
  })

  it('台帳にこの生徒の行が 1 つも無いときは黙らずに知らせる', () => {
    const summary = summarizeLedgerDays([ledgerDay('2026-11-01', '2026-11-01T09:00:00.000Z', [otherRow()])], 's001')
    expect(summary).toHaveLength(1)
    expect(summary[0].kind).toBe('absent')
  })
})

describe('操作ログ・操作痕跡を生徒 ID で絞る', () => {
  it('痕跡の要約は「名前#ID」で絞る(s001 で s0011 を拾わない)', () => {
    const traces = [{
      snapshotVersion: 12,
      entries: [
        { at: '2026-11-04T01:00:00.000Z', kind: 'commit', summary: '11/5 4限 机2: 講師A: 生徒A#s001(通常 数学) → 生徒B#s002(振替 数学)' },
        { at: '2026-11-04T01:01:00.000Z', kind: 'commit', summary: '11/5 5限 机1: 生徒B#s002(通常 英語) を削除' },
        { at: '2026-11-04T01:02:00.000Z', kind: 'commit', summary: '11/5 6限 机1: 別の子#s0011(通常 英語)' },
      ],
    }]
    const kept = filterStudentTraceEntries(traces, 's001')
    expect(kept).toHaveLength(1)
    expect(kept[0].summary).toContain('#s001(')
    expect(kept[0].snapshotVersion).toBe(12)
  })

  it('操作ログは managedStudentId で絞り、日付全体の操作はその生徒の授業がある日だけ残す', () => {
    const events = [
      { id: 'e1', at: '2026-11-04T01:00:00.000Z', recordedAt: '2026-11-04T01:05:00.000Z', kind: 'makeup-stock-delete', detail: { studentName: '生徒A', managedStudentId: 's001', subject: '数学', originDate: '2026-11-02' } },
      { id: 'e2', at: '2026-11-04T01:00:00.000Z', recordedAt: '2026-11-04T01:05:00.000Z', kind: 'makeup-stock-delete', detail: { studentName: '生徒B', managedStudentId: 's002', subject: '数学' } },
      { id: 'e3', at: '2026-11-04T02:00:00.000Z', recordedAt: '2026-11-04T02:05:00.000Z', kind: 'holiday-toggle', detail: { action: 'set-holiday', dateKey: '2026-11-05' } },
      { id: 'e4', at: '2026-11-04T02:00:00.000Z', recordedAt: '2026-11-04T02:05:00.000Z', kind: 'holiday-toggle', detail: { action: 'set-holiday', dateKey: '2026-11-20' } },
      // 名前だけで ID が無い(生徒の登録解除に伴う自動除去)
      { id: 'e5', at: '2026-11-04T03:00:00.000Z', recordedAt: '2026-11-04T03:05:00.000Z', kind: 'auto-student-unassign', detail: { studentName: '生徒A', sessionLabel: '冬期講習' } },
    ]
    const kept = filterStudentEvents(events, 's001', { studentNames: ['生徒A', 'Aさん'], studentDates: new Set(['2026-11-05']) })
    expect(kept.map((event) => event.id)).toEqual(['e1', 'e3', 'e5'])
  })
})

describe('版の差からその生徒の机だけ残す', () => {
  it('机の前後どちらかにその生徒(#ID)がいる机だけ', () => {
    const desks = [
      { scope: 'desk', dateKey: '2026-11-05', slotNumber: 4, deskNumber: 2, before: '講師A: 生徒A#s001(通常 数学) / 空', after: '講師A: 空 / 空' },
      { scope: 'desk', dateKey: '2026-11-05', slotNumber: 5, deskNumber: 1, before: '講師A: 生徒B#s002(通常 英語) / 空', after: '講師A: 空 / 空' },
      { scope: 'cell', dateKey: '2026-11-05', slotNumber: 4, change: 'changed', changes: [] },
      { scope: 'desk', dateKey: '2026-11-06', slotNumber: 1, deskNumber: 1, before: '講師A: 空 / 空', after: '講師A: [休み 生徒A#s001 数学] / 空' },
    ]
    expect(filterStudentDesks(desks, 's001').map((entry) => `${entry.dateKey}#${entry.slotNumber}`)).toEqual(['2026-11-05#4', '2026-11-06#1'])
  })
})

describe('保存ごとの版の選び方(変化日の最初と最後＋その直前の版だけ)', () => {
  const objects = [
    // 11/3(JST) の 3 本
    'v00000100-2026-11-02T23-10-00-000Z.json.gz',
    'v00000101-2026-11-03T03-00-00-000Z.json.gz',
    'v00000102-2026-11-03T08-00-00-000Z.json.gz',
    // 11/4(JST) の 3 本
    'v00000103-2026-11-04T00-30-00-000Z.json.gz',
    'v00000104-2026-11-04T04-00-00-000Z.json.gz',
    'v00000105-2026-11-04T09-00-00-000Z.json.gz',
    // 11/9(JST)
    'v00000110-2026-11-09T01-00-00-000Z.json.gz',
  ].map((base) => ({ name: `classroom-save-history/main/cls1/${base}`, size: '100' }))
  const short = (plan) => plan.downloads.map((name) => name.split('/').pop().slice(0, 9))
  const toObjects = (bases) => bases.map((base) => ({ name: `classroom-save-history/main/cls1/${base}` }))

  it('ファイル名から版数と保存時刻と JST の日付を読む', () => {
    expect(parseSaveHistoryObjectName(objects[0].name)).toEqual({
      name: objects[0].name,
      version: 100,
      savedAt: '2026-11-02T23:10:00.000Z',
      dateKey: '2026-11-03',
    })
    expect(parseSaveHistoryObjectName('classroom-save-history/main/cls1/latest.json')).toBeNull()
  })

  it('変化日 11/4 なら 直前の版(11/3 の最後)と 11/4 の最初と最後の 3 本だけ落とす(真ん中の版は落とさない)', () => {
    const plan = planVersionDownloads(objects, ['2026-11-04'])
    expect(short(plan)).toEqual(['v00000102', 'v00000103', 'v00000105'])
    expect(plan.dayNotes).toEqual([])
    expect(plan.groups).toHaveLength(1)
  })

  it('暦の前日に版が無くても(日曜休みの翌月曜など)、直前の版と比べる: 版が 11/1 と 11/4 だけ', () => {
    const plan = planVersionDownloads(toObjects([
      'v00000050-2026-11-01T01-00-00-000Z.json.gz',
      'v00000051-2026-11-01T08-00-00-000Z.json.gz',
      'v00000060-2026-11-04T01-00-00-000Z.json.gz',
      'v00000061-2026-11-04T05-00-00-000Z.json.gz',
    ]), ['2026-11-04'])
    expect(short(plan)).toEqual(['v00000051', 'v00000060', 'v00000061'])
    expect(plan.dayNotes).toEqual([])
  })

  it('変化日の版が 1 本だけでも、直前の版との差を比べる', () => {
    const plan = planVersionDownloads(toObjects([
      'v00000050-2026-11-01T01-00-00-000Z.json.gz',
      'v00000051-2026-11-01T08-00-00-000Z.json.gz',
      'v00000060-2026-11-04T01-00-00-000Z.json.gz',
    ]), ['2026-11-04'])
    expect(short(plan)).toEqual(['v00000051', 'v00000060'])
    expect(plan.dayNotes).toEqual([])
  })

  it('続いた変化日は直前の版を重ねて落とさない(11/3 と 11/4)', () => {
    const plan = planVersionDownloads(objects, ['2026-11-03', '2026-11-04'])
    expect(short(plan)).toEqual(['v00000100', 'v00000102', 'v00000103', 'v00000105'])
    expect(plan.dayNotes).toContainEqual({ dateKey: '2026-11-03', note: 'no-earlier-version' })
  })

  it('変化日に版が無ければ印を付ける', () => {
    const plan = planVersionDownloads(objects, ['2026-11-08'])
    expect(plan.dayNotes).toContainEqual({ dateKey: '2026-11-08', note: 'no-versions' })
    expect(plan.downloads).toHaveLength(0)
  })
})

describe('修正ラウンド 2(レビュー指摘)', () => {
  it('出欠で上書きされた側(displacedStudentName)の生徒の操作ログも残し、印を付ける', () => {
    const events = [
      { id: 'e1', at: '2026-11-04T01:00:00.000Z', kind: 'status-mark', detail: { action: 'absent', studentName: '生徒B', managedStudentId: 's002', displacedStudentName: '生徒A', displacedStatus: 'absent', dateKey: '2026-11-05' } },
    ]
    expect(filterStudentEvents(events, 's001', { studentNames: ['生徒A', 'Aさん'] }).map((event) => event.id)).toEqual(['e1'])
    const timeline = buildStudentTimeline({ studentId: 's001', roster: ROSTER, ledgerDays: [], events, traces: [], versionDiffs: [] })
    expect(timeline).toHaveLength(1)
    expect(timeline[0].text).toContain('上書きされた側')
    expect(timeline[0].text).not.toContain('生徒A')
  })

  it('盤面の生徒に managedStudentId が無い(名前#エントリID)机も名前で拾い、「名前で一致」と印を付ける', () => {
    const desks = [{ scope: 'desk', dateKey: '2026-11-05', slotNumber: 4, deskNumber: 1, before: '講師A: 生徒A#e123(通常 数学) / 空', after: '講師A: 空 / 空' }]
    expect(filterStudentDesks(desks, 's001', { studentNames: ['生徒A'] })).toHaveLength(1)
    const timeline = buildStudentTimeline({
      studentId: 's001', roster: ROSTER, ledgerDays: [], events: [], traces: [],
      versionDiffs: [{ dateKey: '2026-11-04', fromSavedAt: '2026-11-04T00:00:00.000Z', toSavedAt: '2026-11-04T01:00:00.000Z', fromVersion: 1, toVersion: 2, desks }],
    })
    expect(timeline).toHaveLength(1)
    expect(timeline[0].text).toContain('名前で一致')
    expect(timeline[0].text).not.toContain('この生徒の机の変化なし')
    expect(timeline[0].text).not.toContain('生徒A')
  })

  it('痕跡も「名前#エントリID」を名前で拾う(別人の名前の一部には当てない)', () => {
    const traces = [{ snapshotVersion: 3, entries: [
      { at: '2026-11-04T01:00:00.000Z', kind: 'board-commit', summary: '2026-11-05 4限 机1: 講師A: 生徒A#e123(regular 数学) / 空 → 講師A: 空 / 空' },
      { at: '2026-11-04T01:01:00.000Z', kind: 'board-commit', summary: '2026-11-05 5限 机1: 講師A: 別の生徒A#e9(regular 数学) / 空 → 講師A: 空 / 空' },
    ] }]
    const kept = filterStudentTraceEntries(traces, 's001', { studentNames: ['生徒A'] })
    expect(kept).toHaveLength(1)
    expect(kept[0].matchedByName).toBe(true)
  })

  it('机のメモ・注と痕跡のメモは既定で伏せ、痕跡の名簿外の講師名も伏せる', () => {
    const timeline = buildStudentTimeline({
      studentId: 's001', roster: ROSTER, ledgerDays: [], events: [],
      traces: [{ snapshotVersion: 3, entries: [
        { at: '2026-11-04T01:00:00.000Z', kind: 'board-commit', summary: '2026-11-05 4限 机1: 辞めた講師: 生徒A#s001(regular 数学) / メモ:名簿外の保護者さん → 講師なし: 空 / 空 | 2026-11-05 5限 机2: 講師A: 空 / 空 → 別の辞めた講師: 生徒A#s001(regular 英語) / 空' },
      ] }],
      versionDiffs: [{
        dateKey: '2026-11-04', fromSavedAt: '2026-11-04T00:00:00.000Z', toSavedAt: '2026-11-04T01:00:00.000Z', fromVersion: 1, toVersion: 2,
        desks: [{ scope: 'desk', dateKey: '2026-11-05', slotNumber: 4, deskNumber: 1, before: '講師A: 生徒A#s001(通常 数学) / メモ:名簿外の兄弟くん 注:名簿外の先生へ連絡', after: '講師A: 空 / 空' }],
      }],
    })
    const text = JSON.stringify(timeline)
    for (const leaked of ['名簿外の保護者さん', '名簿外の兄弟くん', '名簿外の先生へ連絡', '辞めた講師', '別の辞めた講師']) expect(text).not.toContain(leaked)
    expect(text).toContain('メモ:(伏せた)')
    expect(text).toContain('注:(伏せた)')
    expect(text).toContain('(名簿に無い講師)')
    expect(text).not.toContain('s001#s001')
    const shown = JSON.stringify(buildStudentTimeline({
      studentId: 's001', roster: ROSTER, ledgerDays: [], events: [], versionDiffs: [], showNames: true,
      traces: [{ entries: [{ at: '2026-11-04T01:00:00.000Z', kind: 'board-commit', summary: '机1: 講師A: 生徒A#s001(regular 数学) / メモ:名簿外の保護者さん' }] }],
    }))
    expect(shown).toContain('名簿外の保護者さん')
  })
})

describe('buildStudentTimeline(4 つを時刻順に 1 本へ・既定は名前を ID に)', () => {
  const input = {
    studentId: 's001',
    roster: ROSTER,
    ledgerDays: [
      ledgerDay('2026-11-01', '2026-11-01T09:00:00.000Z', [mathRow(), otherRow()]),
      ledgerDay('2026-11-04', '2026-11-04T09:00:00.000Z', [mathRow({ makeupBalance: 0, makeupRemaining: [] }), otherRow()]),
    ],
    events: [
      { id: 'e1', at: '2026-11-04T03:00:00.000Z', recordedAt: '2026-11-04T03:05:00.000Z', kind: 'makeup-stock-delete', detail: { studentName: '生徒A', managedStudentId: 's001', subject: '数学', originDate: '2026-11-02' } },
    ],
    traces: [{
      snapshotVersion: 104,
      entries: [{ at: '2026-11-04T02:00:00.000Z', kind: 'commit', summary: '11/5 4限 机2: 講師A: 生徒A#s001(通常 数学) → 生徒B#s002(振替 数学)' }],
    }],
    versionDiffs: [
      { dateKey: '2026-11-03', note: 'no-versions' },
      {
        dateKey: '2026-11-04',
        fromSavedAt: '2026-11-04T00:30:00.000Z',
        toSavedAt: '2026-11-04T04:00:00.000Z',
        fromVersion: 103,
        toVersion: 104,
        desks: [
          { scope: 'desk', dateKey: '2026-11-05', slotNumber: 4, deskNumber: 2, before: '講師A: 生徒A#s001(通常 数学) / 空', after: '講師A: 生徒B#s002(振替 数学) / 空' },
          { scope: 'desk', dateKey: '2026-11-05', slotNumber: 5, deskNumber: 1, before: '講師A: 生徒B#s002(通常 英語) / 空', after: '講師A: 空 / 空' },
        ],
      },
    ],
  }

  it('時刻順に並ぶ', () => {
    const timeline = buildStudentTimeline(input)
    const times = timeline.map((entry) => entry.at)
    expect([...times].sort()).toEqual(times)
    expect(timeline.map((entry) => entry.source)).toEqual(['ledger', 'version', 'trace', 'event', 'version', 'ledger'])
  })

  it('既定の出力に名簿のどの名前も含まれない(他の生徒・講師の名前も)', () => {
    const timeline = buildStudentTimeline(input)
    const text = formatTimelineText({ classroomId: 'cls1', studentId: 's001', from: '2026-11-01', to: '2026-11-09', timeline, stats: {} })
    for (const name of ALL_NAMES) {
      expect(text).not.toContain(name)
      expect(JSON.stringify(timeline)).not.toContain(name)
    }
    expect(text).toContain('s002')
    expect(text).toContain('t001')
  })

  it('--show-names のときだけ名前を出す', () => {
    const timeline = buildStudentTimeline({ ...input, showNames: true })
    expect(JSON.stringify(timeline)).toContain('生徒B')
  })

  it('版の無い日は「この日の保存の版は無い」と 1 行出す', () => {
    const timeline = buildStudentTimeline(input)
    const missing = timeline.filter((entry) => entry.text.includes('この日の保存の版は無い'))
    expect(missing).toHaveLength(1)
    expect(missing[0].text).toContain('2026-11-03')
  })

  it('その生徒の机だけ残す(生徒B だけの机は出さない)', () => {
    const timeline = buildStudentTimeline(input)
    const desks = timeline.filter((entry) => entry.source === 'version' && entry.text.includes('机'))
    expect(desks).toHaveLength(1)
    expect(desks[0].text).toContain('4限')
  })

  it('比べた版にその生徒の机の変化が無ければ黙らずに 1 行出す', () => {
    const timeline = buildStudentTimeline({ ...input, versionDiffs: [{ ...input.versionDiffs[1], desks: [input.versionDiffs[1].desks[1]] }] })
    expect(timeline.some((entry) => entry.source === 'version' && entry.text.includes('この生徒の机の変化なし'))).toBe(true)
  })

  it('取れなかった元は「取得できず: 理由」と出し、残りは出す', () => {
    const timeline = buildStudentTimeline({ ...input, sourceErrors: [{ source: 'trace', reason: 'HTTP 403' }] })
    expect(timeline.some((entry) => entry.text.includes('取得できず: HTTP 403'))).toBe(true)
    expect(timeline.some((entry) => entry.source === 'ledger')).toBe(true)
  })
})

describe('取得層は読み取りだけ(書き込み系の呼び方は例外)', () => {
  const FS = 'https://firestore.googleapis.com/v1/projects/komahyouapp-prod/databases/(default)/documents'

  function makeHttp() {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }))
    return { http: createReadOnlyHttp({ token: 'x', fetchImpl }), fetchImpl }
  }

  it('GET と :runQuery の POST は通す', async () => {
    const { http, fetchImpl } = makeHttp()
    await http('GET', `${FS}/workspaces/main/classroomSnapshots/cls1`)
    await http('POST', `${FS}/workspaces/main/classroomSnapshots/cls1:runQuery`, { structuredQuery: {} })
    await http('GET', 'https://storage.googleapis.com/storage/v1/b/komahyouapp-prod.firebasestorage.app/o?prefix=a')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['PATCH', `${FS}/workspaces/main/classroomSnapshots/cls1`],
    ['DELETE', `${FS}/workspaces/main/classroomSnapshots/cls1`],
    ['PUT', `${FS}/workspaces/main/classroomSnapshots/cls1`],
    ['POST', `${FS}:commit`],
    ['POST', `${FS}:batchWrite`],
    ['POST', `${FS}:commit?x=:runQuery`],
    ['POST', 'https://storage.googleapis.com/upload/storage/v1/b/komahyouapp-prod.firebasestorage.app/o?name=a'],
    ['DELETE', 'https://storage.googleapis.com/storage/v1/b/komahyouapp-prod.firebasestorage.app/o/a'],
    ['GET', 'https://example.com/anything'],
  ])('%s %s は例外にして送らない', async (method, url) => {
    const { http, fetchImpl } = makeHttp()
    await expect(http(method, url, {})).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('引数', () => {
  it('必須(--workspace・--classroom・--student・--from)が無ければ知らせる', () => {
    const errors = validateArgs(parseArgs([]))
    expect(errors.join('\n')).toContain('--workspace')
    expect(errors.join('\n')).toContain('--classroom')
    expect(errors.join('\n')).toContain('--student')
    expect(errors.join('\n')).toContain('--from')
  })

  it('値を読む(--to・--json・--show-names)', () => {
    const options = parseArgs(['--workspace', 'main', '--classroom', 'cls1', '--student', 's001', '--from', '2026-11-01', '--to', '2026-11-09', '--json', '--show-names'])
    expect(options).toMatchObject({ workspaceKey: 'main', classroomId: 'cls1', studentId: 's001', from: '2026-11-01', to: '2026-11-09', json: true, showNames: true })
    expect(validateArgs(options)).toEqual([])
  })

  it('日付の形が違えば知らせる', () => {
    const options = parseArgs(['--workspace', 'main', '--classroom', 'cls1', '--student', 's001', '--from', '11/1'])
    expect(validateArgs(options).join('\n')).toContain('YYYY-MM-DD')
  })
})

describe('名前の漏れの保険(名簿に無い名前)', () => {
  it('操作ログの名前の項目は、ID があれば落とし、名簿に無い名前は伏せる', () => {
    const timeline = buildStudentTimeline({
      studentId: 's001',
      roster: ROSTER,
      ledgerDays: [],
      events: [
        { id: 'e1', at: '2026-11-04T01:00:00.000Z', kind: 'status-mark', detail: { studentName: '生徒A', managedStudentId: 's001', displacedStudentName: '名簿外の子', dateKey: '2026-11-05' } },
      ],
      traces: [],
      versionDiffs: [],
    })
    const text = JSON.stringify(timeline)
    expect(text).not.toContain('生徒A')
    expect(text).not.toContain('名簿外の子')
    expect(text).toContain('(名簿に無い名前)')
  })

  it('机の講師名が名簿に無ければ伏せる', () => {
    const timeline = buildStudentTimeline({
      studentId: 's001',
      roster: ROSTER,
      ledgerDays: [],
      events: [],
      traces: [],
      versionDiffs: [{
        dateKey: '2026-11-04', fromSavedAt: '2026-11-04T00:00:00.000Z', toSavedAt: '2026-11-04T01:00:00.000Z', fromVersion: 1, toVersion: 2,
        desks: [{ scope: 'desk', dateKey: '2026-11-05', slotNumber: 1, deskNumber: 1, before: '辞めた講師: 生徒A#s001(通常 数学) / 空', after: '講師なし: 空 / 空' }],
      }],
    })
    const text = JSON.stringify(timeline)
    expect(text).not.toContain('辞めた講師')
    expect(text).toContain('(名簿に無い講師)')
  })

  it('名簿が取れないときは痕跡の要約を伏せる(講師の名前を ID にできないため)', () => {
    const timeline = buildStudentTimeline({
      studentId: 's001',
      roster: [],
      ledgerDays: [],
      events: [],
      traces: [{ snapshotVersion: 1, entries: [{ at: '2026-11-04T01:00:00.000Z', kind: 'commit', summary: '講師A: 生徒A#s001(通常 数学)' }] }],
      versionDiffs: [],
      hideTraceSummaries: true,
    })
    expect(JSON.stringify(timeline)).not.toContain('講師A')
    expect(timeline[0].text).toContain('伏せた')
  })
})

describe('問い合わせの形(複合索引が要らない形)', () => {
  it('範囲は文字列で比べ、同じ項目で並べる', async () => {
    const { buildRangeQuery } = await import('./student-timeline.mjs')
    const query = buildRangeQuery({ collectionId: 'operationEvents', field: 'recordedAt', filters: [['GREATER_THAN_OR_EQUAL', '2026-10-31T15:00:00.000Z'], ['LESS_THAN', '2026-11-09T15:00:00.000Z']] })
    const text = JSON.stringify(query)
    expect(text).toContain('stringValue')
    expect(text).not.toContain('timestampValue')
    expect(text).not.toContain('__name__')
    expect(query.structuredQuery.orderBy[0].field.fieldPath).toBe('recordedAt')
  })
})
