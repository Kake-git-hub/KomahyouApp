// 盤面「要望・報告」モーダルの寸法がブラウザ表示倍率に左右されないことを固定する(オーナー指示 2026-09-04)。
//
// 背景: 盤面はコマ表を1週間分見るためにブラウザの表示倍率を下げて使うことが多く、モーダルも一緒に縮んで
// 「日程表タブ(別タブ・通常100%)より見にくい」状態になっていた。寸法を vw/vh 基準の単位
// (--developer-report-unit)で書くことで、倍率を下げたぶん単位が大きくなり画面上の実寸が保たれる。
//
// このテストは「あとから px 直書きに戻す」リグレッションを落とすためのガード。
// 見た目そのものは検証できないので、寸法系の宣言がすべて単位経由であることを CSS の字面で固定する。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const APP_CSS = readFileSync(fileURLToPath(new URL('../App.css', import.meta.url)), 'utf8')

/** `.developer-report-*` のルールだけを取り出す(セレクタと宣言ブロックの組)。 */
function developerReportRules(): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = []
  const pattern = /([^{}]+)\{([^{}]*)\}/gu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(APP_CSS)) !== null) {
    const selector = match[1].replace(/\/\*[\s\S]*?\*\//gu, '').trim()
    if (!selector.includes('.developer-report-')) continue
    if (selector.startsWith('@')) continue
    rules.push({ selector, body: match[2] })
  }
  return rules
}

/** 寸法として px 直書きを許さないプロパティ(色・境界線の太さ・影は対象外)。 */
const SIZE_PROPERTIES = ['font-size', 'padding', 'gap', 'max-width', 'min-height', 'border-radius', 'width', 'height']

describe('要望・報告モーダル(盤面)のズーム非依存スタイル', () => {
  it('寸法の基準単位 --developer-report-unit がモーダル本体に定義されている', () => {
    const modal = developerReportRules().find((rule) => rule.selector === '.developer-report-modal')
    expect(modal).toBeDefined()
    expect(modal?.body).toMatch(/--developer-report-unit:\s*clamp\(\s*1px\s*,\s*min\(\s*[\d.]+vw\s*,\s*[\d.]+vh\s*\)\s*,\s*[\d.]+px\s*\)/u)
  })

  it('モーダル本体の幅・余白が単位基準で書かれている(px 直書きに戻すと落ちる)', () => {
    const modal = developerReportRules().find((rule) => rule.selector === '.developer-report-modal')
    expect(modal?.body).toMatch(/max-width:\s*calc\(820\s*\*\s*var\(--developer-report-unit\)\)/u)
    expect(modal?.body).toMatch(/padding:\s*calc\(28\s*\*\s*var\(--developer-report-unit\)\)\s*calc\(32\s*\*\s*var\(--developer-report-unit\)\)/u)
  })

  it('.developer-report-* の寸法宣言に px 直書きが残っていない', () => {
    const offenders: string[] = []
    for (const rule of developerReportRules()) {
      for (const declaration of rule.body.split(';')) {
        const [rawProperty, ...rest] = declaration.split(':')
        if (rest.length === 0) continue
        const property = rawProperty.trim()
        const value = rest.join(':').trim()
        if (!SIZE_PROPERTIES.includes(property)) continue
        // clamp(1px, ...) は単位の定義そのものなので対象外。
        if (property.startsWith('--')) continue
        if (/\b\d+(\.\d+)?px\b/u.test(value)) offenders.push(`${rule.selector} { ${property}: ${value} }`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('文字サイズがすべて単位基準になっている(題名・本文・入力欄・ボタン)', () => {
    const bySelector = new Map(developerReportRules().map((rule) => [rule.selector, rule.body]))
    const expected: Array<[string, number]> = [
      ['.developer-report-title', 22],
      ['.developer-report-description', 17],
      ['.developer-report-note-label', 16],
      ['.developer-report-note', 17],
      ['.developer-report-hint', 14],
      ['.developer-report-hint-primary', 16],
      ['.developer-report-result', 17],
    ]
    for (const [selector, size] of expected) {
      const body = bySelector.get(selector)
      expect(body, `${selector} が見つからない`).toBeDefined()
      expect(body, `${selector} の font-size`).toMatch(
        new RegExp(`font-size:\\s*calc\\(${size}\\s*\\*\\s*var\\(--developer-report-unit\\)\\)`, 'u'),
      )
    }
  })

  it('ラジオ本体も同じ単位で追従する(既定 13px のままだと倍率を下げたときだけ小さく見える)', () => {
    const radio = developerReportRules().find((rule) => rule.selector.includes("input[type='radio']"))
    expect(radio).toBeDefined()
    expect(radio?.body).toMatch(/width:\s*calc\(13\s*\*\s*var\(--developer-report-unit\)\)/u)
    expect(radio?.body).toMatch(/height:\s*calc\(13\s*\*\s*var\(--developer-report-unit\)\)/u)
  })
})
