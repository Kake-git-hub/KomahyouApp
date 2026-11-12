// 画面の自動巡回(tools/ui-patrol.mjs)の「でたらめ操作」(--random n が 1 以上のときだけ流す。既定 0＝動かない・2026-11-11 オーナー決定で
// 既定の点検は約 10 分のまま)。台本の操作を「部品」にして、重みつき・種つきの乱数で組み合わせ、1 手ごとに点検する(第 2 段の最後で育てた)。
// ★部品の重みは RANDOM_PARTS の 1 か所の表。部品の操作・「変わってよい範囲」・点検は台本の関数(scenarios.mjs の attempt*・run*Flow・
//   runTemplateEditOnce・persist*)をそのまま呼ぶ。ここで操作や規則を書き直さない。
// ★再現: 同じ種データ・同じ --seed・同じ台本なら同じ部品の列になる。部品の選び方は乱数と操作の結果(効いた/断られた/候補なし)だけで決め、
//   候補はその時点の盤面の事実から選ぶ(実際の保存ボタンの状態を毎回読んで選ぶと、ローカルモードの 5 秒後の自動保存の時間差で列が変わる)。
//   --random <k> で流し直すと、--random <n>(n>k)の 1〜k 手目と同じ手を流して止まる(所見を「種・何手目」で短く再現できる)。
// ★1 手ごとに「直前の読み取り」(io.current)を基準に点検する(操作が積み重なったあとの形でも、前の手の変化を次の手のせいにしない)。
// ★断られた手・候補の無い手は所見にせず注に書く(断りの info は「飛ばした」の注へ移す)。画面のエラー・例外・保存ボタンの食い違いは今ある点検のまま拾う。
import {
  MOVE_KINDS, attemptAttendanceOp, attemptStudentMove, collectMakeupPlaceOptions, collectStockIneligibleSeatKeys, createSeededRandom, describeAttendanceOp,
  describeTeacher, isPendingDesk, makeMenuTeacherPicker, persistDayOps, persistTemplateEdit, pickAttendancePlan, pickMoveCandidates, pickTeacherPlan,
  runHolidayFlow, runSimpleTeacherOp, runTeacherOpOn, runTemplateEditOnce, runWholeDayTransferFlow, weekDateKeysFrom, weekStartsFrom,
} from './scenarios.mjs'

/**
 * 部品の表(重みはここだけ)。kind: board=盤面を 1 回変える(元に戻すが 1 つ積まれる)／heavy=保存→読み込み直しで終わる重い操作(履歴は空になる)／
 * undo・redo・save・reload。重み: よく使う操作(生徒の移動・元に戻す・出欠)を多め、重い操作(テンプレ保存・丸ごと振替・休日)は最も少なく。
 * 根拠の台本: 移動=b・出欠=e(解除はでたらめ操作だけ)・講師=f・休日と丸ごと振替=g・テンプレ=d。講習の自動割振(h)は入れていない
 * (講習の期間の週を全部開く重い操作で、講習の提出の前の時期は候補が無い。必要になったら heavy の部品として足す)。
 */
export const RANDOM_PARTS = [
  { name: 'move', label: '生徒の移動', kind: 'board', weight: 6 },
  { name: 'attend-absent', label: '出欠・休み', kind: 'board', weight: 3 },
  { name: 'attend-no-makeup', label: '出欠・振無休', kind: 'board', weight: 2 },
  { name: 'attend-attended', label: '出欠・出席', kind: 'board', weight: 2 },
  { name: 'attend-place', label: '出欠・振替先を決める', kind: 'board', weight: 3 },
  { name: 'attend-clear', label: '出欠・休み/振無休/出席の解除', kind: 'board', weight: 2 },
  { name: 'teacher-move', label: '講師の移動', kind: 'board', weight: 2 },
  { name: 'teacher-swap', label: '講師だけ入替', kind: 'board', weight: 2 },
  { name: 'seat-swap', label: '生徒ごと席入替', kind: 'board', weight: 2 },
  { name: 'teacher-menu', label: '講師メニューで交代', kind: 'board', weight: 2 },
  { name: 'teacher-rest', label: '講師の休み', kind: 'board', weight: 2 },
  { name: 'teacher-release', label: '講師の休みの解除', kind: 'board', weight: 2 },
  { name: 'holiday', label: '休日設定と解除', kind: 'heavy', weight: 1 },
  { name: 'whole-day', label: '丸ごと振替の作成と解除', kind: 'heavy', weight: 1 },
  { name: 'template-edit', label: 'テンプレを 1 か所変えて保存', kind: 'heavy', weight: 1 },
  { name: 'undo', label: '元に戻す', kind: 'undo', weight: 4 },
  { name: 'redo', label: 'やり直し', kind: 'redo', weight: 2 },
  { name: 'save', label: '保存', kind: 'save', weight: 2 },
  { name: 'reload', label: '読み込み直し', kind: 'reload', weight: 2 },
]

export const RANDOM_PART_NAMES = RANDOM_PARTS.map((part) => part.name)
const PART_BY_NAME = new Map(RANDOM_PARTS.map((part) => [part.name, part]))
const DEFAULT_WEIGHTS = Object.fromEntries(RANDOM_PARTS.map((part) => [part.name, part.weight]))
const labelOf = (name) => PART_BY_NAME.get(name)?.label ?? name

/** 始めの見込み。始めは未保存とみなす(台本 b の最後の元に戻すのあと、自動保存が済んだかは時間で変わる。見込みを時間に依存させない)。 */
export function createInitialRandomModel() {
  return { undoDepth: 0, redoDepth: 0, dirty: true, unavailable: [] }
}

function canRun(model, part) {
  if (part.kind === 'undo') return model.undoDepth > 0
  if (part.kind === 'redo') return model.redoDepth > 0
  if (part.kind === 'save') return model.dirty
  if (part.kind === 'reload') return !model.dirty
  return !(model.unavailable ?? []).includes(part.name)
}

/**
 * 今できる部品の中から、重みつき・種つきの乱数で次の部品を選ぶ。model: { undoDepth, redoDepth, dirty, unavailable(候補なし・断られた部品) }。
 * weights は部品の名前 → 重み(既定は RANDOM_PARTS・0 は選ばない)。どれも選べないときは保存(未保存)か読み込み直し(保存済み)。
 */
export function pickNextRandomPart(model, random, weights = DEFAULT_WEIGHTS) {
  const available = RANDOM_PARTS.filter((part) => (weights[part.name] ?? 0) > 0 && canRun(model, part))
  const draw = random()
  if (available.length === 0) return model.dirty ? 'save' : 'reload'
  const total = available.reduce((sum, part) => sum + weights[part.name], 0)
  let rest = draw * total
  for (const part of available) {
    rest -= weights[part.name]
    if (rest < 0) return part.name
  }
  return available.at(-1).name
}

/**
 * 部品のあとの見込みを進める(元の見込みは書き換えない)。outcome: 'applied'(効いた・押せた) / 'blocked'(アプリが断った) / 'skipped'(候補が無い・押せなかった)。
 * - board の効いた手: 元に戻すが 1 つ積まれ、やり直しは捨てられる・未保存・候補なしの印は消える(盤面が変わった)。断られた/候補なし: その部品に印。
 * - heavy の効いた手: 保存→読み込み直しで終わるので履歴は空・保存済み。
 * - undo / redo: 深さを 1 つ動かす・未保存。save: 押せなかったときも実際の状態を正として保存済み。
 * - reload: 効いた=履歴は空・保存済み(盤面は変わらないので印は残す)。押せなかった(保存ボタンが clean でなかった)=未保存に直す。
 * maxUndo: 元に戻す・やり直しの履歴の上限(アプリの MAX_HISTORY_DEPTH＝10・appendHistoryEntry は古いものから捨てる)。
 */
export function advanceRandomModel(model, name, outcome, { maxUndo = Infinity } = {}) {
  const part = PART_BY_NAME.get(name)
  if (!part) throw new Error(`知らない部品です: ${name}`)
  const unavailable = model.unavailable ?? []
  const mark = () => ({ ...model, unavailable: [...new Set([...unavailable, name])] })
  switch (part.kind) {
    case 'board':
      return outcome === 'applied' ? { undoDepth: Math.min(maxUndo, model.undoDepth + 1), redoDepth: 0, dirty: true, unavailable: [] } : mark()
    case 'heavy':
      return outcome === 'applied' ? { undoDepth: 0, redoDepth: 0, dirty: false, unavailable: [] } : mark()
    case 'undo':
      return { undoDepth: model.undoDepth - 1, redoDepth: Math.min(maxUndo, model.redoDepth + 1), dirty: true, unavailable: [] }
    case 'redo':
      return { undoDepth: Math.min(maxUndo, model.undoDepth + 1), redoDepth: model.redoDepth - 1, dirty: true, unavailable: [] }
    case 'save':
      return { ...model, dirty: false, unavailable: [...unavailable] }
    case 'reload':
      return outcome === 'applied' ? { undoDepth: 0, redoDepth: 0, dirty: false, unavailable: [...unavailable] } : { ...model, dirty: true, unavailable: [...unavailable] }
    default:
      throw new Error(`知らない部品の種類です: ${part.kind}`)
  }
}

/** 手順の列を、あとで同じ種で流し直せる 1 行にする(例: "seed=1: move→attend-absent(断)→undo")。 */
export function formatRandomTrace(seed, ops) {
  return `seed=${seed}: ${ops.length > 0 ? ops.join('→') : '(なし)'}`
}

const BLOCKED_CODES = new Set(['move-blocked', 'attendance-blocked', 'teacher-op-blocked', 'day-op-blocked', 'auto-assign-blocked'])

/** アプリが断った手の info(…-blocked)を所見から外し、「飛ばした」の注へ移した新しい手順を返す(元は書き換えない)。 */
export function convertBlockedFindingsToNotes(step) {
  const blocked = step.findings.filter((finding) => finding.level === 'info' && BLOCKED_CODES.has(finding.code))
  if (blocked.length === 0) return step
  return {
    ...step,
    findings: step.findings.filter((finding) => !blocked.includes(finding)),
    notes: [...step.notes, ...blocked.map((finding) => `飛ばした(アプリが断った・所見にしない): ${finding.message}`)],
  }
}

// ── 部品の候補選び(純関数・その時点の盤面の事実から・種つきの乱数)。

const seedFrom = (random) => Math.floor(random() * 4294967296)
const pickOne = (list, random) => list[Math.floor(random() * list.length)]

function shuffledBy(list, random) {
  const result = [...list]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(random() * (index + 1))
    ;[result[index], result[pick]] = [result[pick], result[index]]
  }
  return result
}

/** その週で今日以降の開いている日の机(台本 e と同じ範囲)。 */
function openWeekDesks(facts, { weekDateKeys, todayKey }) {
  const week = new Set(weekDateKeys)
  return [...facts.desks.values()]
    .filter((desk) => week.has(desk.dateKey) && desk.dateKey >= todayKey && desk.cellOpen)
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.slotNumber - right.slotNumber || left.cellId.localeCompare(right.cellId) || left.deskIndex - right.deskIndex)
}

/** コマごとに居る生徒の鍵(上段・保留の下段)。 */
function studentKeysByCell(desks) {
  const keysByCell = new Map()
  for (const desk of desks) {
    const keys = keysByCell.get(desk.cellId) ?? new Set()
    for (const entry of [...desk.students, ...desk.pendingStudents]) if (entry) keys.add(entry.key)
    keysByCell.set(desk.cellId, keys)
  }
  return keysByCell
}

/** 部品 → 台本 e の操作の名前(ATTENDANCE_SLOTS)。 */
const ATTENDANCE_PART_SLOTS = {
  'attend-absent': ['regular-absent', 'makeup-absent'],
  'attend-no-makeup': ['regular-absent-no-makeup'],
  'attend-attended': ['regular-attended', 'special-attended'],
}

/** 出欠を付ける(休み・振無休・出席): 台本 e の候補選び(pickAttendancePlan)から、その部品の操作を 1 つ。無ければ null。 */
export function pickRandomAttendanceMark(facts, { weekDateKeys, todayKey, random, part, excludeSeatKeys = new Set() }) {
  const slots = ATTENDANCE_PART_SLOTS[part] ?? []
  const plan = pickAttendancePlan(facts, { weekDateKeys, todayKey, seed: seedFrom(random), excludeSeatKeys })
  const ops = plan.ops.filter((op) => slots.includes(op.slot))
  return ops.length > 0 ? pickOne(ops, random) : null
}

const STATUS_RECORD_STATUSES = ['absent', 'absent-no-makeup', 'attended']

/** 教室データの出欠記録の席(上段の statusSlots)。生徒の事実(boardFacts)は記録の席を持たないので、教室データから集める。 */
function collectStatusSeats(payload) {
  const weeks = Array.isArray(payload?.boardState?.weeks) ? payload.boardState.weeks : []
  const seats = []
  for (const week of weeks) {
    const cells = Array.isArray(week) ? week : Array.isArray(week?.cells) ? week.cells : []
    for (const boardCell of cells) {
      if (!boardCell || typeof boardCell.id !== 'string' || !Array.isArray(boardCell.desks)) continue
      boardCell.desks.forEach((boardDesk, deskIndex) => {
        const records = Array.isArray(boardDesk?.statusSlots) ? boardDesk.statusSlots : []
        const slots = Array.isArray(boardDesk?.lesson?.studentSlots) ? boardDesk.lesson.studentSlots : []
        records.forEach((record, seat) => {
          if (!record || typeof record !== 'object') return
          seats.push({
            deskKey: `${boardCell.id}#${deskIndex}`, cellId: boardCell.id, deskIndex, seat,
            key: record.managedStudentId ? record.managedStudentId : `name:${record.name ?? ''}`, name: record.name ?? '',
            status: record.status ?? '', subject: record.subject ?? '', lessonType: record.lessonType ?? '',
            flagged: Boolean(record.manualAdded || record.editedToMakeup || record.editedFromRegular), seatTaken: Boolean(slots[seat]),
          })
        })
      })
    }
  }
  return seats
}

/**
 * 出欠の解除(生徒メニューの 休み解除・振無休解除・出席解除): その週で今日以降の、本物の講師がいて講師の休み・保留の無い机の、席が空いている記録。
 * 選ぶのは 休み(通常・振替)・振無休(通常)・出席(通常)だけ(講習は講習の在庫の決まりが別・付けられる操作の逆だけを選ぶ)。名簿に結べない生徒・
 * 手動追加や編集で振替にした記録(在庫の数え方が別)・同じコマにもう居る生徒は選ばない。休みの解除は未消化振替が 1 以上のときだけ(戻した授業がまた消化する)。
 */
export function pickRandomAttendanceClear(facts, payload, stock, { weekDateKeys, todayKey, random }) {
  const desks = openWeekDesks(facts, { weekDateKeys, todayKey })
  const byKey = new Map(desks.map((desk) => [desk.key, desk]))
  const keysByCell = studentKeysByCell(desks)
  const options = collectStatusSeats(payload).filter((record) => {
    const desk = byKey.get(record.deskKey)
    if (!desk || desk.teacher === '' || desk.teacherRest || isPendingDesk(desk) || desk.pendingRecorded) return false
    if (!STATUS_RECORD_STATUSES.includes(record.status) || record.key.startsWith('name:') || record.flagged || record.seatTaken) return false
    if (record.status === 'absent' ? !['regular', 'makeup'].includes(record.lessonType) : record.lessonType !== 'regular') return false
    if (keysByCell.get(record.cellId)?.has(record.key)) return false
    if (record.status === 'absent' && (stock?.makeup?.[`${record.key}__${record.subject}`] ?? 0) < 1) return false
    return true
  })
  if (options.length === 0) return null
  const record = pickOne(options, random)
  const desk = byKey.get(record.deskKey)
  return {
    kind: 'clear', label: '出欠の解除', status: record.status, seat: { cellId: record.cellId, deskIndex: record.deskIndex, seat: record.seat },
    studentKey: record.key, studentName: record.name, subject: record.subject, lessonType: record.lessonType, dateKey: desk.dateKey, slotNumber: desk.slotNumber,
  }
}

/**
 * 振替先を決める: その週で今日以降の机に付いている通常の休みの記録のうち、未消化振替が 1 以上の生徒を 1 人選び、その生徒の居ない別のコマの空いた席
 * (台本 e と同じ条件・collectMakeupPlaceOptions)へ置く。無ければ null。振替元の行は置くときに未消化振替の一覧から選ぶ(台本 e と同じ)。
 */
export function pickRandomMakeupPlace(facts, payload, stock, { weekDateKeys, todayKey, random }) {
  const desks = openWeekDesks(facts, { weekDateKeys, todayKey })
  const byKey = new Map(desks.map((desk) => [desk.key, desk]))
  const keysByCell = studentKeysByCell(desks)
  const sources = collectStatusSeats(payload).filter((record) => byKey.has(record.deskKey) && record.status === 'absent' && record.lessonType === 'regular'
    && !record.key.startsWith('name:') && !record.flagged && (stock?.makeup?.[`${record.key}__${record.subject}`] ?? 0) >= 1)
  for (const source of shuffledBy(sources, random)) {
    const options = collectMakeupPlaceOptions(desks, { keysByCell, sourceCellId: source.cellId, studentKey: source.key })
    if (options.length === 0) continue
    const target = pickOne(options, random)
    const from = byKey.get(source.deskKey)
    return {
      slot: 'makeup-place', kind: 'place', label: '振替先を決める',
      to: { cellId: target.desk.cellId, deskIndex: target.desk.deskIndex, seat: target.seat },
      studentKey: source.key, studentName: source.name, subject: source.subject,
      sourceDateKey: from.dateKey, sourceSlotNumber: from.slotNumber, dateKey: target.desk.dateKey, slotNumber: target.desk.slotNumber,
    }
  }
  return null
}

/** 部品 → 台本 f の操作の名前(TEACHER_OPS)。講師の休みは「休みと解除」の候補の机で休みだけ。 */
const TEACHER_PART_OPS = { 'teacher-move': 'move', 'teacher-swap': 'teacher-swap', 'seat-swap': 'seat-swap', 'teacher-menu': 'menu-teacher', 'teacher-rest': 'rest-toggle' }

/** 講師の操作(移動・講師だけ入替・生徒ごと席入替・講師メニュー・休み): 台本 f の候補選び(pickTeacherPlan)でその 1 種類だけ。無ければ null。 */
export function pickRandomTeacherOp(facts, { weekDateKeys, todayKey, random, part }) {
  const only = TEACHER_PART_OPS[part]
  if (!only) return null
  return pickTeacherPlan(facts, { weekDateKeys, todayKey, seed: seedFrom(random), only }).ops[0] ?? null
}

/** 講師の休みの解除: その週で今日以降の開いている日の、休みの記録のある机(保留の机は除く)。無ければ null。 */
export function pickRandomTeacherRelease(facts, { weekDateKeys, todayKey, random }) {
  const desks = openWeekDesks(facts, { weekDateKeys, todayKey }).filter((desk) => desk.teacherRest && desk.teacherRestRecord && !isPendingDesk(desk) && !desk.pendingRecorded)
  if (desks.length === 0) return null
  const desk = pickOne(desks, random)
  return { cellId: desk.cellId, deskIndex: desk.deskIndex, dateKey: desk.dateKey, slotNumber: desk.slotNumber, restName: desk.teacherRestName }
}

// 台本と乱数の列を分ける(同じ --seed でも、台本の候補選びと同じ乱数を消費しない)。部品の選び方と、候補の選び方も分ける
// (候補が無いときなど、片方の消費のしかたでもう片方の列がずれないように)。
const OP_STREAM = 0x52414e44
const CANDIDATE_STREAM = 0x4d4f5645
const MENU_STREAM = 0x4d454e55

/**
 * でたらめ操作を options.random 手流す。ctx は台本の部品と同じ({ session, driver, app, read, audit, stockOf })、io は台本の io
 * ({ current(直前の読み取り), newStep, finish(step)→既知を外したあとの所見 })。weekStart は移動・出欠・講師に使う週(盤面はその週を開いている前提)、
 * nextMonday は休日・丸ごと振替の日付を選ぶ 4 週の始めとテンプレの反映日。weights はテスト用の差し替え(既定は RANDOM_PARTS)。
 * 手順: 準備(部品と重み・流し直し方) → 1 手ごとに 1 本(題名「でたらめ k 手目(部品)」・重い部品は中の手順も同じ見出しで) → まとめ(手順の 1 行)。
 * 「変」が出た手で打ち切る(土台へは戻さない)。打ち切らずに終えたら、元に戻すを積んだ分だけ押して土台(最後の読み込み直しのあと・無ければ始め)と同じかを点検する。
 * → { ops(部品の列・断られた手は「(断)」・候補が無く飛ばした重い部品は「(無)」), operations, trace, aborted, stoppedAt, persisted, effective }
 */
export async function runRandomOps({ ctx, io, options, today, weekStart, nextMonday, weights = DEFAULT_WEIGHTS }) {
  const { session, driver, app, read, stockOf } = ctx
  const seed = Number(options.seed) || 0
  const count = Math.max(0, Number(options.random) || 0)
  const opRandom = createSeededRandom((seed + OP_STREAM) >>> 0)
  const pickRandom = createSeededRandom((seed + CANDIDATE_STREAM) >>> 0)
  const pickMenuTeacher = makeMenuTeacherPicker(createSeededRandom((seed + MENU_STREAM) >>> 0), () => io.current.facts)
  const weekDateKeys = weekDateKeysFrom(weekStart)
  const candidateOptions = () => ({ weekDateKeys, todayKey: today, random: pickRandom })
  // 元に戻すの履歴はアプリと同じ上限まで(ScheduleBoardScreen.tsx の MAX_HISTORY_DEPTH・古いものから捨てる)。束ねた app から読む(無ければ 10)。
  const maxUndo = Number(app.MAX_HISTORY_DEPTH) > 0 ? Number(app.MAX_HISTORY_DEPTH) : 10
  const advance = (current, name, outcome) => advanceRandomModel(current, name, outcome, { maxUndo })
  let model = createInitialRandomModel()
  const ops = []
  let droppedFromHistory = 0
  const effectiveByPart = new Map()
  let operations = 0
  let effective = 0
  let persisted = 0
  let base = io.current
  let undoStack = []
  let redoStack = []
  let aborted = null
  let stoppedAt = null
  const stopsIn = (findings) => (findings ?? []).some((finding) => finding.level === 'stop')

  const prep = io.newStep(`でたらめ操作の準備(${count} 手・種 ${seed}・${weekStart} の週)`)
  prep.notes.push(`部品と重み: ${RANDOM_PARTS.map((part) => `${part.label} ${weights[part.name] ?? 0}`).join('・')}`)
  prep.notes.push(`流し直し: 同じ種データ(--seed-file)・同じ --seed ${seed}・同じ台本で --random <k> にすると、この流しの 1〜k 手目と同じ手を流して止まる(k 手目で所見が出たら --random k)。`)
  await io.finish(prep)

  /** 重い部品の前: 元に戻すの履歴を空にする(保存→読み込み直し)。重い部品の中で週を開く・元に戻すを押すので、前の手の履歴と混ぜない。 */
  const clearHistory = async (step) => {
    if (undoStack.length === 0 && redoStack.length === 0 && !model.dirty) return true
    step.notes.push('重い操作の前に 保存→読み込み直し(元に戻すの履歴を空にする)。')
    await saveHand(step)
    return reloadHand(step)
  }
  const saveHand = async (step) => {
    const pressed = await driver.clickSave(session)
    if (pressed) {
      step.operations += 1
      step.notes.push('保存しました')
    } else {
      step.notes.push('保存ボタンは既に clean で押せませんでした(ローカルモードは変更の 5 秒後に自分で保存する・操作に数えない)')
    }
    const before = io.current
    const saved = await read()
    step.findings.push(...app.checkSameState(before.facts, saved.facts, 'save-changed'), ...app.checkStockDeltas(stockOf(before), stockOf(saved), {}, { code: 'save-changed', label: '保存で在庫が変わった' }))
    step.diff = { before: before.facts, after: saved.facts }
    io.current = saved
    model = advance(model, 'save', pressed ? 'applied' : 'skipped')
    return pressed
  }
  const reloadHand = async (step) => {
    // 未保存のまま読み込み直すと beforeunload が出る。保存ボタンが clean であることを確かめてから(食い違えば実際の状態を正とする)。
    const saveState = await driver.readSaveState(session)
    if (saveState !== 'clean') {
      step.notes.push(`保存ボタンが ${saveState} なので読み込み直さない(見込みを未保存に直す・操作に数えない)`)
      model = advance(model, 'reload', 'skipped')
      return false
    }
    await driver.reloadApp(session)
    step.operations += 1
    const before = io.current
    const reloaded = await read()
    step.findings.push(...app.checkSameState(before.facts, reloaded.facts, 'reload-changed'), ...app.checkStockDeltas(stockOf(before), stockOf(reloaded), {}, { code: 'reload-changed', label: '読み込み直しで在庫が変わった' }))
    step.diff = { before: before.facts, after: reloaded.facts }
    io.current = reloaded
    if (stopsIn(step.findings)) return true
    // 読み込み直すと履歴が消えて戻せない。読み込み直しの前に保存しているので、この状態(保存された正しい状態)を新しい土台にする。
    persisted += undoStack.length
    // 盤面の操作は開いている週の席に対して行うので、使う週を開き直す(週へ移るだけなので操作に数えない)。
    await driver.gotoWeekOf(session, weekStart)
    io.current = await read()
    base = io.current
    undoStack = []
    redoStack = []
    model = advance(model, 'reload', 'applied')
    step.notes.push('読み込み直しました(この状態を新しい土台にする)')
    return true
  }
  /** 盤面を 1 回変えた手: 元に戻すを積む・やり直しを捨てる。 */
  const applied = (name, before, after) => {
    undoStack.push(before)
    if (undoStack.length > maxUndo) {
      // アプリは履歴の上限を超えた古い項目を捨てる。その手は元に戻せないので、届く所(残った一番古い項目)を土台にする。
      undoStack.shift()
      droppedFromHistory += 1
    }
    redoStack = []
    io.current = after
    effective += 1
    effectiveByPart.set(name, (effectiveByPart.get(name) ?? 0) + 1)
    model = advance(model, name, 'applied')
  }

  /** 部品の候補をその時点の盤面の事実から選ぶ。{ candidate } か { none: 理由 }。重い部品はその手の中で選ぶ(週を開くため)。 */
  const findCandidate = (name) => {
    const facts = io.current.facts
    if (name === 'move') {
      const candidates = pickMoveCandidates(facts, { weekDateKeys, todayKey: today, count: MOVE_KINDS.length, seed: seedFrom(pickRandom) })
      return candidates.length > 0 ? { candidate: pickOne(candidates, pickRandom) } : { none: '動かせる生徒と空いた席の組が無い' }
    }
    if (ATTENDANCE_PART_SLOTS[name]) {
      const op = pickRandomAttendanceMark(facts, { ...candidateOptions(), part: name, excludeSeatKeys: collectStockIneligibleSeatKeys(io.current.payload) })
      return op ? { candidate: op } : { none: '出欠を付けられる生徒が無い' }
    }
    if (name === 'attend-place') {
      const op = pickRandomMakeupPlace(facts, io.current.payload, stockOf(io.current), candidateOptions())
      return op ? { candidate: op } : { none: '置ける振替(通常の休みで未消化振替のある生徒)と空いた席の組が無い' }
    }
    if (name === 'attend-clear') {
      const op = pickRandomAttendanceClear(facts, io.current.payload, stockOf(io.current), candidateOptions())
      return op ? { candidate: op } : { none: '解除できる出欠記録が無い' }
    }
    if (TEACHER_PART_OPS[name]) {
      const op = pickRandomTeacherOp(facts, { ...candidateOptions(), part: name })
      return op ? { candidate: op } : { none: '講師を動かせる机(台本 f と同じ条件)が無い' }
    }
    if (name === 'teacher-release') {
      const op = pickRandomTeacherRelease(facts, candidateOptions())
      return op ? { candidate: op } : { none: '休みの記録のある机が無い' }
    }
    return { candidate: null }
  }

  /** 手の手順を報告へ足す(断りの info は注へ)。既知を外したあとに「変」があれば true。 */
  let handStop = false
  const finishHand = async (step) => {
    operations += step.operations
    const filtered = await io.finish(convertBlockedFindingsToNotes(step))
    if (stopsIn(filtered)) handStop = true
    return filtered
  }
  /** 重い部品の中の手順を、その手の見出しで報告へ足す io。 */
  const handIo = (hand, label) => ({
    get current() { return io.current },
    set current(value) { io.current = value },
    newStep: (title) => io.newStep(`でたらめ ${hand} 手目(${label}): ${title}`),
    finish: finishHand,
  })

  /** 1 手を流す。戻り値 'applied' | 'blocked' | 'skipped' | 'aborted'。 */
  const runHand = async (hand, name, candidate, step) => {
    const before = io.current
    switch (name) {
      case 'move': {
        const attempt = await attemptStudentMove({ session, driver, app, before, candidate, read, audit: ctx.audit })
        step.operations += 1
        const seated = before.facts.desks.get(`${candidate.from.cellId}#${candidate.from.deskIndex}`)?.students[candidate.from.seat]
        if (seated) step.notes.push(`生徒: ${seated.name}(${seated.key})`)
        step.notes.push(...attempt.notes)
        step.findings.push(...attempt.findings)
        if (attempt.outcome === 'nothing') {
          aborted = attempt.message
          return 'aborted'
        }
        if (attempt.outcome === 'blocked') return 'blocked'
        step.diff = attempt.diff
        // 生徒の移動は在庫中立(通常・振替・講習とも、席が変わるだけで未消化の数は変わらない)。
        step.findings.push(...app.checkStockDeltas(stockOf(before), stockOf(attempt.moved), {}, { label: '生徒の移動で在庫が変わった' }))
        applied(name, before, attempt.moved)
        return 'applied'
      }
      case 'attend-absent':
      case 'attend-no-makeup':
      case 'attend-attended':
      case 'attend-place':
      case 'attend-clear': {
        step.notes.push(describeAttendanceOp(candidate))
        const attempt = await attemptAttendanceOp(ctx, { before, op: candidate })
        step.operations += attempt.operations
        step.notes.push(...attempt.notes)
        step.findings.push(...attempt.findings)
        if (attempt.outcome === 'nothing') {
          aborted = attempt.message
          return 'aborted'
        }
        if (attempt.outcome === 'blocked') return 'blocked'
        if (attempt.outcome === 'not-placed') return 'blocked'
        step.diff = attempt.diff
        applied(name, before, attempt.after)
        return 'applied'
      }
      case 'teacher-move':
      case 'teacher-swap':
      case 'seat-swap':
      case 'teacher-menu':
      case 'teacher-rest':
      case 'teacher-release': {
        const hio = handIo(hand, labelOf(name))
        const position = { cellId: candidate.cellId, deskIndex: candidate.deskIndex }
        const who = (teacherName) => describeTeacher(app, before.payload, teacherName)
        let result
        if (name === 'teacher-rest') {
          step.notes.push(`講師の休み: ${candidate.cellId} 机${candidate.deskIndex + 1} ${who(candidate.teacher)}(机の生徒は残る)`)
          result = await runTeacherOpOn(ctx, hio, step, { kind: 'rest', ...position }, () => driver.toggleTeacherRest(session, position))
        } else if (name === 'teacher-release') {
          // 解除で盤面が前に保存した形へ戻ると、ローカルモードは控え(IndexedDB)に途中の形を残す(台本 f と同じ罠)。先に保存してから解除する。
          if (await driver.clickSave(session)) step.operations += 1
          step.notes.push(`講師の休みの解除: ${candidate.cellId} 机${candidate.deskIndex + 1} 休 ${candidate.restName}(解除のあとの再マージでテンプレの講師が戻るのは仕様どおり・§2-4)`)
          result = await runTeacherOpOn(ctx, hio, step, { kind: 'release', ...position }, async () => {
            const toggled = await driver.toggleTeacherRest(session, position)
            if (toggled.label) step.notes.push(`押したボタン: ${toggled.label}`)
            return toggled
          })
        } else {
          result = await runSimpleTeacherOp(ctx, hio, step, candidate, { pickMenuTeacher })
        }
        if (result.outcome === 'applied') {
          applied(name, before, result.after)
          return 'applied'
        }
        return result.outcome === 'skipped' ? 'skipped' : 'blocked'
      }
      case 'holiday':
      case 'whole-day': {
        if (!(await clearHistory(step))) return 'skipped'
        if (stopsIn(step.findings)) return 'applied'
        // 来週の月曜から 4 週を開き、その範囲の日から選ぶ(台本 g と同じ・dayOps.ts の pickDayOpsPlan)。
        const openedWeeks = weekStartsFrom(nextMonday)
        for (const monday of openedWeeks) await driver.gotoWeekOf(session, monday)
        io.current = await read()
        const plan = app.pickDayOpsPlan({ facts: io.current.facts, payload: io.current.payload, dateKeys: openedWeeks.flatMap((monday) => weekDateKeysFrom(monday)), todayKey: today, random: pickRandom })
        const target = name === 'holiday' ? plan.holiday : plan.transfer
        if (!target) {
          step.notes.push(`候補なしで飛ばした: ${plan.skipped.filter((reason) => reason.includes(name === 'holiday' ? '休日' : '丸ごと振替')).join(' / ') || plan.skipped.join(' / ') || '日付が選べない'}`)
          await driver.gotoWeekOf(session, weekStart)
          io.current = await read()
          base = io.current
          return 'skipped'
        }
        step.notes.push(name === 'holiday'
          ? `休日にする日: ${target.dateKey}(席の生徒 ${target.studentCount} 人)`
          : `丸ごと振替: 振替元 ${target.sourceDateKey}(席の生徒 ${target.studentCount} 人)→ 振替先の候補 ${target.targetDateKeys.join('・')}`)
        await finishHand(step)
        step.finished = true
        const hio = handIo(hand, labelOf(name))
        const result = name === 'holiday'
          ? await runHolidayFlow(ctx, hio, { holiday: target, ineligibleSeatKeys: collectStockIneligibleSeatKeys(io.current.payload) })
          : await runWholeDayTransferFlow(ctx, hio, { transfer: target })
        if (handStop) return 'applied'
        if (result.effective > 0) await persistDayOps(ctx, hio, '日付の操作のあと 保存→読み込み直し')
        return finishHeavy(name, result.effective > 0)
      }
      case 'template-edit': {
        if (!(await clearHistory(step))) return 'skipped'
        if (stopsIn(step.findings)) return 'applied'
        const kinds = app.TEMPLATE_EDIT_KINDS ?? ['add-student', 'change-teacher', 'delete-desk']
        const kind = pickOne(kinds, pickRandom)
        step.notes.push(`テンプレの変え方: ${kind}(反映日 ${nextMonday})`)
        await finishHand(step)
        step.finished = true
        const hio = handIo(hand, labelOf(name))
        const { done } = await runTemplateEditOnce(ctx, hio, { kind, index: 0, random: pickRandom, usedCellIds: new Set(), nextMonday, today })
        if (handStop) return 'applied'
        if (done) await persistTemplateEdit(ctx, hio, 'テンプレを変えて保存のあと 保存→読み込み直し')
        return finishHeavy(name, done)
      }
      case 'undo':
      case 'redo': {
        const isUndo = name === 'undo'
        const code = isUndo ? 'undo-not-restored' : 'redo-not-restored'
        // 前に保存した形へ戻る操作のあと、ローカルモードは控えに途中の形を残す(台本 f・g・h と同じ罠)。押す前に保存する(未保存のときだけ押せる)。
        if (await driver.clickSave(session)) { step.operations += 1; step.notes.push('押す前に保存した(ローカルモードの控えの罠を避ける)') }
        const pressed = await (isUndo ? driver.clickUndo(session) : driver.clickRedo(session))
        if (!pressed) {
          // 見込みでは押せるはず(盤面の手が効いた・元に戻した)なのに押せないのは、室長にとって「戻せない／やり直せない」。押せなかったものは数えない。
          step.findings.push({ level: 'stop', code, message: `でたらめ操作 ${hand} 手目: ${isUndo ? '元に戻す' : 'やり直し'}が押せない(ボタンが無効・見込みの元に戻す ${model.undoDepth}・やり直し ${model.redoDepth})` })
          return 'applied'
        }
        step.operations += 1
        const after = await read()
        const expected = isUndo ? undoStack.pop() : redoStack.pop()
        const other = isUndo ? redoStack : undoStack
        other.push(io.current)
        if (other.length > maxUndo) other.shift()
        io.current = after
        model = advance(model, name, 'applied')
        effective += 1
        effectiveByPart.set(name, (effectiveByPart.get(name) ?? 0) + 1)
        step.notes.push(`ステータス: ${await driver.readStatusText(session)}`)
        step.diff = { before: expected.facts, after: after.facts }
        step.findings.push(
          ...app.checkSameState(expected.facts, after.facts, code),
          ...app.checkStockDeltas(stockOf(expected), stockOf(after), {}, { code, label: isUndo ? '元に戻すで在庫が操作の前に戻らない' : 'やり直しで在庫が操作のあとに戻らない' }),
        )
        return 'applied'
      }
      case 'save':
        await saveHand(step)
        return 'applied'
      case 'reload':
        return (await reloadHand(step)) ? 'applied' : 'skipped'
      default:
        throw new Error(`知らない部品です: ${name}`)
    }
  }
  /** 重い部品のあと: 使う週を開き直し、この状態を新しい土台にする(保存→読み込み直しで終わっているので履歴は空)。 */
  const finishHeavy = async (name, done) => {
    await driver.gotoWeekOf(session, weekStart)
    io.current = await read()
    base = io.current
    undoStack = []
    redoStack = []
    if (!done) {
      model = advance(model, name, 'blocked')
      return 'blocked'
    }
    effective += 1
    effectiveByPart.set(name, (effectiveByPart.get(name) ?? 0) + 1)
    model = advance(model, name, 'applied')
    return 'applied'
  }

  const summary = io.newStep('でたらめ操作のまとめ')
  try {
    for (let index = 0; index < count; index += 1) {
      const hand = index + 1
      // 候補の無い部品は、その手の中で選び直す(手に数えない・盤面が変わるまでその部品を選ばない)。保存か読み込み直しは必ず選べるので止まる。
      const retried = []
      let name
      let candidate
      for (;;) {
        name = pickNextRandomPart(model, opRandom, weights)
        const found = findCandidate(name)
        if (found.none) {
          retried.push(`${labelOf(name)}(${found.none})`)
          model = advance(model, name, 'skipped')
          continue
        }
        candidate = found.candidate
        break
      }
      const step = io.newStep(`でたらめ ${hand} 手目(${labelOf(name)})`)
      if (retried.length > 0) step.notes.push(`候補なしで選び直した: ${retried.join('・')}`)
      handStop = false
      let outcome
      try {
        outcome = await runHand(hand, name, candidate, step)
      } catch (error) {
        // driver の時間切れなどで抜けても、何手目のどの部品だったかを報告に残す。
        ops.push(name)
        if (!step.finished) {
          step.notes.push(`この手の途中で止まった: ${error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : String(error)}`)
          await finishHand(step)
        }
        throw error
      }
      if (outcome === 'blocked' && PART_BY_NAME.get(name).kind === 'board') model = advance(model, name, 'blocked')
      if (outcome === 'skipped' && PART_BY_NAME.get(name).kind === 'board') model = advance(model, name, 'skipped')
      if (outcome === 'skipped' && PART_BY_NAME.get(name).kind === 'heavy') model = advance(model, name, 'skipped')
      ops.push(outcome === 'blocked' ? `${name}(断)` : outcome === 'skipped' && PART_BY_NAME.get(name).kind !== 'reload' ? `${name}(無)` : name)
      if (!step.finished) await finishHand(step)
      if (outcome === 'aborted') {
        stoppedAt = hand
        break
      }
      if (handStop) {
        stoppedAt = hand
        break
      }
    }

    if (stoppedAt === null && aborted === null) {
      // 最後に必ず土台へ戻す(台本 a を土台の状態から始める)。押せなかったら「変」。前に保存した形へ戻る罠を避けるため、押すたびに先に保存する。
      const back = undoStack.length
      let pressedAll = true
      for (let index = 0; index < back; index += 1) {
        if (await driver.clickSave(session)) summary.operations += 1
        if (!(await driver.clickUndo(session))) {
          summary.findings.push({ level: 'stop', code: 'undo-not-restored', message: `でたらめ操作の最後に土台へ戻す元に戻す(${index + 1}/${back} 回目)が押せない(ボタンが無効)` })
          pressedAll = false
          break
        }
        summary.operations += 1
      }
      // 戻す先: 元に戻すの履歴の一番古い項目(履歴の上限で古い手が外れていなければ土台と同じ)。
      const target = undoStack.length > 0 ? undoStack[0] : base
      const final = await read()
      if (pressedAll) {
        summary.findings.push(
          ...app.checkSameState(target.facts, final.facts, 'undo-not-restored'),
          ...app.checkStockDeltas(stockOf(target), stockOf(final), {}, { code: 'undo-not-restored', label: '最後に元に戻しても在庫が土台に戻らない' }),
        )
      }
      if (stopsIn(summary.findings)) summary.diff = { before: target.facts, after: final.facts }
      io.current = final
      summary.notes.push(`最後に元に戻す ${back} 回で土台へ戻す${stopsIn(summary.findings) ? '(戻らない)' : '(土台と同じ)'}`)
    } else if (aborted === null) {
      summary.notes.push(`「変」が出たので ${stoppedAt} 手目で打ち切りました。土台へは戻していません(このあとの台本はこの盤面から始まります)。`)
    }
  } finally {
    summary.notes.unshift(`手順: ${formatRandomTrace(seed, ops)}`)
    const byPart = [...effectiveByPart.entries()].map(([name, value]) => `${labelOf(name)} ${value}`).join('・')
    summary.notes.push(`盤面を変えた手 ${effective}/${ops.length}${byPart ? `(${byPart})` : ''}${effective === 0 ? '・盤面を変えた手が 1 つも無い(何も確かめていない)' : ''}`)
    if (droppedFromHistory > 0) summary.notes.push(`元に戻すの履歴(アプリは ${maxUndo} まで)から外れた手 ${droppedFromHistory} は戻さない(最後の元に戻すは届く所まで・その手は盤面に残ったまま、このあとの台本はこの盤面から始まります)。`)
    if (persisted > 0) summary.notes.push(`でたらめ操作で ${persisted} 回の手が保存されたまま残っています(読み込み直しで元に戻す履歴が消えるため。このあとの台本はこの盤面から始まります)。`)
    operations += summary.operations
    await io.finish(summary)
  }
  return { ops, operations, trace: formatRandomTrace(seed, ops), aborted, stoppedAt, persisted, effective }
}
