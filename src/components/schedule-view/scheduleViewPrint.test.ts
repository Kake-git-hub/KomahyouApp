// 日程表ポップアウトの印刷CSSの回帰防止。オーナー指示(2026-07-08)で「別ウィンドウの Ctrl+P は
// 日程表だけを従来体裁で印刷」。この体裁を決める要点(非対象パーツ非表示・fit zoom 打ち消し・A4横)が
// 消えないよう固定する。体裁を変えるときは生成HTML側 @media print と両方を直すこと。
import { describe, expect, it } from 'vitest'
import { SCHEDULE_VIEW_POPOUT_PRINT_CSS } from './scheduleViewPrint'

describe('scheduleViewPrint', () => {
  it('印刷では日程表シート以外(ツールバー・青枠・ゴースト・机選択・印刷非対象)を隠す', () => {
    expect(SCHEDULE_VIEW_POPOUT_PRINT_CSS).toContain('@media print')
    for (const hidden of [
      '.schedule-view-toolbar',
      '.schedule-drag-frame',
      '.schedule-drag-ghost',
      '.schedule-desk-picker-overlay',
      '.print-only-hidden',
    ]) {
      expect(SCHEDULE_VIEW_POPOUT_PRINT_CSS).toContain(hidden)
    }
  })

  it('fit の zoom を打ち消し(zoom:1 !important)、シートを用紙寸法にする', () => {
    expect(SCHEDULE_VIEW_POPOUT_PRINT_CSS).toContain('zoom: 1 !important')
    expect(SCHEDULE_VIEW_POPOUT_PRINT_CSS).toContain('width: 277mm')
  })

  it('用紙は従来どおり A4 横(給与超過ページ用の A3 縦も温存)', () => {
    expect(SCHEDULE_VIEW_POPOUT_PRINT_CSS).toContain('size: A4 landscape')
    expect(SCHEDULE_VIEW_POPOUT_PRINT_CSS).toContain('@page sheetA3')
    expect(SCHEDULE_VIEW_POPOUT_PRINT_CSS).toContain('size: A3 portrait')
  })

  it('休校・不可コマの背景色を印刷でも保持する(print-color-adjust)', () => {
    expect(SCHEDULE_VIEW_POPOUT_PRINT_CSS).toContain('print-color-adjust: exact')
    expect(SCHEDULE_VIEW_POPOUT_PRINT_CSS).toContain('var(--holiday-bg)')
  })
})
