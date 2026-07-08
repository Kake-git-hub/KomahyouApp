// 日程表 React ビューの外枠。ドック(画面内パネル) ⇄ ポップアウト(別ウィンドウ)のトグルを提供する
// (spec-schedule-interactive-view §B-2/§B-4: どちらが使いやすいかは staging でユーザーが実機比較して決める)。
// 中身(children=ScheduleView)は同一コンポーネント・同一コードパスで、描画先コンテナだけが変わる。
import type { ReactNode } from 'react'
import { PopoutWindow } from './PopoutWindow'
import './scheduleView.css'

export type ScheduleViewDisplayMode = 'dock' | 'popout'

export type ScheduleViewPanelProps = {
  title: string
  mode: ScheduleViewDisplayMode
  expanded: boolean
  onToggleMode: () => void
  onToggleExpanded: () => void
  onClose: () => void
  // ポップアップブロックで別ウィンドウを開けなかったときはドックへ戻す(親が mode を戻す)。
  onPopoutBlocked?: () => void
  children: ReactNode
}

export function ScheduleViewPanel({ title, mode, expanded, onToggleMode, onToggleExpanded, onClose, onPopoutBlocked, children }: ScheduleViewPanelProps) {
  const content = (
    <div className={`schedule-react-view ${mode === 'dock' ? 'is-dock' : 'is-popout'}`} data-testid={`schedule-react-view-${mode}`}>
      <div className="schedule-view-chrome">
        <span className="schedule-view-chrome-title">{title}</span>
        <span className="schedule-view-chrome-note">盤面の編集は自動で反映されます</span>
        <div className="schedule-view-chrome-actions">
          {mode === 'dock' ? (
            <button type="button" onClick={onToggleExpanded}>{expanded ? '縮小' : '拡大'}</button>
          ) : null}
          <button type="button" onClick={onToggleMode}>{mode === 'dock' ? '別ウィンドウで開く' : '画面内に戻す'}</button>
          <button type="button" onClick={onClose}>閉じる</button>
        </div>
      </div>
      {children}
    </div>
  )

  if (mode === 'popout') {
    return (
      <PopoutWindow title={title} onClose={onClose} onOpenBlocked={onPopoutBlocked}>
        {content}
      </PopoutWindow>
    )
  }

  return (
    <section className={`schedule-view-dock${expanded ? ' is-expanded' : ''}`}>
      {content}
    </section>
  )
}
