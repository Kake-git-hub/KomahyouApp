// 描画エラーの受け皿(2026-10-22 案 3)。jsdom は入れていないので、案内画面はサーバー描画で確かめ、
// 取り付け(main.tsx が App を包む・componentDidCatch が捕捉の入口を呼ぶ)はソース走査で固定する。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { APP_ERROR_FALLBACK_TEXT, AppErrorBoundary, AppErrorFallback } from './AppErrorBoundary'

describe('AppErrorFallback(室長向けの案内)', () => {
  it('題名・案内・再読み込みボタンを描き、内部語を出さない', () => {
    const html = renderToString(createElement(AppErrorFallback, { onReload: () => {} }))
    expect(html).toContain(APP_ERROR_FALLBACK_TEXT.title)
    expect(html).toContain(APP_ERROR_FALLBACK_TEXT.lead)
    expect(html).toContain('data-testid="app-error-reload"')
    // 届くのは教室を開いているときだけなので、断定しない(L-6)。英語の例外文は出さない。
    expect(APP_ERROR_FALLBACK_TEXT.lead).toContain('教室を開いていれば')
    for (const word of ['ErrorBoundary', 'developerReports', 'operationTrace', 'TypeError']) expect(html).not.toContain(word)
    const source = readFileSync(fileURLToPath(new URL('./AppErrorBoundary.tsx', import.meta.url)), 'utf8')
    expect(source).not.toContain('this.state.error.message')
  })

  it('例外が無ければ子をそのまま描く', () => {
    const html = renderToString(createElement(AppErrorBoundary, null, createElement('span', { id: 'child' }, 'ok')))
    expect(html).toContain('id="child"')
    expect(html).not.toContain('data-testid="app-error-fallback"')
  })
})

describe('取り付け(ソース走査)', () => {
  const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

  it('main.tsx は App 本体を AppErrorBoundary で包む(提出ページ・保護者ページは別経路のまま)', () => {
    const main = read('../../main.tsx')
    expect(main).toContain("import { AppErrorBoundary } from './components/common/AppErrorBoundary'")
    expect(main).toMatch(/<AppErrorBoundary>\s*<App \/>\s*<\/AppErrorBoundary>/u)
  })

  it('componentDidCatch は捕捉の入口(handleCapturedClientError)へ react-render として渡す', () => {
    const source = read('./AppErrorBoundary.tsx')
    expect(source).toContain("handleCapturedClientError(describeClientError({ source: 'react-render', error, componentStack: info.componentStack }))")
  })

  it('App は window の例外を捕まえ、自動報告の送信口(質問・要望と同じ経路・種類 bug)を登録する', () => {
    const app = read('../../App.tsx')
    expect(app).toContain('installClientErrorCapture(window, handleCapturedClientError)')
    expect(app).toContain('setClientErrorAutoReporter({')
    expect(app).toContain("submit({ source: 'board', category: 'bug', note })")
    expect(app).toContain('setClientErrorAutoReporter(null)')
  })
})
