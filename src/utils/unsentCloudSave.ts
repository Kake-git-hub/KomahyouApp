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

/** 失敗したその場の確認(OK=開発者へ送る)。上 2 行は従来の案内、3 行目が問い(オーナー指示 2026-10-25「1〜2 行」+ 問い)。 */
export function buildUnsentCloudSaveFailurePrompt(guidance: string): string {
  return `${guidance}\n保存できなかった内容を開発者へ送りますか？（原因と保存漏れの確認に使います）`
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
  return runStore('readonly', (store) => store.get(classroomId), (result) => (result && typeof result === 'object' ? result as UnsentCloudSaveRecord : null), null)
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
    const record = await readUnsentCloudSave(classroomId)
    if (shouldClearUnsentCloudSaveOnSuccess(record)) await deleteUnsentCloudSave(classroomId)
    classroomIdsWithSessionRecord.delete(classroomId)
  } catch {
    // 控えは補助。消せなくても次回案内されるだけ。
  }
}

/** 送れたら消す。ただし送っている間に新しい失敗で控えが書き換わっていたら消さない(新しい分はまだ届いていない)。 */
export async function deleteUnsentCloudSaveIfUnchanged(classroomId: string, failedAt: string): Promise<void> {
  try {
    const record = await readUnsentCloudSave(classroomId)
    if (record && record.failedAt === failedAt) await deleteUnsentCloudSave(classroomId)
    if (!record || record.failedAt === failedAt) classroomIdsWithSessionRecord.delete(classroomId)
  } catch {
    // 消せなくても次回もう一度案内されるだけ。
  }
}
