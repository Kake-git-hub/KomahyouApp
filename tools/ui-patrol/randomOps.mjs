// 画面の自動巡回(tools/ui-patrol.mjs)の「でたらめ操作」の土台(試験的・--random n が 1 以上のときだけ流す。既定 0＝動かない)。
// 第 1 段にある 5 つの操作(移動・元に戻す・やり直し・保存・読み込み直し)を、種つきの乱数で組み合わせて流し、操作のたびに点検する。
// ★第 2 段で操作を足すときは、RANDOM_OPS に「操作・できる条件(canRun)・見込みの進め方(advance)」を 1 つ足し、
//   runRandomOps の実行の分岐に「変わってよい範囲(点検)」を 1 つ足せば流れる形にしてある。
// ★見込み(model)は乱数と操作の結果だけで決める(実際の保存ボタンの状態を毎回読んで選ぶと、ローカルモードの 5 秒後の自動保存の
//   時間差で選ぶ操作が変わり、同じ種で流し直せなくなる)。食い違いは、その操作を行う時点で実際の状態を正として直す。
// ★点検は checks.ts(束ねた app)・移動 1 回の「操作→読む→点検」は scenarios.mjs の attemptStudentMove(台本 b と共有)。ここで規則を書き直さない。
import { MOVE_KINDS, attemptStudentMove, createSeededRandom, pickMoveCandidates, weekDateKeysFrom } from './scenarios.mjs'

/**
 * 操作の一覧。canRun: 今の見込みでその操作を選んでよいか。advance: 操作のあとの見込み(applied=押せた/効いた)。
 * - move: 移動の候補が無いと分かっている間(canMove=false)は選ばない。効くと元に戻すが 1 つ積まれ、やり直しは捨てられる。断られた移動は変えない。
 * - undo / redo: 積まれているときだけ。盤面が変わるので未保存になる。
 * - save: 未保存のときだけ。押せなかった(既に clean・ローカルモードの自動保存)ときも、実際の状態を正として保存済みにする。
 * - reload: 保存済みのときだけ(未保存で読み込み直すと beforeunload が出る)。アプリは読み込み直しで履歴を捨てるので両方 0。
 *   行えなかった(実際の保存ボタンが clean でなかった)ときは、実際の状態を正として未保存に直す。
 */
const RANDOM_OPS = [
  {
    name: 'move',
    canRun: (model) => model.canMove !== false,
    advance: (model, applied) => (applied ? { ...model, undoDepth: model.undoDepth + 1, redoDepth: 0, dirty: true, canMove: true } : model),
  },
  {
    name: 'undo',
    canRun: (model) => model.undoDepth > 0,
    advance: (model, applied) => (applied ? { ...model, undoDepth: model.undoDepth - 1, redoDepth: model.redoDepth + 1, dirty: true, canMove: true } : model),
  },
  {
    name: 'redo',
    canRun: (model) => model.redoDepth > 0,
    advance: (model, applied) => (applied ? { ...model, undoDepth: model.undoDepth + 1, redoDepth: model.redoDepth - 1, dirty: true, canMove: true } : model),
  },
  {
    name: 'save',
    canRun: (model) => model.dirty,
    advance: (model) => ({ ...model, dirty: false }),
  },
  {
    name: 'reload',
    canRun: (model) => !model.dirty,
    advance: (model, applied) => (applied ? { ...model, undoDepth: 0, redoDepth: 0, dirty: false, canMove: true } : { ...model, dirty: true }),
  },
]

export const RANDOM_OP_NAMES = RANDOM_OPS.map((op) => op.name)

/** 今できる操作の中から、種つきの乱数で次の操作を選ぶ。 model: { undoDepth, redoDepth, dirty, canMove? }。 */
export function pickNextRandomOp(model, random) {
  const available = RANDOM_OPS.filter((op) => op.canRun(model))
  // save と reload は dirty で必ずどちらかが選べるので、空にはならない。
  return available[Math.floor(random() * available.length)].name
}

/** 操作のあとの見込み(元に戻す／やり直しの深さ・未保存か)を進める。元の見込みは書き換えない。 */
export function advanceRandomModel(model, opName, { applied }) {
  const op = RANDOM_OPS.find((item) => item.name === opName)
  if (!op) throw new Error(`知らない操作です: ${opName}`)
  return op.advance(model, applied)
}

/** 手順の列を、あとで同じ種で流し直せる 1 行にする(例: "seed=1: move→undo→save→reload")。 */
export function formatRandomTrace(seed, ops) {
  return `seed=${seed}: ${ops.length > 0 ? ops.join('→') : '(なし)'}`
}

// 台本 b と乱数の列を分ける(同じ --seed でも、b の候補選びと同じ乱数を消費しない)。操作の選び方と、移動の候補の選び方も分ける
// (移動の候補が無いときなど、片方の消費のしかたでもう片方の列がずれないように)。
const OP_STREAM = 0x52414e44
const MOVE_STREAM = 0x4d4f5645

/**
 * でたらめ操作を options.random 回選んで流す。start は始める前の状態(土台)、weekStart は移動に使う週(盤面はその週を開いている前提)。
 * read は状態を読む関数({ payload, facts, auditResult })、audit は状態の保証台帳。所見は onFinding、注は onNote へ出す。
 * 操作は押せた/効いたものだけ数える(断られた移動は 1・押せなかった保存は 0)。「変」が出たらそこで打ち切る(土台へは戻さない)。
 * 打ち切らずに終えたら、元に戻すを積んだ分だけ押して、土台(最後の読み込み直しのあとの状態・無ければ start)と同じかを点検する。
 * → { ops, operations, trace, current(最後の状態), diff(「変」の出た操作の前後の事実・無ければ null), aborted(中断の理由・無ければ null),
 *     stoppedAt(「変」の出た操作の番号・無ければ null), persistedMoves(読み込み直しで保存されたまま残った移動の数) }
 */
export async function runRandomOps({ session, app, options, today, driver, start, weekStart, read, audit, onFinding = () => {}, onNote = () => {} }) {
  const seed = Number(options.seed) || 0
  const count = Math.max(0, Number(options.random) || 0)
  const opRandom = createSeededRandom((seed + OP_STREAM) >>> 0)
  const moveRandom = createSeededRandom((seed + MOVE_STREAM) >>> 0)
  const weekDateKeys = weekDateKeysFrom(weekStart)
  // 始めは未保存とみなす(台本 b の最後の元に戻すのあと、自動保存が済んだかは時間で変わる。見込みを時間に依存させない)。
  let model = { undoDepth: 0, redoDepth: 0, dirty: true, canMove: true }
  const ops = []
  const details = []
  let operations = 0
  let base = start
  let current = start
  let undoStack = []
  let redoStack = []
  let persistedMoves = 0
  let diff = null
  let aborted = null
  let stoppedAt = null
  const emit = (findings) => {
    for (const finding of findings) onFinding(finding)
    return findings.some((finding) => finding.level === 'stop')
  }
  const stopHere = (before, after) => {
    diff = before && after ? { before: before.facts, after: after.facts } : null
    stoppedAt = ops.length
  }
  const cannotPress = (label, code) => ({ level: 'stop', code, message: `でたらめ操作 ${ops.length} 回目: ${label}が押せない(ボタンが無効・見込みの元に戻す ${model.undoDepth}・やり直し ${model.redoDepth})` })

  let effectiveMoves = 0
  // 途中で driver の待ちが時間切れになって例外で抜けても、手順の 1 行と注は必ず出す(流し直しの手がかり)。
  try {
    loop: for (let index = 0; index < count; index += 1) {
      const op = pickNextRandomOp(model, opRandom)
      ops.push(op)
      const label = `${index + 1}. ${op}`
      switch (op) {
        case 'move': {
          // その時点の盤面の事実から選び直す(前の移動で席が埋まっている)。種類ごとに 1 つずつ選び、その中から 1 つ。
          const candidates = pickMoveCandidates(current.facts, { weekDateKeys, todayKey: today, count: MOVE_KINDS.length, seed: Math.floor(moveRandom() * 4294967296) })
          if (candidates.length === 0) {
            details.push(`${label}: 動かせる生徒と空いた席の組が無い(操作に数えない・次に盤面が変わるまで移動を選ばない)`)
            model = { ...model, canMove: false }
            break
          }
          const candidate = candidates[Math.floor(moveRandom() * candidates.length)]
          const attempt = await attemptStudentMove({ session, driver, app, before: current, candidate, read, audit })
          operations += 1
          details.push(`${label}: ${attempt.notes.join(' / ')}`)
          const hasStop = emit(attempt.findings)
          if (attempt.outcome === 'nothing') {
            aborted = attempt.message
            stoppedAt = ops.length
            break loop
          }
          if (attempt.outcome === 'blocked') {
            model = advanceRandomModel(model, 'move', { applied: false })
            break
          }
          undoStack.push(current)
          redoStack = []
          current = attempt.moved
          effectiveMoves += 1
          model = advanceRandomModel(model, 'move', { applied: true })
          if (hasStop) {
            diff = attempt.diff
            stoppedAt = ops.length
            break loop
          }
          break
        }
        case 'undo':
        case 'redo': {
          const isUndo = op === 'undo'
          const code = isUndo ? 'undo-not-restored' : 'redo-not-restored'
          const pressed = await (isUndo ? driver.clickUndo(session) : driver.clickRedo(session))
          if (!pressed) {
            // 見込みでは押せるはず(移動が効いた・元に戻した)なのに押せないのは、室長にとって「戻せない／やり直せない」。押せなかったものは数えない。
            emit([cannotPress(isUndo ? '元に戻す' : 'やり直し', code)])
            stopHere(null, null)
            break loop
          }
          operations += 1
          const after = await read()
          const expected = isUndo ? undoStack.pop() : redoStack.pop()
          ;(isUndo ? redoStack : undoStack).push(current)
          current = after
          model = advanceRandomModel(model, op, { applied: true })
          details.push(`${label}: ${await driver.readStatusText(session)}`)
          if (emit(app.checkSameState(expected.facts, after.facts, code))) {
            stopHere(expected, after)
            break loop
          }
          break
        }
        case 'save': {
          const pressed = await driver.clickSave(session)
          if (pressed) {
            operations += 1
            details.push(`${label}: 保存しました`)
          } else {
            details.push(`${label}: 保存ボタンは既に clean で押せませんでした(ローカルモードは変更の 5 秒後に自分で保存する・操作に数えない)`)
          }
          const saved = await read()
          const before = current
          current = saved
          model = advanceRandomModel(model, 'save', { applied: pressed })
          if (emit(app.checkSameState(before.facts, saved.facts, 'save-changed'))) {
            stopHere(before, saved)
            break loop
          }
          break
        }
        case 'reload': {
          // 未保存のまま読み込み直すと beforeunload が出る。保存ボタンが clean であることを確かめてから(食い違えば実際の状態を正とする)。
          const saveState = await driver.readSaveState(session)
          if (saveState !== 'clean') {
            details.push(`${label}: 保存ボタンが ${saveState} なので読み込み直さない(見込みを未保存に直す・操作に数えない)`)
            model = advanceRandomModel(model, 'reload', { applied: false })
            break
          }
          await driver.reloadApp(session)
          operations += 1
          const reloaded = await read()
          if (emit(app.checkSameState(current.facts, reloaded.facts, 'reload-changed'))) {
            stopHere(current, reloaded)
            current = reloaded
            break loop
          }
          // 読み込み直すと履歴が消えて戻せない。読み込み直しの前に保存しているので、この状態(保存された正しい状態)を新しい土台にする。
          persistedMoves += undoStack.length
          // 盤面の操作は開いている週の席に対して行うので、移動に使う週を開き直す(週へ移るだけなので操作に数えない)。
          await driver.gotoWeekOf(session, weekStart)
          current = await read()
          base = current
          undoStack = []
          redoStack = []
          model = advanceRandomModel(model, 'reload', { applied: true })
          details.push(`${label}: 読み込み直しました(この状態を新しい土台にする)`)
          break
        }
        default:
          throw new Error(`知らない操作です: ${op}`)
      }
    }

    if (stoppedAt === null && aborted === null) {
      // 最後に必ず土台へ戻す(台本 a を土台の状態から始める)。押せなかったら「変」。
      const back = undoStack.length
      let pressedAll = true
      for (let index = 0; index < back; index += 1) {
        if (!(await driver.clickUndo(session))) {
          emit([cannotPress(`最後に土台へ戻す元に戻す(${index + 1}/${back} 回目)`, 'undo-not-restored')])
          pressedAll = false
          break
        }
        operations += 1
      }
      const final = await read()
      const findings = pressedAll ? app.checkSameState(base.facts, final.facts, 'undo-not-restored') : []
      if (!pressedAll || emit(findings)) stopHere(base, final)
      current = final
      details.push(`最後に元に戻す ${back} 回で土台へ戻す${stoppedAt === null ? '(土台と同じ)' : '(戻らない)'}`)
    } else if (aborted === null) {
      details.push('「変」が出たので打ち切りました。土台へは戻していません(台本 a はこの盤面から始まります)。')
    }
  } finally {
    onNote(`手順: ${formatRandomTrace(seed, ops)}`)
    onNote(`効いた移動 ${effectiveMoves} 回${effectiveMoves === 0 ? '(移動の点検は 1 回も行っていません)' : ''}`)
    if (persistedMoves > 0) onNote(`でたらめ操作で ${persistedMoves} 回の移動が保存されたまま残っています(読み込み直しで元に戻す履歴が消えるため。台本 a はこの盤面から始まります)。`)
    for (const detail of details) onNote(detail)
  }
  return { ops, operations, trace: formatRandomTrace(seed, ops), current, diff, aborted, stoppedAt, persistedMoves, effectiveMoves }
}
