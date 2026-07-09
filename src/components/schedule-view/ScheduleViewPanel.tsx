// 日程表 React ビューの外枠。オーナー確定(2026-07-08)で対話用途は「別ウィンドウ(ポップアウト)既定」。
// ポップアウトは chrome バー(タイトル/トグル/閉じるボタン)を出さず、日程表だけを表示する
// (閉じるは子ウィンドウの×で行い、onClose で検知する)。ポップアップがブロックされた場合のみ
// 画面内(ドック)へフォールバックし、そのときだけ最小の閉じるボタンを出す。
import type { ReactNode } from 'react'
import { PopoutWindow } from './PopoutWindow'
import './scheduleView.css'

export type ScheduleViewDisplayMode = 'dock' | 'popout'

export type ScheduleViewPanelProps = {
  title: string
  mode: ScheduleViewDisplayMode
  onClose: () => void
  // ポップアップブロックで別ウィンドウを開けなかったときはドックへ戻す(親が mode を戻す)。
  onPopoutBlocked?: () => void
  children: ReactNode
}

export function ScheduleViewPanel({ title, mode, onClose, onPopoutBlocked, children }: ScheduleViewPanelProps) {
  if (mode === 'popout') {
    // ポップアウトは chrome なし(タイトル/ヒント/ボタンを出さない・オーナー指示)。
    return (
      <PopoutWindow onClose={onClose} onOpenBlocked={onPopoutBlocked}>
        <div className="schedule-react-view is-popout" data-testid="schedule-react-view-popout">
          {children}
        </div>
      </PopoutWindow>
    )
  }

  // ドックはポップアップブロック時のフォールバックのみ。最小の見出しと閉じるボタンだけ添える。
  return (
    <section className="schedule-view-dock is-expanded">
      <div className="schedule-react-view is-dock" data-testid="schedule-react-view-dock">
        <div className="schedule-view-chrome">
          <span className="schedule-view-chrome-title">{title}</span>
          <span className="schedule-view-chrome-note">別ウィンドウを開けなかったため画面内に表示しています</span>
          <div className="schedule-view-chrome-actions">
            <button type="button" onClick={onClose}>閉じる</button>
          </div>
        </div>
        {children}
      </div>
    </section>
  )
}
