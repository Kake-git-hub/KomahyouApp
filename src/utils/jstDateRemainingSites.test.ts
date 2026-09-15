// UTC の日付(toISOString().slice(0, 10))を使っていて JST 0:00〜8:59 に前日になっていた 3 か所の回帰防止(2026-09-16)。
// 境界 = UTC 14:59:59(JST 23:59:59)/ UTC 15:00(JST 翌日 0:00)。「今日」の正本は jstDate.ts getJstTodayDateKey。
// ※ バックアップの日付キー(Storage パス)はサーバー側 toQuarterHourlyDateKeyJst で既に JST。ここの 3 か所はそれと無関係。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StudentRow } from '../components/basic-data/basicDataModel'
import { listInitialSetupActiveStudents } from '../components/backup-restore/BackupRestoreScreen'
import { buildInitialProvisionDraft, countActiveStudents } from '../components/developer-admin/DeveloperAdminScreen'
import type { AppSnapshotPayload } from '../types/appState'
import type { BillingInvoiceRow } from './billing'
import { getJstTodayDateKey } from './jstDate'
import { buildInvoiceHtml } from './invoicePdf'

const BEFORE = new Date('2026-09-15T14:59:59.999Z') // JST 2026-09-15 23:59:59
const AFTER = new Date('2026-09-15T15:00:00.000Z') // JST 2026-09-16 00:00
const MORNING = new Date('2026-09-15T23:30:00.000Z') // JST 2026-09-16 08:30(UTC ではまだ 9/15)

function student(id: string, entryDate: string, withdrawDate = ''): StudentRow {
  return { id, name: id, displayName: id, email: '', entryDate, withdrawDate, birthDate: '2012-05-01' } as StudentRow
}

// 9/16 入塾の生徒と 9/16 退塾の生徒(isActiveOnDate は退塾日当日から非在籍)。
const students = [
  student('enter0916', '2026-09-16'),
  student('withdraw0916', '2026-04-01', '2026-09-16'),
  student('always', '2026-04-01'),
]

describe('請求書の発行日は JST(invoicePdf.ts)', () => {
  const row = {
    classroomId: 'c1', classroomName: 'テスト教室', managerEmail: '', monthKey: '2026-09', snapshotDate: '2026-09-15',
    studentCount: 1, unitPrice: 300, calculatedAmount: 300, billedAmount: 300, taxAmount: 30, billedAmountWithTax: 330,
    invoiceNumber: 'INV-1', memo: '',
  } as BillingInvoiceRow

  it('UTC 14:59:59 は当日', () => {
    expect(buildInvoiceHtml(row, {}, BEFORE)).toContain('発行日: 2026年9月15日')
  })
  it('UTC 15:00 は JST の翌日', () => {
    expect(buildInvoiceHtml(row, {}, AFTER)).toContain('発行日: 2026年9月16日')
  })
  it('JST 朝 8:30 に発行しても前日付にならない', () => {
    expect(buildInvoiceHtml(row, {}, MORNING)).toContain('発行日: 2026年9月16日')
  })
})

describe('初期在庫登録の生徒選択肢は JST の今日で在籍判定(BackupRestoreScreen.tsx)', () => {
  const ids = (now: Date) => listInitialSetupActiveStudents(students, now).map((s) => s.id).sort()

  it('UTC 14:59:59(JST 9/15)は 9/16 入塾生徒を出さない', () => {
    expect(ids(BEFORE)).toEqual(['always', 'withdraw0916'])
  })
  it('UTC 15:00(JST 9/16)は 9/16 入塾生徒を出し、9/16 退塾生徒を出さない', () => {
    expect(ids(AFTER)).toEqual(['always', 'enter0916'])
  })
  it('JST 朝 8:30 でも 9/16 として判定する', () => {
    expect(ids(MORNING)).toEqual(['always', 'enter0916'])
  })
})

describe('開発者管理画面の今日は JST(DeveloperAdminScreen.tsx)', () => {
  it('教室追加フォームの契約開始日: UTC 14:59:59 は当日 / UTC 15:00 は翌日', () => {
    expect(buildInitialProvisionDraft(2, BEFORE).contractStartDate).toBe('2026-09-15')
    expect(buildInitialProvisionDraft(2, AFTER).contractStartDate).toBe('2026-09-16')
    expect(buildInitialProvisionDraft(2, MORNING).contractStartDate).toBe('2026-09-16')
    expect(buildInitialProvisionDraft(2, AFTER).classroomName).toBe('新規教室 3')
  })

  it('在籍数: JST の今日を基準日にすると境界で切り替わる', () => {
    const snapshot = { students } as unknown as AppSnapshotPayload
    const lateStarter = { students: [...students, student('enter0916b', '2026-09-16')] } as unknown as AppSnapshotPayload
    // JST 9/15: always + withdraw0916 = 2 / JST 9/16(朝 8:30 含む): always + enter0916 + enter0916b = 3
    expect(countActiveStudents(snapshot, getJstTodayDateKey(BEFORE))).toBe(2)
    expect(countActiveStudents(lateStarter, getJstTodayDateKey(BEFORE))).toBe(2)
    expect(countActiveStudents(lateStarter, getJstTodayDateKey(AFTER))).toBe(3)
    expect(countActiveStudents(lateStarter, getJstTodayDateKey(MORNING))).toBe(3)
  })

  it('3 ファイルに UTC の日付切り出しが戻っていない(在籍数の基準日は getJstTodayDateKey)', () => {
    const files = [
      '../components/backup-restore/BackupRestoreScreen.tsx',
      '../components/developer-admin/DeveloperAdminScreen.tsx',
      './invoicePdf.ts',
    ]
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source, file).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/)
    }
    const admin = readFileSync(new URL('../components/developer-admin/DeveloperAdminScreen.tsx', import.meta.url), 'utf8')
    expect(admin).toMatch(/todayDateKey = useMemo\(\(\) => getJstTodayDateKey\(\)/)
  })
})
