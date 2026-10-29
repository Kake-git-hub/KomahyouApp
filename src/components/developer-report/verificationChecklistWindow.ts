// 確認リストを別タブで開くための DOM 補助(2026-10-14 オーナー指示「確認リストを別タブでひらけるようにして」)。
//
// 方式: window.open で空のタブ(about:blank・同一オリジン)を開き、アプリのスタイルを写したうえで
// パネルを React の createPortal でそのタブへ描く。状態(下書き・送信・生徒名の解決)は元のタブの
// VerificationChecklistPanel が持ったまま＝新しい保存先・新しい送信経路・教室データの再読み込みを作らない。
// 元のタブを閉じる/再読み込みすると別タブも閉じる(取り残された別タブで入力しても届かないため)。
//
// このファイルは window / document を引数で受け取る(テストで jsdom の文書を渡せるように)。
// タブを開く・文書を整える中身は detachedWindow.ts(質問・要望の別タブと共通・2026-10-29)。

import { openNamedBlankWindow, prepareDetachedWindowDocument } from './detachedWindow'

/** 別タブの window 名。2 回押しても同じタブを使い回す(タブが増えない)。 */
export const VERIFICATION_CHECKLIST_WINDOW_NAME = 'komahyou-verification-checklist'
/** 別タブの html / body に付けるクラス(全画面表示用の CSS を当てる・index.css の min-width を外す)。 */
export const VERIFICATION_CHECKLIST_WINDOW_BODY_CLASS = 'verification-checklist-window'
/** パネルを描き込む入れ物の id。 */
export const VERIFICATION_CHECKLIST_WINDOW_ROOT_ID = 'verification-checklist-window-root'

/** 別タブを開く。ポップアップを止められたら null。 */
export function openVerificationChecklistWindow(opener: Pick<Window, 'open'>): Window | null {
  return openNamedBlankWindow(opener, VERIFICATION_CHECKLIST_WINDOW_NAME)
}

/**
 * 別タブの文書を整える: 題名・言語・スタイル(元の文書の <style> / <link rel="stylesheet"> の写し)・入れ物。
 * 使い回したタブ(前回の中身が残っている)でも、毎回まっさらに作り直す。戻り値はパネルを描き込む入れ物。
 * 中身は質問・要望の別タブ(2026-10-29)と共通の prepareDetachedWindowDocument。
 */
export function prepareVerificationChecklistWindowDocument(source: Document, target: Document, title: string): HTMLElement {
  return prepareDetachedWindowDocument(source, target, { title, className: VERIFICATION_CHECKLIST_WINDOW_BODY_CLASS, rootId: VERIFICATION_CHECKLIST_WINDOW_ROOT_ID })
}

// ───────────────────────────────────────────────────────────────────────────
// 別タブの拡大率(2026-10-14 オーナー指摘「確認リストの別タブ時の拡大縮小は独立でできるようにして」)。
// ブラウザの拡大(Ctrl+ホイール)は**同じサイト単位**で効くので、別タブ(about:blank・同一オリジン)を拡大すると
// 元の盤面のタブも一緒に拡大されてしまう。そこで別タブのパネルにだけ CSS の zoom を当てる自前の拡大率を持ち、
// 元のタブ(右下の浮き窓)には適用しない。値は別タブ専用のキーで localStorage に残す(教室・版をまたいで共通)。
// ───────────────────────────────────────────────────────────────────────────

/** 別タブの拡大率の保存キー(右下の浮き窓には使わない)。 */
export const VERIFICATION_CHECKLIST_WINDOW_ZOOM_STORAGE_KEY = 'verification-checklist:window-zoom'
/** 選べる拡大率(%)。既定は 100。 */
export const VERIFICATION_CHECKLIST_WINDOW_ZOOM_STEPS: readonly number[] = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200]
export const VERIFICATION_CHECKLIST_WINDOW_ZOOM_DEFAULT = 100

/** 保存値(文字列)を拡大率(%)へ。壊れた値・範囲外・一覧に無い値は既定(100)。 */
export function parseVerificationChecklistWindowZoom(raw: unknown): number {
  const value = typeof raw === 'string' ? Number(raw.trim()) : typeof raw === 'number' ? raw : NaN
  return VERIFICATION_CHECKLIST_WINDOW_ZOOM_STEPS.includes(value) ? value : VERIFICATION_CHECKLIST_WINDOW_ZOOM_DEFAULT
}

/** 拡大率を 1 段動かす(端で止まる)。一覧に無い現在値からは既定(100)を基準に動く。 */
export function stepVerificationChecklistWindowZoom(current: number, direction: 1 | -1): number {
  const steps = VERIFICATION_CHECKLIST_WINDOW_ZOOM_STEPS
  const index = steps.indexOf(steps.includes(current) ? current : VERIFICATION_CHECKLIST_WINDOW_ZOOM_DEFAULT)
  const next = Math.min(steps.length - 1, Math.max(0, index + direction))
  return steps[next]
}

/** 拡大率(%)を CSS zoom の値(倍率)にする。 */
export function verificationChecklistWindowZoomToCss(zoomPercent: number): number {
  return parseVerificationChecklistWindowZoom(zoomPercent) / 100
}
