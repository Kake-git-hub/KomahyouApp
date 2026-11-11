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
 * 所見の突き合わせの鍵: 教室 ID・手順の name・code・dateKey・slotNumber・deskIndex・studentId・message。
 * 区切りは \u0000(message に '|' が入っても別の鍵と混ざらない)。無い項目は空。
 */
export function findingKey(classroomId, stepName, finding) {
  return [classroomId, stepName, finding?.code, finding?.dateKey, finding?.slotNumber, finding?.deskIndex, finding?.studentId, finding?.message]
    .map((part) => (part === undefined || part === null ? '' : String(part))).join('\u0000')
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
    // baseline の stop を鍵ごとに数える(多重集合)。残ったものが「消えた」。
    const left = new Map()
    const order = []
    for (const step of base.steps) {
      for (const finding of step.findings ?? []) {
        if (finding.level !== 'stop') continue
        const key = findingKey(room.classroomId, step.name, finding)
        const entry = left.get(key)
        if (entry) entry.items.push({ step, finding })
        else { left.set(key, { items: [{ step, finding }] }); order.push(key) }
      }
    }
    const steps = (room.steps ?? []).map((step) => ({
      ...step,
      findings: (step.findings ?? []).map((finding) => {
        if (finding.level !== 'stop') return finding
        const entry = left.get(findingKey(room.classroomId, step.name, finding))
        if (entry && entry.items.length > 0) {
          entry.items.shift()
          carriedStops += 1
          return { ...finding, baseline: 'carried' }
        }
        newStops += 1
        return { ...finding, baseline: 'new' }
      }),
    }))
    const resolved = order.flatMap((key) => left.get(key).items.map(({ step, finding }) => ({ step: step.name, title: step.title ?? step.name, finding })))
    resolvedStops += resolved.length
    return { ...room, steps, resolved }
  })
  return { ok: true, report: { ...currentReport, classrooms, baseline: { source, newStops, carriedStops, resolvedStops } } }
}
