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
  resolveDeveloperReportMailSkipReason,
  normalizeDeveloperReportCategory,
  DEVELOPER_REPORT_NOTE_LIMIT,
  DEVELOPER_REPORT_TRACE_KINDS,
  DEVELOPER_REPORT_TRACE_LIMIT,
  buildDeveloperReportId,
  buildDeveloperReportStoragePath,
  normalizeDeveloperReport,
  normalizeDeveloperReportTrace,
  trimDeveloperReportTraceToBudget,
} from './developerReport'

const FALLBACK = '2026-09-04T03:00:00.000Z'

describe('developerReport(server): 操作痕跡の正規化', () => {
  it('クライアント(src/utils/operationTrace.ts)の種別一覧と一致する(片方だけ足すとサーバーが黙って捨てる)', () => {
    expect([...DEVELOPER_REPORT_TRACE_KINDS]).toEqual(['board-commit', 'board-rebuild', 'undo', 'redo', 'save', 'operation-event', 'schedule-message', 'navigation', 'auto'])
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

  it('質問(question・2026-09-13)は件名に【質問】が付き、本文に「自動回答しない・承認した回答だけ返す」が載る', () => {
    const mail = buildDeveloperReportMail({ ...base, category: 'question', note: '休みにした生徒の振替先を後から変えるには？' }, options)
    expect(mail.subject).toBe('【質問】[コマ表アプリ 要望・報告] スクールIE 緑が丘校 / 使い方の質問: 休みにした生徒の振替先を後から変えるには？')
    expect(mail.text).toContain('種類: 使い方の質問')
    expect(mail.text).toContain('自動回答はしない')
    expect(mail.text).toContain('承認したものだけ')
    // 不具合/要望には質問向けの行は出ない(件名も【質問】なし)。
    const bugMail = buildDeveloperReportMail({ ...base, category: 'bug' }, options)
    expect(bugMail.subject.startsWith('[コマ表アプリ 要望・報告]')).toBe(true)
    expect(bugMail.text).not.toContain('自動回答はしない')
    // テスト送信の質問は【テスト】【質問】の順。
    expect(buildDeveloperReportMail({ ...base, category: 'question', isTest: true }, options).subject.startsWith('【テスト】【質問】[コマ表アプリ 要望・報告]')).toBe(true)
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
    expect(indexTs).toContain('const isVerificationChecklist = isVerificationChecklistReport(report.note, isDevelopmentClassroomIdentity({ workspaceKey, classroomId }))')
    expect(indexTs).toContain('notifiedAt: report.isTest || isVerificationChecklist ? recordedAt : null,')
    expect(indexTs).toMatch(/isVerificationChecklist,\s*\n\s*note: report\.note,/u)
    const trigger = indexTs.slice(indexTs.indexOf('export const notifyDeveloperReportByMail'))
    const skipIndex = trigger.indexOf('resolveDeveloperReportMailSkipReason(data)')
    expect(skipIndex).toBeGreaterThan(0)
    expect(skipIndex).toBeLessThan(trigger.indexOf('transport.sendMail'))
  })
})
