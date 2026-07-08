// 日程表ポップアウト(子ウィンドウ)専用の印刷CSS。
// 子ウィンドウで Ctrl+P すると「日程表シートだけ」を従来の生成HTMLと同じ体裁(A4横・非対象パーツ非表示・
// 休校/不可コマの背景保持)で印刷する。createScheduleHtml(scheduleHtml.ts)の @media print / @page を
// React ビュー(.schedule-react-view 配下)向けに移植したもの。
// ⚠️ この CSS は PopoutWindow が「子ウィンドウにのみ」注入する。本体アプリ(main document)には
// 入れない(@page がアプリ全体の印刷に波及するのを避けるため)。印刷体裁を変えるときは生成HTML側の
// @media print と両方を直す。fit の zoom(インラインstyle)は zoom:1 !important で打ち消す。
export const SCHEDULE_VIEW_POPOUT_PRINT_CSS = `
@media print {
  *, *::before, *::after {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  html, body {
    background: #fff !important;
    overflow: hidden !important;
  }
  .schedule-react-view .schedule-view-toolbar,
  .schedule-react-view .schedule-view-move-status,
  .schedule-react-view .schedule-drag-frame,
  .schedule-react-view .schedule-drag-ghost,
  .schedule-react-view .schedule-desk-picker-overlay,
  .schedule-view-chrome,
  .print-only-hidden {
    display: none !important;
  }
  .schedule-react-view,
  .schedule-react-view .schedule-view-body {
    display: block !important;
    height: auto !important;
    background: #fff !important;
  }
  .schedule-react-view .pages {
    padding: 0 !important;
    gap: 0 !important;
    overflow: visible !important;
    display: block !important;
  }
  .schedule-react-view .sheet {
    zoom: 1 !important;
    box-shadow: none !important;
    border: 0 !important;
    padding: 0 !important;
    width: 277mm !important;
    height: 190mm !important;
    aspect-ratio: 297 / 210 !important;
    overflow: hidden !important;
    page-break-after: always;
  }
  .schedule-react-view .sheet.is-a3-portrait {
    width: 281mm !important;
    height: 404mm !important;
    aspect-ratio: 297 / 420 !important;
    page: sheetA3;
  }
  .schedule-react-view .holiday-col,
  .schedule-react-view .slot-cell.is-holiday {
    background: var(--holiday-bg) !important;
    box-shadow: inset 0 0 0 999px var(--holiday-bg);
  }
  .schedule-react-view .slot-cell.is-unavailable {
    background: #d1d6dc !important;
    box-shadow: inset 0 0 0 999px #d1d6dc;
  }
  .schedule-react-view .teacher-lesson-person { gap: 1px; padding: 1px 0; }
  .schedule-react-view .teacher-lesson-name { font-size: 10px; }
  .schedule-react-view .teacher-lesson-meta { font-size: 7px; }
  .schedule-react-view .lesson-card-teacher.is-pair .teacher-lesson-name { font-size: 8px; }
  .schedule-react-view .lesson-card-teacher.is-pair .teacher-lesson-meta { font-size: 6px; }
  .schedule-react-view .schedule-table.is-dense .lesson-card-teacher.is-pair .teacher-lesson-name { font-size: 7px; }
  .schedule-react-view .schedule-table.is-dense .lesson-card-teacher.is-pair .teacher-lesson-meta { font-size: 5px; }
  .schedule-react-view .schedule-table.is-ultra-dense .lesson-card-teacher.is-pair .teacher-lesson-name { font-size: 6px; }
  .schedule-react-view .schedule-table.is-ultra-dense .lesson-card-teacher.is-pair .teacher-lesson-meta { font-size: 4px; }
}

@page {
  size: A4 landscape;
  margin: 8mm;
}

@page sheetA3 {
  size: A3 portrait;
  margin: 8mm;
}
`
