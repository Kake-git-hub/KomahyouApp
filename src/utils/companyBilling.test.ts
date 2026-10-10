import { describe, expect, it } from 'vitest'
import type { BillingInvoiceRow } from './billing'
import {
  buildCompanyInvoice,
  buildCompanyInvoiceNumber,
  companyDisplayLabel,
  isBillingAllowedUser,
  normalizeRecipientEmail,
  parseCompanyBillingProfile,
  resolveBillingUnitPrice,
  resolveCompanyInvoiceExcludedIds,
  toggleCompanyInvoiceExclusion,
} from './companyBilling'

function row(overrides: Partial<BillingInvoiceRow>): BillingInvoiceRow {
  return {
    classroomId: overrides.classroomId ?? 'c1',
    classroomName: overrides.classroomName ?? '教室',
    managerEmail: '',
    monthKey: overrides.monthKey ?? '2026-10',
    snapshotDate: '2026-10-15',
    studentCount: overrides.studentCount ?? 10,
    unitPrice: overrides.unitPrice ?? 300,
    calculatedAmount: 0,
    billedAmount: overrides.billedAmount ?? (overrides.studentCount ?? 10) * (overrides.unitPrice ?? 300),
    taxAmount: 0,
    billedAmountWithTax: 0,
    invoiceNumber: '',
    memo: '',
  }
}

describe('parseCompanyBillingProfile(棟の文書 → 会社の請求プロファイル・P-11 ①)', () => {
  it('provision-workspace.mjs が書く形を読む', () => {
    const profile = parseCompanyBillingProfile('demo', {
      name: 'demo', companyName: '株式会社デモ', brandName: 'デモ塾',
      billing: { recipientName: '株式会社デモ 経理部', recipientEmail: 'keiri@demo.example.com', standardUnitPrice: 350 },
    })
    expect(profile).toEqual({ workspaceKey: 'demo', companyName: '株式会社デモ', brandName: 'デモ塾', recipientName: '株式会社デモ 経理部', recipientEmail: 'keiri@demo.example.com', standardUnitPrice: 350, excludedClassroomIds: null })
  })

  it('既存運営会社(main)のように会社の項目が無い棟の文書でも落ちない(空・null → 従来の挙動)', () => {
    const profile = parseCompanyBillingProfile('main', { name: 'main', schemaVersion: 1 })
    expect(profile).toEqual({ workspaceKey: 'main', companyName: '', brandName: '', recipientName: '', recipientEmail: '', standardUnitPrice: null, excludedClassroomIds: null })
    expect(companyDisplayLabel(profile)).toBe('main')
    expect(parseCompanyBillingProfile('x', undefined).standardUnitPrice).toBeNull()
    expect(parseCompanyBillingProfile('x', { billing: { standardUnitPrice: '400' } }).standardUnitPrice).toBe(400)
    expect(parseCompanyBillingProfile('x', { billing: { standardUnitPrice: -1 } }).standardUnitPrice).toBeNull()
    expect(parseCompanyBillingProfile('x', { companyName: '会社', billing: {} }).recipientName).toBe('会社')
  })
})

describe('resolveBillingUnitPrice(保存済み行 > 教室 > 会社標準 > 既定 300・§7-13)', () => {
  it('優先順どおりに決まる', () => {
    expect(resolveBillingUnitPrice({ recordUnitPrice: 280, classroomUnitPrice: 320, companyStandardUnitPrice: 350 })).toBe(280)
    expect(resolveBillingUnitPrice({ recordUnitPrice: null, classroomUnitPrice: 320, companyStandardUnitPrice: 350 })).toBe(320)
    expect(resolveBillingUnitPrice({ classroomUnitPrice: undefined, companyStandardUnitPrice: 350 })).toBe(350)
    expect(resolveBillingUnitPrice({})).toBe(300)
    expect(resolveBillingUnitPrice({ recordUnitPrice: 0 })).toBe(0)
    expect(resolveBillingUnitPrice({ recordUnitPrice: -5, companyStandardUnitPrice: 350 })).toBe(350)
  })

  it('既存運営会社(main・標準単価 null)は従来どおり「教室単価 → 300 円」(出力不変)', () => {
    expect(resolveBillingUnitPrice({ recordUnitPrice: undefined, classroomUnitPrice: undefined, companyStandardUnitPrice: null })).toBe(300)
    expect(resolveBillingUnitPrice({ classroomUnitPrice: 250, companyStandardUnitPrice: null })).toBe(250)
  })
})

describe('buildCompanyInvoice(会社宛合算請求書・P-11 ②)', () => {
  const profile = parseCompanyBillingProfile('demo', { companyName: '株式会社デモ', billing: { recipientName: '株式会社デモ 御担当', recipientEmail: 'k@demo.example.com', standardUnitPrice: 300 } })

  it('教室行を教室名順に並べて合算し、税は合算の税抜額に 1 回かける', () => {
    const invoice = buildCompanyInvoice({
      profile,
      rows: [
        row({ classroomId: 'b', classroomName: 'みどり校', studentCount: 7, unitPrice: 300, billedAmount: 2105 }),
        row({ classroomId: 'a', classroomName: 'あおぞら校', studentCount: 10, unitPrice: 300, billedAmount: 3005 }),
      ],
      monthKey: '2026-10',
      snapshotDate: '2026-10-15',
    })
    expect(invoice.lines.map((line) => line.classroomName)).toEqual(['あおぞら校', 'みどり校'])
    expect(invoice.studentCount).toBe(17)
    expect(invoice.calculatedAmount).toBe(5100)
    expect(invoice.billedAmount).toBe(5110)
    // 教室ごとの税(301 + 211 = 512)ではなく合算 5110 × 10% = 511(端数処理 1 回)。
    expect(invoice.taxAmount).toBe(511)
    expect(invoice.billedAmountWithTax).toBe(5621)
    expect(invoice.invoiceNumber).toBe('INV-202610-DEMO-ALL')
    expect(invoice.companyName).toBe('株式会社デモ')
    expect(invoice.recipientName).toBe('株式会社デモ 御担当')
    expect(invoice.recipientEmail).toBe('k@demo.example.com')
  })

  it('別の月の行は混ぜない・会社名未設定なら workspaceKey を宛名にする', () => {
    const invoice = buildCompanyInvoice({
      profile: parseCompanyBillingProfile('main', {}),
      rows: [row({ monthKey: '2026-10' }), row({ classroomId: 'c2', monthKey: '2026-09' })],
      monthKey: '2026-10',
      snapshotDate: '2026-10-15',
    })
    expect(invoice.lines).toHaveLength(1)
    expect(invoice.companyName).toBe('main')
    expect(invoice.recipientName).toBe('main')
    expect(invoice.invoiceNumber).toBe('INV-202610-MAIN-ALL')
  })

  it('0 教室でも 0 円の請求書(落ちない)', () => {
    const invoice = buildCompanyInvoice({ profile, rows: [], monthKey: '2026-10', snapshotDate: '2026-10-15' })
    expect(invoice.lines).toEqual([])
    expect(invoice.billedAmountWithTax).toBe(0)
  })

  it('buildCompanyInvoiceNumber は教室宛(INV-YYYYMM-<教室>)と区別できる -ALL 付き', () => {
    expect(buildCompanyInvoiceNumber('demo', '2026-10')).toBe('INV-202610-DEMO-ALL')
    expect(buildCompanyInvoiceNumber('', '2026-10')).toBe('INV-202610-COMPANY-ALL')
  })
})

describe('isBillingAllowedUser(P-11 ④ 第 1 段: フラグ または メール固定・developer のみ)', () => {
  it('従来のメール固定は引き続き通る(フラグ無しの既存会員 = 出力不変)', () => {
    expect(isBillingAllowedUser({ email: 'bkkdmzn@gmail.com', role: 'developer' })).toBe(true)
    expect(isBillingAllowedUser({ email: 'bkkdmzn@gmail.com', role: 'developer', billingAllowed: false })).toBe(true)
  })

  it('フラグ billingAllowed:true の developer は固定メールでなくても通る(2 社目の請求担当)', () => {
    expect(isBillingAllowedUser({ email: 'owner@demo.example.com', role: 'developer', billingAllowed: true })).toBe(true)
    expect(isBillingAllowedUser({ email: 'owner@demo.example.com', role: 'developer' })).toBe(false)
    expect(isBillingAllowedUser({ email: 'owner@demo.example.com', role: 'developer', billingAllowed: false })).toBe(false)
  })

  it('manager はフラグがあっても固定メールでも通らない', () => {
    expect(isBillingAllowedUser({ email: 'bkkdmzn@gmail.com', role: 'manager', billingAllowed: true })).toBe(false)
    expect(isBillingAllowedUser(null)).toBe(false)
  })
})

// オーナー要望(2026-10-10): テスト教室・開発用教室は合算に出したくない → 教室ごとに「合算に含める」チェック。
describe('合算に含める教室(excludedClassroomIds)', () => {
  it('未保存(null)なら登録済みの検証用教室(開発用教室・テスト教室)だけを既定で除外する', () => {
    const profile = parseCompanyBillingProfile('main', {})
    const excluded = resolveCompanyInvoiceExcludedIds(profile, ['v8OZ7zH8vONNHjjYVcR1', 'test_classroom_20260507_dai', 'prodA', 'prodB'])
    expect([...excluded].sort()).toEqual(['test_classroom_20260507_dai', 'v8OZ7zH8vONNHjjYVcR1'])
    // 別会社では main の開発用教室 ID でも既定除外しない(台帳は (workspaceKey, classroomId) の完全一致)。
    expect([...resolveCompanyInvoiceExcludedIds(parseCompanyBillingProfile('demo', {}), ['v8OZ7zH8vONNHjjYVcR1'])]).toEqual([])
  })

  it('保存済み(配列)ならその一覧どおり・空配列は「全教室を含める」(既定除外を使わない)', () => {
    const saved = parseCompanyBillingProfile('main', { billing: { excludedClassroomIds: ['prodB'] } })
    expect([...resolveCompanyInvoiceExcludedIds(saved, ['v8OZ7zH8vONNHjjYVcR1', 'prodB'])]).toEqual(['prodB'])
    const none = parseCompanyBillingProfile('main', { billing: { excludedClassroomIds: [] } })
    expect([...resolveCompanyInvoiceExcludedIds(none, ['v8OZ7zH8vONNHjjYVcR1'])]).toEqual([])
    expect(parseCompanyBillingProfile('x', { billing: { excludedClassroomIds: [' b ', 'a', 'a', 3, ''] } }).excludedClassroomIds).toEqual(['a', 'b'])
  })

  it('チェックの切替は現在の除外集合から保存値(ソート済み)を作る', () => {
    const current = new Set(['dev', 'test'])
    expect(toggleCompanyInvoiceExclusion(current, 'dev', true)).toEqual(['test'])
    expect(toggleCompanyInvoiceExclusion(current, 'prodA', false)).toEqual(['dev', 'prodA', 'test'])
    expect(toggleCompanyInvoiceExclusion(current, 'dev', false)).toEqual(['dev', 'test'])
  })

  it('buildCompanyInvoice は除外した教室を明細・合計から外す(0 円のテスト教室・開発用教室が合算に出ない)', () => {
    const profile = parseCompanyBillingProfile('main', {})
    const rows = [
      row({ classroomId: 'prodA', classroomName: '緑が丘校', studentCount: 40, billedAmount: 12000 }),
      row({ classroomId: 'test_classroom_20260507_dai', classroomName: 'テスト教室', studentCount: 140, billedAmount: 0 }),
      row({ classroomId: 'v8OZ7zH8vONNHjjYVcR1', classroomName: '開発用教室', studentCount: 144, billedAmount: 0 }),
    ]
    const excluded = resolveCompanyInvoiceExcludedIds(profile, rows.map((entry) => entry.classroomId))
    const invoice = buildCompanyInvoice({ profile, rows, monthKey: '2026-10', snapshotDate: '2026-10-15', excludedClassroomIds: excluded })
    expect(invoice.lines.map((line) => line.classroomName)).toEqual(['緑が丘校'])
    expect(invoice.studentCount).toBe(40)
    expect(invoice.calculatedAmount).toBe(12000)
    // 省略時は従来どおり全教室。
    expect(buildCompanyInvoice({ profile, rows, monthKey: '2026-10', snapshotDate: '2026-10-15' }).lines).toHaveLength(3)
  })
})

// オーナー要望(2026-10-10): 合算請求先のメールアドレスを入力して、会社宛合算のメール下書きを作る。
describe('normalizeRecipientEmail(合算請求先メール)', () => {
  it('前後の空白を落として小文字化・空は未設定として有効', () => {
    expect(normalizeRecipientEmail('  Keiri@Example.COM ')).toEqual({ ok: true, value: 'keiri@example.com' })
    expect(normalizeRecipientEmail('')).toEqual({ ok: true, value: '' })
    expect(normalizeRecipientEmail('   ')).toEqual({ ok: true, value: '' })
  })

  it('形式が不正・複数指定は ok:false(保存しない)', () => {
    expect(normalizeRecipientEmail('keiri').ok).toBe(false)
    expect(normalizeRecipientEmail('keiri@example').ok).toBe(false)
    expect(normalizeRecipientEmail('a@example.com, b@example.com').ok).toBe(false)
    expect(normalizeRecipientEmail('a@example.com;b@example.com').ok).toBe(false)
    expect(normalizeRecipientEmail('a b@example.com').ok).toBe(false)
  })
})
