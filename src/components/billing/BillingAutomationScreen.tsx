import { useEffect, useMemo, useState } from 'react'
import { createGmailDraftWithPdf, isGmailDraftCreationConfigured, requestGmailComposeAccessToken } from '../../integrations/gmail/drafts'
import { loadFirebaseBillingMonth, markFirebaseBillingDraftCreated, saveFirebaseBillingRow, saveFirebaseBillingRows, type BillingClassroomRecord } from '../../integrations/firebase/billingStore'
import type { WorkspaceClassroom, WorkspaceUser } from '../../types/appState'
import { buildInvoiceNumber, calculateBillingAmounts, countActiveStudentsForBilling, formatBillingMonthLabel, formatJapaneseDate, formatYen, getBillingDueDate, getBillingSnapshotDate, getCurrentBillingMonthKey, isBillingAllowedEmail, normalizeBillingMonthKey, type BillingInvoiceRow, type BillingMonthKey } from '../../utils/billing'
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
}

const DEFAULT_STUDENT_UNIT_PRICE = 300
const ISSUER_STORAGE_KEY = 'billingInvoiceIssuerInfo:v1'

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

function buildBillingRows(params: {
  classrooms: WorkspaceClassroom[]
  users: WorkspaceUser[]
  monthKey: BillingMonthKey
  records: BillingClassroomRecord[]
}) {
  const recordByClassroomId = new Map(params.records.map((record) => [record.classroomId, record]))
  const managerById = new Map(params.users.map((user) => [user.id, user]))
  const snapshotDate = getBillingSnapshotDate(params.monthKey)

  return params.classrooms.map((classroom): BillingRowDraft => {
    const record = recordByClassroomId.get(classroom.id)
    const manager = managerById.get(classroom.managerUserId)
    const studentCount = record?.studentCount ?? countActiveStudentsForBilling(classroom.data.students, params.monthKey)
    const unitPrice = record?.unitPrice ?? classroom.studentUnitPrice ?? DEFAULT_STUDENT_UNIT_PRICE
    const amounts = calculateBillingAmounts(studentCount, unitPrice, record?.billedAmount)

    return {
      classroomId: classroom.id,
      classroomName: classroom.name || record?.classroomName || '名称未設定の教室',
      managerEmail: manager?.email || record?.managerEmail || '',
      monthKey: params.monthKey,
      snapshotDate: record?.snapshotDate || snapshotDate,
      studentCount: amounts.studentCount,
      unitPrice: amounts.unitPrice,
      calculatedAmount: amounts.calculatedAmount,
      billedAmount: amounts.billedAmount,
      invoiceNumber: record?.invoiceNumber || buildInvoiceNumber(classroom.id, params.monthKey),
      memo: record?.memo ?? '',
      draftId: record?.draftId,
      draftCreatedAt: record?.draftCreatedAt,
    }
  })
}

function buildDraftBody(row: BillingInvoiceRow) {
  return [
    `${row.classroomName} 御中`,
    '',
    `${formatBillingMonthLabel(row.monthKey)}の請求書を添付いたします。`,
    '',
    `生徒数: ${row.studentCount.toLocaleString('ja-JP')}人`,
    `単価: ${formatYen(row.unitPrice)}`,
    `合計金額: ${formatYen(row.calculatedAmount)}`,
    `請求金額: ${formatYen(row.billedAmount)}`,
    `支払期限: ${formatJapaneseDate(getBillingDueDate(row.monthKey))}`,
    '',
    'ご確認のほど、よろしくお願いいたします。',
  ].join('\n')
}

function formatDraftCreatedAt(value: string | undefined) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('ja-JP')
}

export function BillingAutomationScreen({ currentUser, authMode, classrooms, users, onBackToDeveloper, onLogout }: BillingAutomationScreenProps) {
  const [monthKey, setMonthKey] = useState<BillingMonthKey>(() => getCurrentBillingMonthKey())
  const [rows, setRows] = useState<BillingRowDraft[]>([])
  const [issuerInfo, setIssuerInfo] = useState<InvoiceIssuerInfo>(() => loadStoredIssuerInfo())
  const [statusMessage, setStatusMessage] = useState('請求データを読み込んでいます。')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [draftingClassroomId, setDraftingClassroomId] = useState<string | null>(null)
  const [isCreatingAllDrafts, setIsCreatingAllDrafts] = useState(false)

  const canUseBilling = isBillingAllowedEmail(currentUser.email) && currentUser.role === 'developer'
  const snapshotDate = getBillingSnapshotDate(monthKey)
  const dueDate = getBillingDueDate(monthKey)
  const totals = useMemo(() => rows.reduce((summary, row) => ({
    studentCount: summary.studentCount + row.studentCount,
    calculatedAmount: summary.calculatedAmount + row.calculatedAmount,
    billedAmount: summary.billedAmount + row.billedAmount,
  }), { studentCount: 0, calculatedAmount: 0, billedAmount: 0 }), [rows])

  useEffect(() => {
    if (!canUseBilling) return
    let cancelled = false

    setIsLoading(true)
    setStatusMessage('請求データを読み込んでいます。')
    void (async () => {
      try {
        const records = authMode === 'firebase' ? await loadFirebaseBillingMonth(monthKey) : []
        if (cancelled) return

        const nextRows = buildBillingRows({ classrooms, users, monthKey, records })
        setRows(nextRows)

        if (authMode === 'firebase' && records.length < classrooms.length) {
          await saveFirebaseBillingRows(nextRows)
          if (!cancelled) setStatusMessage(`${formatBillingMonthLabel(monthKey)}の請求スナップショットを保存しました。`)
          return
        }

        setStatusMessage(`${formatBillingMonthLabel(monthKey)}の請求データを読み込みました。`)
      } catch (error) {
        if (!cancelled) setStatusMessage(error instanceof Error ? error.message : '請求データの読み込みに失敗しました。')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authMode, canUseBilling, classrooms, monthKey, users])

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

  const createDraftForRow = async (row: BillingRowDraft, accessToken?: string) => {
    if (!row.managerEmail.trim()) throw new Error(`${row.classroomName} の管理者メールが未設定です。`)
    const token = accessToken ?? await requestGmailComposeAccessToken()
    const pdfBlob = await createInvoicePdfBlob(row, issuerInfo)
    const result = await createGmailDraftWithPdf({
      accessToken: token,
      to: row.managerEmail,
      subject: `${formatBillingMonthLabel(row.monthKey)} 請求書`,
      bodyText: buildDraftBody(row),
      pdfBlob,
      pdfFileName: buildInvoicePdfFileName(row),
    })
    if (authMode === 'firebase') {
      await markFirebaseBillingDraftCreated({ monthKey: row.monthKey, classroomId: row.classroomId, draftId: result.id })
    }
    const draftCreatedAt = new Date().toISOString()
    setRows((currentRows) => currentRows.map((entry) => entry.classroomId === row.classroomId ? { ...entry, draftId: result.id, draftCreatedAt } : entry))
    return result.id
  }

  const handleCreateDraft = async (row: BillingRowDraft) => {
    setDraftingClassroomId(row.classroomId)
    setStatusMessage(`${row.classroomName} の Gmail 下書きを作成しています。`)
    try {
      await createDraftForRow(row)
      setStatusMessage(`${row.classroomName} の Gmail 下書きを作成しました。Gmail で内容確認後に送信してください。`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Gmail 下書き作成に失敗しました。')
    } finally {
      setDraftingClassroomId(null)
    }
  }

  const handleCreateAllDrafts = async () => {
    setIsCreatingAllDrafts(true)
    setStatusMessage('Gmail 下書きを一括作成しています。')
    try {
      const token = await requestGmailComposeAccessToken()
      let createdCount = 0
      for (const row of rows) {
        await createDraftForRow(row, token)
        createdCount += 1
        setStatusMessage(`Gmail 下書きを作成中です (${createdCount}/${rows.length})。`)
      }
      setStatusMessage(`${createdCount}件の Gmail 下書きを作成しました。Gmail で内容確認後に送信してください。`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Gmail 下書きの一括作成に失敗しました。')
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
            </div>
            <div className="basic-data-row-actions developer-actions-right">
              <label className="basic-data-inline-field billing-month-field">
                <span>請求月</span>
                <input type="month" value={monthKey} onChange={(event) => setMonthKey(normalizeBillingMonthKey(event.target.value, monthKey))} />
              </label>
              <button className="primary-button" type="button" onClick={saveAllRows} disabled={isLoading || isSaving || rows.length === 0}>{isSaving ? '保存中...' : '入力内容を保存'}</button>
              <button className="primary-button" type="button" onClick={() => void handleCreateAllDrafts()} disabled={isLoading || isCreatingAllDrafts || rows.length === 0 || !isGmailDraftCreationConfigured()}>{isCreatingAllDrafts ? '下書き作成中...' : '全教室の請求書を送信'}</button>
            </div>
          </div>
          {!isGmailDraftCreationConfigured() ? <div className="workspace-auth-note workspace-auth-note-error">Gmail 下書き作成には `VITE_GOOGLE_OAUTH_CLIENT_ID` の設定が必要です。</div> : null}
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
            <div className="developer-summary-card"><span>在籍生徒数</span><strong>{totals.studentCount}</strong></div>
            <div className="developer-summary-card"><span>合計金額</span><strong>{formatYen(totals.calculatedAmount)}</strong></div>
            <div className="developer-summary-card"><span>請求金額</span><strong>{formatYen(totals.billedAmount)}</strong></div>
          </div>

          <div className="billing-table-scroll">
            <table className="developer-billing-table billing-table">
              <thead>
                <tr>
                  <th>教室</th>
                  <th>送信先</th>
                  <th>生徒数</th>
                  <th>単価</th>
                  <th>合計金額</th>
                  <th>請求金額</th>
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
                    <td className="numeric-cell">{row.studentCount.toLocaleString('ja-JP')}人</td>
                    <td className="numeric-cell"><input className="billing-number-input" type="number" min={0} value={row.unitPrice} onChange={(event) => updateRow(row.classroomId, { unitPrice: Number(event.target.value) })} onBlur={() => void saveRow(row)} />円</td>
                    <td className="numeric-cell">{formatYen(row.calculatedAmount)}</td>
                    <td className="numeric-cell"><input className="billing-number-input" type="number" min={0} value={row.billedAmount} onChange={(event) => updateRow(row.classroomId, { billedAmount: Number(event.target.value) })} onBlur={() => void saveRow(row)} />円</td>
                    <td><input className="billing-note-input" value={row.memo} onChange={(event) => updateRow(row.classroomId, { memo: event.target.value })} onBlur={() => void saveRow(row)} /></td>
                    <td>{row.draftId ? <span className="status-chip secondary">作成済 {formatDraftCreatedAt(row.draftCreatedAt)}</span> : <span className="status-chip warning">未作成</span>}</td>
                    <td>
                      <div className="basic-data-row-actions billing-row-actions">
                        <button className="secondary-button slim" type="button" onClick={() => updateRow(row.classroomId, { billedAmount: row.calculatedAmount })}>合計を反映</button>
                        <button className="secondary-button slim" type="button" onClick={() => void saveRow(row)} disabled={isSaving}>保存</button>
                        <button className="primary-button slim" type="button" onClick={() => void handleCreateDraft(row)} disabled={draftingClassroomId === row.classroomId || isCreatingAllDrafts || !isGmailDraftCreationConfigured()}>{draftingClassroomId === row.classroomId ? '作成中...' : '請求書を送信'}</button>
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