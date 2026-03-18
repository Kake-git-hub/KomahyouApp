import { getStudentDisplayName, getTeacherDisplayName, type StudentRow, type TeacherRow } from '../components/basic-data/basicDataModel'
import type { SpecialSessionRow } from '../components/special-data/specialSessionModel'
import type { SlotCell } from '../components/schedule-board/types'
import type { ClassroomSettings } from '../types/appState'
import { buildSpecialSessionRegularAssignments } from './specialSessionRegularAssignments'

type PopupWindowWithMarker = Window & typeof globalThis & {
  __lessonScheduleSpecialSessionPopupReady?: boolean
}

type PopupSession = Pick<SpecialSessionRow, 'id' | 'label' | 'startDate' | 'endDate'>

type PopupTeacher = {
  id: string
  name: string
  fullName: string
  input: SpecialSessionRow['teacherInputs'][string] | null
}

type PopupStudent = {
  id: string
  name: string
  fullName: string
  birthDate: string
  input: SpecialSessionRow['studentInputs'][string] | null
  regularAssignments: Record<string, {
    slotKey: string
    dateKey: string
    slotNumber: number
    subject: string
    teacherName: string
    lessonType: 'regular' | 'makeup'
  }>
}

type PopupPayload = {
  session: PopupSession
  defaultStartDate: string
  defaultEndDate: string
  availableStartDate: string
  availableEndDate: string
  availability: Pick<ClassroomSettings, 'closedWeekdays' | 'holidayDates' | 'forceOpenDates'>
  periodBands: Array<{ label: string; startDate: string; endDate: string }>
  teachers: PopupTeacher[]
  students: PopupStudent[]
}

type OpenSpecialSessionAvailabilityHtmlParams = {
  session: SpecialSessionRow
  allSessions: SpecialSessionRow[]
  classroomSettings: Pick<ClassroomSettings, 'closedWeekdays' | 'holidayDates' | 'forceOpenDates'>
  teachers: TeacherRow[]
  students: StudentRow[]
  scheduleCells: SlotCell[]
  boardWeeks?: SlotCell[][]
  targetWindow?: Window | null
}

function normalizeManagedDate(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '未定') return ''
  return trimmed
}

function isActiveDuringSession(entryDate: string, withdrawDate: string, isHidden: boolean, sessionStart: string, sessionEnd: string) {
  if (isHidden) return false
  const normalizedEntry = normalizeManagedDate(entryDate)
  const normalizedWithdraw = normalizeManagedDate(withdrawDate)
  if (normalizedEntry && normalizedEntry > sessionEnd) return false
  if (normalizedWithdraw && normalizedWithdraw < sessionStart) return false
  return true
}

function buildPayload(params: OpenSpecialSessionAvailabilityHtmlParams): PopupPayload {
  const { session, allSessions, classroomSettings, teachers, students, scheduleCells, boardWeeks = [] } = params
  const sortedSessions = allSessions
    .slice()
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate) || left.label.localeCompare(right.label, 'ja'))
  const availableStartDate = sortedSessions[0]?.startDate || session.startDate
  const availableEndDate = sortedSessions[sortedSessions.length - 1]?.endDate || session.endDate
  const regularAssignments = buildSpecialSessionRegularAssignments({ scheduleCells, students, boardWeeks })
  return {
    session: {
      id: session.id,
      label: session.label,
      startDate: session.startDate,
      endDate: session.endDate,
    },
    defaultStartDate: session.startDate,
    defaultEndDate: session.endDate,
    availableStartDate,
    availableEndDate,
    availability: {
      closedWeekdays: [...classroomSettings.closedWeekdays],
      holidayDates: [...classroomSettings.holidayDates],
      forceOpenDates: [...classroomSettings.forceOpenDates],
    },
    periodBands: [{ label: session.label, startDate: session.startDate, endDate: session.endDate }],
    teachers: teachers
      .filter((teacher) => isActiveDuringSession(teacher.entryDate, teacher.withdrawDate, teacher.isHidden, session.startDate, session.endDate))
      .sort((left, right) => getTeacherDisplayName(left).localeCompare(getTeacherDisplayName(right), 'ja'))
      .map((teacher) => ({
        id: teacher.id,
        name: getTeacherDisplayName(teacher),
        fullName: teacher.name,
        input: session.teacherInputs[teacher.id] ?? null,
      })),
    students: students
      .filter((student) => isActiveDuringSession(student.entryDate, student.withdrawDate, student.isHidden, session.startDate, session.endDate))
      .sort((left, right) => getStudentDisplayName(left).localeCompare(getStudentDisplayName(right), 'ja'))
      .map((student) => ({
        id: student.id,
        name: getStudentDisplayName(student),
        fullName: student.name,
        birthDate: student.birthDate,
        input: session.studentInputs[student.id] ?? null,
        regularAssignments: Object.fromEntries((regularAssignments.byStudent[student.id] ?? []).map((assignment) => [assignment.slotKey, assignment])),
      })),
  }
}

function createPopupWindow(targetWindow?: Window | null) {
  const openedWindow = window.open('', 'special-session-availability') as PopupWindowWithMarker | null
  if (openedWindow) return openedWindow
  if (targetWindow && !targetWindow.closed) {
    targetWindow.focus()
    return targetWindow as PopupWindowWithMarker
  }
  return null
}

function createSpecialSessionAvailabilityHtml(payload: PopupPayload) {
  const serializedPayload = JSON.stringify(payload).replace(/</g, '\\u003c')
  const serializedSubjects = JSON.stringify(['英', '数', '算', '国', '理', '社', 'IT']).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>特別講習入力</title>
    <style>
      :root {
        color-scheme: light;
        --paper: #ffffff;
        --line: #111111;
        --soft-line: #777777;
        --ink: #111111;
        --muted: #666666;
        --sun: #d00000;
        --sat: #003cff;
        --holiday-bg: #d9dde3;
        --selected-bg: #cfd5dd;
        --header-bg: #f8f8f8;
        --overlay: rgba(17, 17, 17, 0.32);
      }

      * { box-sizing: border-box; }

      html {
        scrollbar-width: none;
      }

      html::-webkit-scrollbar,
      body::-webkit-scrollbar,
      .pages::-webkit-scrollbar,
      .modal-body::-webkit-scrollbar {
        width: 0;
        height: 0;
        display: none;
      }

      body {
        margin: 0;
        font-family: 'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif;
        color: var(--ink);
        background: #f2f2f2;
        scrollbar-width: none;
      }

      button,
      input,
      select,
      textarea {
        font: inherit;
      }

      .toolbar {
        position: sticky;
        top: 0;
        z-index: 20;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: end;
        padding: 10px 16px;
        border-bottom: 1px solid #c9c9c9;
        background: rgba(255, 255, 255, 0.97);
      }

      .toolbar-field {
        display: grid;
        gap: 4px;
      }

      .toolbar-field label,
      .toolbar-summary,
      .toolbar-title {
        font-size: 12px;
        color: var(--muted);
      }

      .toolbar-title {
        min-width: 180px;
        font-weight: 700;
        color: var(--ink);
      }

      .toolbar-title strong {
        display: block;
        font-size: 14px;
        color: var(--ink);
      }

      .toolbar select,
      .toolbar input {
        min-width: 128px;
        padding: 8px 10px;
        border: 1px solid #666666;
        border-radius: 0;
        background: #ffffff;
      }

      .toolbar button {
        height: 38px;
        padding: 0 16px;
        border: 1px solid #333333;
        border-radius: 0;
        background: #ffffff;
        color: #111111;
        font-weight: 700;
        cursor: pointer;
      }

      .toolbar button.active {
        background: #111111;
        color: #ffffff;
      }

      .toolbar button:disabled {
        cursor: default;
        color: #888888;
      }

      .toolbar-summary {
        min-height: 18px;
      }

      .pages {
        display: grid;
        gap: 12px;
        padding: 12px;
        justify-content: center;
        overflow: auto;
        scrollbar-width: none;
      }

      .sheet {
        background: var(--paper);
        border: 1.5px solid var(--line);
        border-radius: 0;
        padding: 10px;
        box-shadow: none;
        width: 277mm;
        min-height: 190mm;
        overflow: hidden;
      }

      .sheet-top {
        display: grid;
        grid-template-columns: 150px 200px 1fr 240px;
        gap: 6px;
        align-items: stretch;
        margin-bottom: 8px;
      }

      .logo-box,
      .school-box,
      .title-box,
      .meta-box {
        border: 0;
        min-height: 44px;
        background: #ffffff;
      }

      .logo-box {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2px 4px;
        position: relative;
        overflow: hidden;
        cursor: pointer;
      }

      .logo-placeholder {
        font-size: 11px;
        color: var(--muted);
      }

      .logo-image {
        max-width: 100%;
        max-height: 36px;
        object-fit: contain;
        display: block;
      }

      .school-box {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        padding: 3px 8px;
      }

      .school-input,
      .static-text {
        width: 100%;
        border: 0;
        outline: 0;
        background: transparent;
        color: #444444;
        font-size: 13px;
        line-height: 1.2;
      }

      .school-input {
        min-height: 34px;
        resize: none;
        white-space: nowrap;
      }

      .title-box {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 10px;
      }

      .title-input {
        width: 100%;
        border: 0;
        outline: 0;
        background: transparent;
        color: #444444;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-align: center;
      }

      .meta-box {
        display: grid;
        align-content: center;
        justify-items: end;
        padding: 3px 8px;
        gap: 2px;
        font-size: 13px;
        font-weight: 700;
      }

      .meta-row {
        display: flex;
        gap: 10px;
        align-items: center;
        white-space: nowrap;
      }

      .meta-label {
        font-weight: 700;
      }

      table.schedule-table,
      table.count-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .schedule-table th,
      .schedule-table td,
      .count-table th,
      .count-table td {
        border: 1.5px solid var(--line);
      }

      .schedule-table thead th {
        background: #ffffff;
        text-align: center;
        padding: 4px 2px;
        font-size: 12px;
      }

      .schedule-table .time-col {
        width: 62px;
        min-width: 62px;
        background: #ffffff;
      }

      .month-row th {
        background: var(--header-bg);
        font-size: 13px;
        padding-top: 2px;
        padding-bottom: 2px;
      }

      .time-corner {
        background: var(--header-bg);
        padding: 0;
      }

      .time-corner-box {
        min-height: 58px;
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 1px;
        padding: 3px 2px;
      }

      .time-corner-year {
        display: block;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.05;
      }

      .date-row th,
      .weekday-row th {
        font-size: 12px;
        font-weight: 700;
      }

      .weekday-sun { color: var(--sun); }
      .weekday-sat { color: var(--sat); }

      .holiday-col,
      .slot-cell.is-holiday {
        background: var(--holiday-bg);
      }

      .period-row th {
        border-top: 1.5px solid var(--line);
        border-bottom: 1.5px solid var(--line);
        padding: 3px 0;
        background: #ffffff;
      }

      .period-gap {
        background: #ffffff;
      }

      .period-band {
        background: #fff6cf;
      }

      .period-pill {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        min-height: 22px;
        background: #ffe48a;
        color: #5a4200;
        font-size: 12px;
        font-weight: 700;
        border: 1.5px solid #b18d26;
        padding: 0 6px;
      }

      .period-pill-edge {
        flex: 0 0 auto;
        font-size: 11px;
        line-height: 1;
      }

      .period-pill-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .time-box {
        display: grid;
        align-items: center;
        justify-items: center;
        gap: 3px;
        padding: 0;
        min-height: 62px;
      }

      .time-toggle-button,
      .header-toggle {
        width: 100%;
        height: 100%;
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 0;
        font: inherit;
      }

      .time-toggle-button {
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 3px;
      }

      .header-toggle {
        min-height: 100%;
        font-weight: 700;
      }

      .time-range {
        display: grid;
        justify-items: center;
        font-size: 10px;
        font-weight: 400;
        line-height: 1.15;
      }

      .time-part,
      .time-separator {
        display: block;
        white-space: nowrap;
      }

      .time-slot {
        font-size: 12px;
        color: var(--ink);
        font-weight: 700;
        line-height: 1.1;
      }

      .slot-cell {
        height: 62px;
        vertical-align: top;
        background: #fff;
      }

      .slot-cell.is-selected {
        background: var(--selected-bg);
      }

      .slot-cell-content {
        height: 100%;
        padding: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .cell-button {
        width: 100%;
        height: 100%;
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 0;
      }

      .cell-button.is-unavailable {
        background: transparent;
        color: #111111;
      }

      .cell-button.has-regular-lesson {
        display: flex;
        align-items: stretch;
        justify-content: stretch;
      }

      .lesson-card {
        width: 100%;
        height: 100%;
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 2px;
        border: 1px solid #1f1f1f;
        background: #ffffff;
        padding: 2px;
      }

      .lesson-main {
        font-size: 12px;
        font-weight: 700;
        line-height: 1.05;
      }

      .lesson-sub {
        font-size: 10px;
        line-height: 1.05;
      }

      .slot-cell.is-selected .lesson-card {
        background: #d7dce3;
        border-color: #6b7076;
      }

      .cell-button:disabled {
        cursor: default;
      }

      .empty-label {
        width: 100%;
        height: 100%;
      }

      .bottom-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 255px 360px;
        gap: 8px;
        margin-top: 10px;
        align-items: start;
      }

      .box-panel {
        border: 1.5px solid var(--line);
        background: #ffffff;
      }

      .box-stack {
        display: grid;
        align-content: start;
      }

      .box-stack .box-panel {
        border-top: 0;
      }

      .box-textarea {
        width: 100%;
        min-height: 124px;
        border: 0;
        padding: 6px 8px;
        resize: none;
        font: inherit;
        background: #ffffff;
      }

      .special-static-block {
        white-space: normal;
        line-height: 1.45;
      }

      .box-table-title {
        border: 1.5px solid var(--line);
        border-bottom: 0;
        text-align: center;
        font-size: 12px;
        font-weight: 700;
        padding: 4px 6px;
      }

      .count-table th,
      .count-table td {
        padding: 3px 4px;
        text-align: center;
        height: 22px;
        font-size: 12px;
      }

      .count-table td:first-child,
      .count-table th:first-child {
        width: 50%;
      }

      .count-table input[type="number"] {
        width: 100%;
        border: 0;
        background: transparent;
        text-align: center;
        padding: 2px 4px;
      }

      .count-stack {
        display: grid;
        align-content: start;
      }

      .makeup-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .makeup-table td {
        border: 1.5px solid var(--line);
        padding: 2px 3px;
        text-align: left;
        font-size: 9px;
        line-height: 1.05;
        height: 17px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .summary-line {
        display: block;
      }

      .count-check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }

      .count-editor-footer {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 108px;
        gap: 8px;
        margin-top: 8px;
      }

      .count-submit-state,
      .count-apply-button,
      .modal-footer button {
        min-height: 40px;
        border: 1.5px solid var(--line);
        background: #ffffff;
        color: var(--ink);
        font-weight: 700;
      }

      .count-submit-state {
        display: grid;
        place-items: center;
        font-size: 12px;
      }

      .count-apply-button,
      .modal-footer button {
        width: 100%;
        cursor: pointer;
      }

      .placeholder-panel {
        display: grid;
        gap: 12px;
        padding: 48px 24px;
        text-align: center;
        color: var(--muted);
        border: 1.5px dashed var(--soft-line);
        background: rgba(255, 255, 255, 0.86);
        min-width: min(100%, 277mm);
      }

      .empty-state {
        padding: 44px 18px;
        text-align: center;
        color: var(--muted);
        border: 1.5px dashed var(--soft-line);
        background: rgba(255, 255, 255, 0.86);
      }

      .modal {
        position: fixed;
        inset: 0;
        z-index: 40;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: var(--overlay);
      }

      .modal-card {
        width: min(560px, 100%);
        max-height: calc(100vh - 48px);
        display: grid;
        gap: 12px;
        padding: 16px;
        background: #ffffff;
        border: 1.5px solid var(--line);
      }

      .modal-header {
        display: grid;
        gap: 6px;
      }

      .modal-title {
        font-size: 16px;
        font-weight: 700;
      }

      .modal-subtitle {
        font-size: 12px;
        color: var(--muted);
      }

      .modal-body {
        display: grid;
        gap: 12px;
        overflow: auto;
        scrollbar-width: none;
      }

      .modal-field {
        display: grid;
        gap: 6px;
      }

      .modal-field label {
        font-size: 12px;
        color: var(--muted);
      }

      .modal-field select,
      .modal-field input {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid #666666;
        border-radius: 0;
        background: #ffffff;
      }

      .modal-footer {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
      }

      .modal-footer .secondary {
        background: #f4f4f4;
      }

      .check-line {
        display: flex;
        gap: 6px;
        align-items: center;
        font-size: 12px;
      }

      @media (max-width: 980px) {
        .toolbar {
          align-items: stretch;
        }

        .sheet {
          width: min(100%, 277mm);
          min-height: auto;
        }

        .sheet-top,
        .bottom-grid,
        .modal-footer {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <input id="special-session-logo-input" type="file" accept="image/*" style="display:none" />
    <script>
      window.__lessonScheduleSpecialSessionPopupReady = true;
      const subjectDefinitions = ${serializedSubjects};
      const slotDefinitions = [
        { number: 1, label: '1限', timeLabel: '13:00-14:30' },
        { number: 2, label: '2限', timeLabel: '14:40-16:10' },
        { number: 3, label: '3限', timeLabel: '16:20-17:50' },
        { number: 4, label: '4限', timeLabel: '18:00-19:30' },
        { number: 5, label: '5限', timeLabel: '19:40-21:10' },
      ];
      const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];
      const root = document.getElementById('root');
      const logoInput = document.getElementById('special-session-logo-input');
      const initialPayload = ${serializedPayload};
      const state = {
        payload: initialPayload,
        tab: 'student',
        status: '',
        startDate: initialPayload.defaultStartDate || initialPayload.availableStartDate,
        endDate: initialPayload.defaultEndDate || initialPayload.availableEndDate,
        periodValue: '',
      };

      function escapeHtml(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;'); }
      function parseDate(dateKey) { const [year, month, day] = dateKey.split('-').map(Number); return new Date(year, month - 1, day); }
      function toDateKey(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }
      function formatMonthDay(dateKey) { const parts = dateKey.split('-'); return Number(parts[1]) + '月' + Number(parts[2]) + '日'; }
      function formatRangeLabel(startDate, endDate) { if (!startDate || !endDate) return ''; return formatMonthDay(startDate) + ' ～ ' + formatMonthDay(endDate); }
      function setDateInputValue(input, value) { input.value = value || ''; if (value && !input.value) { const parsed = new Date(value + 'T00:00:00'); if (!Number.isNaN(parsed.getTime())) input.valueAsDate = parsed; } }
      function getSharedStorage() { try { if (window.opener && window.opener !== window && window.opener.localStorage) return window.opener.localStorage; } catch {} try { return window.localStorage; } catch { return null; } }
      const sharedStoragePrefix = 'schedule-shared:student:';
      function getDatesInRange(startDate, endDate) { const dates = []; const cursor = parseDate(startDate); const limit = parseDate(endDate); while (cursor <= limit) { dates.push(toDateKey(cursor)); cursor.setDate(cursor.getDate() + 1); } return dates; }
      function getVisibleYears(dateHeaders) { return Array.from(new Set(dateHeaders.map((header) => String(header.year)))); }
      function buildMonthGroups(dateHeaders) { const groups = []; dateHeaders.forEach((header) => { const last = groups[groups.length - 1]; if (!last || last.month !== header.month || last.year !== header.year) groups.push({ year: header.year, month: header.month, count: 1 }); else last.count += 1; }); return groups; }
      function splitTimeLabel(timeLabel) { const normalized = String(timeLabel || '').replace(/\s+/g, ''); const matched = normalized.match(/^(.+?)[-~〜](.+)$/); if (!matched) return { start: normalized, end: '' }; return { start: matched[1], end: matched[2] }; }
      function getGradeLabel(birthDate, referenceDate) { if (!birthDate) return ''; const birthParts = birthDate.split('-').map(Number); const ref = new Date(referenceDate + 'T00:00:00'); const schoolYear = ref >= new Date(ref.getFullYear(), 3, 1) ? ref.getFullYear() : ref.getFullYear() - 1; const enrollmentYear = birthParts[1] < 4 || (birthParts[1] === 4 && birthParts[2] === 1) ? birthParts[0] + 6 : birthParts[0] + 7; const gradeNumber = schoolYear - enrollmentYear + 1; if (gradeNumber <= 1) return '小1'; if (gradeNumber === 2) return '小2'; if (gradeNumber === 3) return '小3'; if (gradeNumber === 4) return '小4'; if (gradeNumber === 5) return '小5'; if (gradeNumber === 6) return '小6'; if (gradeNumber === 7) return '中1'; if (gradeNumber === 8) return '中2'; if (gradeNumber === 9) return '中3'; if (gradeNumber === 10) return '高1'; if (gradeNumber === 11) return '高2'; return '高3'; }
      function formatStudentHeaderName(student, referenceDate) { const sourceName = student.fullName || student.name; const gradeLabel = getGradeLabel(student.birthDate, referenceDate); return gradeLabel ? sourceName + '(' + gradeLabel + ')' : sourceName; }
      function buildPeriodValue(band) { return band.startDate + '|' + band.endDate + '|' + band.label; }
      function getSortedPeriodBands() { return state.payload.periodBands.slice().sort((left, right) => left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate) || left.label.localeCompare(right.label, 'ja')); }
      function clampRange(startDate, endDate) { let nextStart = startDate || state.payload.defaultStartDate || state.payload.availableStartDate; let nextEnd = endDate || state.payload.defaultEndDate || state.payload.availableEndDate; if (nextStart > nextEnd) { const previous = nextStart; nextStart = nextEnd; nextEnd = previous; } return { startDate: nextStart, endDate: nextEnd }; }
      function normalizeSubjectSlots(subjectSlots) { const next = {}; subjectDefinitions.forEach((subject) => { const rawValue = Number(subjectSlots && typeof subjectSlots === 'object' ? subjectSlots[subject] : 0); const normalizedValue = Number.isFinite(rawValue) ? Math.max(0, Math.trunc(rawValue)) : 0; if (normalizedValue > 0) next[subject] = normalizedValue; }); return next; }
      function sumSubjectSlots(subjectSlots) { return Object.values(normalizeSubjectSlots(subjectSlots)).reduce((total, value) => total + value, 0); }
      function sortSlotKeys(slotKeys) { return Array.from(new Set(slotKeys)).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true })); }
      function defaultStudentInput() { return { unavailableSlots: [], regularBreakSlots: [], subjectSlots: {}, regularOnly: false, countSubmitted: false, updatedAt: '' }; }
      function getStudentInput(student) { const current = student.input || defaultStudentInput(); return { ...defaultStudentInput(), ...current, unavailableSlots: sortSlotKeys(current.unavailableSlots || []), regularBreakSlots: sortSlotKeys(current.regularBreakSlots || []), subjectSlots: normalizeSubjectSlots(current.subjectSlots), regularOnly: Boolean(current.regularOnly), countSubmitted: Boolean(current.countSubmitted) }; }
      function getRegularAssignment(student, slotKey) { return student.regularAssignments && typeof student.regularAssignments === 'object' ? student.regularAssignments[slotKey] || null : null; }
      function applyStudentInput(studentId, updater) { const student = state.payload.students.find((entry) => entry.id === studentId); if (!student) return; const currentInput = getStudentInput(student); const nextInput = updater({ ...currentInput, unavailableSlots: [...currentInput.unavailableSlots], regularBreakSlots: [...currentInput.regularBreakSlots], subjectSlots: { ...normalizeSubjectSlots(currentInput.subjectSlots) } }); const normalizedRegularBreakSlots = sortSlotKeys((nextInput.regularBreakSlots || []).filter((slotKey) => Boolean(getRegularAssignment(student, slotKey)))); const normalizedUnavailableSlots = sortSlotKeys(nextInput.unavailableSlots || []); student.input = { ...defaultStudentInput(), ...nextInput, unavailableSlots: normalizedUnavailableSlots, regularBreakSlots: normalizedRegularBreakSlots, subjectSlots: nextInput.regularOnly ? {} : normalizeSubjectSlots(nextInput.subjectSlots), regularOnly: Boolean(nextInput.regularOnly), countSubmitted: Boolean(nextInput.countSubmitted) }; }
      function isOpenDayByRules(dateKey) { if (state.payload.availability.forceOpenDates.includes(dateKey)) return true; if (state.payload.availability.holidayDates.includes(dateKey)) return false; return !state.payload.availability.closedWeekdays.includes(new Date(dateKey + 'T00:00:00').getDay()); }
      function buildDateHeaders(startDate, endDate) { return getDatesInRange(startDate, endDate).map((dateKey) => { const date = parseDate(dateKey); return { dateKey, year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), weekday: date.getDay(), isOpenDay: isOpenDayByRules(dateKey) }; }); }
      function buildPeriodSegments(dateHeaders) { const groups = []; let cursor = 0; while (cursor < dateHeaders.length) { const header = dateHeaders[cursor]; const matched = state.payload.periodBands.find((band) => header.dateKey >= band.startDate && header.dateKey <= band.endDate); if (!matched) { const gapStart = cursor; while (cursor < dateHeaders.length && !state.payload.periodBands.find((band) => dateHeaders[cursor].dateKey >= band.startDate && dateHeaders[cursor].dateKey <= band.endDate)) cursor += 1; groups.push({ type: 'gap', key: 'gap-' + gapStart, colSpan: cursor - gapStart }); continue; } const segmentStart = cursor; while (cursor < dateHeaders.length && dateHeaders[cursor].dateKey >= matched.startDate && dateHeaders[cursor].dateKey <= matched.endDate) cursor += 1; groups.push({ type: 'band', key: matched.label + '-' + segmentStart, colSpan: cursor - segmentStart, label: matched.label }); } return groups; }
      function getTableDensityClass(dateHeaders) { if (dateHeaders.length >= 28) return 'is-dense'; if (dateHeaders.length >= 18) return 'is-compact'; return ''; }
      function makeCornerYearHtml(dateHeaders) { return getVisibleYears(dateHeaders).map((year) => '<span class="time-corner-year">' + year + '</span>').join(''); }
      function makeMonthHeaderHtml(dateHeaders) { return buildMonthGroups(dateHeaders).map((group) => '<th colspan="' + group.count + '">' + group.month + '月</th>').join(''); }
      function makeDateHeaderHtml(student, dateHeaders) { return dateHeaders.map((header) => { const slotKeys = header.isOpenDay ? slotDefinitions.map((slot) => header.dateKey + '_' + slot.number) : []; const cls = !header.isOpenDay ? 'holiday-col' : ''; return '<th class="' + cls + '"><button type="button" class="header-toggle" data-role="toggle-day" data-student-id="' + student.id + '" data-slot-keys="' + slotKeys.join('|') + '" data-testid="special-session-popup-day-' + student.id + '-' + header.dateKey + '"' + (slotKeys.length === 0 ? ' disabled' : '') + '>' + header.day + '</button></th>'; }).join(''); }
      function makeWeekdayHeaderHtml(dateHeaders) { return dateHeaders.map((header) => { const cls = [!header.isOpenDay ? 'holiday-col' : '', header.weekday === 0 ? 'weekday-sun' : '', header.weekday === 6 ? 'weekday-sat' : ''].filter(Boolean).join(' '); return '<th class="' + cls + '">' + weekdayLabels[header.weekday] + '</th>'; }).join(''); }
      function renderTimeHeaderCell(timeLabel, slotNumber, studentId, slotKeys) { const range = splitTimeLabel(timeLabel); const rangeHtml = range.end ? '<div class="time-range"><span class="time-part">' + escapeHtml(range.start) + '</span><span class="time-separator">〜</span><span class="time-part">' + escapeHtml(range.end) + '</span></div>' : '<div class="time-range"><span class="time-part">' + escapeHtml(range.start) + '</span></div>'; return '<th class="time-col"><div class="time-box"><button type="button" class="time-toggle-button" data-role="toggle-slot-row" data-student-id="' + studentId + '" data-slot-keys="' + slotKeys.join('|') + '" data-testid="special-session-popup-slot-row-' + studentId + '-' + slotNumber + '"' + (slotKeys.length === 0 ? ' disabled' : '') + '>' + rangeHtml + '<div class="time-slot">' + slotNumber + '限</div></button></div></th>'; }
      function buildHeaderHtml(subLabel, periodLabel, pageIndex) { return '<div class="sheet-top">' + '<div class="logo-box" data-shared-image="logo"><span class="logo-placeholder">ロゴ欄</span></div>' + '<div class="school-box"><textarea class="school-input shared-input" data-shared-input="school-info" rows="2" placeholder="校舎名&#10;TEL等"></textarea></div>' + '<div class="title-box"><div class="title-input">' + escapeHtml(state.payload.session.label + ' 希望入力') + '</div></div>' + '<div class="meta-box"><div class="meta-row"><span class="meta-label">期間:</span> ' + escapeHtml(periodLabel) + '</div><div class="meta-row"><span>' + (pageIndex + 1) + 'ページ目</span><span><span class="meta-label">生徒名:</span> ' + escapeHtml(subLabel) + '</span></div></div>' + '</div>'; }
      function renderRegularCard(assignment) { return '<div class="lesson-card"><div class="lesson-main">' + escapeHtml(assignment.subject) + '</div><div class="lesson-sub">' + escapeHtml(assignment.lessonType === 'makeup' ? '振替' : '通常') + '</div></div>'; }
      function formatSlotKeyLabel(slotKey) { const parts = slotKey.split('_'); return formatMonthDay(parts[0]) + ' ' + parts[1] + '限'; }
      function renderStudentCell(student, slotKey, isHoliday) { const input = getStudentInput(student); const regularAssignment = getRegularAssignment(student, slotKey); const isUnavailable = input.unavailableSlots.includes(slotKey); const classes = ['slot-cell']; if (isHoliday) classes.push('is-holiday'); if (isUnavailable) classes.push('is-selected'); const buttonClasses = ['cell-button']; if (isUnavailable) buttonClasses.push('is-unavailable'); if (regularAssignment) buttonClasses.push('has-regular-lesson'); const title = regularAssignment ? [regularAssignment.subject, '通常授業', regularAssignment.teacherName].filter(Boolean).join(' / ') : ''; const content = regularAssignment ? renderRegularCard(regularAssignment) : '<span class="empty-label"></span>'; return '<td class="' + classes.join(' ') + '"><div class="slot-cell-content"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-slot" data-student-id="' + student.id + '" data-slot-key="' + slotKey + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + (isHoliday ? ' disabled' : '') + ' data-testid="special-session-popup-cell-' + student.id + '-' + slotKey + '">' + content + '</button></div></td>'; }
      function updateLectureCountSubject(studentId, subject, value) { applyStudentInput(studentId, (current) => { const subjectSlots = { ...normalizeSubjectSlots(current.subjectSlots) }; const normalizedValue = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0; if (normalizedValue > 0) subjectSlots[subject] = normalizedValue; else delete subjectSlots[subject]; return { ...current, subjectSlots, countSubmitted: false }; }); refreshStudentSheet(studentId); }
      function updateLectureCountRegularOnly(studentId, regularOnly) { applyStudentInput(studentId, (current) => ({ ...current, regularOnly: Boolean(regularOnly), subjectSlots: regularOnly ? {} : normalizeSubjectSlots(current.subjectSlots), countSubmitted: false })); refreshStudentSheet(studentId); }
      function applyLectureCount(studentId) { const student = state.payload.students.find((entry) => entry.id === studentId); if (!student) return; applyStudentInput(studentId, (current) => ({ ...current, countSubmitted: true })); state.status = '希望コマ数の変更を画面へ反映しました。'; refreshStudentSheet(studentId); }
      function buildRegularBreakRows(student) { const rows = getStudentInput(student).regularBreakSlots.map((slotKey) => { const assignment = getRegularAssignment(student, slotKey); const label = assignment ? assignment.subject + ' ' + formatSlotKeyLabel(slotKey) + '（生徒希望入力）' : formatSlotKeyLabel(slotKey) + '（生徒希望入力）'; return '<tr><td colspan="3">' + escapeHtml(label) + '</td></tr>'; }); return Array.from({ length: Math.max(7, rows.length) }, (_, index) => rows[index] || '<tr><td colspan="3"></td></tr>').join(''); }
      function buildLectureCountRows(student) { const input = getStudentInput(student); const subjectRows = subjectDefinitions.map((subject) => '<tr><td>' + escapeHtml(subject) + '</td><td><input type="number" min="0" step="1" data-role="lecture-count-subject" data-student-id="' + student.id + '" data-subject="' + subject + '" data-testid="special-session-popup-subject-' + student.id + '-' + subject + '" value="' + escapeHtml(String(Number(input.subjectSlots[subject] || 0))) + '"' + (input.regularOnly ? ' disabled' : '') + '></td></tr>').join(''); const regularOnlyRow = '<tr><td>通常のみ</td><td><label class="count-check"><input type="checkbox" data-role="lecture-count-regular-only" data-student-id="' + student.id + '" data-testid="special-session-popup-regular-only-' + student.id + '"' + (input.regularOnly ? ' checked' : '') + '>通常のみ</label></td></tr>'; return subjectRows + regularOnlyRow; }
      function renderBottomSection(student) { const input = getStudentInput(student); const guideBox = '<div class="box-stack"><div class="box-table-title">共通連絡事項</div><div class="box-panel"><div class="box-textarea special-static-block"></div></div></div>'; const selectionBox = '<div class="box-stack"><div class="box-table-title">個別連絡事項</div><div class="box-panel"><div class="box-textarea special-static-block"><span class="summary-line">' + escapeHtml(formatStudentHeaderName(student, state.startDate)) + '</span><span class="summary-line">' + escapeHtml(state.status || '日付・時限・通常授業をクリックして入力できます。') + '</span></div></div></div>'; const makeupBox = '<div class="box-stack"><div class="box-table-title">振替授業</div><table class="makeup-table"><tbody>' + buildRegularBreakRows(student) + '</tbody></table></div>'; const lectureCountBox = '<div><div class="box-table-title">講習回数(希望数)</div><table class="count-table"><tbody>' + buildLectureCountRows(student) + '</tbody></table><div class="count-editor-footer"><div class="count-submit-state" data-testid="special-session-popup-count-status-' + student.id + '">' + escapeHtml(input.countSubmitted ? '提出済み' : '未提出') + '</div><button type="button" class="count-apply-button" data-role="apply-lecture-count" data-student-id="' + student.id + '" data-testid="special-session-popup-apply-count-' + student.id + '">反映</button></div></div>'; return '<div class="bottom-grid">' + guideBox + selectionBox + makeupBox + '<div class="count-stack">' + lectureCountBox + '</div></div>'; }
      function renderStudentSheet(student, index, dateHeaders, periodSegments, tableDensityClass) { const periodRowHtml = periodSegments.length ? '<tr class="period-row"><th class="time-col"></th>' + periodSegments.map((segment) => segment.type === 'gap' ? '<th class="period-gap" colspan="' + segment.colSpan + '"></th>' : '<th class="period-band" colspan="' + segment.colSpan + '"><span class="period-pill"><span class="period-pill-edge">◀</span><span class="period-pill-label">' + escapeHtml(segment.label) + '</span><span class="period-pill-edge">▶</span></span></th>').join('') + '</tr>' : ''; const rows = slotDefinitions.map((slot) => { const visibleSlotKeys = dateHeaders.filter((header) => header.isOpenDay).map((header) => header.dateKey + '_' + slot.number); return '<tr>' + renderTimeHeaderCell(slot.timeLabel, slot.number, student.id, visibleSlotKeys) + dateHeaders.map((header) => renderStudentCell(student, header.dateKey + '_' + slot.number, !header.isOpenDay)).join('') + '</tr>'; }).join(''); return '<section class="sheet" data-student-id="' + student.id + '" data-testid="special-session-student-sheet-' + student.id + '">' + buildHeaderHtml(formatStudentHeaderName(student, state.startDate), formatRangeLabel(state.startDate, state.endDate), index) + '<table class="schedule-table ' + tableDensityClass + '"><thead>' + periodRowHtml + '<tr class="month-row"><th class="time-col time-corner" rowspan="3"><div class="time-corner-box">' + makeCornerYearHtml(dateHeaders) + '</div></th>' + makeMonthHeaderHtml(dateHeaders) + '</tr><tr class="date-row">' + makeDateHeaderHtml(student, dateHeaders) + '</tr><tr class="weekday-row">' + makeWeekdayHeaderHtml(dateHeaders) + '</tr></thead><tbody>' + rows + '</tbody></table>' + renderBottomSection(student) + '</section>'; }
      function renderStudentPages() { const dateHeaders = buildDateHeaders(state.startDate, state.endDate); const periodSegments = buildPeriodSegments(dateHeaders); const tableDensityClass = getTableDensityClass(dateHeaders); return state.payload.students.map((student, index) => renderStudentSheet(student, index, dateHeaders, periodSegments, tableDensityClass)).join(''); }
      function updateStatusText() { const statusElement = root.querySelector('[data-testid="special-session-popup-status"]'); if (statusElement) statusElement.textContent = state.status || (state.tab === 'student' ? '生徒日程表の一覧上で入力できます。' : '講師入力は後で設定します。'); }
      function hydrateSharedInputs(scope) { (scope || document).querySelectorAll('.shared-input').forEach((element) => { const sharedKey = element.getAttribute('data-shared-input'); if (!sharedKey) return; element.value = resolveSharedInputValue(sharedKey); }); }
      function refreshStudentSheet(studentId) { const studentIndex = state.payload.students.findIndex((entry) => entry.id === studentId); if (studentIndex < 0) return; const currentSheet = root.querySelector('[data-testid="special-session-student-sheet-' + studentId + '"]'); if (!currentSheet) { render(); return; } const dateHeaders = buildDateHeaders(state.startDate, state.endDate); const periodSegments = buildPeriodSegments(dateHeaders); const tableDensityClass = getTableDensityClass(dateHeaders); currentSheet.outerHTML = renderStudentSheet(state.payload.students[studentIndex], studentIndex, dateHeaders, periodSegments, tableDensityClass); hydrateSharedInputs(root); if (window.__specialSessionReadStoredLogo) syncLogo(window.__specialSessionReadStoredLogo()); updateStatusText(); }
      function toggleStudentSlots(studentId, slotKeys) { const student = state.payload.students.find((entry) => entry.id === studentId); if (!student) return; const normalizedSlotKeys = sortSlotKeys(slotKeys.filter(Boolean)); if (normalizedSlotKeys.length === 0) return; const currentInput = getStudentInput(student); const shouldSelect = normalizedSlotKeys.some((slotKey) => !currentInput.unavailableSlots.includes(slotKey)); applyStudentInput(studentId, (current) => { const unavailableSlots = new Set(current.unavailableSlots); const regularBreakSlots = new Set(current.regularBreakSlots); normalizedSlotKeys.forEach((slotKey) => { if (shouldSelect) unavailableSlots.add(slotKey); else unavailableSlots.delete(slotKey); if (getRegularAssignment(student, slotKey)) { if (shouldSelect) regularBreakSlots.add(slotKey); else regularBreakSlots.delete(slotKey); } else { regularBreakSlots.delete(slotKey); } }); return { ...current, unavailableSlots: Array.from(unavailableSlots), regularBreakSlots: Array.from(regularBreakSlots) }; }); refreshStudentSheet(studentId); }
      function renderTeacherPlaceholder() { return '<div class="placeholder-panel" data-testid="special-session-popup-screen"><strong>講師入力は後で設定します。</strong><span>いまは生徒日程表をそのまま一覧表示し、出席不可コマと希望コマ数を先に入力できる状態にしています。</span></div>'; }
      function setRangeAndRender(nextStartDate, nextEndDate, nextPeriodValue) { const normalizedRange = clampRange(nextStartDate, nextEndDate); state.startDate = normalizedRange.startDate; state.endDate = normalizedRange.endDate; const matchedBand = getSortedPeriodBands().find((band) => band.startDate === state.startDate && band.endDate === state.endDate); state.periodValue = nextPeriodValue || (matchedBand ? buildPeriodValue(matchedBand) : ''); render(); }
      function applyIncomingPayload(nextPayload) { state.payload = nextPayload; const normalizedRange = clampRange(state.startDate, state.endDate); state.startDate = normalizedRange.startDate; state.endDate = normalizedRange.endDate; const matchedBand = getSortedPeriodBands().find((band) => band.startDate === state.startDate && band.endDate === state.endDate); state.periodValue = matchedBand ? buildPeriodValue(matchedBand) : ''; render(); }
      function resolveSharedInputValue(sharedKey) { const activeElement = document.querySelector('.shared-input[data-shared-input="' + sharedKey + '"]'); if (activeElement && 'value' in activeElement && typeof activeElement.value === 'string' && activeElement.value) return activeElement.value; const storage = getSharedStorage(); try { return storage ? storage.getItem(sharedStoragePrefix + sharedKey) || '' : ''; } catch { return ''; } }
      function bindSharedInputs() { document.querySelectorAll('.shared-input').forEach((element) => { const sharedKey = element.getAttribute('data-shared-input'); const storageKey = sharedStoragePrefix + sharedKey; const storage = getSharedStorage(); try { const saved = storage ? storage.getItem(storageKey) : null; if (saved !== null) element.value = saved; } catch {} if (element.dataset.sharedBound === 'true') return; element.dataset.sharedBound = 'true'; element.addEventListener('input', () => { try { storage && storage.setItem(storageKey, element.value); } catch {} document.querySelectorAll('.shared-input[data-shared-input="' + sharedKey + '"]').forEach((other) => { if (other !== element) other.value = element.value; }); }); }); }
      function syncLogo(src) { document.querySelectorAll('[data-shared-image="logo"]').forEach((element) => { element.innerHTML = src ? '<img class="logo-image" src="' + src + '" alt="logo" />' : '<span class="logo-placeholder">ロゴ欄</span>'; }); }
      function bindLogoControls() { const storageKey = sharedStoragePrefix + 'logo'; const readStoredLogo = () => { const storage = getSharedStorage(); try { return storage ? storage.getItem(storageKey) || '' : ''; } catch { return ''; } }; try { syncLogo(readStoredLogo()); } catch { syncLogo(''); } document.addEventListener('click', (event) => { const target = event.target; if (!(target instanceof HTMLElement)) return; const logoBox = target.closest('[data-shared-image="logo"]'); if (!logoBox || !logoInput) return; logoInput.click(); }); logoInput?.addEventListener('change', () => { const file = logoInput.files && logoInput.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const result = typeof reader.result === 'string' ? reader.result : ''; syncLogo(result); try { const storage = getSharedStorage(); storage && storage.setItem(storageKey, result); } catch {} }; reader.readAsDataURL(file); }); return readStoredLogo; }
      function saveStudents() { if (!window.opener || window.opener.closed) { state.status = '保存先の画面が見つかりません。'; render(); return; } const entries = state.payload.students.map((student) => { const input = getStudentInput(student); return { personId: student.id, unavailableSlots: input.unavailableSlots.slice(), regularBreakSlots: input.regularBreakSlots.slice(), subjectSlots: input.regularOnly ? {} : normalizeSubjectSlots(input.subjectSlots), regularOnly: Boolean(input.regularOnly), countSubmitted: Boolean(input.countSubmitted) }; }); window.opener.postMessage({ type: 'special-session-availability-save-students', sessionId: state.payload.session.id, entries }, '*'); state.status = '生徒の欠席不可コマ・通常休み・希望科目数を保存しました。'; render(); }
      function render() {
        const periodOptionsHtml = ['<option value="">選択してください</option>'].concat(getSortedPeriodBands().map((band) => '<option value="' + escapeHtml(buildPeriodValue(band)) + '">' + escapeHtml(band.label + ' (' + formatMonthDay(band.startDate) + ' - ' + formatMonthDay(band.endDate) + ')') + '</option>')).join('');
        const studentScreen = state.payload.students.length > 0 ? renderStudentPages() : '<div class="empty-state" data-testid="special-session-popup-screen">この期間に在籍中の生徒はいません。</div>';
        root.innerHTML = '<div class="toolbar"><div class="toolbar-title"><strong>' + escapeHtml(state.payload.session.label + ' 希望入力') + '</strong><span>' + escapeHtml(state.payload.session.label) + '</span></div><button type="button" class="' + (state.tab === 'teacher' ? 'active' : '') + '" data-role="switch-tab" data-tab="teacher" data-testid="special-session-popup-tab-teacher">講師</button><button type="button" class="' + (state.tab === 'student' ? 'active' : '') + '" data-role="switch-tab" data-tab="student" data-testid="special-session-popup-tab-student">生徒</button><div class="toolbar-field"><label for="special-session-period-select">期間帯</label><select id="special-session-period-select" data-role="period-select" data-testid="special-session-popup-period-select">' + periodOptionsHtml + '</select></div><div class="toolbar-field"><label for="special-session-start-date">開始日</label><input id="special-session-start-date" type="date" data-role="start-date" data-testid="special-session-popup-start-date"></div><div class="toolbar-field"><label for="special-session-end-date">終了日</label><input id="special-session-end-date" type="date" data-role="end-date" data-testid="special-session-popup-end-date"></div><div class="toolbar-summary" data-testid="special-session-popup-status">' + escapeHtml(state.status || (state.tab === 'student' ? '生徒日程表の一覧上で入力できます。' : '講師入力は後で設定します。')) + '</div><button type="button" data-role="save" data-testid="special-session-popup-save-button"' + (state.tab === 'teacher' ? ' disabled' : '') + '>保存</button></div><main class="pages">' + (state.tab === 'student' ? studentScreen : renderTeacherPlaceholder()) + '</main>';
        const periodSelect = root.querySelector('[data-role="period-select"]');
        const startInput = root.querySelector('[data-role="start-date"]');
        const endInput = root.querySelector('[data-role="end-date"]');
        if (periodSelect) periodSelect.value = state.periodValue;
        if (startInput) setDateInputValue(startInput, state.startDate);
        if (endInput) setDateInputValue(endInput, state.endDate);
        bindSharedInputs();
        if (window.__specialSessionReadStoredLogo) syncLogo(window.__specialSessionReadStoredLogo());
      }
      window.addEventListener('message', (event) => { const message = event.data; if (!message || message.type !== 'special-session-availability-update') return; applyIncomingPayload(message.payload); });
      function handleDateInputChange() { const startInput = root.querySelector('[data-role="start-date"]'); const endInput = root.querySelector('[data-role="end-date"]'); setRangeAndRender(startInput && startInput.value ? startInput.value : '', endInput && endInput.value ? endInput.value : '', ''); }
      root.addEventListener('click', (event) => { const target = event.target; if (!(target instanceof HTMLElement)) return; const switchTab = target.closest('[data-role="switch-tab"]'); if (switchTab) { state.tab = switchTab.getAttribute('data-tab') || 'student'; render(); return; } const toggleSlot = target.closest('[data-role="toggle-slot"]'); if (toggleSlot) { const studentId = toggleSlot.getAttribute('data-student-id') || ''; const slotKey = toggleSlot.getAttribute('data-slot-key') || ''; if (!studentId || !slotKey) return; toggleStudentSlots(studentId, [slotKey]); return; } const toggleDay = target.closest('[data-role="toggle-day"]'); if (toggleDay) { const studentId = toggleDay.getAttribute('data-student-id') || ''; const slotKeys = (toggleDay.getAttribute('data-slot-keys') || '').split('|').filter(Boolean); if (!studentId) return; toggleStudentSlots(studentId, slotKeys); return; } const toggleSlotRow = target.closest('[data-role="toggle-slot-row"]'); if (toggleSlotRow) { const studentId = toggleSlotRow.getAttribute('data-student-id') || ''; const slotKeys = (toggleSlotRow.getAttribute('data-slot-keys') || '').split('|').filter(Boolean); if (!studentId) return; toggleStudentSlots(studentId, slotKeys); return; } const applyCount = target.closest('[data-role="apply-lecture-count"]'); if (applyCount) { applyLectureCount(applyCount.getAttribute('data-student-id') || ''); return; } if (target.closest('[data-role="save"]')) { saveStudents(); } });
      root.addEventListener('change', (event) => { const target = event.target; if (!(target instanceof HTMLElement)) return; if (target.matches('[data-role="period-select"]')) { const value = 'value' in target && target.value ? target.value : ''; if (!value) return; const parts = value.split('|'); setRangeAndRender(parts[0] || '', parts[1] || '', value); return; } if (target.matches('[data-role="lecture-count-regular-only"]')) { const studentId = target.getAttribute('data-student-id') || ''; if (!studentId) return; updateLectureCountRegularOnly(studentId, 'checked' in target && Boolean(target.checked)); return; } if (target.matches('[data-role="lecture-count-subject"]')) { const studentId = target.getAttribute('data-student-id') || ''; const subject = target.getAttribute('data-subject') || ''; if (!studentId || !subject) return; updateLectureCountSubject(studentId, subject, Number('value' in target ? target.value || '0' : '0')); } });
      root.addEventListener('input', (event) => { const target = event.target; if (!(target instanceof HTMLElement)) return; if (target.matches('[data-role="start-date"]') || target.matches('[data-role="end-date"]')) { handleDateInputChange(); return; } if (target.matches('[data-role="lecture-count-subject"]')) { const studentId = target.getAttribute('data-student-id') || ''; const subject = target.getAttribute('data-subject') || ''; if (!studentId || !subject) return; updateLectureCountSubject(studentId, subject, Number('value' in target ? target.value || '0' : '0')); } });
      window.__specialSessionReadStoredLogo = bindLogoControls();
      state.periodValue = state.payload.periodBands.length > 0 ? buildPeriodValue(state.payload.periodBands[0]) : '';
      render();
    </script>
  </body>
</html>`
}

function writePopupHtml(targetWindow: PopupWindowWithMarker, payload: PopupPayload) {
  targetWindow.document.open()
  targetWindow.document.write(createSpecialSessionAvailabilityHtml(payload))
  targetWindow.document.close()
}

function postPopupPayload(targetWindow: PopupWindowWithMarker, payload: PopupPayload) {
  targetWindow.postMessage({ type: 'special-session-availability-update', payload }, '*')
}

export function openSpecialSessionAvailabilityHtml(params: OpenSpecialSessionAvailabilityHtmlParams) {
  const targetWindow = createPopupWindow(params.targetWindow)
  if (!targetWindow) return null

  const payload = buildPayload(params)
  if (targetWindow.__lessonScheduleSpecialSessionPopupReady) postPopupPayload(targetWindow, payload)
  else writePopupHtml(targetWindow, payload)
  targetWindow.focus()
  return targetWindow
}

export function syncSpecialSessionAvailabilityHtml(params: OpenSpecialSessionAvailabilityHtmlParams) {
  const { targetWindow } = params
  if (!targetWindow || targetWindow.closed) return

  const popupWindow = targetWindow as PopupWindowWithMarker
  const payload = buildPayload(params)
  if (popupWindow.__lessonScheduleSpecialSessionPopupReady) postPopupPayload(popupWindow, payload)
  else writePopupHtml(popupWindow, payload)
}
