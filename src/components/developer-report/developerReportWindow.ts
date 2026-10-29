// 「質問・要望」を別タブで開く(2026-10-29 オーナー指示「質問・要望ボタンのページは別タブで開くようにして。
// AI 回答を見ながら画面操作する可能性があるので」・全教室)。
//
// 方式は確認リストの別タブと同じ(detachedWindow.ts): 盤面の「質問・要望」を押すと名前付きの空タブを開き、
// App が DeveloperReportModal をそのタブへ createPortal で描く。入力・送信・回答の履歴は元のタブ(App)が持ったまま
// ＝送る教室データは送った時点の盤面(未保存の変更込み)・操作痕跡・「画面を撮る」(元のタブを写す)は今までと同じ。
// ポップアップを止められたときは null を返し、App は今までどおり盤面のモーダルで開く。

import { DEVELOPER_REPORT_UI_TEXT } from '../../utils/developerReport'
import { openNamedBlankWindow, prepareDetachedWindowDocument, type DetachedWindowTarget } from './detachedWindow'

/** 別タブの window 名。もう一度押しても同じタブを使い回す(タブが増えない)。 */
export const DEVELOPER_REPORT_WINDOW_NAME = 'komahyou-developer-report'
/** 別タブの html / body に付けるクラス(全画面表示用の CSS を当てる・index.css の min-width を外す)。 */
export const DEVELOPER_REPORT_WINDOW_BODY_CLASS = 'developer-report-window'
/** モーダルを描き込む入れ物の id。 */
export const DEVELOPER_REPORT_WINDOW_ROOT_ID = 'developer-report-window-root'

/** 別タブの題名。教室名を添える(複数の教室のタブを並べても見分けられるように)。 */
export function buildDeveloperReportWindowTitle(classroomName: string): string {
  const name = classroomName.trim()
  return name ? `${DEVELOPER_REPORT_UI_TEXT.title}（${name}）` : DEVELOPER_REPORT_UI_TEXT.title
}

/** 別タブがまだ開いているか(閉じた／触れない window は閉じたとみなす)。 */
export function isDetachedWindowOpen(target: Pick<DetachedWindowTarget, 'win'> | null): boolean {
  if (!target) return false
  try {
    return !target.win.closed
  } catch {
    return false
  }
}

/** 別タブを開いて文書を整える。ポップアップを止められた・文書を整えられなかったら null(呼び出し側はモーダルで開く)。 */
export function openDeveloperReportWindow(opener: Pick<Window, 'open'>, source: Document, classroomName: string): DetachedWindowTarget | null {
  const win = openNamedBlankWindow(opener, DEVELOPER_REPORT_WINDOW_NAME)
  if (!win) return null
  try {
    const root = prepareDetachedWindowDocument(source, win.document, {
      title: buildDeveloperReportWindowTitle(classroomName),
      className: DEVELOPER_REPORT_WINDOW_BODY_CLASS,
      rootId: DEVELOPER_REPORT_WINDOW_ROOT_ID,
    })
    try {
      win.focus()
    } catch {
      // 前に出せなくても別タブは開いている。
    }
    return { win, root }
  } catch {
    try {
      win.close()
    } catch {
      // 閉じられなくてもモーダルで開く。
    }
    return null
  }
}
