// テスト教室の確認リスト(2026-10-14 オーナー指示「テスト教室にも確認リストを設けて」)の回帰防止テスト。
// 定義の形(id の接頭辞・一意・手順の上限・実名なし)と、開いている教室で定義を選ぶ規則を固定する。

import { describe, expect, it } from 'vitest'

import { DEVELOPMENT_CLASSROOM_REGISTRY } from './developmentClassroomRegistry'
import {
  VERIFICATION_CHECKLIST,
  buildVerificationChecklistMarker,
  buildVerificationChecklistReportNotes,
  createEmptyVerificationChecklistDraft,
  resolveVerificationChecklistText,
  setVerificationChecklistEntry,
  verificationChecklistStorageKey,
} from './verificationChecklist'
import {
  TEST_CLASSROOM_VERIFICATION_CHECKLIST,
  TEST_CLASSROOM_VERIFICATION_CHECKLIST_ID_PREFIX,
  TEST_CLASSROOM_VERIFICATION_CHECKLIST_TARGET,
  TEST_CLASSROOM_VERIFICATION_CHECKLIST_VERSION,
  findTestClassroomVerificationChecklistRegistryEntry,
  isTestClassroomVerificationChecklistTarget,
  resolveVerificationChecklistDefinitionFor,
} from './verificationChecklistTestClassroom'

const ITEMS = TEST_CLASSROOM_VERIFICATION_CHECKLIST.items

describe('テスト教室の確認リストの項目定義', () => {
  it('第 1 版(v1.5.596): 準備・在庫/回数の不変・保留の表示と片づけ・同じ内容は保留にしない・日程表/PDF/共有・日常操作の 23 項目', () => {
    expect(TEST_CLASSROOM_VERIFICATION_CHECKLIST.version).toBe('v1.5.596')
    expect(TEST_CLASSROOM_VERIFICATION_CHECKLIST_VERSION).toBe(TEST_CLASSROOM_VERIFICATION_CHECKLIST.version)
    expect(ITEMS.map((item) => item.id)).toEqual([
      'tc-00',
      'tc-s1', 'tc-s2', 'tc-s3', 'tc-s4',
      'tc-p1', 'tc-p2', 'tc-p3', 'tc-p4', 'tc-p5', 'tc-p6', 'tc-p7',
      'tc-m1', 'tc-m2', 'tc-m3',
      'tc-v1', 'tc-v2', 'tc-v3',
      'tc-r1', 'tc-r2', 'tc-r3', 'tc-r4', 'tc-r5',
    ])
    for (const item of ITEMS) expect(item.introducedIn, item.id).toBe('v1.5.596')
  })

  it('id は tc- 始まりで一意。開発用教室の確認リストの id と重ならない(同じ developerReports に載るため)', () => {
    const ids = ITEMS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    const devIds = new Set(VERIFICATION_CHECKLIST.items.map((item) => item.id))
    for (const id of ids) {
      expect(id, id).toMatch(new RegExp(`^${TEST_CLASSROOM_VERIFICATION_CHECKLIST_ID_PREFIX}[a-z0-9]+$`, 'u'))
      expect(devIds.has(id), `${id} が開発用教室の id と重なる`).toBe(false)
    }
    // 開発用教室側にも tc- を使わせない(今後の追加で混ざらないように)。
    for (const id of devIds) expect(id.startsWith(TEST_CLASSROOM_VERIFICATION_CHECKLIST_ID_PREFIX), id).toBe(false)
  })

  it('全項目が 前提(1 行)・操作(1〜2)・見るところ(最大 4)の形で、版と分類を持つ(開発用教室の確認リストと同じ上限)', () => {
    for (const item of ITEMS) {
      expect(item.introducedIn, item.id).toMatch(/^v\d+\.\d+\.\d+$/u)
      expect(item.steps.length, item.id).toBeGreaterThan(0)
      expect(item.steps.length, `${item.id} の操作が多すぎる`).toBeLessThanOrEqual(2)
      expect(item.check?.length ?? 0, `${item.id} の見るところが多すぎる`).toBeLessThanOrEqual(4)
      expect(item.check?.length ?? 0, `${item.id} に見るところが無い`).toBeGreaterThan(0)
      if (item.prep !== undefined) expect(item.prep, item.id).not.toContain('\n')
      for (const line of [...item.steps, ...(item.check ?? [])]) expect(line.trim(), item.id).not.toBe('')
      expect(item.title.trim(), item.id).not.toBe('')
      expect(item.area.trim(), item.id).not.toBe('')
    }
  })

  it('前書きと対象ラベルを持ち、分類は 0〜5 の順に並ぶ', () => {
    expect(TEST_CLASSROOM_VERIFICATION_CHECKLIST.scopeLabel).toBe('テスト教室(全校展開前の最終テスト)')
    expect(TEST_CLASSROOM_VERIFICATION_CHECKLIST.intro?.length).toBeGreaterThanOrEqual(3)
    for (const line of TEST_CLASSROOM_VERIFICATION_CHECKLIST.intro ?? []) expect(line.trim()).not.toBe('')
    const areas = [...new Set(ITEMS.map((item) => item.area))]
    expect(areas.map((area) => area.slice(0, 2))).toEqual(['0.', '1.', '2.', '3.', '4.', '5.'])
  })

  it('実名(姓 全角スペース 名)と生徒名の差し込み {{student:…}} を使わない(テスト教室のデータは担当者が作る)', () => {
    for (const item of ITEMS) {
      for (const line of [item.title, item.prep ?? '', ...item.steps, ...(item.check ?? [])]) {
        expect(line, item.id).not.toMatch(/[一-龠ぁ-んァ-ヶ]+\u3000[一-龠ぁ-んァ-ヶ]+/u)
        expect(line, item.id).not.toContain('{{')
        expect(resolveVerificationChecklistText(line), item.id).toBe(line)
      }
    }
    for (const line of TEST_CLASSROOM_VERIFICATION_CHECKLIST.intro ?? []) expect(line).not.toContain('{{')
  })

  it('保証の芯(在庫の不変・日程表との一致・保留の下段は盤面専用)を手作業で確かめる項目を持つ', () => {
    const joined = (item: (typeof ITEMS)[number]) => [item.title, item.prep ?? '', ...item.steps, ...(item.check ?? [])].join(' / ')
    // 在庫(INV-06): テンプレ保存だけでは未消化振替・未消化講習が動かない。
    for (const id of ['tc-s1', 'tc-s2', 'tc-s3', 'tc-p1', 'tc-p2']) {
      const item = ITEMS.find((row) => row.id === id)!
      expect(joined(item), id).toMatch(/未消化振替.*(変わらない|同じ)/u)
    }
    // テンプレを採用すると在庫由来の振替だけ未消化へ戻る(全コマ削除と同じ裁定)。
    expect(joined(ITEMS.find((row) => row.id === 'tc-p3')!)).toContain('手動追加の振替は在庫を使っていない')
    // 日程表との一致(INV-04・INV-05)と、保留の下段は日程表・PDF・配布用盤面に出ない(INV-13)。
    expect(joined(ITEMS.find((row) => row.id === 'tc-v1')!)).toContain('予定数と一致していません')
    expect(joined(ITEMS.find((row) => row.id === 'tc-p1')!)).toContain('下段は盤面専用')
    expect(joined(ITEMS.find((row) => row.id === 'tc-v3')!)).toMatch(/PDF.*配布用盤面.*下段の A は出ない/u)
    // 片づけの操作は 4 択の名前で指す(画面の文言と一致)。
    expect(joined(ITEMS.find((row) => row.id === 'tc-p2')!)).toContain('手入力データを採用')
    expect(joined(ITEMS.find((row) => row.id === 'tc-p3')!)).toContain('テンプレ授業を採用')
    expect(joined(ITEMS.find((row) => row.id === 'tc-p5')!)).toContain('手入力データを移動')
    // 数を比べる項目は「控える」手順を持つ。
    for (const id of ['tc-00', 'tc-s1', 'tc-s2', 'tc-p1', 'tc-p4', 'tc-p7']) expect(joined(ITEMS.find((row) => row.id === id)!), id).toContain('控え')
  })
})

describe('送信本文・下書きキー(開発用教室と同じ書式・版で分かれる)', () => {
  it('マーカーはテスト教室の版、下書きキーは教室 ID × テスト教室の版', () => {
    expect(buildVerificationChecklistMarker(TEST_CLASSROOM_VERIFICATION_CHECKLIST.version)).toBe('[確認リスト v1.5.596]')
    expect(verificationChecklistStorageKey(TEST_CLASSROOM_VERIFICATION_CHECKLIST_TARGET.classroomId, TEST_CLASSROOM_VERIFICATION_CHECKLIST.version))
      .toBe('verification-checklist:test_classroom_20260507_dai:v1.5.596')
    // 開発用教室の版とは別のキー(テスト教室で開発用教室の下書きを読まない)。
    expect(verificationChecklistStorageKey(TEST_CLASSROOM_VERIFICATION_CHECKLIST_TARGET.classroomId, VERIFICATION_CHECKLIST.version))
      .not.toBe(verificationChecklistStorageKey(TEST_CLASSROOM_VERIFICATION_CHECKLIST_TARGET.classroomId, TEST_CLASSROOM_VERIFICATION_CHECKLIST.version))
  })

  it('本文は tc- の id だけを載せる(開発用教室の id は未確認扱いで落ちる)', () => {
    let draft = createEmptyVerificationChecklistDraft(TEST_CLASSROOM_VERIFICATION_CHECKLIST.version)
    draft = setVerificationChecklistEntry(draft, 'tc-s1', { status: 'ok' })
    draft = setVerificationChecklistEntry(draft, 'tc-p1', { status: 'needs-fix', memo: '未消化が 1 増えた' })
    draft = setVerificationChecklistEntry(draft, 'tp-32', { status: 'ok' })
    const notes = buildVerificationChecklistReportNotes(draft, { items: ITEMS })
    expect(notes).toEqual(['[確認リスト v1.5.596]\n- tc-s1 OK\n- tc-p1 要改善: 未消化が 1 増えた'])
  })
})

describe('定義の選び分け(resolveVerificationChecklistDefinitionFor)', () => {
  it('対象はテスト教室(main / test_classroom_20260507_dai)で、登録台帳に載っている検証用教室', () => {
    expect(TEST_CLASSROOM_VERIFICATION_CHECKLIST_TARGET).toEqual({ workspaceKey: 'main', classroomId: 'test_classroom_20260507_dai' })
    const entry = findTestClassroomVerificationChecklistRegistryEntry()
    expect(entry).not.toBeNull()
    expect(DEVELOPMENT_CLASSROOM_REGISTRY).toContain(entry)
  })

  it('テスト教室ではテスト教室の定義、開発用教室・未登録・別会社・空ではこれまでの定義', () => {
    expect(resolveVerificationChecklistDefinitionFor('main', 'test_classroom_20260507_dai')).toBe(TEST_CLASSROOM_VERIFICATION_CHECKLIST)
    expect(resolveVerificationChecklistDefinitionFor('main', ' test_classroom_20260507_dai ')).toBe(TEST_CLASSROOM_VERIFICATION_CHECKLIST)
    expect(resolveVerificationChecklistDefinitionFor('main', 'v8OZ7zH8vONNHjjYVcR1')).toBe(VERIFICATION_CHECKLIST)
    expect(resolveVerificationChecklistDefinitionFor('other-company', 'test_classroom_20260507_dai')).toBe(VERIFICATION_CHECKLIST)
    expect(resolveVerificationChecklistDefinitionFor('main', 'TEST_CLASSROOM_20260507_DAI')).toBe(VERIFICATION_CHECKLIST)
    expect(resolveVerificationChecklistDefinitionFor('', 'test_classroom_20260507_dai')).toBe(VERIFICATION_CHECKLIST)
    expect(resolveVerificationChecklistDefinitionFor('main', null)).toBe(VERIFICATION_CHECKLIST)
    expect(isTestClassroomVerificationChecklistTarget(undefined, undefined)).toBe(false)
  })
})
