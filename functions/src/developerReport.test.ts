import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  DEVELOPER_REPORT_CATEGORIES,
  DEVELOPER_REPORT_MAIL_TRACE_LINES,
  buildDeveloperReportMail,
  isDeveloperReportTestNote,
  isMailTransportConfigured,
  isVerificationChecklistNote,
  isVerificationChecklistReport,
  resolveDeveloperReportMailSkipReason, shouldSendDeveloperReportMailOnWrite,
  normalizeDeveloperReportCategory,
  DEVELOPER_REPORT_NOTE_LIMIT,
  DEVELOPER_REPORT_TRACE_KINDS,
  DEVELOPER_REPORT_AUTO_ERROR_MARKER,
  isAutoErrorReportNote,
  DEVELOPER_REPORT_TRACE_LIMIT,
  buildDeveloperReportAttachmentStoragePath,
  buildDeveloperReportId,
  buildDeveloperReportStoragePath,
  DEVELOPER_REPORT_ATTACHMENT_LIMIT,
  DEVELOPER_REPORT_ATTACHMENT_MAX_BYTES,
  DEVELOPER_REPORT_ATTACHMENT_TOTAL_MAX_BYTES,
  normalizeDeveloperReport,
  normalizeDeveloperReportAttachments,
  DEVELOPER_REPORT_MODAL_ATTACHMENT_LIMIT,
  DEVELOPER_REPORT_MAIL_ATTACHMENT_MAX_BYTES,
  resolveDeveloperReportAttachmentLimit,
  selectDeveloperReportMailAttachment,
  buildDeveloperReportMailAttachmentLines,
  matchesImageMagicBytes,
  parseImageDataUrl,
  normalizeDeveloperReportTrace,
  trimDeveloperReportTraceToBudget,
} from './developerReport'

const FALLBACK = '2026-09-04T03:00:00.000Z'

describe('developerReport(server): 操作痕跡の正規化', () => {
  it('クライアント(src/utils/operationTrace.ts)の種別一覧と一致する(片方だけ足すとサーバーが黙って捨てる)', () => {
    expect([...DEVELOPER_REPORT_TRACE_KINDS]).toEqual(['board-commit', 'board-rebuild', 'undo', 'redo', 'save', 'operation-event', 'schedule-message', 'navigation', 'auto', 'error'])
  })

  it('壊れた要素だけ捨て、残りは通す。上限超過は新しい方を残す', () => {
    const raw = [
      { at: '2026-09-04T01:00:00.000Z', kind: 'board-commit', summary: ' ok ' },
      { at: 'bad-date', kind: 'undo', summary: 'fallback time' },
      { at: '2026-09-04T01:00:00.000Z', kind: 'unknown-kind', summary: 'drop' },
      { at: '2026-09-04T01:00:00.000Z', kind: 'save', summary: '' },
      'not-an-object',
      null,
    ]
    expect(normalizeDeveloperReportTrace(raw, { fallbackIso: FALLBACK })).toEqual([
      { at: '2026-09-04T01:00:00.000Z', kind: 'board-commit', summary: 'ok' },
      { at: FALLBACK, kind: 'undo', summary: 'fallback time' },
    ])
    expect(normalizeDeveloperReportTrace('nope', { fallbackIso: FALLBACK })).toEqual([])

    const many = Array.from({ length: DEVELOPER_REPORT_TRACE_LIMIT + 5 }, (_, i) => ({ at: FALLBACK, kind: 'save', summary: `op-${i}` }))
    const normalized = normalizeDeveloperReportTrace(many, { fallbackIso: FALLBACK })
    expect(normalized).toHaveLength(DEVELOPER_REPORT_TRACE_LIMIT)
    expect(normalized[0]?.summary).toBe('op-5')
  })

  it('合計文字数の予算を超えたら古い方から落とす(Firestore 1MiB 対策)', () => {
    const entries = Array.from({ length: 10 }, () => ({ at: FALLBACK, kind: 'save' as const, summary: 'x'.repeat(100) }))
    const kept = trimDeveloperReportTraceToBudget(entries, 3 * (100 + 4 + FALLBACK.length))
    expect(kept).toHaveLength(3)
    expect(kept).toEqual(entries.slice(-3))
  })
})

describe('developerReport(server): 報告本体の正規化', () => {
  it('文字列を切り詰め、boolean/日時を検証し、教室 id は呼び出し側の値を使う', () => {
    const report = normalizeDeveloperReport({
      classroomId: 'attacker-supplied',
      source: 'schedule',
      note: `  ${'n'.repeat(DEVELOPER_REPORT_NOTE_LIMIT + 50)}  `,
      reportedAt: 'garbage',
      appVersion: '1.5.490',
      userAgent: 'ua',
      pageUrl: 'https://komahyouapp-prod.web.app/',
      screen: 'board',
      boardDirty: 'yes',
      lastSavedAt: '2026-09-04T02:00:00.000Z',
      recentOperations: [{ at: FALLBACK, kind: 'save', summary: 's' }],
      scheduleContext: { viewType: 'student', nested: { a: 1 } },
      snapshotPayload: { screen: 'board' },
    }, { classroomId: 'c1', fallbackIso: FALLBACK })
    expect(report.classroomId).toBe('c1')
    expect(report.source).toBe('schedule')
    expect(report.category).toBe('bug')
    expect(report.isTest).toBe(false)
    expect(report.note).toHaveLength(DEVELOPER_REPORT_NOTE_LIMIT)
    expect(report.reportedAt).toBe(FALLBACK)
    expect(report.boardDirty).toBe(false)
    expect(report.lastSavedAt).toBe('2026-09-04T02:00:00.000Z')
    expect(report.recentOperations).toHaveLength(1)
    expect(report.scheduleContext).toEqual({ viewType: 'student' })
    expect(report.hasSnapshotPayload).toBe(true)
  })

  it('種類は bug/request/question のみ、#テスト を含む内容はテスト扱い', () => {
    expect(normalizeDeveloperReportCategory('request')).toBe('request')
    expect(normalizeDeveloperReportCategory('question')).toBe('question')
    // クライアント側(src/utils/developerReport.ts)と二重管理。期待一覧を両方のテストに同じ形で固定する(ドリフト検知)。
    expect([...DEVELOPER_REPORT_CATEGORIES]).toEqual(['bug', 'request', 'question'])
    expect(normalizeDeveloperReportCategory('zzz')).toBe('bug')
    expect(isDeveloperReportTestNote('#テスト 動作確認')).toBe(true)
    expect(isDeveloperReportTestNote('確認 #TEST')).toBe(true)
    expect(isDeveloperReportTestNote('テストの振替が消えた')).toBe(false)
    const report = normalizeDeveloperReport({ category: 'request', note: '要望 #テスト' }, { classroomId: 'c1', fallbackIso: FALLBACK })
    expect(report.category).toBe('request')
    expect(report.isTest).toBe(true)
  })

  it('生徒×科目の台帳(妥協案 B・2026-10-16)は形を検証して受け、壊れた行・トークンは捨て、無ければ null', () => {
    const report = normalizeDeveloperReport({
      category: 'question',
      note: '山田太郎さんの振替は？',
      studentLedger: {
        computedAt: '2026-10-16T03:00:00.000Z',
        rows: [
          { studentId: 's001', name: ' 山田 太郎 ', subject: '数', makeupBalance: 2.7, makeupRemaining: ['2026-10-03#2|休み', 'not-a-token', 42], attended: [], absent: ['2026-10-03#2|regular'], absentNoMakeup: 'x', placed: ['2026-10-20#3|makeup|2026-10-03|2'] },
          { name: '', subject: '英' },
          'garbage',
        ],
        lectureRows: [{ studentId: 's001', name: '山田 太郎', sessionLabel: '夏期講習', subject: '英', pending: -1, origins: ['2026-08-01#1'] }],
      },
    }, { classroomId: 'c1', fallbackIso: FALLBACK })
    expect(report.studentLedger).toEqual({
      computedAt: '2026-10-16T03:00:00.000Z',
      rows: [{ studentId: 's001', name: '山田 太郎', subject: '数', makeupBalance: 2, makeupRemaining: ['2026-10-03#2|休み'], attended: [], absent: ['2026-10-03#2|regular'], absentNoMakeup: [], placed: ['2026-10-20#3|makeup|2026-10-03|2'] }],
      lectureRows: [{ studentId: 's001', name: '山田 太郎', sessionLabel: '夏期講習', subject: '英', pending: 0, origins: ['2026-08-01#1'] }],
    })
    expect(normalizeDeveloperReport({ note: 'x' }, { classroomId: 'c1', fallbackIso: FALLBACK }).studentLedger).toBeNull()
    expect(normalizeDeveloperReport({ note: 'x', studentLedger: { rows: [], lectureRows: [] } }, { classroomId: 'c1', fallbackIso: FALLBACK }).studentLedger).toBeNull()
    expect(normalizeDeveloperReport({ note: 'x', studentLedger: [] }, { classroomId: 'c1', fallbackIso: FALLBACK }).studentLedger).toBeNull()
  })

  it('source が不明なら board、snapshotPayload が配列/欠落なら無し扱い', () => {
    const report = normalizeDeveloperReport({ source: 'x', snapshotPayload: [] }, { classroomId: 'c1', fallbackIso: FALLBACK })
    expect(report.source).toBe('board')
    expect(report.hasSnapshotPayload).toBe(false)
    expect(report.note).toBe('')
    expect(report.lastSavedAt).toBe('')
  })
})

describe('developerReport(server): id と Storage パス', () => {
  it('id は時刻由来＋乱数で、パスに使える文字だけ', () => {
    const id = buildDeveloperReportId('2026-09-04T03:04:05.678Z', 'ab/c?d1e2f3g4h5')
    expect(id).toBe('20260904-030405678-abcd1e2f')
    expect(buildDeveloperReportStoragePath('main', 'v8OZ7zH8vONNHjjYVcR1', id)).toBe(`developer-reports/main/v8OZ7zH8vONNHjjYVcR1/${id}.json.gz`)
  })

  it('パス区切りなどの危険な文字を含むセグメントは拒否する', () => {
    expect(() => buildDeveloperReportStoragePath('main/../x', 'c1', 'r1')).toThrow()
    expect(() => buildDeveloperReportStoragePath('main', 'c 1', 'r1')).toThrow()
    expect(() => buildDeveloperReportStoragePath('main', 'c1', '')).toThrow()
  })
})

describe('developerReport(server): メール即時通知の本文', () => {
  const base = {
    reportId: 'r1',
    classroomId: 'KzFnOQoTFLsCxwUp1tvh',
    classroomName: 'スクールIE 緑が丘校',
    source: 'schedule',
    category: 'request',
    note: '講師日程表にも電話番号の欄がほしい\n2行目',
    reportedAt: '2026-09-04T03:04:05.000Z',
    recordedAt: '2026-09-04T03:04:06.000Z',
    appVersion: '1.5.494',
    reporterRole: 'manager',
    boardDirty: true,
    lastSavedAt: '2026-09-04T02:00:00.000Z',
    scheduleContext: { viewType: 'teacher', personLabel: '佐藤', search: '' },
    recentOperations: Array.from({ length: DEVELOPER_REPORT_MAIL_TRACE_LINES + 5 }, (_, i) => ({ at: FALLBACK, kind: 'board-commit', summary: `op-${i} 青木#s012` })),
    recentOperationCount: DEVELOPER_REPORT_MAIL_TRACE_LINES + 5,
    snapshotStoragePath: 'developer-reports/main/KzFnOQoTFLsCxwUp1tvh/r1.json.gz',
  }
  const options = { workspaceKey: 'main', projectId: 'komahyouapp-prod', storageBucket: 'komahyouapp-prod.firebasestorage.app' }

  it('件名に教室・種類・内容の先頭、本文にメタ・内容・許可ルール・操作痕跡(新しい順・上限件数)・置き場所を載せる', () => {
    const mail = buildDeveloperReportMail(base, options)
    expect(mail.subject).toBe('[コマ表アプリ 要望・報告] スクールIE 緑が丘校 / 追加してほしい・要望: 講師日程表にも電話番号の欄がほしい')
    expect(mail.text).toContain('種類: 追加してほしい・要望')
    expect(mail.text).toContain('報告元: 日程表(別タブ)')
    expect(mail.text).toContain('2026-09-04 12:04:05 JST')
    expect(mail.text).toContain('講師日程表にも電話番号の欄がほしい\n2行目')
    expect(mail.text).toContain('勝手に修正を始めない')
    expect(mail.text).toContain('  - personLabel: 佐藤')
    expect(mail.text).not.toContain('search:')
    // 私的経路なので操作痕跡(生徒名+ID)を載せる。新しい方から上限件数。
    expect(mail.text).toContain(`新しい方から ${DEVELOPER_REPORT_MAIL_TRACE_LINES} 件 / 全 ${DEVELOPER_REPORT_MAIL_TRACE_LINES + 5} 件`)
    expect(mail.text).toContain(`op-${DEVELOPER_REPORT_MAIL_TRACE_LINES + 4} 青木#s012`)
    expect(mail.text).not.toContain('op-4 青木')
    expect(mail.text.indexOf(`op-${DEVELOPER_REPORT_MAIL_TRACE_LINES + 4}`)).toBeLessThan(mail.text.indexOf('op-5 '))
    expect(mail.text).toContain('workspaces/main/developerReports/r1')
    expect(mail.text).toContain('gsutil cp "gs://komahyouapp-prod.firebasestorage.app/developer-reports/main/KzFnOQoTFLsCxwUp1tvh/r1.json.gz"')
    expect(mail.text).not.toContain('【テスト】')
  })

  it('質問(question・2026-09-13)は件名に【質問】が付き、本文に AI の自動回答の節と「訂正回答は開発者画面から」の進め方が載る(2026-10-16 夜)', () => {
    // AI を呼んでいない質問(本番教室): 「なし」の節と【質問】。
    const mail = buildDeveloperReportMail({ ...base, category: 'question', note: '休みにした生徒の振替先を後から変えるには？' }, options)
    expect(mail.subject).toBe('【質問】[コマ表アプリ 要望・報告] スクールIE 緑が丘校 / 使い方の質問: 休みにした生徒の振替先を後から変えるには？')
    expect(mail.text).toContain('種類: 使い方の質問')
    expect(mail.text).toContain('■ AI の自動回答: なし(この教室では AI を呼んでいない')
    expect(mail.text).toContain('訂正・補足が要れば開発者画面「質問への回答」から送る')
    expect(mail.text).not.toContain('自動回答はしない')
    // AI が回答した質問(開発用教室): 回答文がそのまま載り、件名は【質問/AI回答済】。
    const answered = buildDeveloperReportMail({ ...base, category: 'question', note: '山田太郎さんの振替は？', aiAnswer: '未消化振替の一覧から選び直せます。\n2 行目', aiAnswerModel: 'claude-haiku-5-5', aiAnswerDigestStudents: ['山田 太郎'] }, options)
    expect(answered.subject.startsWith('【質問/AI回答済】[コマ表アプリ 要望・報告]')).toBe(true)
    expect(answered.text).toContain('■ AI の自動回答(室長の画面にすぐ表示済み・claude-haiku-5-5・数字を渡した生徒 山田 太郎)\n未消化振替の一覧から選び直せます。\n2 行目')
    expect(answered.text.indexOf('■ AI の自動回答')).toBeLessThan(answered.text.indexOf('■ 進め方'))
    // AI が答えられなかった(止めた)質問: 理由と止めた元の文(室長には未表示)を載せ、件名は【質問】のまま(開発者が回答する)。
    const blocked = buildDeveloperReportMail({ ...base, category: 'question', aiAnswerError: '回答の決まりに反したため表示しませんでした(金額)', aiAnswerBlocked: '月額 5,000 円です。', aiAnswerModel: 'claude-haiku-5-5' }, options)
    expect(blocked.subject.startsWith('【質問】[コマ表アプリ 要望・報告]')).toBe(true)
    expect(blocked.text).toContain('■ AI の自動回答: 作れなかった(室長には「自動回答を作れませんでした。開発者より別途回答いたします」と表示済み・claude-haiku-5-5)\n理由: 回答の決まりに反したため表示しませんでした(金額)\n止めた元の文(室長には未表示):\n月額 5,000 円です。')
    // 不具合/要望には質問向けの節・行は出ない(件名も【質問】なし)。
    const bugMail = buildDeveloperReportMail({ ...base, category: 'bug', aiAnswer: 'x' }, options)
    expect(bugMail.subject.startsWith('[コマ表アプリ 要望・報告]')).toBe(true)
    expect(bugMail.text).not.toContain('AI の自動回答')
    expect(bugMail.text).not.toContain('質問への回答')
    // テスト送信の質問は【テスト】【質問】の順。
    expect(buildDeveloperReportMail({ ...base, category: 'question', isTest: true }, options).subject.startsWith('【テスト】【質問】[コマ表アプリ 要望・報告]')).toBe(true)
    expect(buildDeveloperReportMail({ ...base, category: 'question', isTest: true, aiAnswer: 'a' }, options).subject.startsWith('【テスト】【質問/AI回答済】[コマ表アプリ 要望・報告]')).toBe(true)
  })

  it('メールは AI の回答が書かれてから 1 回だけ送る(2026-10-16 夜・オーナー指示「開発者にもメールでやり取りを知らせる」)', () => {
    // 作成時: AI を呼ばない報告はすぐ送る。AI 待ち(aiAnswerPending)は送らない。
    expect(shouldSendDeveloperReportMailOnWrite(null, { reportId: 'r', classroomId: 'c' })).toBe(true)
    expect(shouldSendDeveloperReportMailOnWrite(null, { reportId: 'r', classroomId: 'c', aiAnswerPending: false })).toBe(true)
    expect(shouldSendDeveloperReportMailOnWrite(null, { reportId: 'r', classroomId: 'c', aiAnswerPending: true })).toBe(false)
    // 更新時: aiAnswerPending が true → 下りた 1 回だけ送る(成功・失敗どちらでも)。
    const pending = { reportId: 'r', classroomId: 'c', aiAnswerPending: true }
    expect(shouldSendDeveloperReportMailOnWrite(pending, { ...pending, aiAnswerPending: false, aiAnswer: '回答' })).toBe(true)
    expect(shouldSendDeveloperReportMailOnWrite(pending, { ...pending, aiAnswerPending: false, aiAnswerError: '失敗' })).toBe(true)
    expect(shouldSendDeveloperReportMailOnWrite(pending, { ...pending, aiAnswerPending: true, note: '別の更新' })).toBe(false)
    // 開発者の回答・Issue 番号など、AI 待ちでなかった文書の更新では送らない(古い文書に回答しても送らない)。
    const settled = { reportId: 'r', classroomId: 'c', aiAnswerPending: false, mailSentAt: '2026-10-16T00:00:00.000Z' }
    expect(shouldSendDeveloperReportMailOnWrite(settled, { ...settled, answerFinal: '開発者の回答' } as never)).toBe(false)
    expect(shouldSendDeveloperReportMailOnWrite({ reportId: 'r', classroomId: 'c' }, { reportId: 'r', classroomId: 'c', issueNumber: 80 } as never)).toBe(false)
    // 送信済み・スキップ済み・失敗済みは二度送らない(自分の書き込みで再発火しても止まる)。
    for (const mark of [{ mailSentAt: 't' }, { mailSkipped: 'test' }, { mailError: 'x' }]) {
      expect(shouldSendDeveloperReportMailOnWrite(null, { reportId: 'r', classroomId: 'c', ...mark })).toBe(false)
      expect(shouldSendDeveloperReportMailOnWrite(pending, { ...pending, aiAnswerPending: false, ...mark })).toBe(false)
    }
    expect(shouldSendDeveloperReportMailOnWrite(pending, null)).toBe(false)
  })

  it('#テスト の報告は件名・本文にテスト扱いを明示し、内容なし・教室データなしでも成立する', () => {
    const mail = buildDeveloperReportMail({ ...base, isTest: true, note: '', category: 'bug', snapshotStoragePath: '', recentOperations: [], recentOperationCount: 0 }, options)
    expect(mail.subject.startsWith('【テスト】[コマ表アプリ 要望・報告] スクールIE 緑が丘校 / 不具合・おかしい')).toBe(true)
    expect(mail.text).toContain('GitHub Issue は作られません')
    expect(mail.text).toContain('(なし)')
    expect(mail.text).toContain('保存されていません')
  })

  it('SMTP URL と宛先が揃っていて smtp/smtps の URL のときだけ送る', () => {
    expect(isMailTransportConfigured('', 'a@example.test')).toBe(false)
    expect(isMailTransportConfigured('smtps://u%40x.test:p@smtp.example.test:465', '')).toBe(false)
    expect(isMailTransportConfigured('https://example.test', 'a@example.test')).toBe(false)
    expect(isMailTransportConfigured('not a url', 'a@example.test')).toBe(false)
    expect(isMailTransportConfigured('smtps://u%40x.test:p@smtp.example.test:465', 'a@example.test')).toBe(true)
    expect(isMailTransportConfigured('smtp://u:p@smtp.example.test:587', 'a@example.test')).toBe(true)
  })
})

describe('developerReport(server): 確認リストはメール・Issue の対象外(2026-09-13)', () => {
  it('先頭行が [確認リスト vX.Y.Z](分割番号つき含む)なら確認リスト本文と判定する', () => {
    expect(isVerificationChecklistNote('[確認リスト v1.5.512]\n- k-1 要改善: 直して')).toBe(true)
    expect(isVerificationChecklistNote('[確認リスト v1.5.512] (2/3)\r\n- k-2 OK')).toBe(true)
    expect(isVerificationChecklistNote('盤面がおかしい\n[確認リスト v1.5.512]')).toBe(false)
    expect(isVerificationChecklistNote('[確認リスト] 何か')).toBe(false)
    expect(isVerificationChecklistNote('')).toBe(false)
  })

  it('開発用教室の確認リストだけを対象にする(本番教室の利用者が同じ書式を書いても通知は止めない)', () => {
    const note = '[確認リスト v1.5.512]\n- k-1 OK'
    expect(isVerificationChecklistReport(note, true)).toBe(true)
    expect(isVerificationChecklistReport(note, false)).toBe(false)
    expect(isVerificationChecklistReport('普通の要望', true)).toBe(false)
  })

  it('記録済みの isVerificationChecklist が true ならメールを送らない理由を返し、それ以外は送る', () => {
    expect(resolveDeveloperReportMailSkipReason({ isVerificationChecklist: true })).toBe('verification-checklist')
    expect(resolveDeveloperReportMailSkipReason({ isVerificationChecklist: false })).toBeNull()
    expect(resolveDeveloperReportMailSkipReason({})).toBeNull()
  })

  // 配線(source-scan): 記録時に Issue 起票を止め、メールトリガーでも送らない。片方だけだと通知が残る。
  it('submitDeveloperReport は確認リストを notifiedAt 即時埋め＋記録し、メールトリガーは送信前に打ち切る', () => {
    const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    // 2026-09-16: 検証用教室の判定は (workspaceKey, classroomId) の登録台帳。教室名は渡さない。
    expect(indexTs).toContain('const isDevelopmentClassroom = isDevelopmentClassroomIdentity({ workspaceKey, classroomId })')
    expect(indexTs).toContain('const isVerificationChecklist = isVerificationChecklistReport(report.note, isDevelopmentClassroom)')
    // 2026-10-22 案 3 で自動エラー報告(isAutoErrorReport)も Issue 起票をしない側に加わった。
    expect(indexTs).toContain('notifiedAt: report.isTest || isVerificationChecklist || isAutoErrorReport ? recordedAt : null,')
    // 2026-10-22 案 3 で isAutoErrorReport が間に入った(どちらも記録して本文の前に置く)。
    expect(indexTs).toMatch(/isVerificationChecklist,\s*\n\s*isAutoErrorReport,\s*\n\s*note: report\.note,/u)
    const trigger = indexTs.slice(indexTs.indexOf('export const notifyDeveloperReportByMail'))
    const skipIndex = trigger.indexOf('resolveDeveloperReportMailSkipReason(data)')
    expect(skipIndex).toBeGreaterThan(0)
    expect(skipIndex).toBeLessThan(trigger.indexOf('transport.sendMail'))
  })
})

describe('developerReport(server): 添付画像(確認リストのスクショ・2026-10-14)', () => {
  // 画像の先頭バイト(マジックバイト)を正しく持つ data URL を作る(2026-10-22 からサーバーは中身の先頭も検査する)。
  const dataUrlOfBytes = (bytes: number, mime = 'image/jpeg') => {
    const magic = mime === 'image/png' ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] : mime === 'image/webp' ? [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50] : [0xff, 0xd8, 0xff]
    const buffer = Buffer.alloc(Math.max(bytes, magic.length), 7)
    Buffer.from(magic).copy(buffer, 0)
    return `data:${mime};base64,${buffer.subarray(0, bytes).toString('base64')}`
  }

  it('画像の data URL だけ受け付け、base64 本体とデコード後のバイト数を返す(クライアントと同じ判定)', () => {
    const parsed = parseImageDataUrl(dataUrlOfBytes(10))
    expect(parsed?.mimeType).toBe('image/jpeg')
    expect(parsed?.byteLength).toBe(10)
    expect(Buffer.from(parsed!.base64, 'base64')).toHaveLength(10)
    expect(parseImageDataUrl(dataUrlOfBytes(10, 'image/gif'))).toBeNull()
    expect(parseImageDataUrl('data:image/jpeg;base64,abc')).toBeNull()
    expect(parseImageDataUrl('')).toBeNull()
  })

  it('正規化: 壊れた要素・上限超えを捨て、枚数と合計を抑える(クライアント src/utils/developerReport.ts と同じ上限)', () => {
    expect(DEVELOPER_REPORT_ATTACHMENT_LIMIT).toBe(8)
    expect(DEVELOPER_REPORT_ATTACHMENT_MAX_BYTES).toBe(1_500_000)
    expect(DEVELOPER_REPORT_ATTACHMENT_TOTAL_MAX_BYTES).toBe(6_000_000)
    const result = normalizeDeveloperReportAttachments([
      { label: ' tp-38 ', name: 'a.png', dataUrl: dataUrlOfBytes(9, 'image/png') },
      { label: 'big', name: 'b', dataUrl: dataUrlOfBytes(DEVELOPER_REPORT_ATTACHMENT_MAX_BYTES + 3) },
      { label: 'x', name: '', dataUrl: 'data:image/jpeg;base64,' },
      42,
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ label: 'tp-38', name: 'a.png', mimeType: 'image/png', byteLength: 9 })
    expect(normalizeDeveloperReportAttachments(Array.from({ length: 10 }, () => ({ label: 'a', name: 'a', dataUrl: dataUrlOfBytes(3) })))).toHaveLength(DEVELOPER_REPORT_ATTACHMENT_LIMIT)
    const each = DEVELOPER_REPORT_ATTACHMENT_MAX_BYTES - 3
    expect(normalizeDeveloperReportAttachments(Array.from({ length: 5 }, () => ({ label: 'a', name: 'a', dataUrl: dataUrlOfBytes(each) })))).toHaveLength(Math.floor(DEVELOPER_REPORT_ATTACHMENT_TOTAL_MAX_BYTES / each))
    expect(normalizeDeveloperReportAttachments(null)).toEqual([])
  })

  it('Storage パスは教室データと同じフォルダに {reportId}-img{n}.{拡張子}(n は 1 から)。危険な文字は拒否', () => {
    expect(buildDeveloperReportAttachmentStoragePath('main', 'v8OZ7zH8vONNHjjYVcR1', '20261014-062117803-c223100f', 0, 'image/jpeg')).toBe('developer-reports/main/v8OZ7zH8vONNHjjYVcR1/20261014-062117803-c223100f-img1.jpg')
    expect(buildDeveloperReportAttachmentStoragePath('main', 'c1', 'r1', 2, 'image/png')).toBe('developer-reports/main/c1/r1-img3.png')
    expect(buildDeveloperReportAttachmentStoragePath('main', 'c1', 'r1', 0, 'image/webp')).toBe('developer-reports/main/c1/r1-img1.webp')
    expect(() => buildDeveloperReportAttachmentStoragePath('main/../x', 'c1', 'r1', 0, 'image/jpeg')).toThrow()
    expect(() => buildDeveloperReportAttachmentStoragePath('main', 'c1', 'r1', -1, 'image/jpeg')).toThrow()
  })

  it('index.ts: 添付は教室データの後に 1 枚ずつ Storage へ保存し、保存できた分だけ文書 attachments[] に残す(画像本体は文書に入れない)', () => {
    const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    // 2026-10-22 オーナー決定: 一般の質問・要望モーダルにも画像が付くので全教室から受け付け、枚数だけ教室で分ける(開発用教室 8 枚・それ以外 3 枚)。
    expect(indexTs).toContain('const attachments = normalizeDeveloperReportAttachments(rawData.attachments, { limit: resolveDeveloperReportAttachmentLimit(isDevelopmentClassroom) })')
    expect(indexTs.indexOf('const isDevelopmentClassroom = isDevelopmentClassroomIdentity({ workspaceKey, classroomId })')).toBeLessThan(indexTs.indexOf('const attachments = normalizeDeveloperReportAttachments('))
    expect(indexTs).toContain("buildDeveloperReportAttachmentStoragePath(workspaceKey, classroomId, reportId, index, attachment.mimeType)")
    expect(indexTs).toContain("save(Buffer.from(attachment.base64, 'base64')")
    expect(indexTs).toContain('attachments: storedAttachments,')
    expect(indexTs).toContain('attachmentCount: attachments.length,')
    expect(indexTs).not.toMatch(/attachments:\s*attachments,/u)
  })
})

describe('画面エラーの自動報告(2026-10-22 案 3)', () => {
  it('目印はクライアント(src/utils/clientErrorCapture.ts)と同じ文字列で、先頭行だけを見る', () => {
    expect(DEVELOPER_REPORT_AUTO_ERROR_MARKER).toBe('[自動エラー報告]')
    expect(isAutoErrorReportNote('[自動エラー報告] 画面で想定外のエラーが起きました\nエラー: TypeError: x')).toBe(true)
    expect(isAutoErrorReportNote('  [自動エラー報告] 先頭の空白は許す')).toBe(true)
    expect(isAutoErrorReportNote('ふつうの質問\n[自動エラー報告] 2 行目では自動報告にしない')).toBe(false)
    expect(isAutoErrorReportNote('')).toBe(false)
  })

  it('メール件名に【自動エラー報告】を付け、本文で Issue を作らない旨を知らせる', () => {
    const mail = buildDeveloperReportMail({ reportId: 'r1', classroomId: 'c1', classroomName: '教室A', category: 'bug', source: 'board', isAutoErrorReport: true, note: '[自動エラー報告] 画面で想定外のエラー' }, { workspaceKey: 'main', projectId: 'p', storageBucket: 'b' })
    expect(mail.subject.startsWith('【自動エラー報告】[コマ表アプリ 要望・報告] 教室A / 不具合・おかしい')).toBe(true)
    expect(mail.text).toContain('アプリが自動で送った報告です')
    expect(mail.text).toContain('GitHub Issue は作られません')
    expect(mail.text).not.toContain('利用者が画面の「要望・報告」ボタンから送った内容です。')
  })

  it('index.ts: 自動報告は isAutoErrorReport を記録し、Issue 起票をしない(notifiedAt 即時・notifySkipped auto-error)。回答待ちの文書も作らない', () => {
    const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    expect(indexTs).toContain('const isAutoErrorReport = isAutoErrorReportNote(report.note)')
    expect(indexTs).toContain('isAutoErrorReport,')
    expect(indexTs).toContain("notifiedAt: report.isTest || isVerificationChecklist || isAutoErrorReport ? recordedAt : null,")
    expect(indexTs).toContain("notifySkipped: report.isTest ? 'test' : isVerificationChecklist ? 'verification-checklist' : isAutoErrorReport ? 'auto-error' : null,")
    expect(indexTs).toContain('shouldCreateReportAnswerDoc({ isTest: report.isTest, isVerificationChecklist, isAutoErrorReport, reporterRole: member.role, isDevelopmentClassroom })')
  })
})

describe('一般モーダルの添付画像(2026-10-22 オーナー決定: 3 枚・メールに 1 枚目 1MB まで)', () => {
  // 画像の先頭バイト(マジックバイト)を正しく持つ data URL を作る(2026-10-22 からサーバーは中身の先頭も検査する)。
  const dataUrlOfBytes = (bytes: number, mime = 'image/jpeg') => {
    const magic = mime === 'image/png' ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] : mime === 'image/webp' ? [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50] : [0xff, 0xd8, 0xff]
    const buffer = Buffer.alloc(Math.max(bytes, magic.length), 7)
    Buffer.from(magic).copy(buffer, 0)
    return `data:${mime};base64,${buffer.subarray(0, bytes).toString('base64')}`
  }

  it('枚数の上限はクライアントと同じ 3 枚。開発用教室(確認リスト)は 8 枚のまま', () => {
    expect(DEVELOPER_REPORT_MODAL_ATTACHMENT_LIMIT).toBe(3)
    expect(resolveDeveloperReportAttachmentLimit(true)).toBe(DEVELOPER_REPORT_ATTACHMENT_LIMIT)
    expect(resolveDeveloperReportAttachmentLimit(false)).toBe(3)
    const many = Array.from({ length: 6 }, (_, index) => ({ label: `l${index}`, name: `n${index}`, dataUrl: dataUrlOfBytes(3) }))
    expect(normalizeDeveloperReportAttachments(many, { limit: 3 })).toHaveLength(3)
    expect(normalizeDeveloperReportAttachments(many, { limit: 3 }).map((item) => item.label)).toEqual(['l0', 'l1', 'l2'])
    // 全体の上限(8)より大きい limit を渡しても 8 を超えない。
    expect(normalizeDeveloperReportAttachments(Array.from({ length: 12 }, () => ({ label: 'a', name: 'a', dataUrl: dataUrlOfBytes(3) })), { limit: 20 })).toHaveLength(DEVELOPER_REPORT_ATTACHMENT_LIMIT)
  })

  it('メールに添付するのは 1 枚目だけ・1MB まで・保存先があるもの', () => {
    expect(DEVELOPER_REPORT_MAIL_ATTACHMENT_MAX_BYTES).toBe(1_000_000)
    const small = { name: 'a.jpg', mimeType: 'image/jpeg', byteLength: 400_000, storagePath: 'developer-reports/main/c1/r1-img1.jpg' }
    const big = { name: 'b.jpg', mimeType: 'image/jpeg', byteLength: 1_000_001, storagePath: 'developer-reports/main/c1/r1-img1.jpg' }
    expect(selectDeveloperReportMailAttachment([small, big])).toEqual({ name: 'a.jpg', fileName: 'r1-img1.jpg', mimeType: 'image/jpeg', storagePath: small.storagePath, byteLength: 400_000 })
    // 1 枚目が大きければ 2 枚目には進まない(「1 枚目だけ」)。
    expect(selectDeveloperReportMailAttachment([big, small])).toBeNull()
    expect(selectDeveloperReportMailAttachment([{ ...small, storagePath: '' }])).toBeNull()
    expect(selectDeveloperReportMailAttachment([{ ...small, byteLength: undefined }])).toBeNull()
    expect(selectDeveloperReportMailAttachment(undefined)).toBeNull()
    expect(selectDeveloperReportMailAttachment([{ ...small, name: '  ', mimeType: '' }])?.name).toBe('image')
    // メールの添付名は利用者入力(name)ではなく Storage の保存名(M-4): 「悪意のある名前.html」を付けても r1-img1.jpg になる。
    expect(selectDeveloperReportMailAttachment([{ ...small, name: 'evil.html' }])?.fileName).toBe('r1-img1.jpg')
  })

  it('本文の添付の節: 枚数・1 枚目を付けたか・各画像の置き場所。添付が無ければ節ごと無い', () => {
    const report = { attachments: [
      { label: '画面を撮る', name: '画面_20261022-150409.jpg', mimeType: 'image/jpeg', byteLength: 350_000, storagePath: 'developer-reports/main/c1/r1-img1.jpg' },
      { label: '画像を選ぶ', name: 'shot.png', mimeType: 'image/jpeg', byteLength: 900_000, storagePath: 'developer-reports/main/c1/r1-img2.jpg' },
    ] }
    const lines = buildDeveloperReportMailAttachmentLines(report, { storageBucket: 'bucket' })
    expect(lines[0]).toBe('■ 添付画像: 2 枚')
    expect(lines[1]).toContain('1 枚目(画面_20261022-150409.jpg・342KB)をこのメールに添付')
    expect(lines[2]).toBe('  1. 画面_20261022-150409.jpg [画面を撮る] gs://bucket/developer-reports/main/c1/r1-img1.jpg')
    expect(lines[3]).toBe('  2. shot.png [画像を選ぶ] gs://bucket/developer-reports/main/c1/r1-img2.jpg')
    expect(buildDeveloperReportMailAttachmentLines({ attachments: [] }, { storageBucket: 'b' })).toEqual([])
    expect(buildDeveloperReportMailAttachmentLines({}, { storageBucket: 'b' })).toEqual([])
    const tooBig = buildDeveloperReportMailAttachmentLines({ attachments: [{ name: 'x', byteLength: 2_000_000, storagePath: 'p' }] }, { storageBucket: 'b' })
    expect(tooBig[1]).toContain('メールには付けていません')
    // 本文全体にも節が入る。
    const mail = buildDeveloperReportMail({ reportId: 'r1', classroomId: 'c1', category: 'bug', ...report }, { workspaceKey: 'main', projectId: 'p', storageBucket: 'bucket' })
    expect(mail.text).toContain('■ 添付画像: 2 枚')
  })

  it('index.ts: メール送信で 1 枚目を Storage から読んで添付し、読めなくても本文は送る', () => {
    const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const notify = indexTs.slice(indexTs.indexOf('export const notifyDeveloperReportByMail = onDocumentWritten('), indexTs.indexOf('export const answerDeveloperReport = onCall('))
    expect(notify).toContain('const mailAttachment = selectDeveloperReportMailAttachment(data.attachments)')
    expect(notify).toContain('filename: mailAttachment.fileName')
    expect(notify).not.toContain('filename: mailAttachment.name')
    expect(notify).toContain('.file(mailAttachment.storagePath).download()')
    expect(notify).toContain("...(mailAttachments.length > 0 ? { attachments: mailAttachments } : {}),")
    // 読み込み失敗は warn だけ(try/catch)で、sendMail は別の try に進む。
    expect(notify.indexOf('Failed to load attachment')).toBeGreaterThan(-1)
    expect(notify.indexOf('Failed to load attachment')).toBeLessThan(notify.indexOf('transport.sendMail('))
  })
})

describe('添付画像の中身の検査(マジックバイト・regression-reviewer M-4・2026-10-22)', () => {
  const asDataUrl = (mime: string, bytes: number[]) => `data:${mime};base64,${Buffer.from([...bytes, ...Array.from({ length: 12 }, () => 7)]).toString('base64')}`

  it('JPEG / PNG / WEBP の先頭バイトを確かめる', () => {
    expect(matchesImageMagicBytes('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true)
    expect(matchesImageMagicBytes('image/jpeg', Uint8Array.from([0x3c, 0x68, 0x74, 0x6d]))).toBe(false)
    expect(matchesImageMagicBytes('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
    expect(matchesImageMagicBytes('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe(false)
    expect(matchesImageMagicBytes('image/webp', Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]))).toBe(true)
    expect(matchesImageMagicBytes('image/webp', Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20]))).toBe(false)
  })

  it('MIME を image/jpeg と称した HTML・空に近いバイト列は捨て、正しい先頭を持つ画像だけ通す', () => {
    const html = asDataUrl('image/jpeg', [0x3c, 0x21, 0x44, 0x4f, 0x43]) // <!DOC
    const jpeg = asDataUrl('image/jpeg', [0xff, 0xd8, 0xff, 0xe1])
    const png = asDataUrl('image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const pngAsJpeg = asDataUrl('image/jpeg', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(parseImageDataUrl(html)).toBeNull()
    expect(parseImageDataUrl(pngAsJpeg)).toBeNull()
    expect(parseImageDataUrl(jpeg)?.mimeType).toBe('image/jpeg')
    expect(parseImageDataUrl(png)?.mimeType).toBe('image/png')
    const kept = normalizeDeveloperReportAttachments([{ label: 'a', name: 'a', dataUrl: html }, { label: 'b', name: 'b', dataUrl: jpeg }])
    expect(kept.map((item) => item.label)).toEqual(['b'])
  })
})
