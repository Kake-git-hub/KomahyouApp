// 「質問・要望」を開く・閉じる状態(2026-10-29 オーナー指示「質問・要望ボタンのページは別タブで開くようにして。
// AI 回答を見ながら画面操作する可能性があるので」・全教室)。App から切り出して、開く/移る/閉じる/教室切替/送信中に閉じた後の
// 結果を描画テストで固定する(useDeveloperReportWindow.test.ts)。
//
// - 盤面の「質問・要望」を押すと別タブを開く(押した操作の中で開く＝ポップアップ扱いされない)。開けなければ盤面のモーダル。
// - 別タブで開いていれば、もう一度押してもそのタブへ移るだけ(入力中の内容を消さない・タブを増やさない)。
// - 別タブを閉じた(× や Ctrl+W)・「閉じる」・教室を切り替えた・ログアウトした(resetKey が変わった)ら閉じる。
//   教室を切り替えても別タブは開いたままになり得るので、入力途中の質問が切り替え先の教室へ届かないようにする(INV-08)。
// - 送信の結果は、送った回が開いている間だけ出す(送信中に閉じた後に結果のモーダルが出ないように。報告自体は送れている)。
// 元のタブを閉じる/再読み込みするときは別タブも閉じる(watchDetachedWindow)。

import { useCallback, useEffect, useRef, useState } from 'react'

import { recordOperationTrace } from '../../utils/operationTrace'
import { watchDetachedWindow, type DetachedWindowTarget } from './detachedWindow'
import { isDetachedWindowOpen, openDeveloperReportWindow } from './developerReportWindow'

export type DeveloperReportSession = {
  /** 開いた回ごとの番号(DeveloperReportModal の key にも使う＝開くたびに入力はまっさら)。 */
  openId: number
  sending: boolean
  /** 送信後の結果文。null のうちは入力フォーム。 */
  resultMessage: string | null
  /** 別タブを開けず(ポップアップを止められた)盤面のモーダルで開いた。 */
  windowBlocked: boolean
}

export type DeveloperReportWindowController = {
  session: DeveloperReportSession | null
  /** 別タブの描き込み先。null = 盤面のモーダルで開いている(または閉じている)。 */
  target: DetachedWindowTarget | null
  open: () => void
  close: () => void
  /** 送信を走らせ、結果文を送った回にだけ出す。 */
  runSubmit: (send: () => Promise<string>) => Promise<void>
}

export function useDeveloperReportWindow({ classroomName, resetKey }: { classroomName: string; resetKey: string }): DeveloperReportWindowController {
  const [session, setSession] = useState<DeveloperReportSession | null>(null)
  const [target, setTarget] = useState<DetachedWindowTarget | null>(null)
  const openIdRef = useRef(0)
  // open は盤面へ渡すので識別子を変えない(開閉のたびに盤面を描き直さない)。最新の状態はここから読む。
  const latestRef = useRef({ session, target, classroomName })
  useEffect(() => {
    latestRef.current = { session, target, classroomName }
  }, [classroomName, session, target])

  const open = useCallback(() => {
    const { session, target, classroomName } = latestRef.current
    if (session && isDetachedWindowOpen(target)) {
      recordOperationTrace('navigation', '質問・要望の別タブへ移る(盤面)')
      try {
        target?.win.focus()
      } catch {
        // 前に出せなくても別タブは開いたまま。
      }
      return
    }
    openIdRef.current += 1
    const openId = openIdRef.current
    const opened = openDeveloperReportWindow(window, document, classroomName)
    recordOperationTrace('navigation', opened ? '質問・要望を別タブで開く(盤面)' : '質問・要望モーダルを開く(盤面・別タブを開けなかった)')
    setTarget(opened)
    setSession({ openId, sending: false, resultMessage: null, windowBlocked: !opened })
  }, [])

  // 別タブは下の後始末(watchDetachedWindow の戻り値)が閉じる。
  const close = useCallback(() => {
    setSession(null)
    setTarget(null)
  }, [])

  const runSubmit = useCallback(async (send: () => Promise<string>) => {
    const openId = openIdRef.current
    setSession((current) => (current && current.openId === openId ? { ...current, sending: true, resultMessage: null } : current))
    const resultMessage = await send()
    setSession((current) => (current && current.openId === openId ? { ...current, sending: false, resultMessage } : current))
  }, [])

  // 別タブが閉じられたら入力ごと閉じる。元のタブを閉じる/再読み込みするときは別タブも閉じる。
  useEffect(() => {
    if (!target) return undefined
    return watchDetachedWindow(window, target.win, () => {
      setTarget((current) => (current === target ? null : current))
      setSession(null)
    })
  }, [target])

  // 教室を切り替えた・ログアウトした(resetKey が変わった)ら閉じる(INV-08)。
  useEffect(() => () => {
    setSession(null)
    setTarget(null)
  }, [resetKey])

  return { session, target, open, close, runSubmit }
}
