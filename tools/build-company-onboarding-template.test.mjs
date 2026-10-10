// 初期データ雛形(P-7)のシート名・列名が基本データ画面の取込(parseImportedBundle)と一致していることを固定する。
// 画面側の列名を変えたらここが落ちる → 雛形(TEMPLATE_SHEETS)も同時に直す(会社に渡した雛形が取り込めなくなる事故の防止)。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as xlsx from 'xlsx'
import { buildTemplateWorkbook, TEMPLATE_SHEETS } from './build-company-onboarding-template.mjs'

const screenSource = readFileSync(resolve('src/components/basic-data/BasicDataScreen.tsx'), 'utf8')

describe('company onboarding template', () => {
  it('シート名は取込が読む名前と一致(マネージャー・講師・生徒・通常授業テンプレ・教室データ)', () => {
    for (const sheet of TEMPLATE_SHEETS) {
      expect(screenSource, sheet.name).toMatch(new RegExp(`readRows\\('${sheet.name}'\\)|Sheets\\['${sheet.name}'\\]`))
    }
  })

  it('列名は取込が row[...] で読む名前と一致(全列が BasicDataScreen.tsx に現れる)', () => {
    for (const sheet of TEMPLATE_SHEETS) {
      for (const column of sheet.columns) {
        expect(screenSource, `${sheet.name}.${column}`).toMatch(new RegExp(`(row\\['${column}'\\]|${column}:)`))
      }
    }
  })

  it('雛形の workbook はシート順どおりで、記入例 1 行 + 説明シートを持つ', () => {
    const workbook = buildTemplateWorkbook()
    expect(workbook.SheetNames).toEqual([...TEMPLATE_SHEETS.map((sheet) => sheet.name), '説明'])
    const students = xlsx.utils.sheet_to_json(workbook.Sheets['生徒'], { header: 1 })
    expect(students[0]).toEqual(TEMPLATE_SHEETS.find((sheet) => sheet.name === '生徒').columns)
    expect(students).toHaveLength(2)
    // 個人情報を入れない(記入例は example.com)。
    const sheetText = JSON.stringify(workbook.Sheets)
    expect(sheetText).not.toMatch(/@(?!example\.com)[a-z0-9.-]+\.[a-z]{2,}/i)
  })
})
