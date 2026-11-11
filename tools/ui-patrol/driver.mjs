// 画面の自動巡回(tools/ui-patrol.mjs)のブラウザ操作の部品。室長と同じ画面操作(ボタン・長押しドラッグ)だけを行う。
// ★外へは出さない: localhost 以外は名前解決の段階で止め(--host-resolver-rules)、さらに context.route で localhost・data:・blob: 以外を
//   止めてホスト名を externalRequests に残す(台本が「変」として報告する)。
// ★待ちは条件で待つ(testid の状態・読み口の値)。固定の待ちは長押しと描画の落ち着きだけ(selectors.mjs の DRIVER_TIMING)。
//   待ちが時間切れになったら PatrolAbortError を投げる(台本が画面写真を撮って教室を「中断」にする。所見にはしない)。
// ★Playwright は package.json に入れない(この環境の全体の node_modules から読む)。読めなければ loadPlaywright() が null を返す。
import { createRequire } from 'node:module'
import { CLASS_SELECTORS, DRIVER_TIMING, PROP_TESTIDS, SEARCHABLE_SELECT_TESTIDS, TESTIDS, TESTID_PREFIXES, byTestId, dayHeaderTestId, lectureStockEntryTestId, makeupStockEntryTestId, studentCellTestId, studentNameTestId, teacherCellTestId, weekJumpDayTestId } from './selectors.mjs'

export class PatrolAbortError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PatrolAbortError'
  }
}

const BLANK_PATH = '/__ui-patrol-blank.html'
const BOOT_TIMEOUT_MS = 120000
const HOOK_TIMEOUT_MS = 30000
const READ_TIMEOUT_MS = 10000
const READ_INTERVAL_MS = 200
const SAVE_TIMEOUT_MS = 60000
const TEMPLATE_PREVIEW_TIMEOUT_MS = 120000
const TEMPLATE_SAVE_TIMEOUT_MS = 300000
const STATUS_CHANGE_TIMEOUT_MS = 3000
const UI_TIMEOUT_MS = 15000
/** 盤面の全コマがスクロールなしで入る大きさ(盤面の自動スクロールが長押しドラッグの着地をずらさないように)。 */
export const PATROL_VIEWPORT = { width: 2600, height: 3400 }

export function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright')
  } catch {
    return null
  }
}

/**
 * 止めずに通す URL か: 手元のサーバー(baseUrl)と同じ origin(vite の HMR の WebSocket は同じホスト・ポートの ws:)・data:・blob: だけ。
 * localhost でも別のポートは通さない(手元の別のサーバーへ巡回のデータが流れないように・作業 5 修正 1)。
 */
export function isAllowedPatrolUrl(url, baseUrl) {
  if (url.startsWith('data:') || url.startsWith('blob:')) return true
  try {
    const parsed = new URL(url)
    const base = new URL(baseUrl)
    if (parsed.host !== base.host) return false
    return parsed.protocol === base.protocol || (base.protocol === 'http:' && parsed.protocol === 'ws:')
  } catch {
    return false
  }
}

function hostOf(url) {
  try {
    return new URL(url).host || url.slice(0, 40)
  } catch {
    return url.slice(0, 40)
  }
}

async function withTimeout(promise, message) {
  try {
    return await promise
  } catch (error) {
    if (error && (error.name === 'TimeoutError' || /Timeout/.test(String(error.message)))) throw new PatrolAbortError(message)
    throw error
  }
}

export async function launchPatrolBrowser({ baseUrl, headed = false }) {
  const playwright = loadPlaywright()
  if (!playwright) throw new PatrolAbortError('Playwright が無い環境では回せません。')
  const browser = await playwright.chromium.launch({
    headless: !headed,
    // Playwright の既定は Ctrl+C でブラウザを閉じてすぐ process.exit する(開発用サーバーを止める前に終わってしまう)。
    // シグナルは tools/ui-patrol.mjs の installSignalCleanup がまとめて片づける。
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [
      // ローカルモードのアプリは navigator.webdriver が true だと保存を止める(src/App.tsx の isSnapshotPersistenceRuntimeEnabled)。
      // 巡回は保存も通すので隠す(開いた直後に false を確かめる)。
      '--disable-blink-features=AutomationControlled',
      // localhost 以外は名前解決の段階で止める(本番・外部のサービスへ 1 件も出さない)。
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
      // 環境変数の proxy(HTTPS_PROXY など)を使うと、名前解決はプロキシ側で行われ上の止め方が効かない。プロキシを使わない。
      '--no-proxy-server',
    ],
  })
  const session = { browser, context: null, page: null, baseUrl, externalRequests: [], pageErrors: [], dialogs: [], downloads: 0, classroomId: null }
  try {
    const context = await browser.newContext({ viewport: PATROL_VIEWPORT, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', deviceScaleFactor: 1, acceptDownloads: true })
    session.context = context
    await context.route('**/*', (route) => {
      const url = route.request().url()
      if (isAllowedPatrolUrl(url, baseUrl) && new URL(url).pathname === BLANK_PATH) {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>ui-patrol</title>' })
      }
      if (isAllowedPatrolUrl(url, baseUrl)) return route.continue()
      session.externalRequests.push(hostOf(url))
      return route.abort('blockedbyclient')
    })
    // context.route は WebSocket を捕まえないので別に見る。同じ origin(vite の HMR)だけサーバーへつなぎ、ほかは閉じて記録する。
    await context.routeWebSocket(/.*/, (socket) => {
      const url = socket.url()
      if (isAllowedPatrolUrl(url, baseUrl)) {
        socket.connectToServer()
        return
      }
      session.externalRequests.push(hostOf(url))
      void Promise.resolve(socket.close({ code: 1008, reason: 'ui-patrol' })).catch(() => {})
    })
    const page = await context.newPage()
    session.page = page
    page.on('pageerror', (error) => session.pageErrors.push(String(error?.message ?? error).split('\n')[0].slice(0, 300)))
    // ダイアログは全部 accept して文を残す(出席不可コマへの移動の確認など。室長が「OK」を押したのと同じ)。
    page.on('dialog', (dialog) => {
      session.dialogs.push(`${dialog.type()}: ${dialog.message().split('\n')[0].slice(0, 200)}`)
      dialog.accept().catch(() => {})
    })
    // テンプレ保存前の盤面の PDF などのダウンロードは保存しない。
    page.on('download', (download) => {
      session.downloads += 1
      download.cancel().catch(() => {})
    })
    return session
  } catch (error) {
    await browser.close().catch(() => {})
    throw error
  }
}

async function waitForBoard(session) {
  const { page } = session
  const save = page.locator(byTestId(TESTIDS.saveButton))
  const duplicate = page.locator(byTestId(TESTIDS.duplicateTabBlock))
  await withTimeout(save.or(duplicate).first().waitFor({ state: 'visible', timeout: BOOT_TIMEOUT_MS }), '盤面が開きませんでした(保存ボタンが出ない)。')
  if (await duplicate.isVisible()) throw new PatrolAbortError('同じ教室を別のタブで開いている扱いになりました(duplicate-tab-block)。')
  await withTimeout(page.waitForFunction(
    (classroomId) => window.__komahyouUiPatrol?.readClassroom?.()?.classroomId === classroomId,
    session.classroomId,
    { timeout: HOOK_TIMEOUT_MS, polling: 500 },
  ), '巡回の読み口が出ないか、開いた教室が種データの教室ではありません。')
  await fitViewportToBoard(session)
}

/**
 * 盤面の全コマがスクロールなしで入るよう、画面の大きさを広げる(狭めない)。保留(2 行)の机が多いと盤面が既定の高さを越え、
 * 長押しドラッグで端へ寄ったときに盤面が自動スクロールして着地がずれるため(handleStudentMouseDown の autoScrollStep)。
 */
export async function fitViewportToBoard(session) {
  const { page } = session
  const need = await page.evaluate(() => {
    const grid = document.querySelector('.slot-adjust-grid')
    const rect = grid?.getBoundingClientRect()
    const gridBottom = grid && rect ? rect.top + window.scrollY + grid.scrollHeight : 0
    const gridRight = grid && rect ? rect.left + window.scrollX + grid.scrollWidth : 0
    return {
      height: Math.ceil(Math.max(document.documentElement.scrollHeight, gridBottom + 120)),
      width: Math.ceil(Math.max(document.documentElement.scrollWidth, gridRight + 40)),
    }
  })
  const current = page.viewportSize() ?? PATROL_VIEWPORT
  if (need.height > current.height || need.width > current.width) {
    await page.setViewportSize({ width: Math.max(current.width, need.width), height: Math.max(current.height, need.height) })
    await page.waitForTimeout(200)
  }
}

/** アプリの起動前に種データを入れて開き、盤面と読み口を待つ。アプリを先に開いてから入れると、初回起動の自動保存のほうが新しい扱いになり種データが読まれない。 */
export async function seedAndOpen(session, seedSnapshot) {
  const { page, baseUrl } = session
  await page.goto(`${baseUrl}${BLANK_PATH}`, { waitUntil: 'load' })
  const webdriver = await page.evaluate(() => navigator.webdriver)
  if (webdriver !== false) throw new PatrolAbortError('navigator.webdriver が false になりません(アプリが保存を止めるので回せません)。')
  const seeded = await page.evaluate(async (snapshot) => {
    const repository = await import('/src/data/appSnapshotRepository.ts')
    return repository.saveWorkspaceSnapshot(snapshot)
  }, { ...seedSnapshot, savedAt: new Date().toISOString() })
  if (!seeded?.savedToIndexedDb) throw new PatrolAbortError('種データをブラウザの保存領域(IndexedDB)へ入れられませんでした。')
  session.classroomId = seedSnapshot.actingClassroomId
  await page.goto(`${baseUrl}/`, { waitUntil: 'load' })
  await waitForBoard(session)
}

/** 開いている教室の { classroomId, payload }。盤面の JSON が 2 回続けて同じになるまで 200ms おきに読む(最長 10 秒)。 */
export async function readClassroom(session) {
  const result = await session.page.evaluate(async ({ intervalMs, timeoutMs }) => {
    const started = Date.now()
    let previous = null
    for (;;) {
      const read = window.__komahyouUiPatrol?.readClassroom?.() ?? null
      // payload は App の状態と中身を共有するので、ページの中で書き換えない(文字列にして外へ出すだけ)。
      const text = read ? JSON.stringify(read.payload) : null
      if (read && text === previous) return { classroomId: read.classroomId, json: text }
      previous = text
      if (Date.now() - started > timeoutMs) return { timeout: true }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }, { intervalMs: READ_INTERVAL_MS, timeoutMs: READ_TIMEOUT_MS })
  if (result.timeout) throw new PatrolAbortError('盤面の状態が 10 秒たっても落ち着きませんでした(読み口)。')
  if (result.classroomId !== session.classroomId) throw new PatrolAbortError('開いている教室が種データの教室ではありません。')
  return { classroomId: result.classroomId, payload: JSON.parse(result.json) }
}

export async function readStatusText(session) {
  return (await session.page.locator(byTestId(TESTIDS.status)).innerText().catch(() => '')).trim()
}

export async function readSaveState(session) {
  return session.page.locator(byTestId(TESTIDS.saveButton)).getAttribute('data-state')
}

/** 保存ボタン → data-state="clean" を待つ。押せたら true、既に clean なら false。 */
export async function clickSave(session) {
  const { page } = session
  const save = page.locator(byTestId(TESTIDS.saveButton))
  if ((await save.getAttribute('data-state')) === 'clean') return false
  await save.click()
  await withTimeout(page.waitForFunction(
    (selector) => document.querySelector(selector)?.getAttribute('data-state') === 'clean',
    byTestId(TESTIDS.saveButton),
    { timeout: SAVE_TIMEOUT_MS },
  ), '保存が終わりませんでした(保存ボタンが clean に戻らない)。')
  return true
}

/** 読み込み直し。未保存があると beforeunload が出るので、台本は先に保存しておく。 */
export async function reloadApp(session) {
  await session.page.goto(`${session.baseUrl}/`, { waitUntil: 'load' })
  await waitForBoard(session)
}

/** 週の選択から dateKey の週へ移る。表示中の月に無ければ月を送る。 */
export async function gotoWeekOf(session, dateKey) {
  const { page } = session
  await page.locator(byTestId(TESTIDS.weekLabel)).click()
  await withTimeout(page.locator(byTestId(TESTIDS.weekJumpPopover)).waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS }), '週の選択が開きませんでした。')
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const day = page.locator(byTestId(weekJumpDayTestId(dateKey)))
    if ((await day.count()) > 0) {
      await day.first().click()
      // 休日・休校の日はコマ(data-cell-id)を描かないので、日付の見出しが出るのも「その週が出た」とみなす(台本 h が夏期講習の盆休みの週を開いて分かった)。
      await withTimeout(page.locator(`[data-cell-id^="${dateKey}_"], ${byTestId(dayHeaderTestId(dateKey))}`).first().waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS }), `${dateKey} の週が盤面に出ませんでした。`)
      await fitViewportToBoard(session)
      return
    }
    const shown = await page.locator('[data-testid^="week-jump-day-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid').slice('week-jump-day-'.length)).sort())
    const goBack = shown.length > 0 && dateKey < shown[0]
    await page.locator(byTestId(goBack ? TESTIDS.weekJumpPrevMonth : TESTIDS.weekJumpNextMonth)).click()
  }
  throw new PatrolAbortError(`週の選択に ${dateKey} が出ませんでした。`)
}

async function centerOf(locator, label) {
  await withTimeout(locator.waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS }), `${label}の席が画面にありません。`)
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new PatrolAbortError(`${label}の席の位置が取れません。`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** ステータスの文が before から変わるのを待つ(変わらなくても中断にしない。同じ文が続くことがあるため)。 */
async function waitForStatusChange(session, before) {
  const started = Date.now()
  while (Date.now() - started < STATUS_CHANGE_TIMEOUT_MS) {
    const now = await readStatusText(session)
    if (now !== before) return now
    await session.page.waitForTimeout(100)
  }
  return readStatusText(session)
}

/**
 * 長押しドラッグ(ScheduleBoardScreen.tsx の handleStudentMouseDown): 元の席の中央で押し → 長押し → 先の席の中央へ段階的に動かし → 放す。
 * from/to は { cellId, deskIndex, seat }。ステータスの文を返す。
 */
export async function dragStudent(session, from, to) {
  const { page } = session
  const source = page.locator(byTestId(studentCellTestId(from)))
  const target = page.locator(byTestId(studentCellTestId(to)))
  const statusBefore = await readStatusText(session)
  const start = await centerOf(source, '元')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.waitForTimeout(DRIVER_TIMING.longPressMs)
  // 掴んだあとに先の位置を測る(掴んだ表示で並びが動いても、放す位置がずれないように)。
  const box = await target.boundingBox()
  if (!box) {
    await page.mouse.up()
    throw new PatrolAbortError('先の席の位置が取れません。')
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: DRIVER_TIMING.dragSteps })
  await page.waitForTimeout(DRIVER_TIMING.beforeReleaseMs)
  await page.mouse.up()
  return waitForStatusChange(session, statusBefore)
}

async function clickHistoryButton(session, testId) {
  const button = session.page.locator(byTestId(testId))
  if (await button.isDisabled()) return false
  await button.click()
  return true
}

export async function clickUndo(session) { return clickHistoryButton(session, TESTIDS.undoButton) }
export async function clickRedo(session) { return clickHistoryButton(session, TESTIDS.redoButton) }

/** テンプレ編集を開く → 既定の反映開始日。 */
export async function openTemplateEditor(session) {
  const { page } = session
  await page.locator(byTestId(TESTIDS.openTemplate)).click()
  const date = page.locator(byTestId(TESTIDS.templateDate))
  await withTimeout(date.waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS }), 'テンプレ編集が開きませんでした。')
  return date.inputValue()
}

export async function setTemplateStartDate(session, dateKey) {
  const date = session.page.locator(byTestId(TESTIDS.templateDate))
  await date.fill(dateKey)
  const value = await date.inputValue()
  if (value !== dateKey) throw new PatrolAbortError(`反映開始日を ${dateKey} にできませんでした(入力欄は ${value})。`)
}

/** 保存を押し、確認の画面を待つ → { confirmMessage, detailText }(詳細は畳まれていても文字は読める。無いときは '')。 */
export async function requestTemplateSave(session) {
  const { page } = session
  await page.locator(byTestId(TESTIDS.templateSave)).click()
  const modal = page.locator(byTestId(TESTIDS.templateConfirmModal))
  try {
    await modal.waitFor({ state: 'visible', timeout: TEMPLATE_PREVIEW_TIMEOUT_MS })
  } catch {
    throw new PatrolAbortError(`テンプレ保存の確認の画面が出ませんでした(ステータス: ${await readStatusText(session)})。`)
  }
  const confirmMessage = (await page.locator(byTestId(TESTIDS.templateConfirmMessage)).innerText()).trim()
  const detail = page.locator(byTestId(TESTIDS.templateConfirmDetail))
  const detailText = (await detail.count()) > 0 ? ((await detail.first().textContent()) ?? '').trim() : ''
  return { confirmMessage, detailText }
}

/** 確認を押し、テンプレ編集が閉じる(盤面のテンプレ作成ボタンが戻る)のを待つ。 */
export async function confirmTemplateSave(session) {
  const { page } = session
  await page.locator(byTestId(TESTIDS.templateConfirmExecute)).click()
  await withTimeout(page.locator(byTestId(TESTIDS.openTemplate)).waitFor({ state: 'visible', timeout: TEMPLATE_SAVE_TIMEOUT_MS }), 'テンプレ保存が終わりませんでした(テンプレ編集が閉じない)。')
  await withTimeout(page.locator(byTestId(TESTIDS.templateConfirmModal)).waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS }), 'テンプレ保存の確認の画面が閉じませんでした。')
}

// ── 台本 d(テンプレを実際に変えて保存): テンプレ作成の画面で机を変える。室長と同じく、席・講師欄を押してメニューから選ぶ
// (ScheduleBoardScreen.tsx の handleTemplateStudentClick / handleTemplateSelectDesk → 空欄メニューの「既存生徒追加」・生徒メニューの「削除」・
// 講師メニューの「保存」「講師削除」)。選ぶ生徒・講師は、画面のプルダウンの選択肢を choose(options) に渡して台本が決める(種つきの乱数)。
// 変えたあとに画面の席・講師欄の文字で効いたことを確かめ、効かなければ中断する(台本が画面に合っていない)。

async function waitVisible(locator, message) {
  await withTimeout(locator.waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS }), message)
}

async function waitHidden(locator, message) {
  await withTimeout(locator.waitFor({ state: 'hidden', timeout: UI_TIMEOUT_MS }), message)
}

async function readSelectOptions(select) {
  return select.locator('option').evaluateAll((nodes) => nodes.map((node) => ({ value: node.value, label: node.textContent ?? '' })))
}

const describeTemplatePosition = ({ cellId, deskIndex, seat }) => `${cellId} 机${deskIndex + 1}${seat === undefined ? '' : ` 席${seat + 1}`}`

async function closeMenu(menu) {
  await menu.locator('.student-menu-close').first().click()
  await waitHidden(menu, 'メニューが閉じませんでした。')
}

async function cellText(session, testId) {
  return ((await session.page.locator(byTestId(testId)).innerText().catch(() => '')) ?? '').trim()
}

/** 空いた席を押す → 「既存生徒追加」→ 生徒を選ぶ → 「追加」。choose が null を返したらメニューを閉じて { studentId: null }。 */
export async function templateAddStudent(session, position, choose) {
  const { page } = session
  const seatCell = page.locator(byTestId(studentCellTestId(position)))
  await waitVisible(seatCell, `テンプレの席 ${describeTemplatePosition(position)} が画面にありません。`)
  await seatCell.click()
  const menu = page.locator(byTestId(TESTIDS.studentMenu))
  await waitVisible(menu, `テンプレの席 ${describeTemplatePosition(position)} の空欄メニューが開きませんでした(ステータス: ${await readStatusText(session)})。`)
  await menu.locator(byTestId(TESTIDS.menuOpenAdd)).click()
  const select = page.locator(byTestId(SEARCHABLE_SELECT_TESTIDS.templateAddStudent))
  await waitVisible(select, `生徒を選ぶ欄が出ませんでした(ステータス: ${await readStatusText(session)})。`)
  const studentId = choose(await readSelectOptions(select))
  if (!studentId) {
    await closeMenu(menu)
    return { studentId: null }
  }
  await select.selectOption(studentId)
  await menu.locator(byTestId(TESTIDS.menuAddConfirm)).click()
  await waitHidden(menu, `生徒を足したあとメニューが閉じませんでした(ステータス: ${await readStatusText(session)})。`)
  if (!(await cellText(session, studentNameTestId(position)))) {
    throw new PatrolAbortError(`テンプレの席 ${describeTemplatePosition(position)} に足した生徒が画面に出ません(ステータス: ${await readStatusText(session)})。`)
  }
  return { studentId }
}

/** 講師欄を押す → 講師を選ぶ → 「保存」。choose が null を返したらメニューを閉じて { teacher: null }。 */
export async function templateChangeTeacher(session, position, choose) {
  const { page } = session
  const teacherCell = page.locator(byTestId(teacherCellTestId(position)))
  await waitVisible(teacherCell, `テンプレの講師欄 ${describeTemplatePosition(position)} が画面にありません。`)
  await teacherCell.click()
  const menu = page.locator(byTestId(TESTIDS.teacherMenu))
  await waitVisible(menu, `テンプレの講師欄 ${describeTemplatePosition(position)} の講師メニューが開きませんでした(ステータス: ${await readStatusText(session)})。`)
  const select = page.locator(byTestId(SEARCHABLE_SELECT_TESTIDS.teacherSelect))
  await waitVisible(select, '講師を選ぶ欄が出ませんでした。')
  const teacher = choose(await readSelectOptions(select))
  if (!teacher) {
    await closeMenu(menu)
    return { teacher: null }
  }
  await select.selectOption(teacher)
  await menu.locator(byTestId(TESTIDS.teacherConfirm)).click()
  await waitHidden(menu, `講師を替えたあとメニューが閉じませんでした(ステータス: ${await readStatusText(session)})。`)
  if (!(await cellText(session, teacherCellTestId(position))).includes(teacher)) {
    throw new PatrolAbortError(`テンプレの講師欄 ${describeTemplatePosition(position)} が選んだ講師になりません(ステータス: ${await readStatusText(session)})。`)
  }
  return { teacher }
}

/** 机の生徒を 1 人ずつ「削除」→ 講師欄の「講師削除」。seats は生徒のいる席。 */
export async function templateDeleteDesk(session, { cellId, deskIndex, seats }) {
  const { page } = session
  const menu = page.locator(byTestId(TESTIDS.studentMenu))
  for (const seat of seats) {
    const position = { cellId, deskIndex, seat }
    const seatCell = page.locator(byTestId(studentCellTestId(position)))
    await waitVisible(seatCell, `テンプレの席 ${describeTemplatePosition(position)} が画面にありません。`)
    await seatCell.click()
    await waitVisible(menu, `テンプレの席 ${describeTemplatePosition(position)} の生徒メニューが開きませんでした(ステータス: ${await readStatusText(session)})。`)
    await menu.locator(byTestId(TESTIDS.menuDelete)).click()
    await waitHidden(menu, `生徒を消したあとメニューが閉じませんでした(ステータス: ${await readStatusText(session)})。`)
    if (await cellText(session, studentNameTestId(position))) {
      throw new PatrolAbortError(`テンプレの席 ${describeTemplatePosition(position)} の生徒が消えません(ステータス: ${await readStatusText(session)})。`)
    }
  }
  const position = { cellId, deskIndex }
  const teacherCell = page.locator(byTestId(teacherCellTestId(position)))
  await waitVisible(teacherCell, `テンプレの講師欄 ${describeTemplatePosition(position)} が画面にありません。`)
  await teacherCell.click()
  const teacherMenu = page.locator(byTestId(TESTIDS.teacherMenu))
  await waitVisible(teacherMenu, `テンプレの講師欄 ${describeTemplatePosition(position)} の講師メニューが開きませんでした(ステータス: ${await readStatusText(session)})。`)
  await teacherMenu.locator(byTestId(TESTIDS.teacherDelete)).click()
  await waitHidden(teacherMenu, `講師を消したあとメニューが閉じませんでした(ステータス: ${await readStatusText(session)})。`)
  if (await cellText(session, teacherCellTestId(position))) {
    throw new PatrolAbortError(`テンプレの講師欄 ${describeTemplatePosition(position)} の講師が消えません(ステータス: ${await readStatusText(session)})。`)
  }
}

/** テンプレ編集を保存せずに閉じる(「コマ表に戻る」)。盤面のテンプレ作成ボタンが戻るのを待つ。 */
export async function closeTemplateEditor(session) {
  const { page } = session
  await page.locator(byTestId(TESTIDS.templateClose)).click()
  await withTimeout(page.locator(byTestId(TESTIDS.openTemplate)).waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS }), 'テンプレ編集が閉じませんでした(コマ表に戻る)。')
}

// ── 台本 e(出欠): 盤面の生徒メニューで出欠を付ける・未消化振替の一覧から振替先へ置く。室長と同じく、席を押してメニューのボタンを押す
// (ScheduleBoardScreen.tsx の handleStudentClick → 生徒メニュー「出席」「休み」「振無休」／ツールバー「未消化振替」→ 生徒の行 → 振替元 → 空欄の席)。

const ATTENDANCE_BUTTONS = { attended: TESTIDS.menuAttendance, absent: TESTIDS.menuAbsence, 'absent-no-makeup': TESTIDS.menuAbsenceNoMakeup }

/**
 * 盤面の生徒の席を押して生徒メニューを開き、出欠のボタン(status: absent / absent-no-makeup / attended)を押す。ステータスの文を返す。
 * メニューにそのボタンが無ければ(保留の机の上段は出席が無いなど)メニューを閉じて、押す前と同じ文を返す(台本は「何も起きない」と見て中断する)。
 */
export async function markStudentAttendance(session, seat, status) {
  const { page } = session
  const testId = ATTENDANCE_BUTTONS[status]
  if (!testId) throw new PatrolAbortError(`知らない出欠の種類です: ${status}`)
  const statusBefore = await readStatusText(session)
  const seatCell = page.locator(byTestId(studentCellTestId(seat)))
  await waitVisible(seatCell, `盤面の席 ${describeTemplatePosition(seat)} が画面にありません。`)
  await seatCell.click()
  const menu = page.locator(byTestId(TESTIDS.studentMenu))
  await waitVisible(menu, `盤面の席 ${describeTemplatePosition(seat)} の生徒メニューが開きませんでした(ステータス: ${await readStatusText(session)})。`)
  const button = menu.locator(byTestId(testId))
  if ((await button.count()) === 0) {
    await closeMenu(menu)
    return statusBefore
  }
  await button.first().click()
  await waitHidden(menu, `出欠を付けたあと生徒メニューが閉じませんでした(ステータス: ${await readStatusText(session)})。`)
  return waitForStatusChange(session, statusBefore)
}

async function closeMakeupStockPanels(session) {
  const { page } = session
  const modal = page.locator(byTestId(TESTIDS.stockActionModal))
  if (await modal.isVisible().catch(() => false)) await modal.locator(byTestId(TESTIDS.stockActionModalCancel)).first().click().catch(() => {})
  const panel = page.locator(byTestId(TESTIDS.makeupStockPanel))
  if (await panel.isVisible().catch(() => false)) await panel.locator(byTestId(TESTIDS.makeupStockClose)).first().click().catch(() => {})
}

/**
 * 未消化振替から振替先へ置く: ツールバー「未消化振替」→ 生徒の行(stockStudentKey)→ 振替元を選ぶ画面の行の文字を choose(items) に渡して選ぶ → 先の空欄の席を押す。
 * 戻り値 { placed, status, reason, chosenText(選んだ振替元の行の文字) }。一覧に生徒が無い・選べる振替元が無いときは画面を閉じて placed: false。
 * 置いても盤面が変わらなかった(アプリが断った)ときに選択が残らないよう、選択の取り消しボタンが出ていれば押す。
 */
export async function placeMakeupFromStock(session, { stockStudentKey, choose }, to) {
  const { page } = session
  const statusBefore = await readStatusText(session)
  await page.locator(byTestId(TESTIDS.makeupStockChip)).click()
  const panel = page.locator(byTestId(TESTIDS.makeupStockPanel))
  await waitVisible(panel, `未消化振替の一覧が開きませんでした(ステータス: ${await readStatusText(session)})。`)
  const row = panel.locator(byTestId(makeupStockEntryTestId(stockStudentKey)))
  if ((await row.count()) === 0 || (await row.first().isDisabled())) {
    await closeMakeupStockPanels(session)
    return { placed: false, status: await readStatusText(session), reason: '未消化振替の一覧にその生徒の行が無い(または押せない)' }
  }
  await row.first().click()
  const modal = page.locator(byTestId(TESTIDS.stockActionModal))
  await waitVisible(modal, `振替元を選ぶ画面が開きませんでした(ステータス: ${await readStatusText(session)})。`)
  const items = modal.locator(`[data-testid^="${TESTID_PREFIXES.stockOriginItem}"]`)
  const texts = (await items.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim())
  const index = choose(texts)
  if (index < 0 || index >= texts.length) {
    await closeMakeupStockPanels(session)
    return { placed: false, status: await readStatusText(session), reason: `振替元を選ぶ画面に合う行が無い(行 ${texts.length})` }
  }
  await items.nth(index).click()
  await waitHidden(modal, '振替元を選んだあと画面が閉じませんでした。')
  await waitHidden(panel, '振替元を選んだあと未消化振替の一覧が閉じませんでした。')
  const target = page.locator(byTestId(studentCellTestId(to)))
  await waitVisible(target, `振替先の席 ${describeTemplatePosition(to)} が画面にありません。`)
  await target.click()
  const status = await waitForStatusChange(session, statusBefore)
  const cancel = page.locator(byTestId(PROP_TESTIDS.cancelSelection))
  if (await cancel.isVisible().catch(() => false)) await cancel.first().click().catch(() => {})
  return { placed: true, status, chosenText: texts[index] }
}

// ── 台本 h(講習の自動割振): ツールバー「未消化講習」→ 生徒の行 → 画面の「未消化振替も同時に自動割り当てする」→「自動割振」(ScheduleBoardScreen.tsx の
// handleAutoAssignLectureStockEntry)。押すと、割り振れたときも割り振れなかったときも結果の画面(auto-assign-debug-panel)が出るので、それを待って閉じる。

/** 未消化講習の一覧・自動割振の画面・振替の一覧が開いていれば閉じる(押したあとアプリが一覧を開き直すことがある)。 */
async function closeLectureStockPanels(session) {
  const { page } = session
  const modal = page.locator(byTestId(TESTIDS.stockActionModal))
  if (await modal.isVisible().catch(() => false)) await modal.locator(byTestId(TESTIDS.stockActionModalCancel)).first().click().catch(() => {})
  for (const [panelId, closeId] of [[TESTIDS.lectureStockPanel, TESTIDS.lectureStockClose], [TESTIDS.makeupStockPanel, TESTIDS.makeupStockClose]]) {
    const panel = page.locator(byTestId(panelId))
    if (await panel.isVisible().catch(() => false)) await panel.locator(byTestId(closeId)).first().click().catch(() => {})
  }
}

/**
 * 講習の自動割振を 1 回: 未消化講習の一覧を開く → 行(entryKey)を押す → 「未消化振替も同時に」を includeMakeup に合わせる →「自動割振」→ 結果の画面を待って閉じる。
 * 戻り値 { found(行があって押せた), status(ステータスの文), debugText(結果の画面の文・1 行) }。行が無い・自動割振が押せないときは画面を閉じて found: false。
 */
export async function runLectureAutoAssign(session, { entryKey, includeMakeup }) {
  const { page } = session
  await closeLectureStockPanels(session)
  await page.locator(byTestId(TESTIDS.lectureStockChip)).click()
  const panel = page.locator(byTestId(TESTIDS.lectureStockPanel))
  await waitVisible(panel, `未消化講習の一覧が開きませんでした(ステータス: ${await readStatusText(session)})。`)
  const row = panel.locator(byTestId(lectureStockEntryTestId(entryKey)))
  if ((await row.count()) === 0) {
    await closeLectureStockPanels(session)
    return { found: false, status: await readStatusText(session) }
  }
  await row.first().click()
  const modal = page.locator(byTestId(TESTIDS.stockActionModal))
  await waitVisible(modal, `自動割振の画面が開きませんでした(ステータス: ${await readStatusText(session)})。`)
  const checkbox = modal.locator(`${byTestId(TESTIDS.stockActionModalIncludeMakeup)} input[type="checkbox"]`)
  if ((await checkbox.isChecked()) !== Boolean(includeMakeup)) await checkbox.setChecked(Boolean(includeMakeup))
  const auto = modal.locator(byTestId(TESTIDS.stockActionModalAuto))
  if (await auto.isDisabled()) {
    await closeLectureStockPanels(session)
    return { found: false, status: await readStatusText(session) }
  }
  await auto.click()
  const result = page.locator(byTestId(TESTIDS.autoAssignDebugPanel))
  await waitVisible(result, `自動割振の結果の画面が出ませんでした(ステータス: ${await readStatusText(session)})。`)
  const debugText = (await result.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200)
  await result.locator(byTestId(TESTIDS.autoAssignDebugClose)).first().click()
  await waitHidden(result, '自動割振の結果の画面が閉じませんでした。')
  await closeLectureStockPanels(session)
  return { found: true, status: await readStatusText(session), debugText }
}

// ── 台本 f(講師の移動・入れ替え・休み): 盤面の講師欄の長押しドラッグと講師メニュー。室長と同じく、講師欄を長押しして同じコマの別の机の講師欄へ放す
// (ScheduleBoardScreen.tsx の handleTeacherMouseDown。生徒が絡むと「講師だけ入れ替え／生徒ごと席を入れ替え」を選ぶ画面)・講師欄を押して
// 講師メニューの「保存」「休み」「休みを解除する(講師名)」を押す(handleConfirmTeacher・handleToggleTeacherRest)。

/**
 * 講師の長押しドラッグ: 元の講師欄の中央で押し → 長押し → 先の講師欄の中央へ段階的に動かし → 放す。選ぶ画面が出たら swapMode('teacher'/'seat')のボタンを押す。
 * from/to は { cellId, deskIndex }(同じコマ)。戻り値 { status(ステータスの文), modal(選ぶ画面が出たか) }。
 */
export async function dragTeacher(session, from, to, swapMode = 'teacher') {
  const { page } = session
  const source = page.locator(byTestId(teacherCellTestId(from)))
  const target = page.locator(byTestId(teacherCellTestId(to)))
  const statusBefore = await readStatusText(session)
  const start = await centerOf(source, '講師の元')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.waitForTimeout(DRIVER_TIMING.longPressMs)
  const box = await target.boundingBox()
  if (!box) {
    await page.mouse.up()
    throw new PatrolAbortError('講師の先の机の位置が取れません。')
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: DRIVER_TIMING.dragSteps })
  await page.waitForTimeout(DRIVER_TIMING.beforeReleaseMs)
  await page.mouse.up()
  // 選ぶ画面は放した直後の描画で出る(ステータスの文はまだ変わらない)。画面が出るか、文が変わるまで待つ。
  const modal = page.locator(byTestId(TESTIDS.teacherSeatMoveModal))
  const started = Date.now()
  while (Date.now() - started < STATUS_CHANGE_TIMEOUT_MS) {
    if (await modal.isVisible().catch(() => false)) {
      await modal.locator(byTestId(swapMode === 'seat' ? TESTIDS.teacherSeatMoveSeat : TESTIDS.teacherSeatMoveTeacher)).click()
      await waitHidden(modal, '講師の入れ替えを選ぶ画面が閉じませんでした。')
      return { status: await waitForStatusChange(session, statusBefore), modal: true }
    }
    if ((await readStatusText(session)) !== statusBefore) break
    await page.waitForTimeout(100)
  }
  return { status: await readStatusText(session), modal: false }
}

async function openBoardTeacherMenu(session, position) {
  const { page } = session
  const teacherCell = page.locator(byTestId(teacherCellTestId(position)))
  await waitVisible(teacherCell, `盤面の講師欄 ${describeTemplatePosition(position)} が画面にありません。`)
  await teacherCell.click()
  const menu = page.locator(byTestId(TESTIDS.teacherMenu))
  await waitVisible(menu, `盤面の講師欄 ${describeTemplatePosition(position)} の講師メニューが開きませんでした(ステータス: ${await readStatusText(session)})。`)
  return menu
}

/** 盤面の講師欄を押す → 講師を選ぶ → 「保存」。choose が null を返したらメニューを閉じて { teacher: null }。戻り値 { teacher, status }。 */
export async function setBoardTeacher(session, position, choose) {
  const { page } = session
  const menu = await openBoardTeacherMenu(session, position)
  const statusOpened = await readStatusText(session)
  const select = page.locator(byTestId(SEARCHABLE_SELECT_TESTIDS.teacherSelect))
  await waitVisible(select, '講師を選ぶ欄が出ませんでした。')
  const teacher = choose(await readSelectOptions(select))
  if (!teacher) {
    await closeMenu(menu)
    return { teacher: null, status: await readStatusText(session) }
  }
  await select.selectOption(teacher)
  await menu.locator(byTestId(TESTIDS.teacherConfirm)).click()
  await waitHidden(menu, `講師を保存したあとメニューが閉じませんでした(ステータス: ${await readStatusText(session)})。`)
  return { teacher, status: await waitForStatusChange(session, statusOpened) }
}

/** 盤面の講師欄を押す → 「休み」／「休みを解除する(講師名)」を押す。ボタンが無ければメニューを閉じて { status(押す前と同じ), label: null }。 */
export async function toggleTeacherRest(session, position) {
  const { page } = session
  const statusBefore = await readStatusText(session)
  const menu = await openBoardTeacherMenu(session, position)
  const statusOpened = await readStatusText(session)
  const button = menu.locator(byTestId(TESTIDS.teacherRestButton))
  if ((await button.count()) === 0) {
    await closeMenu(menu)
    return { status: statusBefore, label: null }
  }
  const label = ((await button.first().innerText()) ?? '').trim()
  await button.first().click()
  await waitHidden(menu, `休みのボタンを押したあと講師メニューが閉じませんでした(ステータス: ${await readStatusText(session)})。`)
  return { status: await waitForStatusChange(session, statusOpened), label }
}

// ── 台本 g(休日設定と解除・丸ごと振替): 盤面の日付の見出しを押す。開いている日はメニュー(休日設定・丸ごと振替・丸ごと振替を解除)が出る。
// 休日の見出しはメニューを出さずに解除する(確認のダイアログは accept)。丸ごと振替の振替先を選ぶ状態では、見出しを押すと振替先になる
// (ScheduleBoardScreen.tsx の handleDayHeaderClick)。できないときは画面中央の断りの画面(whole-day-transfer-blocked-modal)が出る。

const DAY_MENU_ITEMS = { holiday: TESTIDS.dayHeaderMenuHoliday, transfer: TESTIDS.dayHeaderMenuTransfer, 'transfer-release': TESTIDS.dayHeaderMenuTransferRelease }

/** ステータスの文が変わるか、断りの画面が出るまで待つ。断りの画面は文を読んで閉じる。戻り値 { status, blocked(断りの文・無ければ '') }。 */
async function waitDayOpOutcome(session, statusBefore) {
  const { page } = session
  const modal = page.locator(byTestId(TESTIDS.wholeDayTransferBlockedModal))
  const started = Date.now()
  while (Date.now() - started < STATUS_CHANGE_TIMEOUT_MS) {
    if (await modal.isVisible().catch(() => false)) {
      const blocked = ((await modal.innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()
      await modal.locator(byTestId(TESTIDS.wholeDayTransferBlockedClose)).click()
      await waitHidden(modal, '丸ごと振替の断りの画面が閉じませんでした。')
      return { status: await readStatusText(session), blocked }
    }
    if ((await readStatusText(session)) !== statusBefore) break
    await page.waitForTimeout(100)
  }
  // 文が変わった直後に断りの画面が出ることもある(notifyWholeDayTransferBlocked は文と画面を同時に出す)。
  if (await modal.isVisible().catch(() => false)) return waitDayOpOutcome(session, '')
  return { status: await readStatusText(session), blocked: '' }
}

async function clickDayHeaderElement(session, dateKey) {
  const header = session.page.locator(byTestId(dayHeaderTestId(dateKey)))
  await waitVisible(header, `${dateKey} の日付の見出しが画面にありません(その週を開いていない)。`)
  await header.scrollIntoViewIfNeeded()
  await header.click()
}

/**
 * 日付の見出しを押してメニューを開き、item('holiday'=休日設定・'transfer'=丸ごと振替・'transfer-release'=丸ごと振替を解除)を押す。
 * メニューにそのボタンが無ければメニューの外を押して閉じ、{ missing: true }。押したら { status, blocked }(確認のダイアログは accept)。
 */
export async function chooseDayMenuItem(session, dateKey, item) {
  const { page } = session
  const testId = DAY_MENU_ITEMS[item]
  if (!testId) throw new PatrolAbortError(`知らない日付のメニューです: ${item}`)
  const statusBefore = await readStatusText(session)
  await clickDayHeaderElement(session, dateKey)
  const menu = page.locator(CLASS_SELECTORS.dayHeaderMenu)
  await waitVisible(menu, `${dateKey} の日付のメニューが開きませんでした(ステータス: ${await readStatusText(session)})。`)
  const button = menu.locator(byTestId(testId))
  if ((await button.count()) === 0) {
    await page.locator(CLASS_SELECTORS.dayHeaderMenuBackdrop).click({ position: { x: 5, y: 5 } })
    await waitHidden(menu, '日付のメニューが閉じませんでした。')
    return { missing: true, status: await readStatusText(session) }
  }
  await button.first().click()
  await waitHidden(menu, `日付のメニューのボタンを押したあとメニューが閉じませんでした(ステータス: ${await readStatusText(session)})。`)
  return waitDayOpOutcome(session, statusBefore)
}

/** 日付の見出しを押す(休日の日は解除・丸ごと振替の振替先を選ぶ状態では振替先)。戻り値 { status, blocked }。 */
export async function clickDayHeader(session, dateKey) {
  const statusBefore = await readStatusText(session)
  await clickDayHeaderElement(session, dateKey)
  return waitDayOpOutcome(session, statusBefore)
}

/** 丸ごと振替の振替先を選ぶ状態を取り消す(帯の「キャンセル」)。帯が出ていなければ何もしない(false)。 */
export async function cancelWholeDayTransfer(session) {
  const { page } = session
  const banner = page.locator(byTestId(TESTIDS.wholeDayTransferBanner))
  if (!(await banner.isVisible().catch(() => false))) return false
  await banner.locator(byTestId(TESTIDS.wholeDayTransferCancel)).click()
  await waitHidden(banner, '丸ごと振替の選ぶ状態が取り消せませんでした。')
  return true
}

export async function takeScreenshot(session, file) {
  if (!session?.page) return null
  try {
    await fitViewportToBoard(session).catch(() => {})
    await session.page.screenshot({ path: file })
    return file
  } catch {
    return null
  }
}

/** ブラウザを閉じるのを待つ上限。超えたら諦めて先へ進む(Playwright は Node の終了時に子のブラウザを止める)。 */
export const BROWSER_CLOSE_TIMEOUT_MS = 5000

/**
 * ブラウザを閉じる。閉じる処理が返らなくても timeoutMs で先へ進む: 片づけ(シグナル・finally)がここで止まると、
 * 2 回目以降の Ctrl+C は無視する作り(tools/ui-patrol.mjs の installSignalCleanup)なので、抜けられなくなる(作業 5 の再レビュー)。
 */
export async function closePatrolBrowser(session, { timeoutMs = BROWSER_CLOSE_TIMEOUT_MS } = {}) {
  if (!session?.browser) return
  let timer = null
  // タイマーは unref しない(unref すると、閉じる処理だけが残ったとき Node が片づけの途中で終わり、終了コード 130 を返せない)。
  const giveUp = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs) })
  try {
    await Promise.race([Promise.resolve().then(() => session.browser.close()).catch(() => {}), giveUp])
  } finally {
    clearTimeout(timer)
  }
}
