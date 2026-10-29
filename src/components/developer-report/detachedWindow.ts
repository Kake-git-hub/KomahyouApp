// 画面の一部を別タブ(about:blank・同一オリジン)へ出すための DOM 補助(確認リスト 2026-10-14 → 質問・要望 2026-10-29 で共通化)。
//
// 方式: window.open で名前付きの空タブを開き、元の文書のスタイルを写して入れ物を作る。中身は呼び出し側が React の
// createPortal でその入れ物へ描く(状態・送信は元のタブのまま＝新しい保存先・送信経路・教室データの再読み込みを作らない)。
// 元のタブを閉じる/再読み込みすると別タブも閉じる(取り残された別タブで入力しても届かないため)。
//
// このファイルは window / document を引数で受け取る(テストで jsdom の文書を渡せるように)。

/** 別タブの描き込み先。 */
export type DetachedWindowTarget = { win: Window; root: HTMLElement }

/** 別タブの文書の作り。html / body に付けるクラス(全画面表示用の CSS を当てる)と入れ物の id。 */
export type DetachedWindowLayout = { title: string; className: string; rootId: string }

/** 名前付きの空タブを開く(同じ名前なら同じタブを使い回す＝タブが増えない)。ポップアップを止められたら null。 */
export function openNamedBlankWindow(opener: Pick<Window, 'open'>, name: string): Window | null {
  try {
    return opener.open('', name) ?? null
  } catch {
    return null
  }
}

/**
 * 別タブの文書を整える: 題名・言語・スタイル(元の文書の <style> / <link rel="stylesheet"> の写し)・入れ物。
 * 使い回したタブ(前回の中身が残っている)でも、毎回まっさらに作り直す。戻り値は中身を描き込む入れ物。
 */
export function prepareDetachedWindowDocument(source: Document, target: Document, layout: DetachedWindowLayout): HTMLElement {
  target.title = layout.title
  target.documentElement.lang = source.documentElement.lang || 'ja'
  target.head.replaceChildren()
  const charset = target.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  const viewport = target.createElement('meta')
  viewport.setAttribute('name', 'viewport')
  viewport.setAttribute('content', 'width=device-width, initial-scale=1')
  const titleElement = target.createElement('title')
  titleElement.textContent = layout.title
  target.head.append(charset, viewport, titleElement)

  for (const node of Array.from(source.querySelectorAll('style, link[rel="stylesheet"]'))) {
    if (node.tagName === 'LINK') {
      // about:blank のタブでは相対 URL の基準が定まらないので、元の文書で解決した絶対 URL を使う。
      const link = target.createElement('link')
      link.rel = 'stylesheet'
      link.href = (node as HTMLLinkElement).href
      target.head.append(link)
    } else {
      const style = target.createElement('style')
      style.textContent = node.textContent
      target.head.append(style)
    }
  }

  target.body.replaceChildren()
  target.documentElement.className = layout.className
  target.body.className = layout.className
  const root = target.createElement('div')
  root.id = layout.rootId
  target.body.append(root)
  return root
}

/** 別タブが閉じたかを見る間隔(pagehide を取りこぼすブラウザ向けの保険)。 */
export const DETACHED_WINDOW_CLOSED_POLL_MS = 1000

/**
 * 別タブの後始末を見張る。別タブが閉じられたら onGone を呼ぶ。元のタブが閉じる/再読み込みするときは別タブも閉じる。
 * 戻り値(後始末)を呼ぶと見張りを外して別タブを閉じる(useEffect の cleanup にそのまま返す)。
 */
export function watchDetachedWindow(opener: Window, win: Window, onGone: () => void): () => void {
  const closeWindow = () => {
    try {
      if (!win.closed) win.close()
    } catch {
      // 既に閉じている等は無視する。
    }
  }
  win.addEventListener('pagehide', onGone)
  const timer = opener.setInterval(() => {
    if (win.closed) onGone()
  }, DETACHED_WINDOW_CLOSED_POLL_MS)
  opener.addEventListener('pagehide', closeWindow)
  return () => {
    try {
      win.removeEventListener('pagehide', onGone)
    } catch {
      // 閉じたタブの window は触れないことがある。
    }
    opener.clearInterval(timer)
    opener.removeEventListener('pagehide', closeWindow)
    closeWindow()
  }
}
