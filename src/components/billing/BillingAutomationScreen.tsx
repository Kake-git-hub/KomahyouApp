import { useEffect, useMemo, useState } from 'react'
import { createGmailDraftWithPdf, isGmailDraftCreationConfigured, requestGmailComposeAccessToken } from '../../integrations/gmail/drafts'
import { downloadBlob, openGmailCompose, openGmailDraft } from '../../integrations/gmail/compose'
import { loadFirebaseBillingMonth, markFirebaseBillingDraftCreated, saveFirebaseBillingRow, saveFirebaseBillingRows, type BillingClassroomRecord } from '../../integrations/firebase/billingStore'
import { loadStudentCountLedgerEntry, recordStudentCountLedgerEntry, type StudentCountLedgerEntry } from '../../integrations/firebase/studentCountLedger'
import type { WorkspaceClassroom, WorkspaceUser } from '../../types/appState'
import { buildInvoiceNumber, calculateBillingAmounts, countActiveStudentsForBilling, DEFAULT_BILLING_SNAPSHOT_DAY, formatBillingMonthLabel, formatJapaneseDate, formatYen, getBillingDueDate, getBillingSnapshotDate, getCurrentBillingMonthKey, getJstTodayDateKey, isBillingAllowedEmail, isFutureBillingSnapshotDate, normalizeBillingMonthKey, resolveBillingStudentCount, type BillingInvoiceRow, type BillingMonthKey, type BillingStudentCountSource } from '../../utils/billing'
import { buildInvoicePdfFileName, createInvoicePdfBlob, type InvoiceIssuerInfo } from '../../utils/invoicePdf'

type BillingAutomationScreenProps = {
  currentUser: WorkspaceUser
  authMode: 'local' | 'firebase'
  classrooms: WorkspaceClassroom[]
  users: WorkspaceUser[]
  onBackToDeveloper: () => void
  onLogout: () => void
}

type BillingRowDraft = BillingInvoiceRow & {
  draftId?: string
  draftCreatedAt?: string
  // 生徒数の出どころ(恒久記録 or 現在の名簿からの再計算)と、その食い違い。表示の根拠として持つ。
  studentCountSource: BillingStudentCountSource
  ledgerStudentCount: number | null
  liveStudentCount: number
  hasStudentCountDrift: boolean
}

const DEFAULT_STUDENT_UNIT_PRICE = 300
const ISSUER_STORAGE_KEY = 'billingInvoiceIssuerInfo:v1'
// 請求メールに自動で追加する CC 宛先（運営控え用）。
const BILLING_CC_ADDRESS = 'bkkdmzn@gmail.com'

// 請求日 = メール作成日。今日の日付キー(YYYY-MM-DD)を返す。
function getInvoiceDateKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function loadStoredIssuerInfo(): InvoiceIssuerInfo {
  const fallback: InvoiceIssuerInfo = {
    name: 'コマ表アプリ運営事務局',
    address: '',
    phone: '',
    registrationNumber: '',
    bankAccount: '',
    notes: '',
  }

  try {
    const stored = window.localStorage.getItem(ISSUER_STORAGE_KEY)
    if (!stored) return fallback
    return { ...fallback, ...JSON.parse(stored) as Partial<InvoiceIssuerInfo> }
  } catch {
    return fallback
  }
}

function saveStoredIssuerInfo(value: InvoiceIssuerInfo) {
  try {
    window.localStorage.setItem(ISSUER_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // localStorage is best-effort for issuer display settings.
  }
}

export function buildBillingRows(params: {
  classrooms: WorkspaceClassroom[]
  users: WorkspaceUser[]
  monthKey: BillingMonthKey
  snapshotDate: string
  records: BillingClassroomRecord[]
  ledgerEntry: StudentCountLedgerEntry | null
}) {
  const recordByClassroomId = new Map(params.records.map((record) => [record.classroomId, record]))
  const managerById = new Map(params.users.map((user) => [user.id, user]))
  const snapshotDate = params.snapshotDate

  return params.classrooms.map((classroom): BillingRowDraft => {
    const record = recordByClassroomId.get(classroom.id)
    const manager = managerById.get(classroom.managerUserId)
    // 生徒数の優先順位:
    //  1) 恒久記録(studentCountLedger) … 毎月15日 0:00(JST)にサーバーが記録した確定値。
    //     名簿を後から直しても動かないので、遡っても同じ人数が読み取れる(この台帳の目的)。
    //  2) 記録が無い日付 … 選択中の集計日で現在の名簿からライブ計算した暫定値。
    // ⚠️ billingMonths 側の保存済み record.studentCount は今も表示に使わない。
    //    あちらは画面操作で上書きされ得る可変値で、古い値と食い違う回帰の原因になる(既存ガード)。
    //    「保存済みだから」と record.studentCount を復活させないこと。
    const liveStudentCount = countActiveStudentsForBilling(classroom.data.students, params.monthKey, snapshotDate)
    const resolvedStudentCount = resolveBillingStudentCount({
      ledgerStudentCount: params.ledgerEntry?.countByClassroomId[classroom.id]?.studentCount ?? null,
      liveStudentCount,
    })
    const unitPrice = record?.unitPrice ?? classroom.studentUnitPrice ?? DEFAULT_STUDENT_UNIT_PRICE
    const amounts = calculateBillingAmounts(resolvedStudentCount.studentCount, unitPrice, record?.billedAmount)

    return {
      classroomId: classroom.id,
      classroomName: classroom.name || record?.classroomName || '名称未設定の教室',
      managerEmail: manager?.email || record?.managerEmail || '',
      monthKey: params.monthKey,
      snapshotDate,
      studentCount: amounts.studentCount,
      studentCountSource: resolvedStudentCount.source,
      ledgerStudentCount: resolvedStudentCount.ledgerStudentCount,
      liveStudentCount: resolvedStudentCount.liveStudentCount,
      hasStudentCountDrift: resolvedStudentCount.hasDrift,
      unitPrice: amounts.unitPrice,
      calculatedAmount: amounts.calculatedAmount,
      billedAmount: amounts.billedAmount,
      taxAmount: amounts.taxAmount,
      billedAmountWithTax: amounts.billedAmountWithTax,
      invoiceNumber: record?.invoiceNumber || buildInvoiceNumber(classroom.id, params.monthKey),
      memo: record?.memo ?? '',
      draftId: record?.draftId,
      draftCreatedAt: record?.draftCreatedAt,
    }
  })
}

function buildMailSubject(row: BillingInvoiceRow) {
  return `コマ表アプリ ${formatBillingMonthLabel(row.monthKey)} 請求書`
}

export function buildDraftBody(row: BillingInvoiceRow, issuer: InvoiceIssuerInfo, invoiceDateKey: string) {
  const signatureSeparator = '------------------------------------------'
  return [
    `${row.classroomName} 様`,
    'いつも大変お世話になっております。',
    '',
    `コマ表アプリ ${formatBillingMonthLabel(row.monthKey)}の請求書を添付いたします。`,
    '',
    `請求日：${formatJapaneseDate(invoiceDateKey)}`,
    `請求金額（税込）: ${formatYen(row.billedAmountWithTax)}`,
    `支払期限: ${formatJapaneseDate(getBillingDueDate(row.monthKey))}`,
    `振込先: ${issuer.bankAccount}`,
    '',
    'ご確認のほど、よろしくお願いいたします。',
    signatureSeparator,
    issuer.name,
    issuer.phone,
    signatureSeparator,
  ].join('\n')
}

function formatDraftCreatedAt(value: string | undefined) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('ja-JP')
}

export function BillingAutomationScreen({ currentUser, authMode, classrooms, users, onBackToDeveloper, onLogout }: BillingAutomationScreenProps) {
  // 集計基準日（単一のカレンダーで選択）。請求月はこの日付から導出する。既定は当月15日。
  const [snapshotDate, setSnapshotDate] = useState<string>(() => getBillingSnapshotDate(getCurrentBillingMonthKey()))
  const [rows, setRows] = useState<BillingRowDraft[]>([])
  const [ledgerEntry, setLedgerEntry] = useState<StudentCountLedgerEntry | null>(null)
  const [issuerInfo, setIssuerInfo] = useState<InvoiceIssuerInfo>(() => loadStoredIssuerInfo())
  const [statusMessage, setStatusMessage] = useState('請求データを読み込んでいます。')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [draftingClassroomId, setDraftingClassroomId] = useState<string | null>(null)
  const [isCreatingAllDrafts, setIsCreatingAllDrafts] = useState(false)
  const [isRecordingLedger, setIsRecordingLedger] = useState(false)
  // 手動記録の直後に請求データ＋台帳を読み直すためのトークン(値が変われば読み込み effect が再実行される)。
  const [reloadToken, setReloadToken] = useState(0)

  const canUseBilling = isBillingAllowedEmail(currentUser.email) && currentUser.role === 'developer'
  // 請求月は集計日の年月から導出する（請求月ピッカーは集計日カレンダーに統合）。
  const monthKey = normalizeBillingMonthKey(snapshotDate.slice(0, 7))
  const dueDate = getBillingDueDate(monthKey)

  const handleSnapshotDateChange = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return
    setSnapshotDate(value)
  }
  const totals = useMemo(() => rows.reduce((summary, row) => ({
    studentCount: summary.studentCount + row.studentCount,
    calculatedAmount: summary.calculatedAmount + row.calculatedAmount,
    billedAmount: summary.billedAmount + row.billedAmount,
    taxAmount: summary.taxAmount + row.taxAmount,
    billedAmountWithTax: summary.billedAmountWithTax + row.billedAmountWithTax,
  }), { studentCount: 0, calculatedAmount: 0, billedAmount: 0, taxAmount: 0, billedAmountWithTax: 0 }), [rows])

  // 表示中の生徒数がどれだけ恒久記録に裏付けられているか。全教室が記録由来なら「確定」と言い切れる。
  const studentCountAudit = useMemo(() => {
    const ledgerRowCount = rows.filter((row) => row.studentCountSource === 'ledger').length
    return {
      ledgerRowCount,
      driftRowCount: rows.filter((row) => row.hasStudentCountDrift).length,
      isFullyLedgerBacked: rows.length > 0 && ledgerRowCount === rows.length,
    }
  }, [rows])

  const isSnapshotDayOfMonth = Number(snapshotDate.slice(8, 10)) === DEFAULT_BILLING_SNAPSHOT_DAY
  // 未来日は恒久記録できない(先回りして記録するとその日の定期実行がスキップされる)。
  const isFutureSnapshotDate = isFutureBillingSnapshotDate(snapshotDate, getJstTodayDateKey())

  useEffect(() => {
    if (!canUseBilling) return
    let cancelled = false

    setIsLoading(true)
    setStatusMessage('請求データを読み込んでいます。')
    void (async () => {
      try {
        // 恒久記録の取得は請求データと独立。台帳が読めなくても画面は暫定値で使えるようにする
        // (記録が無い日付・移行前の月でも請求作業を止めない)。
        const [records, nextLedgerEntry] = await Promise.all([
          authMode === 'firebase' ? loadFirebaseBillingMonth(monthKey) : Promise.resolve([]),
          authMode === 'firebase'
            ? loadStudentCountLedgerEntry(snapshotDate).catch(() => null)
            : Promise.resolve(null),
        ])
        if (cancelled) return

        setLedgerEntry(nextLedgerEntry)
        const nextRows = buildBillingRows({ classrooms, users, monthKey, snapshotDate, records, ledgerEntry: nextLedgerEntry })
        setRows(nextRows)

        const ledgerNote = nextLedgerEntry
          ? `${formatJapaneseDate(snapshotDate)}の在籍生徒数は恒久記録から読み込みました。`
          : `${formatJapaneseDate(snapshotDate)}の恒久記録が無いため、現在の名簿から計算した暫定値です。`

        if (authMode === 'firebase' && records.length < classrooms.length) {
          await saveFirebaseBillingRows(nextRows)
          if (!cancelled) setStatusMessage(`${formatBillingMonthLabel(monthKey)}の請求スナップショットを保存しました。${ledgerNote}`)
          return
        }

        setStatusMessage(`${formatBillingMonthLabel(monthKey)}の請求データを読み込みました。${ledgerNote}`)
      } catch (error) {
        if (!cancelled) setStatusMessage(error instanceof Error ? error.message : '請求データの読み込みに失敗しました。')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authMode, canUseBilling, classrooms, monthKey, reloadToken, snapshotDate, users])

  const updateIssuerInfo = (updates: Partial<InvoiceIssuerInfo>) => {
    setIssuerInfo((current) => {
      const next = { ...current, ...updates }
      saveStoredIssuerInfo(next)
      return next
    })
  }

  const updateRow = (classroomId: string, updates: Partial<Pick<BillingRowDraft, 'unitPrice' | 'billedAmount' | 'memo'>>) => {
    setRows((currentRows) => currentRows.map((row) => {
      if (row.classroomId !== classroomId) return row
      const unitPrice = updates.unitPrice ?? row.unitPrice
      const billedAmount = updates.billedAmount ?? row.billedAmount
      const amounts = calculateBillingAmounts(row.studentCount, unitPrice, billedAmount)
      return {
        ...row,
        ...updates,
        unitPrice: amounts.unitPrice,
        calculatedAmount: amounts.calculatedAmount,
        billedAmount: amounts.billedAmount,
        taxAmount: amounts.taxAmount,
        billedAmountWithTax: amounts.billedAmountWithTax,
      }
    }))
  }

  const saveRow = async (row: BillingRowDraft) => {
    if (authMode !== 'firebase') {
      setStatusMessage('ローカル表示中のため、請求データは Firebase へ保存されません。')
      return
    }
    setIsSaving(true)
    try {
      await saveFirebaseBillingRow(row)
      setStatusMessage(`${row.classroomName} の請求データを保存しました。`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '請求データの保存に失敗しました。')
    } finally {
      setIsSaving(false)
    }
  }

  const saveAllRows = async () => {
    if (authMode !== 'firebase') {
      setStatusMessage('ローカル表示中のため、請求データは Firebase へ保存されません。')
      return
    }
    setIsSaving(true)
    try {
      await saveFirebaseBillingRows(rows)
      setStatusMessage('表示中の請求データをすべて保存しました。')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '請求データの保存に失敗しました。')
    } finally {
      setIsSaving(false)
    }
  }

  // 選択中の集計日を恒久記録として残す(サーバー側で記録・開発者のみ)。
  // 定期実行(毎月15日 0:00 JST)より前に当月分を確定させたいとき、あるいは取り逃した日を
  // 後から記録するための入口。既に記録がある日付は上書きされない(write-once)。
  const recordLedgerForSnapshotDate = async () => {
    if (authMode !== 'firebase') {
      setStatusMessage('ローカル表示中のため、恒久記録は作成できません。')
      return
    }
    setIsRecordingLedger(true)
    setStatusMessage(`${formatJapaneseDate(snapshotDate)}の在籍生徒数を恒久記録として保存しています。`)
    try {
      const result = await recordStudentCountLedgerEntry(snapshotDate)
      setStatusMessage(result.created
        ? `${formatJapaneseDate(snapshotDate)}時点の在籍生徒数（${result.classroomCount}教室 / 合計${result.studentCountTotal}人）を恒久記録として保存しました。`
        : `${formatJapaneseDate(snapshotDate)}の恒久記録は既にあります。記録は書き換えていません。`)
      setReloadToken((current) => current + 1)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '恒久記録の保存に失敗しました。')
    } finally {
      setIsRecordingLedger(false)
    }
  }

  // ハイブリッド方式:
  // - VITE_GOOGLE_OAUTH_CLIENT_ID 設定済み → Gmail API で「PDF添付済みの下書き」を作成（自動添付）。
  // - 未設定 → 請求書PDFをダウンロードし、宛先・件名・本文入りの Gmail 作成画面を開く（PDFは手動添付）。
  const markRowPrepared = async (row: BillingRowDraft, draftId?: string) => {
    const draftCreatedAt = new Date().toISOString()
    if (authMode === 'firebase') {
      await markFirebaseBillingDraftCreated({ monthKey: row.monthKey, classroomId: row.classroomId, draftId })
    }
    setRows((currentRows) => currentRows.map((entry) => entry.classroomId === row.classroomId ? { ...entry, draftId: draftId ?? entry.draftId, draftCreatedAt } : entry))
  }

  // OAuth設定時: PDF添付済みのGmail下書きを作成し、Gmailで開くためのメッセージIDを返す。
  const createOAuthDraft = async (row: BillingRowDraft, accessToken: string) => {
    const pdfBlob = await createInvoicePdfBlob(row, issuerInfo)
    const result = await createGmailDraftWithPdf({
      accessToken,
      to: row.managerEmail,
      cc: BILLING_CC_ADDRESS,
      subject: buildMailSubject(row),
      bodyText: buildDraftBody(row, issuerInfo, getInvoiceDateKey()),
      pdfBlob,
      pdfFileName: buildInvoicePdfFileName(row),
    })
    await markRowPrepared(row, result.id)
    return result.message?.id
  }

  // OAuth未設定時: PDFをダウンロードしつつ Gmail 作成画面を開く。
  const downloadAndCompose = async (row: BillingRowDraft) => {
    const pdfBlob = await createInvoicePdfBlob(row, issuerInfo)
    downloadBlob(pdfBlob, buildInvoicePdfFileName(row))
    openGmailCompose({
      to: row.managerEmail,
      cc: BILLING_CC_ADDRESS,
      subject: buildMailSubject(row),
      body: buildDraftBody(row, issuerInfo, getInvoiceDateKey()),
    })
    await markRowPrepared(row)
  }

  const handlePrepareMail = async (row: BillingRowDraft) => {
    if (!row.managerEmail.trim()) {
      setStatusMessage(`${row.classroomName} の管理者メールが未設定です。`)
      return
    }
    const usesOAuth = isGmailDraftCreationConfigured()
    setDraftingClassroomId(row.classroomId)
    setStatusMessage(usesOAuth ? `${row.classroomName} の Gmail 下書きを作成しています。` : `${row.classroomName} の請求書PDFを準備しています。`)
    try {
      if (usesOAuth) {
        const token = await requestGmailComposeAccessToken()
        const messageId = await createOAuthDraft(row, token)
        if (messageId) openGmailDraft(messageId)
        setStatusMessage(`${row.classroomName} の Gmail 下書き（PDF添付済み）を作成し、Gmail で開きました。内容を確認して送信してください。`)
      } else {
        await downloadAndCompose(row)
        setStatusMessage(`${row.classroomName} の請求書PDFをダウンロードし、Gmail 作成画面を開きました。ダウンロードしたPDFを添付して送信してください。`)
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'メール作成の準備に失敗しました。')
    } finally {
      setDraftingClassroomId(null)
    }
  }

  const handlePrepareAll = async () => {
    const usesOAuth = isGmailDraftCreationConfigured()
    setIsCreatingAllDrafts(true)
    setStatusMessage(usesOAuth ? 'Gmail 下書きを一括作成しています。' : '全教室の請求書PDFをダウンロードしています。')
    try {
      // OAuth時はトークンを1回だけ取得して全件で使い回す。
      const token = usesOAuth ? await requestGmailComposeAccessToken() : ''
      let preparedCount = 0
      for (const row of rows) {
        if (usesOAuth) {
          if (!row.managerEmail.trim()) continue // 宛先未設定はAPIがエラーになるためスキップ。
          await createOAuthDraft(row, token)
        } else {
          const pdfBlob = await createInvoicePdfBlob(row, issuerInfo)
          downloadBlob(pdfBlob, buildInvoicePdfFileName(row))
          await markRowPrepared(row)
        }
        preparedCount += 1
        setStatusMessage(usesOAuth ? `Gmail 下書きを作成中です (${preparedCount}/${rows.length})。` : `請求書PDFをダウンロード中です (${preparedCount}/${rows.length})。`)
      }
      setStatusMessage(usesOAuth
        ? `${preparedCount}件の Gmail 下書き（PDF添付済み）を作成しました。Gmail で内容確認後に送信してください。`
        : `${preparedCount}件の請求書PDFをダウンロードしました。各行の「メール作成」で教室ごとに送信してください。`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'メール作成の準備に失敗しました。')
    } finally {
      setIsCreatingAllDrafts(false)
    }
  }

  if (!canUseBilling) {
    return (
      <div className="workspace-auth-shell">
        <div className="workspace-auth-card workspace-auth-card--warning">
          <p className="panel-kicker">Billing Access</p>
          <h1>請求書自動化支援</h1>
          <p>この画面は許可された開発者アカウントのみ利用できます。</p>
          <div className="workspace-status-bar__actions">
            <button className="secondary-button slim" type="button" onClick={onBackToDeveloper}>開発者画面へ戻る</button>
            <button className="secondary-button slim" type="button" onClick={onLogout}>ログアウト</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-shell billing-shell">
      <section className="toolbar-panel" aria-label="請求書自動化支援の操作バー">
        <div className="toolbar-row toolbar-row-primary">
          <div>
            <p className="panel-kicker">Billing Automation</p>
            <h2 className="developer-heading">請求書自動化支援</h2>
          </div>
          <div className="toolbar-group toolbar-group-end">
            <div className="toolbar-status">ログイン中: {currentUser.name}</div>
            <button className="secondary-button slim" type="button" onClick={onBackToDeveloper}>開発者画面</button>
            <button className="secondary-button slim" type="button" onClick={onLogout}>ログアウト</button>
          </div>
        </div>
        <div className="toolbar-row toolbar-row-secondary">
          <div className="toolbar-status">{statusMessage}</div>
        </div>
      </section>

      <main className="developer-main billing-main">
        <section className="board-panel board-panel-unified billing-control-panel">
          <div className="basic-data-header developer-header">
            <div>
              <p className="panel-kicker">対象月</p>
              <h2>{formatBillingMonthLabel(monthKey)}</h2>
              <p className="page-summary">集計基準: {formatJapaneseDate(snapshotDate)} 0:00時点 / 支払期限: {formatJapaneseDate(dueDate)}</p>
              <p className="page-summary billing-ledger-summary">
                {ledgerEntry ? (
                  <>
                    <span className="status-chip secondary">恒久記録</span>
                    {' '}{formatJapaneseDate(snapshotDate)} 0:00時点の在籍生徒数として記録済み（記録日時 {formatDraftCreatedAt(ledgerEntry.recordedAt) || '不明'}{ledgerEntry.source === 'manual' ? ' / 手動記録' : ''}）。名簿を後から直してもこの人数は変わりません。
                    {studentCountAudit.driftRowCount > 0 ? ` 現在の名簿から計算し直すと ${studentCountAudit.driftRowCount} 教室で人数が変わります（請求は記録値で出します）。` : ''}
                  </>
                ) : (
                  <>
                    <span className="status-chip warning">暫定</span>
                    {' '}この日の恒久記録はありません。現在の名簿から計算した参考値です（名簿を直すと人数が変わります）。
                    {isFutureSnapshotDate
                      ? 'まだ来ていない日なので記録もできません（先回りして記録すると、その日の自動記録がスキップされます）。'
                      : isSnapshotDayOfMonth ? '毎月15日 0:00 に自動記録されます。' : `恒久記録があるのは毎月${DEFAULT_BILLING_SNAPSHOT_DAY}日です。`}
                  </>
                )}
              </p>
            </div>
            <div className="basic-data-row-actions developer-actions-right">
              <label className="basic-data-inline-field billing-month-field">
                <span>集計日（請求月）</span>
                <input type="date" value={snapshotDate} onChange={(event) => handleSnapshotDateChange(event.target.value)} />
              </label>
              {!ledgerEntry ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void recordLedgerForSnapshotDate()}
                  disabled={isLoading || isRecordingLedger || isFutureSnapshotDate || rows.length === 0}
                  title={isFutureSnapshotDate
                    ? 'まだ来ていない日は記録できません。先回りして記録すると、その日の自動記録がスキップされてしまいます。'
                    : 'この集計日の在籍生徒数を、後から名簿を直しても変わらない恒久記録として保存します。'}
                >{isRecordingLedger ? '記録中...' : 'この日の人数を恒久記録する'}</button>
              ) : null}
              <button className="primary-button" type="button" onClick={saveAllRows} disabled={isLoading || isSaving || rows.length === 0}>{isSaving ? '保存中...' : '入力内容を保存'}</button>
              <button className="primary-button" type="button" onClick={() => void handlePrepareAll()} disabled={isLoading || isCreatingAllDrafts || rows.length === 0}>{isCreatingAllDrafts ? (isGmailDraftCreationConfigured() ? '下書き作成中...' : 'ダウンロード中...') : (isGmailDraftCreationConfigured() ? '全教室の下書きを作成' : '全教室のPDFをダウンロード')}</button>
            </div>
          </div>
          <div className="workspace-auth-note">{isGmailDraftCreationConfigured()
            ? '各行の「メール作成」で、請求書PDFを添付済みの Gmail 下書きを作成します。Gmail で内容を確認して送信してください。'
            : '各行の「メール作成」で請求書PDFをダウンロードし、宛先・件名・本文を入力済みの Gmail 作成画面が開きます。ダウンロードしたPDFを添付して送信してください。（.env に VITE_GOOGLE_OAUTH_CLIENT_ID を設定すると、PDF添付済みの下書きを自動生成できます）'}</div>
        </section>

        <section className="board-panel board-panel-unified billing-issuer-panel">
          <div className="basic-data-card-head">
            <h3>請求書記載情報</h3>
          </div>
          <div className="developer-classroom-grid">
            <label className="basic-data-inline-field"><span>請求元名</span><input value={issuerInfo.name} onChange={(event) => updateIssuerInfo({ name: event.target.value })} /></label>
            <label className="basic-data-inline-field"><span>住所</span><input value={issuerInfo.address} onChange={(event) => updateIssuerInfo({ address: event.target.value })} /></label>
            <label className="basic-data-inline-field"><span>電話番号</span><input value={issuerInfo.phone} onChange={(event) => updateIssuerInfo({ phone: event.target.value })} /></label>
            <label className="basic-data-inline-field"><span>登録番号</span><input value={issuerInfo.registrationNumber} onChange={(event) => updateIssuerInfo({ registrationNumber: event.target.value })} /></label>
            <label className="basic-data-inline-field billing-wide-field"><span>振込先</span><input value={issuerInfo.bankAccount} onChange={(event) => updateIssuerInfo({ bankAccount: event.target.value })} /></label>
            <label className="basic-data-inline-field billing-wide-field"><span>備考</span><input value={issuerInfo.notes} onChange={(event) => updateIssuerInfo({ notes: event.target.value })} /></label>
          </div>
        </section>

        <section className="board-panel board-panel-unified developer-backup-panel">
          <div className="basic-data-card-head">
            <h3>請求金額サマリー</h3>
          </div>
          <div className="developer-summary-grid billing-summary-grid">
            <div className="developer-summary-card"><span>教室数</span><strong>{rows.length}</strong></div>
            <div className="developer-summary-card">
              <span>在籍生徒数</span>
              <strong>{totals.studentCount}</strong>
              <span className="detail-note">{studentCountAudit.isFullyLedgerBacked ? '恒久記録' : studentCountAudit.ledgerRowCount > 0 ? `恒久記録 ${studentCountAudit.ledgerRowCount}/${rows.length}教室` : '暫定（記録なし）'}</span>
            </div>
            <div className="developer-summary-card"><span>合計金額（税抜）</span><strong>{formatYen(totals.calculatedAmount)}</strong></div>
            <div className="developer-summary-card"><span>請求金額（税抜）</span><strong>{formatYen(totals.billedAmount)}</strong></div>
            <div className="developer-summary-card"><span>消費税（10%）</span><strong>{formatYen(totals.taxAmount)}</strong></div>
            <div className="developer-summary-card"><span>請求金額（税込）</span><strong>{formatYen(totals.billedAmountWithTax)}</strong></div>
          </div>

          <div className="billing-table-scroll">
            <table className="developer-billing-table billing-table">
              <thead>
                <tr>
                  <th>教室</th>
                  <th>送信先</th>
                  <th>生徒数</th>
                  <th>単価</th>
                  <th>合計金額（税抜）</th>
                  <th>請求金額（税抜）</th>
                  <th>消費税（10%）</th>
                  <th>請求金額（税込）</th>
                  <th>備考</th>
                  <th>下書き</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.classroomId}>
                    <td><strong>{row.classroomName}</strong><br /><span className="detail-note">{row.invoiceNumber}</span></td>
                    <td>{row.managerEmail || <span className="basic-data-muted-inline">未設定</span>}</td>
                    <td className="numeric-cell">
                      {row.studentCount.toLocaleString('ja-JP')}人
                      <br />
                      {row.studentCountSource === 'ledger'
                        ? <span className="status-chip secondary">恒久記録</span>
                        : <span className="status-chip warning">暫定</span>}
                      {row.hasStudentCountDrift ? <span className="detail-note">現在の名簿では{row.liveStudentCount.toLocaleString('ja-JP')}人</span> : null}
                    </td>
                    <td className="numeric-cell"><input className="billing-number-input" type="number" min={0} value={row.unitPrice} onChange={(event) => updateRow(row.classroomId, { unitPrice: Number(event.target.value) })} onBlur={() => void saveRow(row)} />円</td>
                    <td className="numeric-cell">{formatYen(row.calculatedAmount)}</td>
                    <td className="numeric-cell"><input className="billing-number-input" type="number" min={0} value={row.billedAmount} onChange={(event) => updateRow(row.classroomId, { billedAmount: Number(event.target.value) })} onBlur={() => void saveRow(row)} />円</td>
                    <td className="numeric-cell">{formatYen(row.taxAmount)}</td>
                    <td className="numeric-cell"><strong>{formatYen(row.billedAmountWithTax)}</strong></td>
                    <td><input className="billing-note-input" value={row.memo} onChange={(event) => updateRow(row.classroomId, { memo: event.target.value })} onBlur={() => void saveRow(row)} /></td>
                    <td>{row.draftCreatedAt ? <span className="status-chip secondary">準備済 {formatDraftCreatedAt(row.draftCreatedAt)}</span> : <span className="status-chip warning">未作成</span>}</td>
                    <td>
                      <div className="basic-data-row-actions billing-row-actions">
                        <button className="secondary-button slim" type="button" onClick={() => updateRow(row.classroomId, { billedAmount: row.calculatedAmount })}>合計を反映</button>
                        <button className="secondary-button slim" type="button" onClick={() => void saveRow(row)} disabled={isSaving}>保存</button>
                        <button className="primary-button slim" type="button" onClick={() => void handlePrepareMail(row)} disabled={draftingClassroomId === row.classroomId || isCreatingAllDrafts}>{draftingClassroomId === row.classroomId ? '準備中...' : 'メール作成'}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>合計</td>
                  <td className="numeric-cell">{totals.studentCount.toLocaleString('ja-JP')}人</td>
                  <td></td>
                  <td className="numeric-cell">{formatYen(totals.calculatedAmount)}</td>
                  <td className="numeric-cell">{formatYen(totals.billedAmount)}</td>
                  <td className="numeric-cell">{formatYen(totals.taxAmount)}</td>
                  <td className="numeric-cell"><strong>{formatYen(totals.billedAmountWithTax)}</strong></td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}