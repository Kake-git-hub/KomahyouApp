import { getStudentDisplayName, getTeacherDisplayName, type StudentRow, type TeacherRow } from '../components/basic-data/basicDataModel'
import type { SpecialSessionRow } from '../components/special-data/specialSessionModel'

type PopupWindowWithMarker = Window & typeof globalThis & {
  __lessonScheduleSpecialSessionPopupReady?: boolean
}

type PopupSession = Pick<SpecialSessionRow, 'id' | 'label' | 'startDate' | 'endDate'>

type PopupTeacher = {
  id: string
  name: string
  input: SpecialSessionRow['teacherInputs'][string] | null
}

type PopupStudent = {
  id: string
  name: string
  input: SpecialSessionRow['studentInputs'][string] | null
}

type PopupPayload = {
  session: PopupSession
  teachers: PopupTeacher[]
  students: PopupStudent[]
}

type OpenSpecialSessionAvailabilityHtmlParams = {
  session: SpecialSessionRow
  teachers: TeacherRow[]
  students: StudentRow[]
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
  const { session, teachers, students } = params
  return {
    session: {
      id: session.id,
      label: session.label,
      startDate: session.startDate,
      endDate: session.endDate,
    },
    teachers: teachers
      .filter((teacher) => isActiveDuringSession(teacher.entryDate, teacher.withdrawDate, teacher.isHidden, session.startDate, session.endDate))
      .sort((left, right) => getTeacherDisplayName(left).localeCompare(getTeacherDisplayName(right), 'ja'))
      .map((teacher) => ({ id: teacher.id, name: getTeacherDisplayName(teacher), input: session.teacherInputs[teacher.id] ?? null })),
    students: students
      .filter((student) => isActiveDuringSession(student.entryDate, student.withdrawDate, student.isHidden, session.startDate, session.endDate))
      .sort((left, right) => getStudentDisplayName(left).localeCompare(getStudentDisplayName(right), 'ja'))
      .map((student) => ({ id: student.id, name: getStudentDisplayName(student), input: session.studentInputs[student.id] ?? null })),
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
        --line: #c7d4e3;
        --ink: #17324d;
        --muted: #5f7793;
        --accent: #2b6cb0;
        --accent-soft: #d7e9fb;
        --accent-strong: #184e88;
        --danger-soft: #ffe1e1;
        --danger: #bf3f3f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: 'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif;
        color: var(--ink);
        background: linear-gradient(180deg, #f6f9fc 0%, #ebf2f8 100%);
      }
      button { font: inherit; }
      .toolbar {
        position: sticky;
        top: 0;
        z-index: 20;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        padding: 12px 18px;
        border-bottom: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.96);
      }
      .toolbar h1 { margin: 0; font-size: 18px; }
      .toolbar p { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
      .toolbar-actions { display: flex; gap: 8px; align-items: center; }
      .toolbar-status { min-height: 18px; color: var(--muted); font-size: 12px; }
      .button { border: 1px solid var(--line); border-radius: 999px; padding: 8px 14px; background: #fff; cursor: pointer; }
      .button.primary { border-color: var(--accent); background: var(--accent); color: #fff; }
      .layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 18px; padding: 18px; }
      .panel { border: 1px solid var(--line); border-radius: 18px; background: var(--paper); box-shadow: 0 16px 36px rgba(22, 49, 79, 0.08); }
      .sidebar { display: grid; gap: 14px; padding: 16px; align-content: start; }
      .tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .tab-button { border: 1px solid var(--line); border-radius: 12px; background: #fff; padding: 10px 12px; text-align: center; cursor: pointer; }
      .tab-button.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); font-weight: 700; }
      .person-list { display: grid; gap: 8px; max-height: calc(100vh - 220px); overflow: auto; }
      .person-row { display: grid; gap: 4px; width: 100%; border: 1px solid var(--line); border-radius: 14px; background: #fff; padding: 10px 12px; text-align: left; cursor: pointer; }
      .person-row.active { border-color: var(--accent); background: #f7fbff; }
      .person-row strong { font-size: 14px; }
      .person-row span { color: var(--muted); font-size: 12px; }
      .editor { display: grid; gap: 14px; padding: 18px; }
      .editor-head { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; justify-content: space-between; }
      .editor-head h2 { margin: 0; font-size: 18px; }
      .editor-head p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
      .student-preferences { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 16px; background: #fbfdff; }
      .student-preferences-head { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; }
      .student-preferences-title { font-size: 14px; font-weight: 700; }
      .regular-only-toggle { display: inline-flex; gap: 8px; align-items: center; font-size: 13px; color: var(--ink); }
      .subject-count-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 10px; }
      .subject-count-field { display: grid; gap: 6px; }
      .subject-count-field span { font-size: 12px; color: var(--muted); }
      .subject-count-input { width: 100%; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; font: inherit; }
      .subject-count-input:disabled { background: #eef3f8; color: #7990aa; cursor: default; }
      .schedule-wrapper { overflow: auto; border: 1px solid var(--line); border-radius: 16px; }
      table.schedule { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 0; background: #fff; }
      .schedule th, .schedule td { border-right: 1px solid #e3ebf4; border-bottom: 1px solid #e3ebf4; text-align: center; }
      .schedule thead th { position: sticky; top: 0; z-index: 5; background: #f8fbff; }
      .schedule .month-cell, .schedule .date-cell, .schedule .weekday-cell, .schedule .slot-head, .schedule .slot-time { min-width: 64px; padding: 8px 6px; }
      .schedule .slot-label-col, .schedule .slot-time-col { position: sticky; left: 0; z-index: 6; background: #f8fbff; }
      .schedule .slot-time-col { left: 68px; }
      .date-toggle, .slot-toggle, .cell-button { width: 100%; border: none; background: transparent; color: inherit; cursor: pointer; padding: 0; }
      .date-toggle.is-selected, .slot-toggle.is-selected { color: var(--accent-strong); font-weight: 700; }
      .weekday-sat { color: #2b5fab; }
      .weekday-sun { color: #b03a3a; }
      .cell-button { min-width: 42px; min-height: 38px; background: #fff; }
      .cell-button.is-unavailable { background: var(--danger-soft); color: var(--danger); font-weight: 700; }
      .hint { color: var(--muted); font-size: 12px; }
      .empty { padding: 28px; color: var(--muted); text-align: center; }
      @media (max-width: 980px) { .layout { grid-template-columns: 1fr; } .person-list { max-height: none; } }
    </style>
  </head>
  <body>
    <div id="root"></div>
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
      const state = { payload: ${serializedPayload}, tab: 'teacher', selectedTeacherId: '', selectedStudentId: '', status: '' };
      function parseDate(dateKey) { const [year, month, day] = dateKey.split('-').map(Number); return new Date(year, month - 1, day); }
      function toDateKey(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }
      function getDatesInRange(startDate, endDate) { const dates = []; const cursor = parseDate(startDate); const limit = parseDate(endDate); while (cursor <= limit) { dates.push(toDateKey(cursor)); cursor.setDate(cursor.getDate() + 1); } return dates; }
      function formatDateLabel(dateKey) { const date = parseDate(dateKey); return (date.getMonth() + 1) + '/' + date.getDate() + '(' + weekdayLabels[date.getDay()] + ')'; }
      function buildMonthGroups(dates) { const groups = []; for (const dateKey of dates) { const monthKey = dateKey.slice(0, 7); const last = groups[groups.length - 1]; if (!last || last.monthKey !== monthKey) groups.push({ monthKey, label: monthKey.replace('-', '年') + '月', count: 1 }); else last.count += 1; } return groups; }
      function sortSlotKeys(slotKeys) { return Array.from(new Set(slotKeys)).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true })); }
      function normalizeSubjectSlots(subjectSlots) { const next = {}; subjectDefinitions.forEach((subject) => { const rawValue = Number(subjectSlots && typeof subjectSlots === 'object' ? subjectSlots[subject] : 0); const normalizedValue = Number.isFinite(rawValue) ? Math.max(0, Math.trunc(rawValue)) : 0; if (normalizedValue > 0) next[subject] = normalizedValue; }); return next; }
      function sumSubjectSlots(subjectSlots) { return Object.values(normalizeSubjectSlots(subjectSlots)).reduce((total, value) => total + value, 0); }
      function getTeacherSummary(teacher) { if (!teacher.input) return '未入力'; return teacher.input.unavailableSlots.length > 0 ? teacher.input.unavailableSlots.length + 'コマ不可' : '入力済み'; }
      function getStudentSummary(student) { if (!student.input) return '未入力'; const parts = []; if (student.input.regularOnly) parts.push('通常のみ'); else { const requestedTotal = sumSubjectSlots(student.input.subjectSlots); if (requestedTotal > 0) parts.push('希望' + requestedTotal + 'コマ'); } if (student.input.unavailableSlots.length > 0) parts.push(student.input.unavailableSlots.length + 'コマ不可'); return parts.length > 0 ? parts.join(' / ') : '入力済み'; }
      function ensureSelection() { if (state.payload.teachers.length > 0 && !state.payload.teachers.some((teacher) => teacher.id === state.selectedTeacherId)) state.selectedTeacherId = state.payload.teachers[0].id; if (state.payload.students.length > 0 && !state.payload.students.some((student) => student.id === state.selectedStudentId)) state.selectedStudentId = state.payload.students[0].id; }
      function getCurrentPerson() { ensureSelection(); return state.tab === 'teacher' ? state.payload.teachers.find((teacher) => teacher.id === state.selectedTeacherId) || null : state.payload.students.find((student) => student.id === state.selectedStudentId) || null; }
      function getSelectedSlots() { const person = getCurrentPerson(); return person && person.input ? person.input.unavailableSlots.slice() : []; }
      function getStudentSubjectSlots() { const person = getCurrentPerson(); if (!person || state.tab !== 'student' || !person.input) return {}; return normalizeSubjectSlots(person.input.subjectSlots); }
      function isStudentRegularOnly() { const person = getCurrentPerson(); return Boolean(state.tab === 'student' && person && person.input && person.input.regularOnly); }
      function setStudentPreferences(nextSubjectSlots, nextRegularOnly) { const person = getCurrentPerson(); if (!person || state.tab !== 'student') return; person.input = { ...(person.input || { unavailableSlots: [], subjectSlots: {}, regularOnly: false, updatedAt: '' }), unavailableSlots: person.input?.unavailableSlots ? person.input.unavailableSlots.slice() : [], subjectSlots: nextRegularOnly ? {} : normalizeSubjectSlots(nextSubjectSlots), regularOnly: nextRegularOnly }; }
      function setSelectedSlots(nextSlots) { const person = getCurrentPerson(); if (!person) return; const unavailableSlots = sortSlotKeys(nextSlots); if (state.tab === 'teacher') person.input = { ...(person.input || { updatedAt: '' }), unavailableSlots }; else person.input = { ...(person.input || { subjectSlots: {}, regularOnly: false, updatedAt: '' }), unavailableSlots, subjectSlots: person.input?.regularOnly ? {} : normalizeSubjectSlots(person.input?.subjectSlots), regularOnly: Boolean(person.input?.regularOnly) }; }
      function toggleSlot(slotKey) { const selectedSlots = getSelectedSlots(); const hasSlot = selectedSlots.includes(slotKey); setSelectedSlots(hasSlot ? selectedSlots.filter((value) => value !== slotKey) : selectedSlots.concat(slotKey)); render(); }
      function toggleDate(dateKey) { const selectedSlots = getSelectedSlots(); const dateSlots = slotDefinitions.map((slot) => dateKey + '_' + slot.number); const allSelected = dateSlots.every((slotKey) => selectedSlots.includes(slotKey)); setSelectedSlots(allSelected ? selectedSlots.filter((slotKey) => !dateSlots.includes(slotKey)) : selectedSlots.concat(dateSlots)); render(); }
      function toggleColumn(slotNumber) { const dates = getDatesInRange(state.payload.session.startDate, state.payload.session.endDate); const selectedSlots = getSelectedSlots(); const columnSlots = dates.map((dateKey) => dateKey + '_' + slotNumber); const allSelected = columnSlots.every((slotKey) => selectedSlots.includes(slotKey)); setSelectedSlots(allSelected ? selectedSlots.filter((slotKey) => !columnSlots.includes(slotKey)) : selectedSlots.concat(columnSlots)); render(); }
      function saveCurrentPerson() { const person = getCurrentPerson(); if (!person || !window.opener || window.opener.closed) { state.status = '保存先の画面が見つかりません。'; render(); return; } const payload = { type: 'special-session-availability-save', sessionId: state.payload.session.id, personType: state.tab, personId: person.id, unavailableSlots: getSelectedSlots() }; if (state.tab === 'student') { payload.subjectSlots = getStudentSubjectSlots(); payload.regularOnly = isStudentRegularOnly(); } window.opener.postMessage(payload, '*'); state.status = state.tab === 'teacher' ? '講師の欠席不可コマを保存しました。' : '生徒の欠席不可コマと希望科目数を保存しました。'; render(); }
      function render() {
        ensureSelection();
        const dates = getDatesInRange(state.payload.session.startDate, state.payload.session.endDate);
        const monthGroups = buildMonthGroups(dates);
        const person = getCurrentPerson();
        const selectedSlots = new Set(getSelectedSlots());
        const studentRegularOnly = isStudentRegularOnly();
        const studentSubjectSlots = getStudentSubjectSlots();
        const people = state.tab === 'teacher' ? state.payload.teachers : state.payload.students;
        const listHtml = people.length === 0 ? '<div class="empty">この期間に在籍中の' + (state.tab === 'teacher' ? '講師' : '生徒') + 'はいません。</div>' : people.map((entry) => { const isActive = state.tab === 'teacher' ? entry.id === state.selectedTeacherId : entry.id === state.selectedStudentId; const summary = state.tab === 'teacher' ? getTeacherSummary(entry) : getStudentSummary(entry); return '<button type="button" class="person-row' + (isActive ? ' active' : '') + '" data-role="select-person" data-id="' + entry.id + '"><strong>' + entry.name + '</strong><span>' + summary + '</span></button>'; }).join('');
        const studentPreferenceHtml = state.tab === 'student' && person ? '<section class="student-preferences" data-testid="special-session-popup-preferences"><div class="student-preferences-head"><div><div class="student-preferences-title">講習希望数</div><div class="hint">通常のみを選ぶと希望数は 0 として扱います。</div></div><label class="regular-only-toggle"><input type="checkbox" data-role="toggle-regular-only" data-testid="special-session-popup-regular-only"' + (studentRegularOnly ? ' checked' : '') + '>通常のみ</label></div><div class="subject-count-grid">' + subjectDefinitions.map((subject) => '<label class="subject-count-field"><span>' + subject + '</span><input class="subject-count-input" type="number" min="0" step="1" value="' + String(studentSubjectSlots[subject] || 0) + '" data-role="subject-count-input" data-testid="special-session-popup-subject-' + subject + '" data-subject="' + subject + '"' + (studentRegularOnly ? ' disabled' : '') + '></label>').join('') + '</div></section>' : '';
        const scheduleHtml = person ? '<div class="schedule-wrapper"><table class="schedule"><thead><tr><th class="slot-label-col" rowspan="3">時限</th><th class="slot-time-col" rowspan="3">時間</th>' + monthGroups.map((group) => '<th class="month-cell" colspan="' + group.count + '">' + group.label + '</th>').join('') + '</tr><tr>' + dates.map((dateKey) => '<th class="date-cell"><button type="button" class="date-toggle' + (slotDefinitions.every((slot) => selectedSlots.has(dateKey + '_' + slot.number)) ? ' is-selected' : '') + '" data-role="toggle-date" data-date="' + dateKey + '">' + formatDateLabel(dateKey) + '</button></th>').join('') + '</tr><tr>' + dates.map((dateKey) => { const day = parseDate(dateKey).getDay(); const weekdayClass = day === 0 ? 'weekday-sun' : day === 6 ? 'weekday-sat' : ''; return '<th class="weekday-cell ' + weekdayClass + '">' + weekdayLabels[day] + '</th>'; }).join('') + '</tr></thead><tbody>' + slotDefinitions.map((slot) => '<tr><th class="slot-head slot-label-col"><button type="button" class="slot-toggle' + (dates.every((dateKey) => selectedSlots.has(dateKey + '_' + slot.number)) ? ' is-selected' : '') + '" data-role="toggle-column" data-slot="' + slot.number + '">' + slot.label + '</button></th><th class="slot-time slot-time-col">' + slot.timeLabel + '</th>' + dates.map((dateKey) => { const slotKey = dateKey + '_' + slot.number; const isUnavailable = selectedSlots.has(slotKey); return '<td><button type="button" class="cell-button' + (isUnavailable ? ' is-unavailable' : '') + '" data-role="toggle-slot" data-slot-key="' + slotKey + '">' + (isUnavailable ? '不可' : '') + '</button></td>'; }).join('') + '</tr>').join('') + '</tbody></table></div>' : '<div class="empty">編集する' + (state.tab === 'teacher' ? '講師' : '生徒') + 'を選択してください。</div>';
        root.innerHTML = '<div class="toolbar"><div><h1>' + state.payload.session.label + '</h1><p>' + state.payload.session.startDate + ' 〜 ' + state.payload.session.endDate + ' の入力</p></div><div class="toolbar-actions"><div class="toolbar-status" data-testid="special-session-popup-status">' + (state.status || '講習期間帯から開いた別タブで入力します。') + '</div><button type="button" class="button primary" data-role="save">保存</button></div></div><div class="layout"><aside class="panel sidebar"><div class="tabs"><button type="button" class="tab-button' + (state.tab === 'teacher' ? ' active' : '') + '" data-role="switch-tab" data-tab="teacher" data-testid="special-session-popup-tab-teacher">講師</button><button type="button" class="tab-button' + (state.tab === 'student' ? ' active' : '') + '" data-role="switch-tab" data-tab="student" data-testid="special-session-popup-tab-student">生徒</button></div><div class="hint">一覧から対象を選び、右側で欠席不可と生徒希望数を入力して保存します。</div><div class="person-list" data-testid="special-session-popup-person-list">' + listHtml + '</div></aside><section class="panel editor" data-testid="special-session-popup-screen"><div class="editor-head"><div><h2>' + (person ? person.name : '未選択') + '</h2><p>' + (state.tab === 'teacher' ? '講師の欠席不可コマ' : '生徒の欠席不可コマと希望科目数') + '</p></div><div class="hint">選択中: ' + (person ? (state.tab === 'teacher' ? getTeacherSummary(person) : getStudentSummary(person)) : 'なし') + '</div></div>' + studentPreferenceHtml + scheduleHtml + '</section></div>';
        root.querySelectorAll('[data-role="switch-tab"]').forEach((element) => element.addEventListener('click', () => { state.tab = element.getAttribute('data-tab'); render(); }));
        root.querySelectorAll('[data-role="select-person"]').forEach((element) => element.addEventListener('click', () => { const id = element.getAttribute('data-id') || ''; if (state.tab === 'teacher') state.selectedTeacherId = id; else state.selectedStudentId = id; render(); }));
        root.querySelectorAll('[data-role="toggle-date"]').forEach((element) => element.addEventListener('click', () => toggleDate(element.getAttribute('data-date') || '')));
        root.querySelectorAll('[data-role="toggle-column"]').forEach((element) => element.addEventListener('click', () => toggleColumn(Number(element.getAttribute('data-slot') || '0'))));
        root.querySelectorAll('[data-role="toggle-slot"]').forEach((element) => element.addEventListener('click', () => toggleSlot(element.getAttribute('data-slot-key') || '')));
        root.querySelector('[data-role="toggle-regular-only"]')?.addEventListener('change', (event) => { const checked = Boolean(event.target && event.target.checked); setStudentPreferences(getStudentSubjectSlots(), checked); render(); });
        root.querySelectorAll('[data-role="subject-count-input"]').forEach((element) => element.addEventListener('change', () => { const subject = element.getAttribute('data-subject') || ''; if (!subject) return; const nextSubjectSlots = { ...getStudentSubjectSlots(), [subject]: Number(element.value || '0') }; setStudentPreferences(nextSubjectSlots, false); render(); }));
        root.querySelector('[data-role="save"]')?.addEventListener('click', saveCurrentPerson);
      }
      window.addEventListener('message', (event) => { const message = event.data; if (!message || message.type !== 'special-session-availability-update') return; state.payload = message.payload; render(); });
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