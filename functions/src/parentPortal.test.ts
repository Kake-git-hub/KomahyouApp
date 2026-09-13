// 保護者向け固定QR(サーバー側純ロジック)のテスト。docs/spec-parent-portal.md §I K-2/K-4/K-5 の受け入れ条件と
// k_contract §1 の検証順を固定する。index.ts は import しない(initializeApp が走る)。配線は文字列走査で検査する。
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import {
  buildParentMessageDoc,
  buildParentMessageId,
  buildParentMessageRateLimitKeys,
  buildParentPortalTokenFingerprint,
  buildStudentPortalOwnerId,
  containsUrlLike,
  countCharacters,
  decideParentMessageRateLimit,
  decideParentPortalGetThrottle,
  PARENT_PORTAL_GET_THROTTLE_LIMIT,
  PARENT_PORTAL_GET_THROTTLE_WINDOW_MS,
  pruneParentPortalGetThrottleKeys,
  resolveParentMessageRateLimitOutcome,
  findParentPortalStudent,
  generateStudentPortalToken,
  handleParentPortalGet,
  handleParentPortalPost,
  incrementRateLimitCounterDoc,
  isParentPortalEnabledForClassroom,
  isStudentPortalTokenActive,
  isValidParentPortalToken,
  normalizeIssueRequest,
  normalizeMarkNotifiedRequest,
  normalizeParentMessageInput,
  normalizeRevokeRequest,
  PARENT_MESSAGE_BODY_LIMIT,
  PARENT_MESSAGE_DAILY_LIMIT_PER_TOKEN,
  PARENT_MESSAGE_ERROR_BODY_EMPTY,
  PARENT_MESSAGE_ERROR_BODY_TOO_LONG,
  PARENT_MESSAGE_ERROR_INVALID_INPUT,
  PARENT_MESSAGE_ERROR_SENDER_NAME_TOO_LONG,
  PARENT_MESSAGE_HOURLY_LIMIT_PER_CLASSROOM,
  PARENT_MESSAGE_MARK_NOTIFIED_MAX_IDS,
  PARENT_MESSAGE_RATE_LIMIT_ERROR,
  PARENT_MESSAGE_SENDER_NAME_LIMIT,
  PARENT_PORTAL_ERROR_DISABLED,
  PARENT_PORTAL_ERROR_GONE,
  PARENT_PORTAL_ERROR_INVALID_TOKEN,
  PARENT_PORTAL_TOKEN_PATTERN,
  readStudentPortalOwnerDoc,
  readStudentPortalTokenDoc,
  resolveIssueDecision,
  resolveJstRateLimitPeriods,
  resolveRevokeDecision,
  selectParentMessageIdsToMarkNotified,
  stripAllControlCharacters,
  stripControlCharactersExceptNewlineAndTab,
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

function createDeps(overrides: Partial<ParentPortalDeps> = {}): ParentPortalDeps & {
  loadSnapshot: ReturnType<typeof vi.fn>
  saveMessage: ReturnType<typeof vi.fn>
  consumeMessageQuota: ReturnType<typeof vi.fn>
} {
  const loadSnapshot = vi.fn(async () => ({ payload: snapshotPayload, savedAt: '2026-09-12T10:00:00.000Z' }))
  const saveMessage = vi.fn(async () => ({ id: 'm1' }))
  const consumeMessageQuota = vi.fn(async () => ({ allowed: true }))
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
      bounds: { minFrom: '2026-07-19', maxTo: '2026-12-06' },
    }),
    isStudentActive: (student, dateKey) => {
      const withdraw = typeof student.withdrawDate === 'string' ? student.withdrawDate : ''
      return !withdraw || withdraw >= dateKey
    },
    isEnabled: ({ id, name }) => isParentPortalEnabledForClassroom({ id, name, projectId: 'komahyouapp-prod' }),
    todayJst: () => '2026-09-13',
    nowIso: () => '2026-09-13T01:23:45.000Z',
    consumeMessageQuota,
    saveMessage,
    ...overrides,
  } as ParentPortalDeps & { loadSnapshot: ReturnType<typeof vi.fn>; saveMessage: ReturnType<typeof vi.fn>; consumeMessageQuota: ReturnType<typeof vi.fn> }
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
  it('開発用教室・テスト教室で有効(判定はクライアントの staging-environment スコープと同一)', () => {
    expect(isParentPortalEnabledForClassroom({ id: 'v8OZ7zH8vONNHjjYVcR1', name: '開発用教室', projectId: 'komahyouapp-prod' })).toBe(true)
    expect(isParentPortalEnabledForClassroom({ id: 'xxx', name: '開発用教室', projectId: 'komahyouapp-prod' })).toBe(true)
    expect(isParentPortalEnabledForClassroom({ id: 'development', name: '', projectId: 'komahyouapp-prod' })).toBe(true)
    expect(isParentPortalEnabledForClassroom({ id: 'test_classroom_20260507_dai', name: 'テスト教室', projectId: 'komahyouapp-prod' })).toBe(true)
    // ★本番の開発用教室 ID 単独では有効にしない: クライアントの SANDBOX_CLASSROOM_IDS に無く、
    //   片側だけ広いと「QR は出ないのに API は答える」非対称になる(教室名で両側同時に判定する)。
    expect(isParentPortalEnabledForClassroom({ id: 'v8OZ7zH8vONNHjjYVcR1', name: '名前を変えた教室', projectId: 'komahyouapp-prod' })).toBe(false)
  })

  it('本番教室(日大前/緑が丘/薬円台)は無効(昇格はクライアント側フラグと同時に行う)', () => {
    for (const [id, name] of [['5w5OMueETerSKrSf14HC', 'スクールIE 日大前校'], ['KzFnOQoTFLsCxwUp1tvh', 'スクールIE 緑が丘校'], ['6xnnbSTbwgGrBLy0EJKb', 'スクールIE 薬円台校']]) {
      expect(isParentPortalEnabledForClassroom({ id, name, projectId: 'komahyouapp-prod' }), id).toBe(false)
    }
  })

  it('staging プロジェクトでは全教室で有効', () => {
    expect(isParentPortalEnabledForClassroom({ id: '5w5OMueETerSKrSf14HC', name: '本番相当', projectId: 'komahyouapp-staging' })).toBe(true)
    expect(isParentPortalEnabledForClassroom({ id: '5w5OMueETerSKrSf14HC', name: '本番相当', projectId: undefined })).toBe(false)
  })
})

describe('連絡本文の正規化(§E-1・P-3)', () => {
  it('改行・タブ以外の制御文字を落とし、CRLF を LF に寄せる', () => {
    expect(stripControlCharactersExceptNewlineAndTab('a\u0001b\u0007c\r\nd\tefg\u007f')).toBe('abc\nd\tefg')
    expect(stripAllControlCharacters('a\nb\tc\u0000d')).toBe('abcd')
  })

  it('文字数はコードポイントで数える', () => {
    expect(countCharacters('𠮷野家')).toBe(3)
    expect(countCharacters('abc')).toBe(3)
  })

  it('本文 0 字は 400 相当', () => {
    expect(normalizeParentMessageInput({ body: '' })).toEqual({ ok: false, error: PARENT_MESSAGE_ERROR_BODY_EMPTY })
    expect(normalizeParentMessageInput({ body: '   \n  ' })).toEqual({ ok: false, error: PARENT_MESSAGE_ERROR_BODY_EMPTY })
    expect(normalizeParentMessageInput({})).toEqual({ ok: false, error: PARENT_MESSAGE_ERROR_BODY_EMPTY })
    expect(normalizeParentMessageInput({ body: 123 })).toEqual({ ok: false, error: PARENT_MESSAGE_ERROR_BODY_EMPTY })
  })

  it('制御文字のみの本文は 0 字扱いで不可', () => {
    expect(normalizeParentMessageInput({ body: '\u0001\u0002\u001b\u007f' })).toEqual({ ok: false, error: PARENT_MESSAGE_ERROR_BODY_EMPTY })
  })

  it('500 字ちょうどは成功・501 字は不可(境界)', () => {
    const exact = 'あ'.repeat(PARENT_MESSAGE_BODY_LIMIT)
    const result = normalizeParentMessageInput({ body: exact })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.body).toBe(exact)
    expect(normalizeParentMessageInput({ body: 'あ'.repeat(PARENT_MESSAGE_BODY_LIMIT + 1) })).toEqual({ ok: false, error: PARENT_MESSAGE_ERROR_BODY_TOO_LONG })
  })

  it('制御文字を除いてから数える(制御文字込みで 501 でも除去後 500 なら成功)', () => {
    const result = normalizeParentMessageInput({ body: 'あ'.repeat(PARENT_MESSAGE_BODY_LIMIT) + '\u0001' })
    expect(result.ok).toBe(true)
  })

  it('送信者名は任意。0 字・30 字は可、31 字は不可、文字列以外は不可', () => {
    const noName = normalizeParentMessageInput({ body: 'こんにちは' })
    expect(noName).toEqual({ ok: true, body: 'こんにちは', senderName: '', containsUrl: false })
    const nullName = normalizeParentMessageInput({ body: 'こんにちは', senderName: null })
    expect(nullName.ok && nullName.senderName).toBe('')
    const max = normalizeParentMessageInput({ body: 'x', senderName: 'あ'.repeat(PARENT_MESSAGE_SENDER_NAME_LIMIT) })
    expect(max.ok).toBe(true)
    expect(normalizeParentMessageInput({ body: 'x', senderName: 'あ'.repeat(PARENT_MESSAGE_SENDER_NAME_LIMIT + 1) })).toEqual({ ok: false, error: PARENT_MESSAGE_ERROR_SENDER_NAME_TOO_LONG })
    expect(normalizeParentMessageInput({ body: 'x', senderName: 42 })).toEqual({ ok: false, error: PARENT_MESSAGE_ERROR_INVALID_INPUT })
  })

  it('送信者名は 1 行(改行・制御文字を落として前後空白を除く)', () => {
    const result = normalizeParentMessageInput({ body: 'x', senderName: '  山田\n\t母 ' })
    expect(result.ok && result.senderName).toBe('山田母')
  })

  it('本文以外の形(配列・null・壊れた JSON 文字列)は不可。JSON 文字列は一度だけ解釈する', () => {
    expect(normalizeParentMessageInput(null)).toEqual({ ok: false, error: PARENT_MESSAGE_ERROR_INVALID_INPUT })
    expect(normalizeParentMessageInput([])).toEqual({ ok: false, error: PARENT_MESSAGE_ERROR_INVALID_INPUT })
    expect(normalizeParentMessageInput('{bad json')).toEqual({ ok: false, error: PARENT_MESSAGE_ERROR_INVALID_INPUT })
    expect(normalizeParentMessageInput(JSON.stringify({ body: '欠席します' }))).toEqual({ ok: true, body: '欠席します', senderName: '', containsUrl: false })
  })

  it('URL らしき文字列を検出して containsUrl を立てる', () => {
    expect(containsUrlLike('明日は休みます')).toBe(false)
    expect(containsUrlLike('ここを見て https://example.com/x')).toBe(true)
    expect(containsUrlLike('www.example.jp です')).toBe(true)
    expect(containsUrlLike('example.co.jp/page')).toBe(true)
    expect(containsUrlLike('16:00からです。')).toBe(false)
    const result = normalizeParentMessageInput({ body: 'http://evil.example' })
    expect(result.ok && result.containsUrl).toBe(true)
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

  it('保存済み 4 件までは許可・5 件保存済み(=6 件目)から拒否(加算前の値で判定)', () => {
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

describe('連絡文書(§E-1)', () => {
  it('tokenPrefix は先頭 6 文字・notifiedAt は null・classroomId/studentId は渡した(トークン doc の)値', () => {
    const doc = buildParentMessageDoc({
      workspaceKey: WS, classroomId: 'C', studentId: 's', studentName: '山田太', body: '休みます', senderName: '母', containsUrl: false, createdAt: 'T', token: TOKEN,
    })
    expect(doc).toEqual({
      workspaceKey: WS, classroomId: 'C', studentId: 's', studentName: '山田太', body: '休みます', senderName: '母', createdAt: 'T', notifiedAt: null, containsUrl: false, tokenPrefix: 'AbCdEf',
    })
    expect(JSON.stringify(doc)).not.toContain(TOKEN)
  })

  it('文書 ID は時系列に並び、ID の形の検証を通る', () => {
    const id = buildParentMessageId('2026-09-13T01:23:45.678Z', 'abc123')
    expect(id).toBe('2026-09-13T01-23-45-678Z-abc123')
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: [id] }).ok).toBe(true)
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

  it('在籍判定は deps.todayJst の日付で行う(退塾日当日は可・翌日は不可 = P-6)', async () => {
    const anyStudentView = () => ({ studentName: '佐藤', days: [] })
    const onWithdrawDay = createDeps({ loadToken: async () => ({ ...activeTokenDoc, studentId: 's002' }), todayJst: () => '2026-08-31', buildScheduleView: anyStudentView })
    expect((await handleParentPortalGet({ token: TOKEN }, onWithdrawDay)).status).toBe(200)
    const nextDay = createDeps({ loadToken: async () => ({ ...activeTokenDoc, studentId: 's002' }), todayJst: () => '2026-09-01', buildScheduleView: anyStudentView })
    expect((await handleParentPortalGet({ token: TOKEN }, nextDay)).status).toBe(410)
  })

  it('検証を通ると 200 で契約どおりのキーだけを返す(講師名・机・ID・トークンを含めない)', async () => {
    const deps = createDeps()
    const result = await handleParentPortalGet({ token: TOKEN, from: '2026-09-06', to: '2026-10-11' }, deps)
    expect(result.status).toBe(200)
    const body = result.body as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['bounds', 'classroomName', 'days', 'range', 'snapshotSavedAt', 'studentName', 'today'])
    expect(body.studentName).toBe('山田太')
    expect(body.classroomName).toBe('開発用教室')
    expect(body.snapshotSavedAt).toBe('2026-09-12T10:00:00.000Z')
    expect(body.today).toBe('2026-09-13')
    expect(body.range).toEqual({ from: '2026-09-06', to: '2026-10-11' })
    expect(body.bounds).toEqual({ minFrom: '2026-07-19', maxTo: '2026-12-06' })
    const json = JSON.stringify(body)
    for (const forbidden of [TOKEN, STUDENT_ID, CLASSROOM_ID, 'teacher', 'desk', 'stock', '講師 秘密', '佐藤', 'mgr-uid', 'createdByUid']) {
      expect(json, forbidden).not.toContain(forbidden)
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

  it('buildScheduleView が null(生徒無し)なら 410', async () => {
    const deps = createDeps({ buildScheduleView: () => null })
    expect((await handleParentPortalGet({ token: TOKEN }, deps)).status).toBe(410)
  })
})

describe('handleParentPortalPost: 検証順・400/429・保存内容', () => {
  it('GET と同じ検証順(400/410/403)で、落ちたときは本文検証もカウンタ加算も保存もしない', async () => {
    const invalid = createDeps()
    expect((await handleParentPortalPost({ token: 'bad', rawBody: { body: 'x' } }, invalid)).status).toBe(400)
    const gone = createDeps({ loadToken: async () => null })
    expect((await handleParentPortalPost({ token: TOKEN, rawBody: { body: 'x' } }, gone)).status).toBe(410)
    const off = createDeps({ loadClassroom: async () => ({ name: '本番校' }), loadToken: async () => ({ ...activeTokenDoc, classroomId: 'prod' }) })
    expect((await handleParentPortalPost({ token: TOKEN, rawBody: { body: 'x' } }, off)).status).toBe(403)
    for (const deps of [invalid, gone, off]) {
      expect(deps.consumeMessageQuota).not.toHaveBeenCalled()
      expect(deps.saveMessage).not.toHaveBeenCalled()
    }
    expect(gone.loadSnapshot).not.toHaveBeenCalled()
    expect(off.loadSnapshot).not.toHaveBeenCalled()
  })

  it('本文 0 字・501 字・制御文字のみ・送信者名 31 字は 400 で、枠を消費しない', async () => {
    for (const rawBody of [{ body: '' }, { body: 'あ'.repeat(501) }, { body: '\u0001\u0002' }, { body: 'x', senderName: 'あ'.repeat(31) }]) {
      const deps = createDeps()
      const result = await handleParentPortalPost({ token: TOKEN, rawBody }, deps)
      expect(result.status, JSON.stringify(rawBody).slice(0, 30)).toBe(400)
      expect(deps.consumeMessageQuota).not.toHaveBeenCalled()
      expect(deps.saveMessage).not.toHaveBeenCalled()
    }
  })

  it('500 字ちょうどは成功', async () => {
    const deps = createDeps()
    const result = await handleParentPortalPost({ token: TOKEN, rawBody: { body: 'あ'.repeat(500) } }, deps)
    expect(result).toEqual({ status: 200, body: { ok: true, createdAt: '2026-09-13T01:23:45.000Z' } })
  })

  it('枠が空いていれば保存し、枠が尽きていたら 429(保存しない)', async () => {
    const allowed = createDeps()
    expect((await handleParentPortalPost({ token: TOKEN, rawBody: { body: 'x' } }, allowed)).status).toBe(200)
    expect(allowed.saveMessage).toHaveBeenCalledTimes(1)

    const denied = createDeps({ consumeMessageQuota: vi.fn(async () => ({ allowed: false, error: PARENT_MESSAGE_RATE_LIMIT_ERROR })) })
    const result = await handleParentPortalPost({ token: TOKEN, rawBody: { body: 'x' } }, denied)
    expect(result).toEqual({ status: 429, body: { error: PARENT_MESSAGE_RATE_LIMIT_ERROR } })
    expect(denied.saveMessage).not.toHaveBeenCalled()
  })

  it('カウンタのキーはトークンの指紋(全文ではない)と JST 日・時で組み、教室はトークン doc 由来', async () => {
    const deps = createDeps()
    await handleParentPortalPost({ token: TOKEN, rawBody: { body: 'x' } }, deps)
    expect(deps.consumeMessageQuota).toHaveBeenCalledWith({
      workspaceKey: WS,
      classroomId: CLASSROOM_ID,
      tokenDayKey: `t${buildParentPortalTokenFingerprint(TOKEN)}__2026-09-13`,
      classroomHourKey: 'classroom__2026-09-13T10',
    })
    // ★文書 ID にトークン全文を入れない(Firestore の例外メッセージがパスを含み、ログへ流れる・§G-1)。
    const keys = deps.consumeMessageQuota.mock.calls[0][0] as { tokenDayKey: string; classroomHourKey: string }
    expect(keys.tokenDayKey).not.toContain(TOKEN)
    expect(keys.classroomHourKey).not.toContain(TOKEN)
  })

  it('保存する classroomId / studentId はリクエスト body ではなくトークン doc 由来。studentName はスナップショットの表示名', async () => {
    const deps = createDeps()
    await handleParentPortalPost({
      token: TOKEN,
      rawBody: { body: '明日は休みます', senderName: '山田母', classroomId: 'EVIL', studentId: 'EVIL' },
    }, deps)
    expect(deps.saveMessage).toHaveBeenCalledTimes(1)
    const [call] = deps.saveMessage.mock.calls as unknown as Array<[{ workspaceKey: string; classroomId: string; doc: Record<string, unknown> }]>
    expect(call[0].workspaceKey).toBe(WS)
    expect(call[0].classroomId).toBe(CLASSROOM_ID)
    expect(call[0].doc).toEqual({
      workspaceKey: WS,
      classroomId: CLASSROOM_ID,
      studentId: STUDENT_ID,
      studentName: '山田太',
      body: '明日は休みます',
      senderName: '山田母',
      createdAt: '2026-09-13T01:23:45.000Z',
      notifiedAt: null,
      containsUrl: false,
      tokenPrefix: 'AbCdEf',
    })
    expect(JSON.stringify(call[0].doc)).not.toContain('EVIL')
  })

  it('表示名が無ければ name を使う', async () => {
    const deps = createDeps({
      loadSnapshot: vi.fn(async () => ({ payload: { students: [{ id: STUDENT_ID, name: '鈴木 一郎', displayName: '  ' }] }, savedAt: null })),
    })
    await handleParentPortalPost({ token: TOKEN, rawBody: { body: 'x' } }, deps)
    const [call] = deps.saveMessage.mock.calls as unknown as Array<[{ doc: { studentName: string } }]>
    expect(call[0].doc.studentName).toBe('鈴木 一郎')
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
    expect(ok).toEqual({ ok: true, value: { workspaceKey: WS, classroomId: 'C', messageIds: ['m1', 'm2'] } })
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: [] }).ok).toBe(false)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: 'm1' }).ok).toBe(false)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: ['a/b'] }).ok).toBe(false)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: [''] }).ok).toBe(false)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: [1] }).ok).toBe(false)
    const fifty = Array.from({ length: PARENT_MESSAGE_MARK_NOTIFIED_MAX_IDS }, (_, index) => `m${index}`)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: fifty }).ok).toBe(true)
    expect(normalizeMarkNotifiedRequest({ workspaceKey: WS, classroomId: 'C', messageIds: [...fifty, 'extra'] }).ok).toBe(false)
  })

  it('selectParentMessageIdsToMarkNotified: 実在し未読(null)の文書だけ(既読は上書きしない)', () => {
    expect(selectParentMessageIdsToMarkNotified([
      { id: 'a', exists: true, notifiedAt: null },
      { id: 'b', exists: true, notifiedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'c', exists: false, notifiedAt: null },
      { id: 'd', exists: true, notifiedAt: undefined },
    ])).toEqual(['a', 'd'])
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
