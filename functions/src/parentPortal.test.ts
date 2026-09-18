// 保護者向け固定QR(サーバー側純ロジック)のテスト。docs/spec-parent-portal.md §I K-2/K-4/K-5 の受け入れ条件と
// k_contract §1 の検証順を固定する。index.ts は import しない(initializeApp が走る)。配線は文字列走査で検査する。
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { isParentStudentActiveOnDate } from './generated/parentSchedule'

import {
  buildParentAbsenceKey,
  buildParentAbsenceKeyRange,
  buildParentAbsenceMessageId,
  buildParentMessageDoc,
  buildParentMessageRateLimitKeys,
  buildParentPortalTokenFingerprint,
  buildStudentPortalOwnerId,
  decideParentMessageRateLimit,
  decideParentPortalGetThrottle,
  findParentAbsenceTargetLesson,
  PARENT_PORTAL_GET_THROTTLE_LIMIT,
  PARENT_PORTAL_GET_THROTTLE_WINDOW_MS,
  pruneParentPortalGetThrottleKeys,
  readParentAbsenceNotices,
  resolveParentMessageMarkWrites,
  resolveParentMessageRateLimitOutcome,
  findParentPortalStudent,
  generateStudentPortalToken,
  handleParentPortalGet,
  handleParentPortalPost,
  incrementRateLimitCounterDoc,
  isAlreadyExistsError,
  isParentPortalEnabledForClassroom,
  isStudentPortalTokenActive,
  isValidParentPortalToken,
  normalizeIssueRequest,
  normalizeMarkNotifiedRequest,
  normalizeParentAbsenceInput,
  normalizeRevokeRequest,
  PARENT_ABSENCE_ERROR_ALREADY_REPORTED,
  PARENT_ABSENCE_ERROR_NOT_REPORTABLE,
  PARENT_ABSENCE_MAX_SLOT_NUMBER,
  PARENT_MESSAGE_DAILY_LIMIT_PER_TOKEN,
  PARENT_MESSAGE_ERROR_INVALID_INPUT,
  PARENT_MESSAGE_HOURLY_LIMIT_PER_CLASSROOM,
  PARENT_MESSAGE_ID_PATTERN,
  PARENT_MESSAGE_MARK_NOTIFIED_MAX_IDS,
  PARENT_MESSAGE_RATE_LIMIT_ERROR,
  PARENT_PORTAL_ERROR_DISABLED,
  PARENT_PORTAL_ERROR_GONE,
  PARENT_PORTAL_ERROR_INVALID_TOKEN,
  PARENT_PORTAL_TOKEN_PATTERN,
  readStudentPortalOwnerDoc,
  readStudentPortalTokenDoc,
  resolveIssueDecision,
  resolveJstRateLimitPeriods,
  resolveRevokeDecision,
  toParentPortalTokenPrefix,
  type ParentPortalDeps,
  type StudentPortalOwnerDoc,
  type StudentPortalTokenDoc,
} from './parentPortal'

const readIndexSource = () => readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345' // 32 文字
const WS = 'main'
const CLASSROOM_ID = 'v8OZ7zH8vONNHjjYVcR1'
const STUDENT_ID = 's001'

const activeTokenDoc: StudentPortalTokenDoc = {
  workspaceKey: WS,
  classroomId: CLASSROOM_ID,
  studentId: STUDENT_ID,
  createdAt: '2026-09-01T00:00:00.000Z',
  createdByUid: 'mgr-uid',
  revokedAt: null,
}

// 本番形に近いスナップショット断片。講師名・机・他生徒が payload には**ある**(応答に漏れないことを検査する)。
const snapshotPayload = {
  students: [
    { id: STUDENT_ID, name: '山田 太郎', displayName: '山田太', entryDate: '2026-04-01', withdrawDate: '', birthDate: '2012-05-05' },
    { id: 's002', name: '佐藤 花子', displayName: '', entryDate: '2026-04-01', withdrawDate: '2026-08-31', birthDate: '2011-01-01' },
  ],
  teachers: [{ id: 't001', name: '講師 秘密' }],
  boardState: { weeks: [] },
}

/** 休み連絡の POST が通る既定の入力(今日 2026-09-13 の 1 週間後・通常授業 1 限)。 */
const ABSENCE_BODY = { dateKey: '2026-09-20', slotNumber: 1 }

type MockedDeps = ParentPortalDeps & {
  loadSnapshot: ReturnType<typeof vi.fn>
  saveMessage: ReturnType<typeof vi.fn>
  consumeMessageQuota: ReturnType<typeof vi.fn>
  hasAbsenceNotice: ReturnType<typeof vi.fn>
  loadAbsenceNotices: ReturnType<typeof vi.fn>
}

function createDeps(overrides: Partial<ParentPortalDeps> = {}): MockedDeps {
  const loadSnapshot = vi.fn(async () => ({ payload: snapshotPayload, savedAt: '2026-09-12T10:00:00.000Z' }))
  const saveMessage = vi.fn(async () => ({ created: true }))
  const consumeMessageQuota = vi.fn(async () => ({ allowed: true }))
  const hasAbsenceNotice = vi.fn(async () => false)
  const loadAbsenceNotices = vi.fn(async () => [] as unknown[])
  return {
    loadToken: async (token) => (token === TOKEN ? activeTokenDoc : null),
    loadClassroom: async () => ({ name: '開発用教室' }),
    loadSnapshot,
    buildScheduleView: (_payload, studentId, range) => (studentId === STUDENT_ID
      ? {
        studentName: '山田太',
        days: [{ dateKey: range.from, weekday: 1, kind: 'board', lessons: [{ slotNumber: 1, timeLabel: '16:00', subject: '数学', kind: 'regular', isTentative: false }] }],
      }
      : null),
    resolveRange: (input, todayKey) => ({
      from: typeof input.from === 'string' ? input.from : todayKey,
      to: typeof input.to === 'string' ? input.to : todayKey,
      bounds: { minFrom: '2026-07-19', maxTo: '2026-09-30' },
    }),
    // 本番配線(index.ts)と同じ生成物の在籍判定を使う(2026-09-15: 生徒は退塾日当日から非在籍)。
    isStudentActive: (student, dateKey) => isParentStudentActiveOnDate(student, dateKey),
    isEnabled: ({ workspaceKey, id }) => isParentPortalEnabledForClassroom({ workspaceKey, id, projectId: 'komahyouapp-prod' }),
    todayJst: () => '2026-09-13',
    nowIso: () => '2026-09-13T01:23:45.000Z',
    consumeMessageQuota,
    hasAbsenceNotice,
    loadAbsenceNotices,
    saveMessage,
    ...overrides,
  } as MockedDeps
}

describe('トークンの形(§B-1)', () => {
  it('randomBytes(24) を base64url にした 32 文字で、ルートの正規表現に収まる', () => {
    const token = generateStudentPortalToken()
    expect(token).toHaveLength(32)
    expect(PARENT_PORTAL_TOKEN_PATTERN.test(token)).toBe(true)
    expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true)
  })

  it('乱数源を注入すると決定的になる(テスト用の注入口)', () => {
    const fixed = generateStudentPortalToken((n) => Buffer.alloc(n, 0xff))
    expect(fixed).toBe('________________________________')
    expect(fixed).toHaveLength(32)
  })

  it('16〜64 文字の [A-Za-z0-9_-] だけを受け付ける', () => {
    expect(isValidParentPortalToken(TOKEN)).toBe(true)
    expect(isValidParentPortalToken('a'.repeat(16))).toBe(true)
    expect(isValidParentPortalToken('a'.repeat(64))).toBe(true)
    expect(isValidParentPortalToken('a'.repeat(15))).toBe(false)
    expect(isValidParentPortalToken('a'.repeat(65))).toBe(false)
    expect(isValidParentPortalToken('abc/def' + 'a'.repeat(20))).toBe(false)
    expect(isValidParentPortalToken('')).toBe(false)
    expect(isValidParentPortalToken(undefined)).toBe(false)
  })

  it('ログ用の先頭 6 文字だけを返す', () => {
    expect(toParentPortalTokenPrefix(TOKEN)).toBe('AbCdEf')
    expect(toParentPortalTokenPrefix(undefined)).toBe('')
  })

  it('索引 ID は classroomId__studentId', () => {
    expect(buildStudentPortalOwnerId('C1', 's9')).toBe('C1__s9')
  })

  it('readStudentPortalTokenDoc は欠損・型違いを null にし、revokedAt の空文字は有効扱い(null)', () => {
    expect(readStudentPortalTokenDoc(null)).toBeNull()
    expect(readStudentPortalTokenDoc({ classroomId: 'C', studentId: 's' })).toBeNull()
    const doc = readStudentPortalTokenDoc({ workspaceKey: WS, classroomId: 'C', studentId: 's', revokedAt: '', revokedReason: 'bogus' })
    expect(doc).toEqual({ workspaceKey: WS, classroomId: 'C', studentId: 's', createdAt: '', createdByUid: '', revokedAt: null })
    const revoked = readStudentPortalTokenDoc({ workspaceKey: WS, classroomId: 'C', studentId: 's', revokedAt: '2026-09-01T00:00:00.000Z', revokedReason: 'manual' })
    expect(revoked?.revokedAt).toBe('2026-09-01T00:00:00.000Z')
    expect(revoked?.revokedReason).toBe('manual')
    expect(isStudentPortalTokenActive(doc)).toBe(true)
    expect(isStudentPortalTokenActive(revoked)).toBe(false)
    expect(isStudentPortalTokenActive(null)).toBe(false)
  })

  it('readStudentPortalOwnerDoc は token が無ければ null', () => {
    expect(readStudentPortalOwnerDoc({ classroomId: 'C' })).toBeNull()
    expect(readStudentPortalOwnerDoc({ token: TOKEN })?.token).toBe(TOKEN)
  })
})

describe('機能フラグ(§H・第1段 = 開発用教室限定)', () => {
  // 【2026-09-16】判定は登録台帳の (workspaceKey, 教室ID)。教室名は引数から外した
  // (他社が「開発用教室」という名前の教室を作っただけで保護者QR API が答えてしまうため)。
  it('登録済みの開発用教室・テスト教室で有効(判定はクライアントの staging-environment スコープと同一)', () => {
    expect(isParentPortalEnabledForClassroom({ workspaceKey: 'main', id: 'v8OZ7zH8vONNHjjYVcR1', projectId: 'komahyouapp-prod' })).toBe(true)
    expect(isParentPortalEnabledForClassroom({ workspaceKey: 'main', id: 'test_classroom_20260507_dai', projectId: 'komahyouapp-prod' })).toBe(true)
  })

  // ★回帰防止: 名前や曖昧IDでは通らない/別会社では通らない(台帳＝両側同じ 1 か所で決まる)。
  it('未登録の教室・別会社の同名教室では無効(名前判定は廃止・2026-09-16)', () => {
    expect(isParentPortalEnabledForClassroom({ workspaceKey: 'main', id: 'xxx', projectId: 'komahyouapp-prod' })).toBe(false)
    expect(isParentPortalEnabledForClassroom({ workspaceKey: 'main', id: 'development', projectId: 'komahyouapp-prod' })).toBe(false)
    expect(isParentPortalEnabledForClassroom({ workspaceKey: 'company-b', id: 'v8OZ7zH8vONNHjjYVcR1', projectId: 'komahyouapp-prod' })).toBe(false)
    expect(isParentPortalEnabledForClassroom({ workspaceKey: '', id: 'v8OZ7zH8vONNHjjYVcR1', projectId: 'komahyouapp-prod' })).toBe(false)
  })

  it('本番教室(日大前/緑が丘/薬円台)は無効(昇格はクライアント側フラグと同時に行う)', () => {
    for (const id of ['5w5OMueETerSKrSf14HC', 'KzFnOQoTFLsCxwUp1tvh', '6xnnbSTbwgGrBLy0EJKb']) {
      expect(isParentPortalEnabledForClassroom({ workspaceKey: 'main', id, projectId: 'komahyouapp-prod' }), id).toBe(false)
    }
  })

  it('staging プロジェクトでは全教室で有効', () => {
    expect(isParentPortalEnabledForClassroom({ workspaceKey: 'main', id: '5w5OMueETerSKrSf14HC', projectId: 'komahyouapp-staging' })).toBe(true)
    expect(isParentPortalEnabledForClassroom({ workspaceKey: 'main', id: '5w5OMueETerSKrSf14HC', projectId: undefined })).toBe(false)
  })
})

describe('休み連絡の入力の形(2026-09-18・自由記述の廃止)', () => {
  it('dateKey(YYYY-MM-DD)と slotNumber(1 以上の整数)だけを受け付ける', () => {
    expect(normalizeParentAbsenceInput({ dateKey: '2026-09-20', slotNumber: 3 })).toEqual({ ok: true, value: { dateKey: '2026-09-20', slotNumber: 3 } })
    expect(normalizeParentAbsenceInput({ dateKey: ' 2026-09-20 ', slotNumber: 1 })).toEqual({ ok: true, value: { dateKey: '2026-09-20', slotNumber: 1 } })
  })

  it('形が違えば 400 相当(日付の形・限の型と範囲)', () => {
    for (const rawBody of [
      { dateKey: '2026/09/20', slotNumber: 1 },
      { dateKey: '2026-9-20', slotNumber: 1 },
      { dateKey: '2026-09-20' },
      { slotNumber: 1 },
      { dateKey: 20260920, slotNumber: 1 },
      { dateKey: '2026-09-20', slotNumber: 0 },
      { dateKey: '2026-09-20', slotNumber: -1 },
      { dateKey: '2026-09-20', slotNumber: 1.5 },
      { dateKey: '2026-09-20', slotNumber: '1' },
      { dateKey: '2026-09-20', slotNumber: PARENT_ABSENCE_MAX_SLOT_NUMBER + 1 },
      null,
      [],
      '{bad json',
    ]) {
      expect(normalizeParentAbsenceInput(rawBody), JSON.stringify(rawBody)).toEqual({ ok: false, error: PARENT_MESSAGE_ERROR_INVALID_INPUT })
    }
  })

  // ★限は absenceKey で 2 桁に詰めるので 3 桁を通すとキーの並び(__00〜__99)が壊れて GET から外れる。
  it('限の上限は 2 桁まで(absenceKey の桁が壊れない)', () => {
    expect(normalizeParentAbsenceInput({ dateKey: '2026-09-20', slotNumber: PARENT_ABSENCE_MAX_SLOT_NUMBER }).ok).toBe(true)
    expect(normalizeParentAbsenceInput({ dateKey: '2026-09-20', slotNumber: 100 }).ok).toBe(false)
  })

  it('JSON 文字列で届いた body は一度だけ解釈する(Content-Type 違いの保険)', () => {
    expect(normalizeParentAbsenceInput(JSON.stringify(ABSENCE_BODY))).toEqual({ ok: true, value: ABSENCE_BODY })
  })

  // ★回帰防止: 本文・送信者名は**もう受け付けない**(受け取っても doc に入らない)。
  it('本文・送信者名を添えても入力としては無視される(休み連絡専用)', () => {
    const result = normalizeParentAbsenceInput({ ...ABSENCE_BODY, body: '休みます', senderName: '母' })
    expect(result).toEqual({ ok: true, value: ABSENCE_BODY })
  })
})

describe('休み連絡できるコマの判定(共有関数 isParentLessonAbsenceReportable の 1 か所経由)', () => {
  const days = [{
    dateKey: '2026-09-20',
    weekday: 0,
    kind: 'board',
    lessons: [
      { slotNumber: 1, timeLabel: '13:00-14:30', subject: '英', kind: 'attended', isTentative: false },
      { slotNumber: 2, timeLabel: '14:40-16:10', subject: '数', kind: 'regular', isTentative: true },
      { slotNumber: 3, timeLabel: '16:20-17:50', subject: '国', kind: 'absent', isTentative: false },
      { slotNumber: 4, timeLabel: '18:00-19:30', subject: '理', kind: 'makeup', isTentative: false },
    ],
  }]

  it('科目・種別・予定かどうかは日程計算から引く(リクエストの値を使わない)', () => {
    expect(findParentAbsenceTargetLesson(days, '2026-09-20', 2, '2026-09-13')).toEqual({ subject: '数', lessonKind: 'regular', isTentative: true })
    expect(findParentAbsenceTargetLesson(days, '2026-09-20', 4, '2026-09-13')).toEqual({ subject: '理', lessonKind: 'makeup', isTentative: false })
  })

  it('出席済み・お休みのコマ、別の日、存在しない限は null', () => {
    expect(findParentAbsenceTargetLesson(days, '2026-09-20', 1, '2026-09-13')).toBeNull()
    expect(findParentAbsenceTargetLesson(days, '2026-09-20', 3, '2026-09-13')).toBeNull()
    expect(findParentAbsenceTargetLesson(days, '2026-09-21', 2, '2026-09-13')).toBeNull()
    expect(findParentAbsenceTargetLesson(days, '2026-09-20', 5, '2026-09-13')).toBeNull()
  })

  it('過去の日は null・当日は可(共有関数と同じ境界)', () => {
    expect(findParentAbsenceTargetLesson(days, '2026-09-20', 2, '2026-09-21')).toBeNull()
    expect(findParentAbsenceTargetLesson(days, '2026-09-20', 2, '2026-09-20')).toEqual({ subject: '数', lessonKind: 'regular', isTentative: true })
  })

  it('壊れた days は null(型ガード)', () => {
    expect(findParentAbsenceTargetLesson(undefined, '2026-09-20', 2, '2026-09-13')).toBeNull()
    expect(findParentAbsenceTargetLesson([null, 'x', { dateKey: '2026-09-20' }], '2026-09-20', 2, '2026-09-13')).toBeNull()
  })
})

describe('回数制限(§E-1・P-4・JST 境界)', () => {
  it('JST の日・時キーを作る(UTC 15:00 = JST 翌日 0:00)', () => {
    expect(resolveJstRateLimitPeriods('2026-09-13T14:59:59.000Z')).toEqual({ dayKey: '2026-09-13', hourKey: '2026-09-13T23' })
    expect(resolveJstRateLimitPeriods('2026-09-13T15:00:00.000Z')).toEqual({ dayKey: '2026-09-14', hourKey: '2026-09-14T00' })
    expect(() => resolveJstRateLimitPeriods('not-a-date')).toThrow()
  })

  it('キーはトークン指紋__日 と classroom__日T時(全文は文書 ID に入れない)', () => {
    expect(buildParentMessageRateLimitKeys(TOKEN, '2026-09-13T01:23:45.000Z')).toEqual({
      tokenDayKey: `t${buildParentPortalTokenFingerprint(TOKEN)}__2026-09-13`,
      classroomHourKey: 'classroom__2026-09-13T10',
    })
  })

  it('JST 0:00 を跨ぐとトークンの日キーが変わる(カウントが戻る)', () => {
    const before = buildParentMessageRateLimitKeys(TOKEN, '2026-09-13T14:59:59.999Z')
    const after = buildParentMessageRateLimitKeys(TOKEN, '2026-09-13T15:00:00.000Z')
    expect(before.tokenDayKey).not.toBe(after.tokenDayKey)
    expect(after.tokenDayKey).toBe(`t${buildParentPortalTokenFingerprint(TOKEN)}__2026-09-14`)
  })

  // ★2026-09-18: 1 件 = 1 コマの休み連絡になったので 1 日の上限を 5 → 10 に上げた(同じ日の複数コマ・数日分)。
  it('トークン 1 日の上限は 10 件。9 件保存済みまで許可・10 件保存済み(=11 件目)から拒否(加算前の値で判定)', () => {
    expect(PARENT_MESSAGE_DAILY_LIMIT_PER_TOKEN).toBe(10)
    expect(decideParentMessageRateLimit({ tokenCountToday: PARENT_MESSAGE_DAILY_LIMIT_PER_TOKEN - 1, classroomCountThisHour: 1 })).toEqual({ allowed: true })
    expect(decideParentMessageRateLimit({ tokenCountToday: PARENT_MESSAGE_DAILY_LIMIT_PER_TOKEN, classroomCountThisHour: 1 })).toEqual({ allowed: false, error: PARENT_MESSAGE_RATE_LIMIT_ERROR })
  })

  it('教室あたり保存済み 59 件までは許可・60 件保存済みから拒否', () => {
    expect(decideParentMessageRateLimit({ tokenCountToday: 1, classroomCountThisHour: PARENT_MESSAGE_HOURLY_LIMIT_PER_CLASSROOM - 1 })).toEqual({ allowed: true })
    expect(decideParentMessageRateLimit({ tokenCountToday: 1, classroomCountThisHour: PARENT_MESSAGE_HOURLY_LIMIT_PER_CLASSROOM }).allowed).toBe(false)
  })

  // 回帰防止(レビュー指摘 2026-09-13): 拒否した試行でカウンタを増やしていた旧実装では、1 本の漏洩QRから
  // 連打すると教室×時カウンタが上限を越え、**同じ教室の他の保護者が 1 時間送れなくなる**(＋書き込み課金が止まらない)。
  it('枠が尽きているときは 1 件も書き込まない(拒否が他の保護者の枠を食わない)', () => {
    const overToken = resolveParentMessageRateLimitOutcome({
      tokenCounter: { count: PARENT_MESSAGE_DAILY_LIMIT_PER_TOKEN, createdAt: 'c', updatedAt: 'u' },
      classroomCounter: { count: 1, createdAt: 'c', updatedAt: 'u' },
      nowIso: 'now',
    })
    expect(overToken.allowed).toBe(false)
    expect(overToken.writes).toBeNull()

    const overClassroom = resolveParentMessageRateLimitOutcome({
      tokenCounter: null,
      classroomCounter: { count: PARENT_MESSAGE_HOURLY_LIMIT_PER_CLASSROOM, createdAt: 'c', updatedAt: 'u' },
      nowIso: 'now',
    })
    expect(overClassroom.allowed).toBe(false)
    expect(overClassroom.writes).toBeNull()
  })

  it('枠が空いていれば 2 つのカウンタを +1 した文書を返す(createdAt は据え置き)', () => {
    const outcome = resolveParentMessageRateLimitOutcome({
      tokenCounter: { count: 4, createdAt: 'first', updatedAt: 'u' },
      classroomCounter: null,
      nowIso: '2026-09-13T01:00:00.000Z',
    })
    expect(outcome.allowed).toBe(true)
    expect(outcome.writes).toEqual({
      token: { count: 5, createdAt: 'first', updatedAt: '2026-09-13T01:00:00.000Z' },
      classroom: { count: 1, createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T01:00:00.000Z' },
    })
    // 上限を 10 にしたので 5 件保存済みでもまだ通る(旧 5 件上限へ戻していないことの回帰防止)。
    expect(resolveParentMessageRateLimitOutcome({ tokenCounter: { count: 5 }, classroomCounter: null, nowIso: 'now' }).allowed).toBe(true)
  })

  // GET は Firestore へ書かないので、回数制限もインスタンス内メモリで数える(§0-2・F-2)。
  it('GET のスロットルは窓内 60 回まで許可し、窓が切れたら数え直す', () => {
    const start = 1_000_000
    let bucket = decideParentPortalGetThrottle(undefined, start).bucket
    for (let i = 2; i <= PARENT_PORTAL_GET_THROTTLE_LIMIT; i += 1) {
      const step = decideParentPortalGetThrottle(bucket, start + i)
      expect(step.allowed, `hit ${i}`).toBe(true)
      bucket = step.bucket
    }
    const over = decideParentPortalGetThrottle(bucket, start + 999)
    expect(over.allowed).toBe(false)
    // 窓が切れたら先頭から数え直す(正当な家庭が翌窓で開けなくならない)。
    const nextWindow = decideParentPortalGetThrottle(over.bucket, start + PARENT_PORTAL_GET_THROTTLE_WINDOW_MS)
    expect(nextWindow.allowed).toBe(true)
    expect(nextWindow.bucket.hits).toBe(1)
  })

  it('GET スロットルのキー数が上限を超えたら古い窓から捨てる(メモリ保護)', () => {
    const now = 5_000_000
    const buckets = new Map<string, { windowStartedAtMs: number; hits: number }>()
    buckets.set('stale', { windowStartedAtMs: now - PARENT_PORTAL_GET_THROTTLE_WINDOW_MS - 1, hits: 3 })
    buckets.set('fresh', { windowStartedAtMs: now, hits: 1 })
    pruneParentPortalGetThrottleKeys(buckets, now, 1)
    expect(buckets.has('stale')).toBe(false)
    expect(buckets.has('fresh')).toBe(true)
    // 上限以下なら何も捨てない。
    pruneParentPortalGetThrottleKeys(buckets, now, 10)
    expect(buckets.size).toBe(1)
  })

  it('カウンタ文書は count を +1 し createdAt を据え置く(retention 7 日の掃除キー)', () => {
    expect(incrementRateLimitCounterDoc(null, '2026-09-13T01:00:00.000Z')).toEqual({ count: 1, createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T01:00:00.000Z' })
    expect(incrementRateLimitCounterDoc({ count: 4, createdAt: '2026-09-13T00:00:00.000Z', updatedAt: 'x' }, '2026-09-13T01:00:00.000Z'))
      .toEqual({ count: 5, createdAt: '2026-09-13T00:00:00.000Z', updatedAt: '2026-09-13T01:00:00.000Z' })
    expect(incrementRateLimitCounterDoc({ count: 'bad' }, 'now').count).toBe(1)
  })
})

describe('休み連絡の文書(§E-1 改定 2026-09-18)', () => {
  const FINGERPRINT = buildParentPortalTokenFingerprint(TOKEN)
  const absence = { dateKey: '2026-09-20', slotNumber: 3, subject: '英', lessonKind: 'regular' as const, isTentative: true }

  it('doc は kind=absence の形で、本文・送信者名・URL 判定を持たない(旧フィールドを書かない)', () => {
    const doc = buildParentMessageDoc({
      workspaceKey: WS, classroomId: 'C', studentId: 's', studentName: '山田太', absence, createdAt: 'T', token: TOKEN, tokenFingerprint: FINGERPRINT,
    })
    expect(doc).toEqual({
      workspaceKey: WS,
      classroomId: 'C',
      studentId: 's',
      studentName: '山田太',
      kind: 'absence',
      absence,
      absenceKey: `${FINGERPRINT}__2026-09-20__03`,
      createdAt: 'T',
      acknowledgedAt: null,
      resolution: null,
      notifiedAt: null,
      tokenPrefix: 'AbCdEf',
    })
    expect(Object.keys(doc)).not.toContain('body')
    expect(Object.keys(doc)).not.toContain('senderName')
    expect(Object.keys(doc)).not.toContain('containsUrl')
    expect(JSON.stringify(doc)).not.toContain(TOKEN)
  })

  it('absenceKey は 指紋__日付__限2桁 で、同じトークンの 1 か月ぶんが範囲 1 本に収まる', () => {
    expect(buildParentAbsenceKey(FINGERPRINT, '2026-09-01', 1)).toBe(`${FINGERPRINT}__2026-09-01__01`)
    expect(buildParentAbsenceKey(FINGERPRINT, '2026-09-30', 10)).toBe(`${FINGERPRINT}__2026-09-30__10`)
    const range = buildParentAbsenceKeyRange(FINGERPRINT, '2026-09-01', '2026-09-30')
    expect(range).toEqual({ startKey: `${FINGERPRINT}__2026-09-01__00`, endKey: `${FINGERPRINT}__2026-09-30__99` })
    for (const key of [buildParentAbsenceKey(FINGERPRINT, '2026-09-01', 1), buildParentAbsenceKey(FINGERPRINT, '2026-09-30', 5)]) {
      expect(key >= range.startKey && key <= range.endKey, key).toBe(true)
    }
    // 範囲外の月・別トークンはキー空間ごと外れる(他の生徒の連絡を引かない)。
    const inRange = (key: string) => key >= range.startKey && key <= range.endKey
    expect(inRange(buildParentAbsenceKey(FINGERPRINT, '2026-10-01', 1))).toBe(false)
    expect(inRange(buildParentAbsenceKey(FINGERPRINT, '2026-08-31', 5))).toBe(false)
    expect(inRange(buildParentAbsenceKey(buildParentPortalTokenFingerprint('other-token-other-token-other-01'), '2026-09-10', 1))).toBe(false)
    // ★キーにトークン全文を入れない(文書のパスが例外メッセージ経由でログに流れる・§G-1)。
    expect(range.startKey).not.toContain(TOKEN)
  })

  it('文書 ID は決定的(abs-指紋-日付-限)で ID 形式の検証を通る = 二重連絡を create が原子的に弾ける', () => {
    const id = buildParentAbsenceMessageId(FINGERPRINT, '2026-09-20', 3)
    expect(id).toBe(`abs-${FINGERPRINT}-2026-09-20-3`)
    expect(PARENT_MESSAGE_ID_PATTERN.test(id)).toBe(true)
    expect(id).not.toContain(TOKEN)
    expect(buildParentAbsenceMessageId(FINGERPRINT, '2026-09-20', 3)).toBe(id)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: [id] }).ok).toBe(true)
  })

  it('readParentAbsenceNotices: 日付・限・確認済みだけを返し、旧 doc(kind 無し)と壊れた行は捨てる', () => {
    expect(readParentAbsenceNotices([
      { kind: 'absence', absence: { dateKey: '2026-09-20', slotNumber: 3 }, acknowledgedAt: null, resolution: null, studentId: 's001' },
      { kind: 'absence', absence: { dateKey: '2026-09-18', slotNumber: 1 }, acknowledgedAt: '2026-09-17T00:00:00.000Z', resolution: 'absent' },
      { body: '旧仕様の自由記述', senderName: '母' },
      { kind: 'absence' },
      { kind: 'absence', absence: { dateKey: '2026-09-20', slotNumber: 'x' } },
      null,
      'x',
    ])).toEqual([
      { dateKey: '2026-09-18', slotNumber: 1, acknowledged: true },
      { dateKey: '2026-09-20', slotNumber: 3, acknowledged: false },
    ])
    expect(readParentAbsenceNotices(undefined)).toEqual([])
  })

  it('readParentAbsenceNotices は内部 ID・resolution・生徒名を載せない(§C)', () => {
    const notices = readParentAbsenceNotices([
      { kind: 'absence', absence: { dateKey: '2026-09-20', slotNumber: 3 }, acknowledgedAt: 'x', resolution: 'makeup-now', studentId: 's001', studentName: '山田太', tokenPrefix: 'AbCdEf' },
    ])
    expect(notices).toEqual([{ dateKey: '2026-09-20', slotNumber: 3, acknowledged: true }])
    const json = JSON.stringify(notices)
    for (const forbidden of ['s001', '山田太', 'AbCdEf', 'makeup-now']) {
      expect(json, forbidden).not.toContain(forbidden)
    }
  })

  it('同じコマの重複 doc は 1 件に畳む', () => {
    expect(readParentAbsenceNotices([
      { kind: 'absence', absence: { dateKey: '2026-09-20', slotNumber: 3 }, acknowledgedAt: '2026-09-19T00:00:00.000Z' },
      { kind: 'absence', absence: { dateKey: '2026-09-20', slotNumber: 3 }, acknowledgedAt: null },
    ])).toEqual([{ dateKey: '2026-09-20', slotNumber: 3, acknowledged: true }])
  })

  it('ALREADY_EXISTS だけを二重連絡として扱う(他の失敗は握り潰さない)', () => {
    expect(isAlreadyExistsError({ code: 6 })).toBe(true)
    expect(isAlreadyExistsError({ code: 'already-exists' })).toBe(true)
    expect(isAlreadyExistsError(new Error('6 ALREADY_EXISTS: entity already exists'))).toBe(true)
    expect(isAlreadyExistsError({ code: 7, message: 'PERMISSION_DENIED' })).toBe(false)
    expect(isAlreadyExistsError(new Error('DEADLINE_EXCEEDED'))).toBe(false)
    expect(isAlreadyExistsError(null)).toBe(false)
  })
})

describe('生徒の同定(§D-3・§F)', () => {
  it('id 一致の行だけを返し、名前一致では拾わない', () => {
    expect(findParentPortalStudent(snapshotPayload, STUDENT_ID)?.displayName).toBe('山田太')
    expect(findParentPortalStudent(snapshotPayload, '山田 太郎')).toBeNull()
    expect(findParentPortalStudent({ students: 'nope' }, STUDENT_ID)).toBeNull()
    expect(findParentPortalStudent(null, STUDENT_ID)).toBeNull()
  })
})

describe('handleParentPortalGet: 検証順(§G-2)とスナップショット未読', () => {
  it('形が不正なトークンは 400 で、トークン doc もスナップショットも読まない', async () => {
    const loadToken = vi.fn(async () => activeTokenDoc)
    const deps = createDeps({ loadToken })
    const result = await handleParentPortalGet({ token: 'short' }, deps)
    expect(result).toEqual({ status: 400, body: { error: PARENT_PORTAL_ERROR_INVALID_TOKEN } })
    expect(loadToken).not.toHaveBeenCalled()
    expect(deps.loadSnapshot).not.toHaveBeenCalled()
  })

  it('存在しないトークンは 410 でスナップショットを読まない', async () => {
    const deps = createDeps()
    const result = await handleParentPortalGet({ token: 'a'.repeat(32) }, deps)
    expect(result).toEqual({ status: 410, body: { error: PARENT_PORTAL_ERROR_GONE } })
    expect(deps.loadSnapshot).not.toHaveBeenCalled()
  })

  it('失効済みトークンは 410 でスナップショットを読まない(再発行しても古いトークンは復活しない)', async () => {
    const deps = createDeps({ loadToken: async () => ({ ...activeTokenDoc, revokedAt: '2026-09-10T00:00:00.000Z', revokedReason: 'reissue' }) })
    const result = await handleParentPortalGet({ token: TOKEN }, deps)
    expect(result.status).toBe(410)
    expect(deps.loadSnapshot).not.toHaveBeenCalled()
  })

  it('フラグ OFF の教室は 403 でスナップショットを読まない(トークンは失効させない = P-11)', async () => {
    const deps = createDeps({
      loadToken: async () => ({ ...activeTokenDoc, classroomId: '5w5OMueETerSKrSf14HC' }),
      loadClassroom: async () => ({ name: 'スクールIE 日大前校' }),
    })
    const result = await handleParentPortalGet({ token: TOKEN }, deps)
    expect(result).toEqual({ status: 403, body: { error: PARENT_PORTAL_ERROR_DISABLED } })
    expect(deps.loadSnapshot).not.toHaveBeenCalled()
  })

  it('教室 doc が無ければ 410(スナップショット未読)', async () => {
    const deps = createDeps({ loadClassroom: async () => null })
    const result = await handleParentPortalGet({ token: TOKEN }, deps)
    expect(result.status).toBe(410)
    expect(deps.loadSnapshot).not.toHaveBeenCalled()
  })

  it('スナップショットが無い／生徒が実在しない(他教室へコピーされたトークン)は 410', async () => {
    expect((await handleParentPortalGet({ token: TOKEN }, createDeps({ loadSnapshot: vi.fn(async () => null) }))).status).toBe(410)
    const deps = createDeps({ loadToken: async () => ({ ...activeTokenDoc, studentId: 'not-in-this-classroom' }) })
    const result = await handleParentPortalGet({ token: TOKEN }, deps)
    expect(result).toEqual({ status: 410, body: { error: PARENT_PORTAL_ERROR_GONE } })
  })

  it('退塾済み(当日 JST で非在籍)は 410 で、理由を出し分けない', async () => {
    const deps = createDeps({ loadToken: async () => ({ ...activeTokenDoc, studentId: 's002' }) })
    const result = await handleParentPortalGet({ token: TOKEN }, deps)
    expect(result).toEqual({ status: 410, body: { error: PARENT_PORTAL_ERROR_GONE } })
  })

  // 2026-09-15 改定(確認リスト v1.5.527 b-2): 生徒の退塾日は「その日から非在籍」。保護者QRも退塾日当日から 410。
  it('在籍判定は deps.todayJst の日付で行う(退塾日の前日は可・当日と翌日は不可 = P-6)', async () => {
    const anyStudentView = () => ({ studentName: '佐藤', days: [] })
    const dayBefore = createDeps({ loadToken: async () => ({ ...activeTokenDoc, studentId: 's002' }), todayJst: () => '2026-08-30', buildScheduleView: anyStudentView })
    expect((await handleParentPortalGet({ token: TOKEN }, dayBefore)).status).toBe(200)
    const onWithdrawDay = createDeps({ loadToken: async () => ({ ...activeTokenDoc, studentId: 's002' }), todayJst: () => '2026-08-31', buildScheduleView: anyStudentView })
    expect((await handleParentPortalGet({ token: TOKEN }, onWithdrawDay)).status).toBe(410)
    const nextDay = createDeps({ loadToken: async () => ({ ...activeTokenDoc, studentId: 's002' }), todayJst: () => '2026-09-01', buildScheduleView: anyStudentView })
    expect((await handleParentPortalGet({ token: TOKEN }, nextDay)).status).toBe(410)
  })

  it('検証を通ると 200 で契約どおりのキーだけを返す(講師名・机・ID・トークンを含めない)', async () => {
    const deps = createDeps()
    const result = await handleParentPortalGet({ token: TOKEN, from: '2026-09-06', to: '2026-09-28' }, deps)
    expect(result.status).toBe(200)
    const body = result.body as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['absenceNotices', 'bounds', 'classroomName', 'days', 'hasLectureLessons', 'range', 'snapshotSavedAt', 'studentName', 'today'])
    // 講習の印は真偽値だけ(講習コマの中身・件数は出さない)。日程計算が印を返さなければ false。
    expect(body.hasLectureLessons).toBe(false)
    expect(body.studentName).toBe('山田太')
    expect(body.classroomName).toBe('開発用教室')
    expect(body.snapshotSavedAt).toBe('2026-09-12T10:00:00.000Z')
    expect(body.today).toBe('2026-09-13')
    expect(body.range).toEqual({ from: '2026-09-06', to: '2026-09-28' })
    expect(body.bounds).toEqual({ minFrom: '2026-07-19', maxTo: '2026-09-30' })
    expect(body.absenceNotices).toEqual([])
    const json = JSON.stringify(body)
    for (const forbidden of [TOKEN, STUDENT_ID, CLASSROOM_ID, 'teacher', 'desk', 'stock', '講師 秘密', '佐藤', 'mgr-uid', 'createdByUid']) {
      expect(json, forbidden).not.toContain(forbidden)
    }
  })

  // 2026-09-18: 保護者ページのバッジ「休み連絡済」/「教室確認済」の元。
  it('表示範囲の休み連絡を absenceKey の単一フィールド範囲で引き、日付・限・確認済みだけを返す', async () => {
    const loadAbsenceNotices = vi.fn(async () => [
      { kind: 'absence', absence: { dateKey: '2026-09-20', slotNumber: 1, subject: '数学', lessonKind: 'regular', isTentative: false }, acknowledgedAt: null, studentId: STUDENT_ID },
      { kind: 'absence', absence: { dateKey: '2026-09-25', slotNumber: 2 }, acknowledgedAt: '2026-09-24T02:00:00.000Z', resolution: 'makeup-now' },
    ])
    const deps = createDeps({ loadAbsenceNotices })
    const result = await handleParentPortalGet({ token: TOKEN, from: '2026-09-01', to: '2026-09-30' }, deps)
    const fingerprint = buildParentPortalTokenFingerprint(TOKEN)
    expect(loadAbsenceNotices).toHaveBeenCalledWith({
      workspaceKey: WS,
      classroomId: CLASSROOM_ID,
      startKey: `${fingerprint}__2026-09-01__00`,
      endKey: `${fingerprint}__2026-09-30__99`,
    })
    const body = result.body as Record<string, unknown>
    expect(body.absenceNotices).toEqual([
      { dateKey: '2026-09-20', slotNumber: 1, acknowledged: false },
      { dateKey: '2026-09-25', slotNumber: 2, acknowledged: true },
    ])
    // 室長の処理内容(resolution)・内部 ID は保護者へ出さない(§C)。
    expect(JSON.stringify(body.absenceNotices)).not.toContain('makeup-now')
    expect(JSON.stringify(body.absenceNotices)).not.toContain(STUDENT_ID)
  })

  it('連絡の読み取りは検証を通ったあとだけ(400/410/403 では引かない)', async () => {
    const invalid = createDeps()
    await handleParentPortalGet({ token: 'short' }, invalid)
    const gone = createDeps({ loadToken: async () => null })
    await handleParentPortalGet({ token: TOKEN }, gone)
    const off = createDeps({ loadToken: async () => ({ ...activeTokenDoc, classroomId: '5w5OMueETerSKrSf14HC' }), loadClassroom: async () => ({ name: '本番校' }) })
    await handleParentPortalGet({ token: TOKEN }, off)
    for (const deps of [invalid, gone, off]) {
      expect(deps.loadAbsenceNotices).not.toHaveBeenCalled()
    }
  })

  it('教室はトークン doc の値が権威(リクエストに別教室を付けても切り替わらない)', async () => {
    const loadSnapshot = vi.fn(async () => ({ payload: snapshotPayload, savedAt: null }))
    const deps = createDeps({ loadSnapshot })
    await handleParentPortalGet({ token: TOKEN, from: 'x', to: 'y', ...({ classroomId: 'OTHER' } as object) }, deps)
    expect(loadSnapshot).toHaveBeenCalledWith(WS, CLASSROOM_ID)
  })

  it('期間は resolveRange(今日基準)で丸めた値を使う', async () => {
    const resolveRange = vi.fn(() => ({ from: '2026-09-06', to: '2026-10-11', bounds: { minFrom: 'a', maxTo: 'b' } }))
    const buildScheduleView = vi.fn(() => ({ studentName: 'n', days: [] }))
    const deps = createDeps({ resolveRange, buildScheduleView })
    await handleParentPortalGet({ token: TOKEN, from: '1999-01-01', to: ['bad'] }, deps)
    expect(resolveRange).toHaveBeenCalledWith({ from: '1999-01-01', to: ['bad'] }, '2026-09-13')
    expect(buildScheduleView).toHaveBeenCalledWith(snapshotPayload, STUDENT_ID, { from: '2026-09-06', to: '2026-10-11' })
  })

  it('日程計算が講習の印を返したら hasLectureLessons=true をそのまま返す(真偽値以外は false)', async () => {
    const view = (flag: unknown) => () => ({ studentName: 'n', days: [], hasLectureLessons: flag as boolean })
    const on = await handleParentPortalGet({ token: TOKEN }, createDeps({ buildScheduleView: view(true) }))
    expect((on.body as Record<string, unknown>).hasLectureLessons).toBe(true)
    const junk = await handleParentPortalGet({ token: TOKEN }, createDeps({ buildScheduleView: view('yes') }))
    expect((junk.body as Record<string, unknown>).hasLectureLessons).toBe(false)
  })

  it('buildScheduleView が null(生徒無し)なら 410', async () => {
    const deps = createDeps({ buildScheduleView: () => null })
    expect((await handleParentPortalGet({ token: TOKEN }, deps)).status).toBe(410)
  })
})

describe('handleParentPortalPost: 休み連絡の検証順(400 → 409 → 429 → create)', () => {
  const FINGERPRINT = buildParentPortalTokenFingerprint(TOKEN)
  const MESSAGE_ID = buildParentAbsenceMessageId(FINGERPRINT, ABSENCE_BODY.dateKey, ABSENCE_BODY.slotNumber)

  it('GET と同じ共通検証(400/410/403)で、落ちたときは入力検証も枠の消費も保存もしない', async () => {
    const invalid = createDeps()
    expect((await handleParentPortalPost({ token: 'bad', rawBody: ABSENCE_BODY }, invalid)).status).toBe(400)
    const gone = createDeps({ loadToken: async () => null })
    expect((await handleParentPortalPost({ token: TOKEN, rawBody: ABSENCE_BODY }, gone)).status).toBe(410)
    const off = createDeps({ loadClassroom: async () => ({ name: '本番校' }), loadToken: async () => ({ ...activeTokenDoc, classroomId: 'prod' }) })
    expect((await handleParentPortalPost({ token: TOKEN, rawBody: ABSENCE_BODY }, off)).status).toBe(403)
    for (const deps of [invalid, gone, off]) {
      expect(deps.hasAbsenceNotice).not.toHaveBeenCalled()
      expect(deps.consumeMessageQuota).not.toHaveBeenCalled()
      expect(deps.saveMessage).not.toHaveBeenCalled()
    }
    expect(gone.loadSnapshot).not.toHaveBeenCalled()
    expect(off.loadSnapshot).not.toHaveBeenCalled()
  })

  it('入力の形が違えば 400 で、対象コマの検証も枠の消費もしない', async () => {
    for (const rawBody of [{}, { dateKey: '2026-09-20' }, { dateKey: '20260920', slotNumber: 1 }, { dateKey: '2026-09-20', slotNumber: 0 }, { body: '休みます' }]) {
      const deps = createDeps()
      const result = await handleParentPortalPost({ token: TOKEN, rawBody }, deps)
      expect(result, JSON.stringify(rawBody)).toEqual({ status: 400, body: { error: PARENT_MESSAGE_ERROR_INVALID_INPUT } })
      expect(deps.hasAbsenceNotice).not.toHaveBeenCalled()
      expect(deps.consumeMessageQuota).not.toHaveBeenCalled()
      expect(deps.saveMessage).not.toHaveBeenCalled()
    }
  })

  it('連絡できるコマなら 200 で、連絡を受けたコマを返す', async () => {
    const deps = createDeps()
    const result = await handleParentPortalPost({ token: TOKEN, rawBody: ABSENCE_BODY }, deps)
    expect(result).toEqual({
      status: 200,
      body: { ok: true, createdAt: '2026-09-13T01:23:45.000Z', notice: { dateKey: '2026-09-20', slotNumber: 1, acknowledged: false } },
    })
  })

  it('当日のコマも受け付ける(オーナー確定 3)', async () => {
    const deps = createDeps()
    const result = await handleParentPortalPost({ token: TOKEN, rawBody: { dateKey: '2026-09-13', slotNumber: 1 } }, deps)
    expect(result.status).toBe(200)
  })

  // ★(3) 対象コマの検証。理由は出し分けない(§F と同じ作法)。
  it('過去の日・表示できない月・存在しない限・すでに結果が付いたコマは 409 で、枠を消費しない', async () => {
    const cases: Array<{ label: string; rawBody: { dateKey: string; slotNumber: number }; overrides?: Partial<ParentPortalDeps> }> = [
      { label: '昨日', rawBody: { dateKey: '2026-09-12', slotNumber: 1 } },
      { label: '表示範囲(今月末)より先', rawBody: { dateKey: '2026-10-05', slotNumber: 1 } },
      { label: '存在しない限', rawBody: { dateKey: '2026-09-20', slotNumber: 4 } },
      {
        label: 'すでにお休み',
        rawBody: ABSENCE_BODY,
        overrides: {
          buildScheduleView: (_payload, _studentId, range) => ({
            studentName: '山田太',
            days: [{ dateKey: range.from, weekday: 0, kind: 'board', lessons: [{ slotNumber: 1, timeLabel: '13:00', subject: '数学', kind: 'absent', isTentative: false }] }],
          }),
        },
      },
      { label: '生徒が日程計算に無い', rawBody: ABSENCE_BODY, overrides: { buildScheduleView: () => null } },
    ]
    for (const testCase of cases) {
      const deps = createDeps(testCase.overrides ?? {})
      const result = await handleParentPortalPost({ token: TOKEN, rawBody: testCase.rawBody }, deps)
      expect(result, testCase.label).toEqual({ status: 409, body: { error: PARENT_ABSENCE_ERROR_NOT_REPORTABLE } })
      expect(deps.hasAbsenceNotice, testCase.label).not.toHaveBeenCalled()
      expect(deps.consumeMessageQuota, testCase.label).not.toHaveBeenCalled()
      expect(deps.saveMessage, testCase.label).not.toHaveBeenCalled()
    }
  })

  it('表示範囲外の日は日程計算を呼ばずに 409(無駄な計算をしない)', async () => {
    const buildScheduleView = vi.fn(() => ({ studentName: 'n', days: [] }))
    const deps = createDeps({ buildScheduleView })
    // 共通検証で 1 回呼ばれる…ことはない(GET だけが呼ぶ)。POST は対象コマ検証のときだけ呼ぶ。
    expect((await handleParentPortalPost({ token: TOKEN, rawBody: { dateKey: '2026-12-01', slotNumber: 1 } }, deps)).status).toBe(409)
    expect(buildScheduleView).not.toHaveBeenCalled()
  })

  // ★(4) 二重連絡は枠を消費しない(押し間違い・二重タップで 1 日 10 件を食い潰さない)。
  it('同じコマの連絡が既にあれば 409 で、枠を消費せず保存もしない', async () => {
    const deps = createDeps({ hasAbsenceNotice: vi.fn(async () => true) })
    const result = await handleParentPortalPost({ token: TOKEN, rawBody: ABSENCE_BODY }, deps)
    expect(result).toEqual({ status: 409, body: { error: PARENT_ABSENCE_ERROR_ALREADY_REPORTED } })
    expect(deps.hasAbsenceNotice).toHaveBeenCalledWith({ workspaceKey: WS, classroomId: CLASSROOM_ID, messageId: MESSAGE_ID })
    expect(deps.consumeMessageQuota).not.toHaveBeenCalled()
    expect(deps.saveMessage).not.toHaveBeenCalled()
  })

  it('create が競合(ALREADY_EXISTS)したときも同じ 409 に揃える(原子的な二重防止)', async () => {
    const deps = createDeps({ saveMessage: vi.fn(async () => ({ created: false })) })
    const result = await handleParentPortalPost({ token: TOKEN, rawBody: ABSENCE_BODY }, deps)
    expect(result).toEqual({ status: 409, body: { error: PARENT_ABSENCE_ERROR_ALREADY_REPORTED } })
  })

  it('枠が尽きていたら 429(保存しない)', async () => {
    const denied = createDeps({ consumeMessageQuota: vi.fn(async () => ({ allowed: false, error: PARENT_MESSAGE_RATE_LIMIT_ERROR })) })
    const result = await handleParentPortalPost({ token: TOKEN, rawBody: ABSENCE_BODY }, denied)
    expect(result).toEqual({ status: 429, body: { error: PARENT_MESSAGE_RATE_LIMIT_ERROR } })
    expect(denied.saveMessage).not.toHaveBeenCalled()
  })

  it('カウンタのキーはトークンの指紋(全文ではない)と JST 日・時で組み、教室はトークン doc 由来', async () => {
    const deps = createDeps()
    await handleParentPortalPost({ token: TOKEN, rawBody: ABSENCE_BODY }, deps)
    expect(deps.consumeMessageQuota).toHaveBeenCalledWith({
      workspaceKey: WS,
      classroomId: CLASSROOM_ID,
      tokenDayKey: `t${FINGERPRINT}__2026-09-13`,
      classroomHourKey: 'classroom__2026-09-13T10',
    })
    // ★文書 ID にトークン全文を入れない(Firestore の例外メッセージがパスを含み、ログへ流れる・§G-1)。
    const keys = deps.consumeMessageQuota.mock.calls[0][0] as { tokenDayKey: string; classroomHourKey: string }
    expect(keys.tokenDayKey).not.toContain(TOKEN)
    expect(keys.classroomHourKey).not.toContain(TOKEN)
  })

  it('保存する classroomId / studentId / 科目 / 種別はリクエスト body ではなくサーバー側の値', async () => {
    const deps = createDeps()
    await handleParentPortalPost({
      token: TOKEN,
      // ★リクエストに科目・種別・教室・生徒を混ぜても doc には入らない(すべてサーバーが決める)。
      rawBody: { ...ABSENCE_BODY, subject: '国', lessonKind: 'extra', isTentative: true, classroomId: 'EVIL', studentId: 'EVIL', body: '休みます', senderName: '母' },
    }, deps)
    expect(deps.saveMessage).toHaveBeenCalledTimes(1)
    const [call] = deps.saveMessage.mock.calls as unknown as Array<[{ workspaceKey: string; classroomId: string; messageId: string; doc: Record<string, unknown> }]>
    expect(call[0].workspaceKey).toBe(WS)
    expect(call[0].classroomId).toBe(CLASSROOM_ID)
    expect(call[0].messageId).toBe(MESSAGE_ID)
    expect(call[0].doc).toEqual({
      workspaceKey: WS,
      classroomId: CLASSROOM_ID,
      studentId: STUDENT_ID,
      studentName: '山田太',
      kind: 'absence',
      // 科目・種別・予定かどうかは日程計算(buildScheduleView)から引いた値。
      absence: { dateKey: '2026-09-20', slotNumber: 1, subject: '数学', lessonKind: 'regular', isTentative: false },
      absenceKey: `${FINGERPRINT}__2026-09-20__01`,
      createdAt: '2026-09-13T01:23:45.000Z',
      acknowledgedAt: null,
      resolution: null,
      notifiedAt: null,
      tokenPrefix: 'AbCdEf',
    })
    const json = JSON.stringify(call[0].doc)
    expect(json).not.toContain('EVIL')
    expect(json).not.toContain('休みます')
    expect(json).not.toContain(TOKEN)
  })

  it('テンプレ補完(予定)のコマは isTentative: true で保存する', async () => {
    const deps = createDeps({
      buildScheduleView: (_payload, _studentId, range) => ({
        studentName: '山田太',
        days: [{ dateKey: range.from, weekday: 0, kind: 'template', lessons: [{ slotNumber: 1, timeLabel: '13:00', subject: '英', kind: 'regular', isTentative: true }] }],
      }),
    })
    await handleParentPortalPost({ token: TOKEN, rawBody: ABSENCE_BODY }, deps)
    const [call] = deps.saveMessage.mock.calls as unknown as Array<[{ doc: { absence: Record<string, unknown> } }]>
    expect(call[0].doc.absence).toEqual({ dateKey: '2026-09-20', slotNumber: 1, subject: '英', lessonKind: 'regular', isTentative: true })
  })

  it('表示名が無ければ name を使う', async () => {
    const deps = createDeps({
      loadSnapshot: vi.fn(async () => ({ payload: { students: [{ id: STUDENT_ID, name: '鈴木 一郎', displayName: '  ' }] }, savedAt: null })),
    })
    await handleParentPortalPost({ token: TOKEN, rawBody: ABSENCE_BODY }, deps)
    const [call] = deps.saveMessage.mock.calls as unknown as Array<[{ doc: { studentName: string } }]>
    expect(call[0].doc.studentName).toBe('鈴木 一郎')
  })

  it('対象コマの検証は「その日 1 日」だけを計算する(月まるごと計算しない)', async () => {
    const buildScheduleView = vi.fn((_payload: unknown, _studentId: string, range: { from: string; to: string }) => ({
      studentName: '山田太',
      days: [{ dateKey: range.from, weekday: 0, kind: 'board', lessons: [{ slotNumber: 1, timeLabel: '13:00', subject: '数学', kind: 'regular', isTentative: false }] }],
    }))
    const deps = createDeps({ buildScheduleView })
    await handleParentPortalPost({ token: TOKEN, rawBody: ABSENCE_BODY }, deps)
    expect(buildScheduleView).toHaveBeenCalledWith(snapshotPayload, STUDENT_ID, { from: '2026-09-20', to: '2026-09-20' })
  })
})

describe('callable の入力正規化', () => {
  it('normalizeIssueRequest: 必須 3 つと reissue(true のときだけ真)', () => {
    expect(normalizeIssueRequest({ workspaceKey: WS, classroomId: 'C', studentId: 's' })).toEqual({ ok: true, value: { workspaceKey: WS, classroomId: 'C', studentId: 's', reissue: false } })
    expect(normalizeIssueRequest({ workspaceKey: WS, classroomId: 'C', studentId: 's', reissue: true }).ok && true).toBe(true)
    expect(normalizeIssueRequest({ workspaceKey: WS, classroomId: 'C', studentId: 's', reissue: 'yes' })).toEqual({ ok: true, value: { workspaceKey: WS, classroomId: 'C', studentId: 's', reissue: false } })
    expect(normalizeIssueRequest({ workspaceKey: WS, classroomId: 'C' }).ok).toBe(false)
    expect(normalizeIssueRequest(null).ok).toBe(false)
    expect(normalizeIssueRequest({ workspaceKey: WS, classroomId: '  ', studentId: 's' }).ok).toBe(false)
  })

  it('normalizeRevokeRequest: reason は manual / studentDeleted のみ', () => {
    expect(normalizeRevokeRequest({ workspaceKey: WS, classroomId: 'C', studentId: 's', reason: 'studentDeleted' })).toEqual({ ok: true, value: { workspaceKey: WS, classroomId: 'C', studentId: 's', reason: 'studentDeleted' } })
    expect(normalizeRevokeRequest({ workspaceKey: WS, classroomId: 'C', studentId: 's', reason: 'manual' }).ok).toBe(true)
    expect(normalizeRevokeRequest({ workspaceKey: WS, classroomId: 'C', studentId: 's', reason: 'reissue' }).ok).toBe(false)
    expect(normalizeRevokeRequest({ workspaceKey: WS, classroomId: 'C', studentId: 's' }).ok).toBe(false)
  })

  it('normalizeMarkNotifiedRequest: 配列必須・ID 形式検証・重複排除・最大 50', () => {
    const ok = normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: ['m1', 'm2', 'm1'] })
    // stage 省略は 'notified'(旧クライアント互換)・resolution 省略は null。
    expect(ok).toEqual({ ok: true, value: { workspaceKey: WS, classroomId: 'C', messageIds: ['m1', 'm2'], stage: 'notified', resolution: null } })
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: [] }).ok).toBe(false)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: 'm1' }).ok).toBe(false)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: ['a/b'] }).ok).toBe(false)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: [''] }).ok).toBe(false)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: [1] }).ok).toBe(false)
    const fifty = Array.from({ length: PARENT_MESSAGE_MARK_NOTIFIED_MAX_IDS }, (_, index) => `m${index}`)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: fifty }).ok).toBe(true)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: [...fifty, 'extra'] }).ok).toBe(false)
  })

  // 2026-09-18: 「四択を押した(acknowledged)」と「処理完了(notified)」の 2 段。
  it('normalizeMarkNotifiedRequest: stage / resolution を受け付け、知らない値は弾く', () => {
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: ['m1'], stage: 'acknowledged', resolution: 'makeup-now' }))
      .toEqual({ ok: true, value: { workspaceKey: WS, classroomId: 'C', messageIds: ['m1'], stage: 'acknowledged', resolution: 'makeup-now' } })
    for (const resolution of ['absent', 'absent-no-makeup', 'makeup-now', 'manual']) {
      expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: ['m1'], stage: 'notified', resolution }).ok, resolution).toBe(true)
    }
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: ['m1'], stage: 'acknowledged', resolution: null }).ok).toBe(true)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: ['m1'], stage: 'done' }).ok).toBe(false)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: ['m1'], stage: 1 }).ok).toBe(false)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: ['m1'], resolution: 'attended' }).ok).toBe(false)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: ['m1'], resolution: 5 }).ok).toBe(false)
  })

  it("resolveParentMessageMarkWrites('acknowledged'): acknowledgedAt は初回だけ・resolution は毎回上書き・notifiedAt は触らない", () => {
    const writes = resolveParentMessageMarkWrites([
      { id: 'a', exists: true, notifiedAt: null, acknowledgedAt: null },
      { id: 'b', exists: true, notifiedAt: null, acknowledgedAt: '2026-09-17T00:00:00.000Z' },
      { id: 'c', exists: false, notifiedAt: null, acknowledgedAt: null },
    ], { stage: 'acknowledged', resolution: 'absent', nowIso: 'NOW' })
    expect(writes).toEqual([
      { id: 'a', update: { acknowledgedAt: 'NOW', resolution: 'absent' } },
      // 最初に確認した時刻は保つ。やり直しで resolution だけ変わる。
      { id: 'b', update: { acknowledgedAt: '2026-09-17T00:00:00.000Z', resolution: 'absent' } },
    ])
    // ★notifiedAt を触らない = 「四択は押したが保存していない」連絡は未読のまま残り、次回また通知が出る(オーナー確定 5)。
    for (const write of writes) expect(Object.keys(write.update)).not.toContain('notifiedAt')
  })

  it("resolveParentMessageMarkWrites('acknowledged'): resolution 未指定なら既存を消さない", () => {
    expect(resolveParentMessageMarkWrites([{ id: 'a', exists: true, notifiedAt: null, acknowledgedAt: null }], { stage: 'acknowledged', nowIso: 'NOW' }))
      .toEqual([{ id: 'a', update: { acknowledgedAt: 'NOW' } }])
  })

  it("resolveParentMessageMarkWrites('notified'): 未読だけを既読にし、acknowledgedAt も埋める(既読は上書きしない)", () => {
    expect(resolveParentMessageMarkWrites([
      { id: 'a', exists: true, notifiedAt: null, acknowledgedAt: null },
      { id: 'b', exists: true, notifiedAt: '2026-09-01T00:00:00.000Z', acknowledgedAt: null },
      { id: 'c', exists: false, notifiedAt: null },
      { id: 'd', exists: true, notifiedAt: undefined, acknowledgedAt: '2026-09-17T00:00:00.000Z' },
    ], { stage: 'notified', nowIso: 'NOW' })).toEqual([
      { id: 'a', update: { notifiedAt: 'NOW', acknowledgedAt: 'NOW' } },
      { id: 'd', update: { notifiedAt: 'NOW', acknowledgedAt: '2026-09-17T00:00:00.000Z' } },
    ])
    // 旧クライアント(stage 省略 = notified)でも同じ経路を通る。
    expect(resolveParentMessageMarkWrites([{ id: 'a', exists: true, notifiedAt: null }], { stage: 'notified', resolution: 'manual', nowIso: 'NOW' }))
      .toEqual([{ id: 'a', update: { notifiedAt: 'NOW', acknowledgedAt: 'NOW', resolution: 'manual' } }])
  })
})

describe('発行・失効の決定(§B-2・K-2)', () => {
  const issuer = { workspaceKey: WS, classroomId: 'C', studentId: 's', createdByUid: 'mgr' }
  const owner: StudentPortalOwnerDoc = { workspaceKey: WS, classroomId: 'C', studentId: 's', token: 'old-token-old-token-old-token-00', updatedAt: 'T0' }
  const activeOld: StudentPortalTokenDoc = { workspaceKey: WS, classroomId: 'C', studentId: 's', createdAt: 'T0', createdByUid: 'mgr', revokedAt: null }

  it('未発行なら新規発行(トークン doc + 索引を書く)', () => {
    const decision = resolveIssueDecision({ existingOwner: null, existingToken: null, reissue: false, nowIso: 'T1', newToken: 'new-token-new-token-new-token-000', issuer })
    expect(decision.token).toBe('new-token-new-token-new-token-000')
    expect(decision.reissued).toBe(false)
    expect(decision.writes).toEqual([
      { op: 'createToken', token: 'new-token-new-token-new-token-000', doc: { workspaceKey: WS, classroomId: 'C', studentId: 's', createdAt: 'T1', createdByUid: 'mgr', revokedAt: null } },
      { op: 'setOwner', ownerId: 'C__s', doc: { workspaceKey: WS, classroomId: 'C', studentId: 's', token: 'new-token-new-token-new-token-000', updatedAt: 'T1' } },
    ])
  })

  it('有効トークンがあり reissue でなければ既存を返し何も書かない(getOrIssue の冪等性)', () => {
    const decision = resolveIssueDecision({ existingOwner: owner, existingToken: activeOld, reissue: false, nowIso: 'T1', newToken: 'new', issuer })
    expect(decision).toEqual({ token: owner.token, reissued: false, writes: [] })
  })

  it('再発行は旧を revokedReason=reissue で失効させてから新規発行(有効は常に 1 本)', () => {
    const decision = resolveIssueDecision({ existingOwner: owner, existingToken: activeOld, reissue: true, nowIso: 'T1', newToken: 'new-token-new-token-new-token-000', issuer })
    expect(decision.reissued).toBe(true)
    expect(decision.token).toBe('new-token-new-token-new-token-000')
    expect(decision.writes[0]).toEqual({ op: 'revokeToken', token: owner.token, revokedAt: 'T1', revokedReason: 'reissue' })
    expect(decision.writes.map((write) => write.op)).toEqual(['revokeToken', 'createToken', 'setOwner'])
  })

  it('索引はあるが指す先が失効済み／別生徒なら、旧を触らず新規発行(自己修復)', () => {
    const revokedOld = { ...activeOld, revokedAt: 'T0', revokedReason: 'manual' as const }
    const decision = resolveIssueDecision({ existingOwner: owner, existingToken: revokedOld, reissue: false, nowIso: 'T1', newToken: 'n'.repeat(32), issuer })
    expect(decision.reissued).toBe(false)
    expect(decision.writes.map((write) => write.op)).toEqual(['createToken', 'setOwner'])
    const foreign = resolveIssueDecision({ existingOwner: owner, existingToken: { ...activeOld, studentId: 'someone-else' }, reissue: false, nowIso: 'T1', newToken: 'n'.repeat(32), issuer })
    expect(foreign.writes.map((write) => write.op)).toEqual(['createToken', 'setOwner'])
  })

  it('失効: 有効トークンを reason で失効させ索引を消す。無ければ何もしない', () => {
    const decision = resolveRevokeDecision({ existingOwner: owner, existingToken: activeOld, reason: 'studentDeleted', nowIso: 'T1', classroomId: 'C', studentId: 's' })
    expect(decision).toEqual({
      revoked: true,
      writes: [
        { op: 'revokeToken', token: owner.token, revokedAt: 'T1', revokedReason: 'studentDeleted' },
        { op: 'deleteOwner', ownerId: 'C__s' },
      ],
    })
    expect(resolveRevokeDecision({ existingOwner: null, existingToken: null, reason: 'manual', nowIso: 'T1', classroomId: 'C', studentId: 's' })).toEqual({ revoked: false, writes: [] })
    const stale = resolveRevokeDecision({ existingOwner: owner, existingToken: { ...activeOld, revokedAt: 'T0' }, reason: 'manual', nowIso: 'T1', classroomId: 'C', studentId: 's' })
    expect(stale).toEqual({ revoked: false, writes: [{ op: 'deleteOwner', ownerId: 'C__s' }] })
  })
})

// index.ts の配線は import できない(initializeApp)ので文字列で固定する。
describe('index.ts の配線(文字列走査)', () => {
  const source = readIndexSource()

  it('parentPortalApi は onRequest(cors 限定・maxInstances 10) で /api/parent の GET/POST/405 を処理する', () => {
    const start = source.indexOf('export const parentPortalApi = onRequest({')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, start + 4000)
    // CORS は本番/staging/localhost に限定する(全許可 cors:true に戻さない・§G-2「必要最小限」)。
    expect(body).not.toContain('cors: true')
    expect(body).toContain('komahyouapp-prod')
    expect(body).toContain('komahyouapp-staging')
    expect(body).toContain('maxInstances: 10')
    expect(body).toContain("res.set('Cache-Control', 'no-store')")
    expect(body).toContain('handleParentPortalGet(')
    expect(body).toContain('handleParentPortalPost(')
    expect(body).toContain('res.status(405)')
    // GET も無制限にしない(スナップショット読み取り＋解凍の増幅を防ぐ)。
    expect(body).toContain('allowParentPortalGet(token)')
  })

  it('GET のスロットルはインスタンス内メモリで数え、キーはトークンの指紋(全文でない)', () => {
    const start = source.indexOf('function allowParentPortalGet')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, start + 900)
    expect(body).toContain('buildParentPortalTokenFingerprint(token)')
    expect(body).toContain('decideParentPortalGetThrottle(')
    expect(body).toContain('pruneParentPortalGetThrottleKeys(')
  })

  it('回数制限は「読む → 判定 → 許可のときだけ加算」で、拒否時は set を呼ばない', () => {
    const start = source.indexOf('consumeMessageQuota: async')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, start + 1400)
    expect(body).toContain('resolveParentMessageRateLimitOutcome(')
    expect(body).toContain('if (outcome.writes) {')
    // 旧実装(無条件 +1)へ戻していないこと。
    expect(body).not.toContain('incrementRateLimitCounterDoc(')
  })

  it('staging 判定のプロジェクト ID は gen2 で注入されうる名前を順に見る', () => {
    const start = source.indexOf('const PARENT_PORTAL_PROJECT_ID =')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, start + 300)
    expect(body).toContain('GCLOUD_PROJECT')
    expect(body).toContain('GOOGLE_CLOUD_PROJECT')
  })

  it('発行は名簿に生徒が実在することを確かめる(ゴミ文書を作らない)', () => {
    const start = source.indexOf("export const issueStudentPortalToken = onCall")
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, start + 1600)
    expect(body).toContain('requireParentPortalEnabledClassroom(')
    expect(body).toContain('requireParentPortalStudentExists(')
  })

  it('スナップショットは readStoredSnapshotPayload で読み、日程は generated/parentSchedule の権威関数を使う', () => {
    expect(source).toContain("from './generated/parentSchedule'")
    const start = source.indexOf('function buildParentPortalDeps')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, start + 6000)
    expect(body).toContain('readStoredSnapshotPayload(')
    expect(body).toContain('buildParentScheduleView')
    expect(body).toContain('resolveParentScheduleRange')
    expect(body).toContain('isParentStudentActiveOnDate')
    expect(body).toContain("collection('parentPortalRateLimits')")
    expect(body).toContain("collection('parentMessages')")
    expect(body).toContain('runTransaction')
    // トークン・索引はトップレベル(CF 専用)。スナップショット本体への書き込みは無い(読み取り専用・§J-1)。
    const section = source.slice(source.indexOf('// 保護者向け固定QR(生徒別ポータル)'))
    expect(section).toContain("collection('studentPortalTokens')")
    expect(section).toContain("collection('studentPortalTokenOwners')")
    expect(section).not.toContain('createStoredSnapshotDoc(')
  })

  // 2026-09-18(休み連絡専用化)。★ここが崩れると「INTERNAL しか出ない」障害になる。
  it('休み連絡は決定的 ID の create で、範囲検索は absenceKey の単一フィールドだけ(orderBy を足さない)', () => {
    const start = source.indexOf('function buildParentPortalDeps')
    const body = source.slice(start, start + 6000)
    // 既存 doc の確認 → 回数制限 → create の配線。
    expect(body).toContain('hasAbsenceNotice: async')
    expect(body).toContain('loadAbsenceNotices: async')
    expect(body).toContain("where('absenceKey', '>=', startKey)")
    expect(body).toContain("where('absenceKey', '<=', endKey)")
    // ★複合インデックスを要求する並べ替えを足さない(FAILED_PRECONDITION → 画面は INTERNAL・2026-09-12 の教訓)。
    const noticesStart = body.indexOf('loadAbsenceNotices: async')
    const noticesBody = body.slice(noticesStart, noticesStart + 900)
    expect(noticesBody).not.toContain('orderBy(')
    expect(noticesBody).toContain('.limit(PARENT_ABSENCE_NOTICE_QUERY_LIMIT)')
    // create + ALREADY_EXISTS の判別(他の失敗を握り潰さない)。
    expect(body).toContain('.doc(messageId).create(doc)')
    expect(body).toContain('isAlreadyExistsError(error)')
    expect(body).toContain('return { created: false }')
    // 旧実装(ランダム ID)へ戻していないこと = 二重連絡を Firestore が弾けなくなる。
    expect(body).not.toContain('buildParentMessageId(')
  })

  it('既読化は stage/resolution を純関数へ渡し、部分更新(update)で他のフィールドを触らない', () => {
    const start = source.indexOf('export const markParentMessagesNotified = onCall')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, start + 2200)
    expect(body).toContain('resolveParentMessageMarkWrites(')
    expect(body).toContain('stage, resolution, nowIso:')
    expect(body).toContain('acknowledgedAt: snapshot.data()?.acknowledgedAt')
    expect(body).toContain('batch.update(collection.doc(write.id), write.update)')
    // set(…, { merge: true }) ではなく update(部分更新)を使う(INV-07)。
    expect(body).not.toContain('batch.set(')
  })

  it('callable 3 本は invoker public + requireClassroomAccessMember + HttpsError(internal) 包み', () => {
    for (const name of ['issueStudentPortalToken', 'revokeStudentPortalToken', 'markParentMessagesNotified']) {
      const start = source.indexOf(`export const ${name} = onCall({ invoker: 'public'`)
      expect(start, name).toBeGreaterThan(-1)
      const body = source.slice(start, start + 4000)
      expect(body, name).toContain('requireClassroomAccessMember(request.auth?.uid')
      expect(body, name).toContain('toParentPortalHttpsError(')
    }
    expect(source).toContain("new HttpsError('internal'")
  })

  it('ログにトークン全文・本文・生徒名を出さない(tokenPrefix だけ)', () => {
    const start = source.indexOf('// 保護者向け固定QR')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start)
    const logCalls = body.match(/logger\.(info|warn|error)\([^)]*\)/g) ?? []
    expect(logCalls.length).toBeGreaterThan(0)
    for (const call of logCalls) {
      expect(call).not.toMatch(/\btoken\b(?!Prefix)/)
      expect(call).not.toContain('studentName')
      expect(call).not.toContain('doc.body')
    }
  })

  it('retention: parentMessages 365 日・parentPortalRateLimits 7 日を cutoff/deleted に配線している', () => {
    expect(source).toContain("const PARENT_MESSAGE_RETENTION_DAYS = Math.max(30, Math.trunc(Number(process.env.PARENT_MESSAGE_RETENTION_DAYS)) || 365)")
    expect(source).toContain("const PARENT_PORTAL_RATE_LIMIT_RETENTION_DAYS = Math.max(1, Math.trunc(Number(process.env.PARENT_PORTAL_RATE_LIMIT_RETENTION_DAYS)) || 7)")
    expect(source).toContain('parentMessages: resolveRetentionCutoffIso(startedAtMs, PARENT_MESSAGE_RETENTION_DAYS)')
    expect(source).toContain('parentPortalRateLimits: resolveRetentionCutoffIso(startedAtMs, PARENT_PORTAL_RATE_LIMIT_RETENTION_DAYS)')
  })
})
