// クラウドへ保存できなかった内容の控え(未送信の控え)と「開発者へ送る」の判定(2026-10-27 オーナー決定・案 A)。
//
// ★なぜ作ったか
//   2026-10-26 17:58〜21:15、日大前校の保存が 1 文書の上限で全部失敗した。失敗時のバックアップ JSON は
//   「保存」ボタンでの失敗のときしか作られず(自動保存の失敗では作られない)、ブラウザが 2 本目以降のダウンロードを
//   止めることもあり、室長の PC には残っていなかった。消えた作業は保存に相乗りした操作痕跡から読み戻せたが、
//   痕跡は 1 件 400 字で切れて一部が読めなかった(痕跡の上限は v1.5.647 で拡大)。
//   → 保存に失敗したら、その時点の教室データを**上書きされない控え**として端末(IndexedDB)に残し、
//     失敗したその場(画面ごとに初回だけ)と、控えが残ったまま次に教室を開いたときに「開発者へ送る」を案内する。
//     送ると既存の「質問・要望」と同じ経路(submitDeveloperReport・開発者へメール)で、控えの教室データと
//     失敗時点までの操作痕跡が届き、原因と保存漏れを開発者が確かめられる。
//
// ★決まり(オーナー決定 2026-10-27)
//   - 送り方は「開発者へ送る」ボタン(ダウンロード＋メール添付の手順は出さない)。
//   - 案内は「失敗したとき(画面ごとに初回)」＋「次に開いたとき」。
//   - **控えを勝手に書き戻さない**(起動時は常にサーバー最新が正・2026-07-07 v1.5.405 の撤去を復活させない)。
//     控えは開発者へ送るためだけに使う。
//   - 控えは教室ごとに 1 件(最新の失敗で上書き)。同じ画面のまま次の保存が成功したら消す(その画面の内容が届いたので)。
//     別の画面(再読み込み後など)の成功では消さない(控えの内容はまだ届いていない)。
//   - 送れたら消す。送らずに 14 日たったら案内をやめて消す(案内し続けない)。
//
// ★本番データ保護: 端末の中だけ。Firestore へは書かない(送るのは利用者が「OK」を押したときの報告だけ)。

import type { AppSnapshotPayload } from '../types/appState'
import { stripParentPortalTokensFromStudents } from './developmentClassroom'
import { buildDeveloperReportRequestBody, type DeveloperReportRequestBody } from './developerReport'
import type { OperationTraceEntry } from './operationTrace'

/** この画面(タブ)を見分ける id。再読み込みで変わる。控えが「この画面のもの」かを見分ける。 */
export const UNSENT_CLOUD_SAVE_SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** 控えを案内し続ける期間。過ぎたら案内せずに消す。 */
export const UNSENT_CLOUD_SAVE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/** 報告の内容(一言)の先頭。開発者がメール・Issue で見分ける。 */
export const UNSENT_CLOUD_SAVE_REPORT_MARKER = '[保存できなかった内容]'

export type UnsentCloudSaveRecord = {
  classroomId: string
  classroomName: string
  /** 控えを作った画面の id(UNSENT_CLOUD_SAVE_SESSION_ID)。 */
  sessionId: string
  /** 送れなかった教室データの時刻(保存を始めた時刻)。 */
  snapshotSavedAt: string
  /** 失敗した時刻。 */
  failedAt: string
  /** 失敗の理由(画面に出た文)。 */
  errorMessage: string
  appVersion: string
  /** 送れなかった教室データ(その教室の分だけ)。 */
  payload: AppSnapshotPayload
  /** 失敗した時点までの操作痕跡(前回保存以降の分)。 */
  recentOperations: OperationTraceEntry[]
}

/** 失敗した保存から控えを作る。 */
export function buildUnsentCloudSaveRecord(input: {
  classroomId: string
  classroomName: string
  snapshotSavedAt: string
  error: unknown
  appVersion: string
  payload: AppSnapshotPayload
  recentOperations: readonly OperationTraceEntry[]
  sessionId?: string
  now?: Date
}): UnsentCloudSaveRecord {
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error ?? '')
  return {
    classroomId: input.classroomId,
    classroomName: input.classroomName,
    sessionId: input.sessionId ?? UNSENT_CLOUD_SAVE_SESSION_ID,
    snapshotSavedAt: input.snapshotSavedAt,
    failedAt: (input.now ?? new Date()).toISOString(),
    errorMessage: errorMessage.slice(0, 300),
    appVersion: input.appVersion,
    payload: input.payload,
    recentOperations: [...input.recentOperations],
  }
}

/** 保存が成功したとき控えを消してよいか: この画面で作った控えだけ(別の画面の控えの内容はまだ届いていない)。 */
export function shouldClearUnsentCloudSaveOnSuccess(record: Pick<UnsentCloudSaveRecord, 'sessionId'> | null | undefined, sessionId: string = UNSENT_CLOUD_SAVE_SESSION_ID): boolean {
  return Boolean(record) && record!.sessionId === sessionId
}

/** 古すぎる控えか(案内せずに消す)。時刻が読めない控えも古いとみなす。 */
export function isUnsentCloudSaveExpired(record: Pick<UnsentCloudSaveRecord, 'failedAt'>, nowMs: number = Date.now()): boolean {
  const failedMs = Date.parse(record.failedAt)
  if (!Number.isFinite(failedMs)) return true
  return nowMs - failedMs > UNSENT_CLOUD_SAVE_MAX_AGE_MS
}

/** 教室を開いたときに案内するか: 別の画面(前回)の控えで、期限内のものだけ。この画面の控えは失敗時に案内済み。 */
export function shouldPromptUnsentCloudSaveOnOpen(record: UnsentCloudSaveRecord | null | undefined, sessionId: string = UNSENT_CLOUD_SAVE_SESSION_ID, nowMs: number = Date.now()): boolean {
  if (!record) return false
  if (record.sessionId === sessionId) return false
  return !isUnsentCloudSaveExpired(record, nowMs)
}

function formatJstLabel(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '(時刻不明)'
  const jst = new Date(ms + 9 * 60 * 60 * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`
}

/** 失敗したその場の確認(OK=開発者へ送る)。上は従来の案内、最後の行が問い(教室名つき・保存中に教室を切り替えても取り違えない)。 */
export function buildUnsentCloudSaveFailurePrompt(guidance: string, classroomName = ''): string {
  const classroom = classroomName ? `「${classroomName}」の` : ''
  return `${guidance}\n${classroom}保存できなかった内容を開発者へ送りますか？（原因と保存漏れの確認に使います）`
}

/** その場で聞くのに必要な、同じ教室での連続失敗の回数(一瞬の回線切れでは聞かない・regression-reviewer 中)。 */
export const UNSENT_CLOUD_SAVE_PROMPT_TRANSIENT_FAILURE_COUNT = 3

export type SaveFailureDialog = { type: 'confirm'; text: string } | { type: 'alert'; text: string } | { type: 'none' }

/**
 * 保存が失敗したときに出すダイアログを決める(純関数・App.tsx の保存キューの catch が使う)。
 *  - 控えがあり、この画面・この教室でまだ聞いておらず、画面が見えていて(隠れたタブで止めない)、
 *    一時的な失敗でない(容量超過など)か同じ教室で 3 回続けて失敗したときだけ、案内に「開発者へ送りますか？」を添えて聞く。
 *  - それ以外は従来どおり、バックアップをダウンロードしたときだけ案内を alert で出す。
 *  - ダウンロードしていない(自動保存の)失敗では、案内から「ダウンロード済み」を外した文を使う。
 */
export function resolveSaveFailureDialog(input: {
  guidance: string
  guidanceWithoutBackup: string
  downloadedBackup: boolean
  record: Pick<UnsentCloudSaveRecord, 'classroomId' | 'classroomName'> | null
  alreadyPrompted: boolean
  isVisible: boolean
  isTransient: boolean
  consecutiveFailures: number
}): SaveFailureDialog {
  const text = input.downloadedBackup ? input.guidance : input.guidanceWithoutBackup
  const persistent = !input.isTransient || input.consecutiveFailures >= UNSENT_CLOUD_SAVE_PROMPT_TRANSIENT_FAILURE_COUNT
  if (input.record && !input.alreadyPrompted && input.isVisible && persistent) {
    return { type: 'confirm', text: buildUnsentCloudSaveFailurePrompt(text, input.record.classroomName) }
  }
  if (input.downloadedBackup) return { type: 'alert', text: input.guidance }
  return { type: 'none' }
}

/**
 * 控えを開発者へ送る報告の本文(純関数)。送り先の教室は**控えの教室**(今開いている教室ではない・INV-08)。
 * 保護者用QRの写しトークンは外す(「質問・要望」と同じ・レビュー指摘 2026-09-13)。
 */
export function buildUnsentCloudSaveReportBody(record: UnsentCloudSaveRecord, env: {
  trigger: 'on-failure' | 'on-open'
  appVersion: string
  userAgent: string
  pageUrl: string
  now?: Date
}): DeveloperReportRequestBody {
  const students = Array.isArray(record.payload?.students) ? record.payload.students : []
  return buildDeveloperReportRequestBody({
    classroomId: record.classroomId,
    source: 'board',
    category: 'bug',
    note: buildUnsentCloudSaveReportNote(record, env.trigger),
    appVersion: env.appVersion,
    userAgent: env.userAgent,
    pageUrl: env.pageUrl,
    screen: 'board',
    boardDirty: true,
    lastSavedAt: record.snapshotSavedAt,
    recentOperations: Array.isArray(record.recentOperations) ? record.recentOperations : [],
    snapshotPayload: { ...record.payload, students: stripParentPortalTokensFromStudents(students) } as AppSnapshotPayload,
    ...(env.now ? { now: env.now } : {}),
  })
}

/** 端末から読んだ控えの形を確かめる(壊れていれば使わない)。 */
export function isUnsentCloudSaveRecord(value: unknown): value is UnsentCloudSaveRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<UnsentCloudSaveRecord>
  return typeof record.classroomId === 'string' && Boolean(record.classroomId)
    && typeof record.sessionId === 'string'
    && typeof record.failedAt === 'string'
    && Boolean(record.payload) && typeof record.payload === 'object'
}

/** 次に開いたときの確認(OK=開発者へ送る・キャンセル=あとで)。 */
export function buildUnsentCloudSaveOpenPrompt(record: Pick<UnsentCloudSaveRecord, 'failedAt' | 'classroomName'>): string {
  const classroom = record.classroomName ? `「${record.classroomName}」で` : ''
  return [
    `前回（${formatJstLabel(record.failedAt)}）${classroom}クラウドへ保存できなかった内容が、この端末に残っています。`,
    '開発者へ送りますか？（原因と保存漏れの確認に使います。「キャンセル」で次回また表示します）',
  ].join('\n')
}

/** 報告の内容(一言)。生徒名は入れない(本文はメール・Issue に載る)。 */
export function buildUnsentCloudSaveReportNote(record: Pick<UnsentCloudSaveRecord, 'failedAt' | 'snapshotSavedAt' | 'errorMessage' | 'appVersion' | 'sessionId'>, trigger: 'on-failure' | 'on-open'): string {
  return [
    `${UNSENT_CLOUD_SAVE_REPORT_MARKER} クラウドへ保存できなかった教室データを送ります(${trigger === 'on-failure' ? '失敗したその場で送信' : '次に開いたときに送信'})。`,
    `失敗: ${formatJstLabel(record.failedAt)} / 教室データの時刻: ${formatJstLabel(record.snapshotSavedAt)} / 版 ${record.appVersion || '不明'}`,
    `理由: ${record.errorMessage || '(不明)'}`,
  ].join('\n')
}

/** 失敗したその場で案内するか: この画面・この教室で初回だけ(自動保存の失敗が続いても何度も聞かない)。 */
export function shouldPromptUnsentCloudSaveOnFailure(promptedClassroomIds: ReadonlySet<string>, classroomId: string): boolean {
  return Boolean(classroomId) && !promptedClassroomIds.has(classroomId)
}

// ---------------------------------------------------------------------------
// 端末の保存領域(IndexedDB)。教室データ(数 MB)が入るので localStorage は使わない。
// 既存の appSnapshotRepository の DB(版 4)とは別の DB にして、版上げの相互作用を避ける。
// どの関数も例外を外へ出さない(控えは補助。失敗しても保存の流れを止めない)。
// ---------------------------------------------------------------------------

const DB_NAME = 'komahyou-unsent-cloud-saves'
const STORE_NAME = 'records'

function openUnsentDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, 1)
      request.onerror = () => resolve(null)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'classroomId' })
      }
      request.onsuccess = () => resolve(request.result)
    } catch {
      resolve(null)
    }
  })
}

async function runStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest | null, map: (result: unknown) => T, fallback: T): Promise<T> {
  const database = await openUnsentDatabase()
  if (!database) return fallback
  return new Promise<T>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, mode)
      const request = action(transaction.objectStore(STORE_NAME))
      transaction.oncomplete = () => {
        database.close()
        resolve(request ? map(request.result) : fallback)
      }
      transaction.onerror = () => {
        database.close()
        resolve(fallback)
      }
      transaction.onabort = () => {
        database.close()
        resolve(fallback)
      }
    } catch {
      database.close()
      resolve(fallback)
    }
  })
}

/** この画面で控えを書いた教室(成功時に IndexedDB を毎回読まないため)。 */
const classroomIdsWithSessionRecord = new Set<string>()

export function writeUnsentCloudSave(record: UnsentCloudSaveRecord): Promise<boolean> {
  if (record.sessionId === UNSENT_CLOUD_SAVE_SESSION_ID) classroomIdsWithSessionRecord.add(record.classroomId)
  return runStore('readwrite', (store) => store.put(record), () => true, false)
}

export function readUnsentCloudSave(classroomId: string): Promise<UnsentCloudSaveRecord | null> {
  if (!classroomId) return Promise.resolve(null)
  return runStore('readonly', (store) => store.get(classroomId), (result) => (isUnsentCloudSaveRecord(result) ? result : null), null)
}

/** 1 つの readwrite トランザクションの中で読み、条件に合えば消す(読んでから消すまでの隙を作らない)。 */
function deleteUnsentCloudSaveWhere(classroomId: string, predicate: (record: UnsentCloudSaveRecord | null) => boolean): Promise<boolean> {
  if (!classroomId) return Promise.resolve(false)
  let deleted = false
  return runStore('readwrite', (store) => {
    const request = store.get(classroomId)
    request.onsuccess = () => {
      const record = isUnsentCloudSaveRecord(request.result) ? request.result : null
      if (record && predicate(record)) {
        store.delete(classroomId)
        deleted = true
      }
    }
    return request
  }, () => deleted, false)
}

export function deleteUnsentCloudSave(classroomId: string): Promise<boolean> {
  if (!classroomId) return Promise.resolve(false)
  return runStore('readwrite', (store) => store.delete(classroomId), () => true, false)
}

/**
 * 保存が成功したら呼ぶ: この画面で書いた控えなら消す(その画面の内容が届いたので)。
 * この画面で控えを書いていなければ IndexedDB を読まない(普段の保存に負担をかけない)。
 * 念のため読み直して sessionId を照合してから消す(別の画面の控えは消さない)。
 */
export async function clearUnsentCloudSaveIfSameSession(classroomId: string): Promise<void> {
  if (!classroomIdsWithSessionRecord.has(classroomId)) return
  try {
    await deleteUnsentCloudSaveWhere(classroomId, (record) => shouldClearUnsentCloudSaveOnSuccess(record))
    classroomIdsWithSessionRecord.delete(classroomId)
  } catch {
    // 控えは補助。消せなくても次回案内されるだけ。
  }
}

/** 送れたら消す。ただし送っている間に新しい失敗で控えが書き換わっていたら消さない(新しい分はまだ届いていない)。 */
export async function deleteUnsentCloudSaveIfUnchanged(classroomId: string, failedAt: string): Promise<void> {
  try {
    await deleteUnsentCloudSaveWhere(classroomId, (record) => record?.failedAt === failedAt)
  } catch {
    // 消せなくても次回もう一度案内されるだけ。
  }
}
