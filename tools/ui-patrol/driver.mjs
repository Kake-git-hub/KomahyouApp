// 画面の自動巡回(tools/ui-patrol.mjs)のブラウザ操作の部品。室長と同じ画面操作(ボタン・長押しドラッグ)だけを行う。
// ★外へは出さない: localhost 以外は名前解決の段階で止め(--host-resolver-rules)、さらに context.route で localhost・data:・blob: 以外を
//   止めてホスト名を externalRequests に残す(台本が「変」として報告する)。
// ★待ちは条件で待つ(testid の状態・読み口の値)。固定の待ちは長押しと描画の落ち着きだけ(selectors.mjs の DRIVER_TIMING)。
//   待ちが時間切れになったら PatrolAbortError を投げる(台本が画面写真を撮って教室を「中断」にする。所見にはしない)。
// ★Playwright は package.json に入れない(この環境の全体の node_modules から読む)。読めなければ loadPlaywright() が null を返す。
import { createRequire } from 'node:module'
import { DRIVER_TIMING, TESTIDS, byTestId, studentCellTestId, weekJumpDayTestId } from './selectors.mjs'

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
      await withTimeout(page.locator(`[data-cell-id^="${dateKey}_"]`).first().waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS }), `${dateKey} の週が盤面に出ませんでした。`)
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
