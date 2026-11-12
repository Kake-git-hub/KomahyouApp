// 画面の自動巡回: 変更前の報告との突き合わせ(第 2 段の 2・--baseline / --baseline-ref)。純関数(ファイルにもネットワークにも触れない)。
// ねらい: 「変」(stop)が出たとき、自分の変更のせいか前からあるものかを道具が分ける。
//   新しい=baseline に無い stop／前から=baseline にもある stop／消えた=baseline にあって今回無い stop。info は分けない。
// ★同じデータでないと比べない: 教室ごとに種データの指紋(seedFingerprint)を持たせ、違えば比べずに断る(終了コード 2)。
//   データが違えば所見の数が変わるのは当たり前で、「新しい/前から」に意味が無くなる。
import { createHash } from 'node:crypto'

/**
 * 種データの教室の data(伏せ字のあとの教室データ)の指紋: JSON の文字列の SHA-256 の先頭 16 桁。
 * savedAt など流すたびに変わる値は教室の data の外(種データの外側)にあるので含めない。
 */
export function seedFingerprint(classroomData) {
  return createHash('sha256').update(JSON.stringify(classroomData ?? null)).digest('hex').slice(0, 16)
}

/**
 * 所見の突き合わせの鍵: 教室 ID・手順(name・題名・同じ題名の何本目か)・code・dateKey・slotNumber・deskIndex・studentId・message。
 * step は手順の name(文字列・古い呼び方)か { name, title, occurrence }。題名で同じ台本の中の別の手順を見分ける
 * (第 2 段の順 2 のついで: 今までは name〔台本の記号〕だけで、移動 1 の所見が直って移動 2 に同じ文の所見が出ても「前から」に数えていた)。
 * 区切りは \u0000(message に '|' が入っても別の鍵と混ざらない)。無い項目は空。
 */
export function findingKey(classroomId, step, finding) {
  const stepPart = typeof step === 'object' && step !== null
    ? [step.name, step.title ?? '', step.occurrence ?? 0].map((part) => String(part ?? '')).join('\u0001')
    : [step, '', 0].map((part) => String(part ?? '')).join('\u0001')
  return [classroomId, stepPart, finding?.code, finding?.dateKey, finding?.slotNumber, finding?.deskIndex, finding?.studentId, finding?.message]
    .map((part) => (part === undefined || part === null ? '' : String(part))).join('\u0000')
}

/** 教室の手順に「同じ name・題名の何本目か」を付ける(題名まで同じ手順を見分ける)。 */
function identifySteps(steps) {
  const counts = new Map()
  return (steps ?? []).map((step) => {
    const id = `${step.name}\u0001${step.title ?? ''}`
    const occurrence = counts.get(id) ?? 0
    counts.set(id, occurrence + 1)
    return { step, identity: { name: step.name, title: step.title ?? '', occurrence } }
  })
}

/**
 * 比べる条件(--baseline の突き合わせ・報告の conditions に記録する)。台本は流れる順(SCENARIO_ORDER)にそろえる。
 * backupKey はデータの時点(--seed-file なら 'seed-file')・today は JST の今日(台本は来週の月曜などを今日から決める)。
 */
const SCENARIO_ORDER = ['boot', 'c', 'b', 'e', 'f', 'a', 'd', 'g', 'h']
export function buildPatrolConditions(options, { backupKey = '', today = '' } = {}) {
  const order = (name) => { const index = SCENARIO_ORDER.indexOf(name); return index === -1 ? SCENARIO_ORDER.length : index }
  return {
    scenarios: [...new Set(options.scenarios ?? [])].sort((a, b) => order(a) - order(b)),
    moves: options.moves, seed: options.seed, random: options.random,
    backupKey, today, classrooms: [...(options.classrooms ?? [])],
  }
}

const isRealBackupKey = (key) => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}$/.test(key)

/**
 * --baseline の報告が今回と同じ条件で流れたか。問題の文の配列(空なら比べられる)。
 * 条件が違えば「新しい変」と「消えた変」に意味が無くなる(違う操作をしたので所見が違って当たり前)。
 * 条件の無い報告(この版より前の道具で作った報告)は断る(取り直す)。データの時点は両方が本物の時点のときだけ比べる
 * (--seed-file で流した側は 'seed-file'。同じデータかは checkBaselineUsable の種データの指紋が見る)。
 * 教室は「今回の教室が比べる報告にあるか」だけ(比べる報告にだけある教室はかまわない)。
 */
export function checkBaselineConditions(baselineReport, current) {
  const base = baselineReport?.conditions
  if (!base || typeof base !== 'object') return ['比べる報告には条件(台本・移動の数・乱数の種など)が記録されていません。条件が記録されていない報告とは比べられません(同じ引数で取り直してください)。']
  const errors = []
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const differ = (label, a, b) => errors.push(`条件が違うので比べられません: ${label}(今回 ${a}・比べる報告 ${b})。`)
  if (!same(base.scenarios, current.scenarios)) differ('台本', (current.scenarios ?? []).join(','), (base.scenarios ?? []).join(','))
  if (base.moves !== current.moves) differ('移動の数', current.moves, base.moves)
  if (base.seed !== current.seed) differ('乱数の種', current.seed, base.seed)
  if (base.random !== current.random) differ('でたらめ操作の数', current.random, base.random)
  if (base.today !== current.today) differ('今日の日付(台本が来週の月曜などを今日から決める)', current.today, base.today)
  if (isRealBackupKey(base.backupKey) && isRealBackupKey(current.backupKey) && base.backupKey !== current.backupKey) differ('データの時点', current.backupKey, base.backupKey)
  const baseRooms = new Set(base.classrooms ?? [])
  const missing = (current.classrooms ?? []).filter((id) => !baseRooms.has(id))
  if (missing.length > 0) errors.push(`条件が違うので比べられません: 教室(今回の ${missing.join(',')} が比べる報告に無い)。`)
  return errors
}

const roomsOf = (report) => (Array.isArray(report?.classrooms) ? report.classrooms : null)

/**
 * baseline の報告が今回と比べられるか。問題の文の配列(空なら比べられる)。
 * currentRooms は今回の教室 [{ classroomId, seedFingerprint }](流す前は種データから、流した後は報告から作れる)。
 * 断る条件: 報告が読めない／教室が無い／その教室の手順が中断していた・0 本／指紋が無い／指紋が違う。
 * baseline にだけある教室は見ない(今回流した教室だけ比べる)。
 */
export function checkBaselineUsable(baselineReport, currentRooms) {
  const baselineRooms = roomsOf(baselineReport)
  if (!baselineRooms) return ['比べる報告(baseline)を読めません(classrooms がありません)。']
  const errors = []
  for (const current of currentRooms) {
    const base = baselineRooms.find((room) => room.classroomId === current.classroomId)
    if (!base) { errors.push(`比べる報告に教室 ${current.classroomId} がありません。`); continue }
    if (base.aborted || !Array.isArray(base.steps) || base.steps.length === 0) {
      errors.push(`比べる報告の教室 ${current.classroomId} は途中で中断していた(または手順が 0 本)ので比べられません${base.aborted ? `: ${base.aborted}` : ''}`)
      continue
    }
    if (!base.seedFingerprint || !current.seedFingerprint) {
      errors.push(`種データの指紋が無いので比べられません(教室 ${current.classroomId}・${base.seedFingerprint ? '今回' : '比べる報告'}に無い)。`)
      continue
    }
    if (base.seedFingerprint !== current.seedFingerprint) {
      errors.push(`データが違うので比べられません: 教室 ${current.classroomId}(種データの指紋 今回 ${current.seedFingerprint}・比べる報告 ${base.seedFingerprint})`)
    }
  }
  return errors
}

/** でたらめ操作の部品の列が違い始めた手(1 始まり)。同じなら null。片方が短いだけなら短い方の次の手。 */
export function findRandomDivergence(baseTrace, currentTrace) {
  const length = Math.max(baseTrace.length, currentTrace.length)
  for (let index = 0; index < length; index += 1) {
    if (baseTrace[index] !== currentTrace[index]) return index + 1
  }
  return null
}

/**
 * 今回の報告の stop を新しい/前からに分け、baseline にだけある stop を教室ごとの resolved(消えた)に出す。
 * 戻り値: { ok: true, report } か { ok: false, errors }。元の報告は書き換えない。
 * 報告に足す項目: stop の finding.baseline('new' | 'carried')・教室の resolved([{ step, title, finding }])・全体の baseline({ source, newStops, carriedStops, resolvedStops })。
 */
export function compareWithBaseline(currentReport, baselineReport, { source = '' } = {}) {
  const currentRooms = roomsOf(currentReport) ?? []
  const errors = checkBaselineUsable(baselineReport, currentRooms.map(({ classroomId, seedFingerprint: fingerprint }) => ({ classroomId, seedFingerprint: fingerprint })))
  if (errors.length > 0) return { ok: false, errors }
  let newStops = 0
  let carriedStops = 0
  let resolvedStops = 0
  const classrooms = currentRooms.map((room) => {
    const base = roomsOf(baselineReport).find((item) => item.classroomId === room.classroomId)
    // baseline の stop を鍵ごとに数える(多重集合)。2 段で突き合わせ、どちらでも組にならなかったものが「消えた」。
    // 1 段目=厳しい鍵(手順の題名・何本目か込み)。2 段目=台本の記号＋所見の鍵だけ(手直し 1・Important-2: 題名には候補の通し番号と種類が入るので、
    // 変更前と今で候補の数・順がずれると、同じ場所の同じ所見が別の手順に出る。それを「新しい」に数えると誤って終了コード 1 になる)。
    const items = []
    const strict = new Map()
    const loose = new Map()
    const push = (map, key, item) => { const list = map.get(key); if (list) list.push(item); else map.set(key, [item]) }
    for (const { step, identity } of identifySteps(base.steps)) {
      for (const finding of step.findings ?? []) {
        if (finding.level !== 'stop') continue
        const item = { step, finding, used: false }
        items.push(item)
        push(strict, findingKey(room.classroomId, identity, finding), item)
        push(loose, findingKey(room.classroomId, step.name, finding), item)
      }
    }
    const take = (map, key) => {
      const item = (map.get(key) ?? []).find((candidate) => !candidate.used)
      if (item) item.used = true
      return item ?? null
    }
    const identified = identifySteps(room.steps)
    // 1 段目を全部の手順で先に済ませる(同じ手順どうしの組を、別の手順の 2 段目に取られないように)。
    const marks = identified.map(({ step, identity }) => (step.findings ?? []).map((finding) => (
      finding.level === 'stop' && take(strict, findingKey(room.classroomId, identity, finding)) ? 'same-step' : null
    )))
    const steps = identified.map(({ step }, stepIndex) => ({
      ...step,
      findings: (step.findings ?? []).map((finding, findingIndex) => {
        if (finding.level !== 'stop') return finding
        if (marks[stepIndex][findingIndex] === 'same-step') {
          carriedStops += 1
          return { ...finding, baseline: 'carried' }
        }
        if (take(loose, findingKey(room.classroomId, step.name, finding))) {
          carriedStops += 1
          return { ...finding, baseline: 'carried', baselineMatch: 'other-step' }
        }
        newStops += 1
        return { ...finding, baseline: 'new' }
      }),
    }))
    const resolved = items.filter((item) => !item.used).map(({ step, finding }) => ({ step: step.name, title: step.title ?? step.name, finding }))
    resolvedStops += resolved.length
    // でたらめ操作(--random)は、同じ種データ・同じ種なら同じ部品の列になる。ただ、変更前と今とでアプリの答え(効いた/断られた)が違うと、
    // その手から先の列がずれ、同じ手どうしの比べでなくなる(2 段目の突き合わせも、別の手の所見を拾えない)。違い始めた手を記録して文に出す。
    if (Array.isArray(room.randomTrace) || Array.isArray(base.randomTrace)) {
      return { ...room, steps, resolved, randomDivergedAt: findRandomDivergence(base.randomTrace ?? [], room.randomTrace ?? []) }
    }
    return { ...room, steps, resolved }
  })
  return { ok: true, report: { ...currentReport, classrooms, baseline: { source, newStops, carriedStops, resolvedStops } } }
}
