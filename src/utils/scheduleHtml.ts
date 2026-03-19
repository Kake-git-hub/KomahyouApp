import { getStudentDisplayName, getTeacherDisplayName, type StudentRow, type TeacherRow } from '../components/basic-data/basicDataModel'
import type { SpecialSessionRow } from '../components/special-data/specialSessionModel'
import type { SlotCell } from '../components/schedule-board/types'
import type { ClassroomSettings } from '../types/appState'
import { generateQrSvg } from './qrcode'
import type { ScheduleQrConfig } from './scheduleQrConfig'

type SerializedStudent = {
  id: string
  name: string
  fullName: string
  birthDate: string
  entryDate: string
  withdrawDate: string
  isHidden: boolean
  qrSvg?: string
}

type SerializedTeacher = {
  id: string
  name: string
  fullName?: string
  entryDate: string
  withdrawDate: string
  isHidden: boolean
  memo: string
  subjects: string[]
  qrSvg?: string
}

type SerializedStudentEntry = {
  id: string
  linkedStudentId?: string
  name: string
  grade: string
  subject: string
  lessonType: string
  teacherType: string
  manualAdded: boolean
  makeupSourceLabel?: string
  warning?: string
}

type SerializedCell = {
  dateKey: string
  dateLabel: string
  dayLabel: string
  slotNumber: number
  slotLabel: string
  timeLabel: string
  isOpenDay: boolean
  desks: Array<{
    teacher: string
    lesson?: {
      note?: string
      students: SerializedStudentEntry[]
    }
  }>
}

type SerializedStudentSpecialSessionInput = {
  unavailableSlots: string[]
  subjectSlots: Record<string, number>
  regularOnly: boolean
  countSubmitted: boolean
}

type SerializedTeacherSpecialSessionInput = {
  unavailableSlots: string[]
  countSubmitted: boolean
}

type SerializedSpecialSession = {
  id: string
  label: string
  startDate: string
  endDate: string
  teacherInputs: Record<string, SerializedTeacherSpecialSessionInput>
  studentInputs: Record<string, SerializedStudentSpecialSessionInput>
}

type SchedulePayload = {
  titleLabel: string
  defaultStartDate: string
  defaultEndDate: string
  defaultPeriodValue: string
  availableStartDate: string
  availableEndDate: string
  availability: Pick<ClassroomSettings, 'closedWeekdays' | 'holidayDates' | 'forceOpenDates'>
  periodBands: Array<{ id?: string; label: string; startDate: string; endDate: string }>
  students: SerializedStudent[]
  teachers: SerializedTeacher[]
  cells: SerializedCell[]
  specialSessions: SerializedSpecialSession[]
  qrSchoolNamePattern: string
}

type OpenScheduleHtmlParams = {
  cells: SlotCell[]
  defaultStartDate: string
  defaultEndDate: string
  defaultPeriodValue?: string
  titleLabel: string
  classroomSettings: Pick<ClassroomSettings, 'closedWeekdays' | 'holidayDates' | 'forceOpenDates'>
  periodBands?: Pick<SpecialSessionRow, 'id' | 'label' | 'startDate' | 'endDate'>[]
  specialSessions?: SpecialSessionRow[]
  targetWindow?: Window | null
  qrConfig?: ScheduleQrConfig
}

function buildScheduleQrSvg(qrConfig: ScheduleQrConfig | undefined, personType: 'student' | 'teacher', personId: string) {
  if (!qrConfig?.baseUrl || !qrConfig.classroomId || !qrConfig.sessionId || !personId) return undefined

  const inputUrl = `${qrConfig.baseUrl}/#/c/${encodeURIComponent(qrConfig.classroomId)}/availability/${encodeURIComponent(qrConfig.sessionId)}/${personType}/${encodeURIComponent(personId)}`
  return generateQrSvg(inputUrl, 52)
}

type OpenStudentScheduleHtmlParams = OpenScheduleHtmlParams & {
  students: StudentRow[]
}

type OpenTeacherScheduleHtmlParams = OpenScheduleHtmlParams & {
  teachers: TeacherRow[]
}

function serializeCells(cells: SlotCell[], resolveLinkedStudentId?: (studentName: string) => string | undefined): SerializedCell[] {
  return cells
    .slice()
    .sort((left, right) => {
      if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey)
      return left.slotNumber - right.slotNumber
    })
    .map((cell) => ({
      dateKey: cell.dateKey,
      dateLabel: cell.dateLabel,
      dayLabel: cell.dayLabel,
      slotNumber: cell.slotNumber,
      slotLabel: cell.slotLabel,
      timeLabel: cell.timeLabel,
      isOpenDay: cell.isOpenDay,
      desks: cell.desks.map((desk) => ({
        teacher: desk.teacher,
        lesson: desk.lesson
          ? {
              note: desk.lesson.note,
              students: desk.lesson.studentSlots
                .filter((student): student is NonNullable<typeof student> => Boolean(student))
                .map((student) => ({
                  id: student.id,
                  linkedStudentId: resolveLinkedStudentId?.(student.name),
                  name: student.name,
                  grade: student.grade,
                  subject: student.subject,
                  lessonType: student.lessonType,
                  teacherType: student.teacherType,
                  manualAdded: Boolean(student.manualAdded),
                  makeupSourceLabel: student.makeupSourceLabel,
                  warning: student.warning,
                })),
            }
          : undefined,
      })),
    }))
}

function createPopupWindow(targetName: string, targetWindow?: Window | null) {
  const openedWindow = window.open('', targetName)
  if (openedWindow) return openedWindow
  if (targetWindow && !targetWindow.closed) {
    targetWindow.focus()
    return targetWindow
  }
  return null
}

function createBasePayload(params: OpenScheduleHtmlParams, linkedStudents: StudentRow[] = []): Omit<SchedulePayload, 'students' | 'teachers'> {
  const linkedStudentIdByName = new Map(linkedStudents.flatMap((student) => {
    const displayName = getStudentDisplayName(student)
    return [[student.name, student.id], [displayName, student.id]] as Array<[string, string]>
  }))
  const serializedCells = serializeCells(params.cells, (studentName) => linkedStudentIdByName.get(studentName))
  const availableStartDate = serializedCells[0]?.dateKey ?? params.defaultStartDate
  const availableEndDate = serializedCells[serializedCells.length - 1]?.dateKey ?? params.defaultEndDate

  return {
    titleLabel: params.titleLabel,
    defaultStartDate: params.defaultStartDate,
    defaultEndDate: params.defaultEndDate,
    defaultPeriodValue: params.defaultPeriodValue || '',
    availableStartDate,
    availableEndDate,
    availability: {
      closedWeekdays: [...params.classroomSettings.closedWeekdays],
      holidayDates: [...params.classroomSettings.holidayDates],
      forceOpenDates: [...params.classroomSettings.forceOpenDates],
    },
    periodBands: (params.periodBands ?? []).map((period) => ({
      id: 'id' in period ? period.id : undefined,
      label: period.label,
      startDate: period.startDate,
      endDate: period.endDate,
    })),
    cells: serializedCells,
    specialSessions: (params.specialSessions ?? []).map((session) => ({
      id: session.id,
      label: session.label,
      startDate: session.startDate,
      endDate: session.endDate,
      teacherInputs: Object.fromEntries(Object.entries(session.teacherInputs).map(([personId, input]) => [personId, {
        unavailableSlots: Array.isArray(input.unavailableSlots) ? [...input.unavailableSlots] : [],
        countSubmitted: Boolean(input.countSubmitted),
      }])),
      studentInputs: Object.fromEntries(Object.entries(session.studentInputs).map(([personId, input]) => [personId, {
        unavailableSlots: Array.isArray(input.unavailableSlots) ? [...input.unavailableSlots] : [],
        subjectSlots: input.subjectSlots && typeof input.subjectSlots === 'object' ? { ...input.subjectSlots } : {},
        regularOnly: Boolean(input.regularOnly),
        countSubmitted: Boolean(input.countSubmitted),
      }])),
    })),
    qrSchoolNamePattern: params.qrConfig?.schoolNamePattern ?? '',
  }
}

function buildStudentPayload(params: OpenStudentScheduleHtmlParams): SchedulePayload {
  const basePayload = createBasePayload(params, params.students)

  return {
    ...basePayload,
    students: params.students.map((student) => ({
      id: student.id,
      name: getStudentDisplayName(student),
      fullName: student.name,
      birthDate: student.birthDate,
      entryDate: student.entryDate,
      withdrawDate: student.withdrawDate,
      isHidden: student.isHidden,
      qrSvg: buildScheduleQrSvg(params.qrConfig, 'student', student.id),
    })),
    teachers: [],
  }
}

function buildTeacherPayload(params: OpenTeacherScheduleHtmlParams): SchedulePayload {
  const basePayload = createBasePayload(params)

  return {
    ...basePayload,
    students: [],
    teachers: params.teachers.map((teacher) => ({
      id: teacher.id,
      name: getTeacherDisplayName(teacher),
      fullName: teacher.name,
      entryDate: teacher.entryDate,
      withdrawDate: teacher.withdrawDate,
      isHidden: teacher.isHidden,
      memo: teacher.memo,
      subjects: teacher.subjectCapabilities.map((capability) => `${capability.subject}${capability.maxGrade}`),
      qrSvg: buildScheduleQrSvg(params.qrConfig, 'teacher', teacher.id),
    })),
  }
}

function createScheduleHtml(payload: SchedulePayload, viewType: 'student' | 'teacher') {
  const serializedPayload = JSON.stringify(payload).replace(/</g, '\\u003c')
  const viewLabel = viewType === 'student' ? '生徒日程表' : '講師日程表'

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${viewLabel}</title>
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
        --header-bg: #f8f8f8;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        background: #f2f2f2;
        color: var(--ink);
        font-family: 'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif;
        scrollbar-width: none;
      }

      html {
        scrollbar-width: none;
      }

      html::-webkit-scrollbar,
      body::-webkit-scrollbar,
      .pages::-webkit-scrollbar {
        width: 0;
        height: 0;
        display: none;
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

      .toolbar-field { display: grid; gap: 4px; }

      .toolbar-field label,
      .toolbar-summary,
      .toolbar-title {
        font-size: 12px;
        color: var(--muted);
      }

      .toolbar-title {
        min-width: 220px;
        font-weight: 700;
        color: var(--ink);
      }

      .toolbar input {
        min-width: 152px;
        padding: 8px 10px;
        border: 1px solid #666666;
        border-radius: 0;
        font: inherit;
      }

      .toolbar select {
        min-width: 220px;
        padding: 8px 10px;
        border: 1px solid #666666;
        border-radius: 0;
        font: inherit;
        background: #ffffff;
      }

      .toolbar button {
        height: 38px;
        padding: 0 16px;
        border: 1px solid #333333;
        border-radius: 0;
        background: #ffffff;
        color: #fff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        color: #111111;
      }

      .toolbar button.secondary {
        background: #f3f3f3;
        color: var(--ink);
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
        break-inside: avoid;
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
        position: relative;
        overflow: hidden;
        padding: 2px 4px;
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
        min-width: 200px;
      }

      .school-input {
        width: 100%;
        min-height: 34px;
        border: 0;
        outline: 0;
        font: inherit;
        font-size: 13px;
        color: #444444;
        background: transparent;
        resize: none;
        line-height: 1.2;
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
        font: inherit;
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

      .person-meta-row {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }

      .meta-label {
        font-weight: 700;
      }

      .page-count {
        color: var(--muted);
        font-weight: 400;
      }

      .print-only-hidden {
        display: inline;
      }

      .qr-code {
        flex: 0 0 auto;
        line-height: 0;
      }

      .qr-code.is-hidden {
        display: none;
      }

      .qr-code svg {
        display: block;
      }

      table.schedule-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .schedule-table th,
      .schedule-table td {
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

      .period-row th {
        background: #ffffff;
        padding: 3px 2px;
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

      .period-pill-button {
        width: 100%;
        border: 0;
        margin: 0;
        padding: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }

      .period-pill-button.is-registered .period-pill {
        background: #d8f0d8;
        border-color: #5b8f5b;
        color: #214a21;
      }

      .period-pill-state {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
      }

      .count-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 40;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(17, 17, 17, 0.28);
      }

      .count-modal {
        width: min(420px, 100%);
        border: 1.5px solid var(--line);
        background: #ffffff;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.14);
      }

      .count-modal-head,
      .count-modal-body,
      .count-modal-actions {
        padding: 14px 16px;
      }

      .count-modal-head {
        border-bottom: 1px solid #d7d7d7;
        display: grid;
        gap: 4px;
      }

      .count-modal-title {
        font-size: 16px;
        font-weight: 700;
      }

      .count-modal-subtitle,
      .count-modal-note {
        font-size: 12px;
        color: var(--muted);
      }

      .count-modal-body {
        display: grid;
        gap: 12px;
      }

      .count-modal-table {
        width: 100%;
        border-collapse: collapse;
      }

      .count-modal-table td {
        border: 1px solid #d7d7d7;
        padding: 8px 10px;
        font-size: 13px;
      }

      .count-modal-table input[type="number"] {
        width: 84px;
        padding: 6px 8px;
        border: 1px solid #888888;
        font: inherit;
      }

      .count-modal-check {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .count-modal-actions {
        border-top: 1px solid #d7d7d7;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .period-pill-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .period-pill-edge {
        flex: 0 0 auto;
        font-size: 11px;
        line-height: 1;
      }

      .date-row th {
        font-size: 12px;
        font-weight: 700;
      }

      .date-label,
      .weekday-label {
        display: block;
      }

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

      .time-box {
        display: grid;
        align-items: center;
        justify-items: center;
        gap: 3px;
        padding: 4px 2px;
        min-height: 62px;
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

      .header-toggle {
        width: 100%;
        border: 0;
        margin: 0;
        padding: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }

      .header-toggle:focus-visible,
      .slot-button:focus-visible {
        outline: 2px solid #2f6fed;
        outline-offset: -2px;
      }

      .header-toggle.is-unavailable {
        background: rgba(17, 17, 17, 0.08);
      }

      .slot-cell {
        height: 62px;
        vertical-align: top;
        background: #fff;
      }

      .slot-cell.is-unavailable {
        background: #d1d6dc;
      }

      .slot-cell.is-editable {
        cursor: pointer;
      }

      .slot-cell-content {
        height: 100%;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .slot-button,
      .slot-static {
        width: 100%;
        height: 100%;
        min-height: 100%;
        border: 0;
        padding: 3px;
        margin: 0;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .slot-button {
        cursor: pointer;
      }

      .slot-button:disabled {
        cursor: default;
      }

      .slot-button.is-unavailable {
        background: rgba(17, 17, 17, 0.06);
      }

      .lesson-card {
        width: 100%;
        height: 100%;
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 2px;
        padding: 2px 4px;
        border: 0;
        background: transparent;
      }

      .lesson-card-teacher {
        align-items: stretch;
        justify-items: stretch;
        gap: 0;
        padding: 1px 1px;
      }

      .lesson-card-teacher.is-single {
        grid-template-columns: 1fr;
      }

      .lesson-card-teacher.is-pair {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .teacher-lesson-person {
        min-width: 0;
        min-height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 3px 1px;
        writing-mode: vertical-rl;
        text-orientation: upright;
      }

      .teacher-lesson-line {
        display: block;
        line-height: 1.12;
        text-align: center;
        white-space: nowrap;
      }

      .teacher-lesson-name {
        font-size: 12px;
        font-weight: 700;
      }

      .teacher-lesson-meta {
        font-size: 9px;
      }

      .lesson-main {
        font-size: 13px;
        font-weight: 700;
        line-height: 1.1;
        text-align: center;
      }

      .lesson-sub {
        font-size: 11px;
        line-height: 1.1;
        text-align: center;
      }

      .lesson-footnote {
        font-size: 9px;
        color: var(--muted);
        text-align: center;
      }

      .schedule-table.is-compact .lesson-main {
        font-size: 11px;
      }

      .schedule-table.is-compact .lesson-sub {
        font-size: 9px;
      }

      .schedule-table.is-dense .lesson-main {
        font-size: 10px;
      }

      .schedule-table.is-dense .lesson-sub {
        font-size: 8px;
      }

      .schedule-table.is-dense .lesson-card {
        gap: 1px;
        padding: 1px 2px;
      }

      .schedule-table.is-compact .teacher-lesson-name {
        font-size: 11px;
      }

      .schedule-table.is-compact .teacher-lesson-meta {
        font-size: 9px;
      }

      .schedule-table.is-dense .teacher-lesson-name {
        font-size: 10px;
      }

      .schedule-table.is-dense .teacher-lesson-meta {
        font-size: 8px;
      }

      .empty-label {
        width: 100%;
        height: 100%;
      }

      .closed-label {
        display: grid;
        place-items: center;
        height: 100%;
        font-size: 12px;
        color: var(--muted);
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

      .panel-title {
        font-size: 12px;
        margin-bottom: 2px;
      }

      .box-textarea {
        width: 100%;
        min-height: 124px;
        border: 0;
        padding: 6px 8px;
        resize: none;
        font: inherit;
      }

      .check-line {
        display: flex;
        gap: 6px;
        align-items: center;
        padding: 6px 8px 2px;
        font-size: 12px;
      }

      .count-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .count-table,
      .makeup-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .count-table th,
      .count-table td,
      .makeup-table th,
      .makeup-table td {
        border: 1.5px solid var(--line);
        padding: 3px 4px;
        text-align: center;
        height: 22px;
      }

      .count-stack {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
        align-content: start;
      }

      .count-stack-block {
        display: grid;
        align-content: start;
        gap: 6px;
      }

      .count-warning-stamp {
        border: 3px solid #c3342f;
        color: #c3342f;
        font-size: 21px;
        font-weight: 800;
        line-height: 1.15;
        text-align: center;
        padding: 10px 8px;
        background: rgba(255, 244, 244, 0.94);
        transform: rotate(-4deg);
        letter-spacing: 0.08em;
      }

      .makeup-table td {
        font-size: 9px;
        line-height: 1.05;
        padding: 2px 3px;
        height: 17px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: left;
      }

      .box-table-title {
        border: 1.5px solid var(--line);
        border-bottom: 0;
        text-align: center;
        font-size: 12px;
        font-weight: 700;
        padding: 4px 6px;
      }

      .empty-state {
        padding: 44px 18px;
        text-align: center;
        color: var(--muted);
        border: 1.5px dashed var(--soft-line);
        background: rgba(255, 255, 255, 0.86);
      }

      @media print {
        body { background: #fff; }
        .toolbar { display: none; }
        .pages { padding: 0; gap: 0; }
        .print-only-hidden { display: none; }
        .sheet {
          box-shadow: none;
          border: 0;
          padding: 0;
          width: 277mm;
          min-height: 190mm;
          page-break-after: always;
        }
      }

      @page {
        size: A4 landscape;
        margin: 8mm;
      }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <div class="toolbar-title">${viewLabel}</div>
      <div class="toolbar-field">
        <label for="schedule-start-date">開始日</label>
        <input id="schedule-start-date" type="date" />
      </div>
      <div class="toolbar-field">
        <label for="schedule-end-date">終了日</label>
        <input id="schedule-end-date" type="date" />
      </div>
      <div class="toolbar-field">
        <label for="schedule-period-select">登録された講習期間を表示する</label>
        <select id="schedule-period-select">
          <option value="">選択してください</option>
        </select>
      </div>
      <button id="schedule-refresh-button" type="button" class="secondary">最新状態に更新</button>
      <div class="toolbar-summary" id="schedule-summary-label"></div>
    </div>
    <main class="pages" id="schedule-pages"></main>
    <input id="schedule-logo-input" type="file" accept="image/*" style="display:none" />
    <script id="schedule-data" type="application/json">${serializedPayload}</script>
    <script>
      const VIEW_TYPE = '${viewType}';
      const VIEW_LABEL = '${viewLabel}';
      let DATA = JSON.parse(document.getElementById('schedule-data').textContent || '{}');
      const startInput = document.getElementById('schedule-start-date');
      const endInput = document.getElementById('schedule-end-date');
      const periodSelect = document.getElementById('schedule-period-select');
      const refreshButton = document.getElementById('schedule-refresh-button');
      const summaryLabel = document.getElementById('schedule-summary-label');
      const pagesElement = document.getElementById('schedule-pages');
      const sharedStoragePrefix = 'schedule-shared:' + VIEW_TYPE + ':';
      const rangeStoragePrefix = sharedStoragePrefix + 'range:';
      const lessonTypeLabels = { regular: '通常', makeup: '振替', special: '特別' };
      const teacherTypeLabels = { normal: '', substitute: '代行', outside: '外部' };
      const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
      const subjectDefinitions = ['英', '数', '算', '国', '理', '社', 'IT'];
      let activeCountDialog = null;
      let activeTeacherRegisterDialog = null;
      let payloadFingerprint = JSON.stringify(DATA);
      let skipNextEquivalentPayload = false;
      let suppressNextToggleClick = false;

      function escapeHtml(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
      }

      function formatMonthDay(dateKey) {
        const parts = dateKey.split('-');
        return Number(parts[1]) + '月' + Number(parts[2]) + '日';
      }

      function formatRangeLabel(startDate, endDate) {
        if (!startDate || !endDate) return '';
        return formatMonthDay(startDate) + ' ～ ' + formatMonthDay(endDate);
      }

      function normalizeSchoolInfo(value) {
        return String(value || '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
      }

      function setDateInputValue(input, value) {
        input.value = value || '';
        if (value && !input.value) {
          const parsed = new Date(value + 'T00:00:00');
          if (!Number.isNaN(parsed.getTime())) {
            input.valueAsDate = parsed;
          }
        }
      }

      function getSharedStorage() {
        try {
          if (window.opener && window.opener !== window && window.opener.localStorage) {
            return window.opener.localStorage;
          }
        } catch {}
        try {
          return window.localStorage;
        } catch {
          return null;
        }
      }

      function resolveSharedInputValue(sharedKey) {
        const activeElement = document.querySelector('.shared-input[data-shared-input="' + sharedKey + '"]');
        if (activeElement && 'value' in activeElement && typeof activeElement.value === 'string' && activeElement.value) {
          return activeElement.value;
        }

        const storage = getSharedStorage();
        try {
          return storage ? storage.getItem(sharedStoragePrefix + sharedKey) || '' : '';
        } catch {
          return '';
        }
      }

      function shouldShowScheduleQr() {
        const schoolPattern = normalizeSchoolInfo(DATA.qrSchoolNamePattern || '');
        if (!schoolPattern) return false;
        return normalizeSchoolInfo(resolveSharedInputValue('school-info')).includes(schoolPattern);
      }

      function syncScheduleQrVisibility() {
        const shouldShow = shouldShowScheduleQr();
        document.querySelectorAll('.qr-code').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          element.classList.toggle('is-hidden', !shouldShow);
        });
      }

      function isVisibleInRange(item, startDate, endDate) {
        return !item.isHidden && item.entryDate <= endDate && (!item.withdrawDate || item.withdrawDate === '未定' || item.withdrawDate >= startDate);
      }

      function getGradeLabel(birthDate, referenceDate) {
        if (!birthDate) return '';
        const birthParts = birthDate.split('-').map(Number);
        const ref = new Date(referenceDate + 'T00:00:00');
        const schoolYear = ref >= new Date(ref.getFullYear(), 3, 1) ? ref.getFullYear() : ref.getFullYear() - 1;
        const enrollmentYear = birthParts[1] < 4 || (birthParts[1] === 4 && birthParts[2] === 1) ? birthParts[0] + 6 : birthParts[0] + 7;
        const gradeNumber = schoolYear - enrollmentYear + 1;
        if (gradeNumber <= 1) return '小1';
        if (gradeNumber === 2) return '小2';
        if (gradeNumber === 3) return '小3';
        if (gradeNumber === 4) return '小4';
        if (gradeNumber === 5) return '小5';
        if (gradeNumber === 6) return '小6';
        if (gradeNumber === 7) return '中1';
        if (gradeNumber === 8) return '中2';
        if (gradeNumber === 9) return '中3';
        if (gradeNumber === 10) return '高1';
        if (gradeNumber === 11) return '高2';
        return '高3';
      }
      function filterCells(startDate, endDate) {
        return DATA.cells.filter((cell) => cell.dateKey >= startDate && cell.dateKey <= endDate);
      }

      function sortSlotKeys(slotKeys) {
        return Array.from(new Set((slotKeys || []).filter((slotKey) => typeof slotKey === 'string' && slotKey))).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }));
      }

      function normalizeSubjectSlots(subjectSlots) {
        const next = {};
        subjectDefinitions.forEach((subject) => {
          const rawValue = Number(subjectSlots && typeof subjectSlots === 'object' ? subjectSlots[subject] : 0);
          const normalizedValue = Number.isFinite(rawValue) ? Math.max(0, Math.trunc(rawValue)) : 0;
          if (normalizedValue > 0) next[subject] = normalizedValue;
        });
        return next;
      }

      function defaultStudentSessionInput() {
        return { unavailableSlots: [], subjectSlots: {}, regularOnly: false, countSubmitted: false };
      }

      function defaultTeacherSessionInput() {
        return { unavailableSlots: [], countSubmitted: false };
      }

      function getSpecialSessionById(sessionId) {
        return (DATA.specialSessions || []).find((session) => session.id === sessionId) || null;
      }

      function getStudentSessionInput(studentId, sessionId) {
        const session = getSpecialSessionById(sessionId);
        const current = session && session.studentInputs ? session.studentInputs[studentId] : null;
        return {
          ...defaultStudentSessionInput(),
          ...(current || {}),
          unavailableSlots: sortSlotKeys(current && Array.isArray(current.unavailableSlots) ? current.unavailableSlots : []),
          subjectSlots: normalizeSubjectSlots(current && current.subjectSlots ? current.subjectSlots : {}),
          regularOnly: Boolean(current && current.regularOnly),
          countSubmitted: Boolean(current && current.countSubmitted),
        };
      }

      function getTeacherSessionInput(teacherId, sessionId) {
        const session = getSpecialSessionById(sessionId);
        const current = session && session.teacherInputs ? session.teacherInputs[teacherId] : null;
        return {
          ...defaultTeacherSessionInput(),
          ...(current || {}),
          unavailableSlots: sortSlotKeys(current && Array.isArray(current.unavailableSlots) ? current.unavailableSlots : []),
          countSubmitted: Boolean(current && current.countSubmitted),
        };
      }

      function isStudentSessionUnavailableFixed(studentId, sessionId) {
        return Boolean(studentId && sessionId && getStudentSessionInput(studentId, sessionId).countSubmitted);
      }

      function isTeacherSessionUnavailableFixed(teacherId, sessionId) {
        return Boolean(teacherId && sessionId && getTeacherSessionInput(teacherId, sessionId).countSubmitted);
      }

      function getEditableSpecialSessionsForStudent(studentId, dateKey) {
        return getSpecialSessionsForDate(dateKey).filter((session) => !isStudentSessionUnavailableFixed(studentId, session.id));
      }

      function getEditableSpecialSessionsForTeacher(teacherId, dateKey) {
        return getSpecialSessionsForDate(dateKey).filter((session) => !isTeacherSessionUnavailableFixed(teacherId, session.id));
      }

      function syncPayloadFingerprint() {
        payloadFingerprint = JSON.stringify(DATA);
        skipNextEquivalentPayload = true;
      }

      function toDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
      }

      function isOpenDayByRules(dateKey, fallbackOpenState) {
        if (typeof fallbackOpenState === 'boolean') return fallbackOpenState;
        if (DATA.availability.forceOpenDates.includes(dateKey)) return true;
        if (DATA.availability.holidayDates.includes(dateKey)) return false;
        return !DATA.availability.closedWeekdays.includes(new Date(dateKey + 'T00:00:00').getDay());
      }

      function buildDateHeaders(startDate, endDate) {
        const byDate = new Map(DATA.cells.map((cell) => [cell.dateKey, cell]));
        const headers = [];
        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T00:00:00');
        for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
          const dateKey = toDateKey(cursor);
          const known = byDate.get(dateKey);
          headers.push({
            dateKey,
            dateLabel: Number(dateKey.split('-')[1]) + '/' + Number(dateKey.split('-')[2]),
            isOpenDay: isOpenDayByRules(dateKey, known ? known.isOpenDay : undefined),
            weekday: cursor.getDay(),
          });
        }
        return headers;
      }

      function buildMonthGroups(dateHeaders) {
        const groups = [];
        dateHeaders.forEach((header) => {
          const month = Number(header.dateKey.split('-')[1]);
          const last = groups[groups.length - 1];
          if (last && last.month === month) {
            last.count += 1;
          } else {
            groups.push({ month, count: 1 });
          }
        });
        return groups;
      }

      function getVisibleYears(dateHeaders) {
        return Array.from(new Set(dateHeaders.map((header) => Number(header.dateKey.split('-')[0]))));
      }

      function getSlotNumbers() {
        return Array.from(new Set(DATA.cells.map((cell) => cell.slotNumber))).sort((left, right) => left - right);
      }

      function splitTimeLabel(timeLabel) {
        const normalized = String(timeLabel || '').replace(/\s+/g, '');
        const matched = normalized.match(/^(.+?)[-~〜](.+)$/);
        if (!matched) return { start: normalized, end: '' };
        return { start: matched[1], end: matched[2] };
      }

      function renderTimeHeaderCell(timeLabel, slotNumber, actionHtml) {
        const range = splitTimeLabel(timeLabel);
        const rangeHtml = range.end
          ? '<div class="time-range"><span class="time-part">' + escapeHtml(range.start) + '</span><span class="time-separator">〜</span><span class="time-part">' + escapeHtml(range.end) + '</span></div>'
          : '<div class="time-range"><span class="time-part">' + escapeHtml(range.start) + '</span></div>';
        const contentHtml = '<div class="time-box">' + rangeHtml + '<div class="time-slot">' + slotNumber + '限</div></div>';
        return '<th class="time-col">' + (actionHtml ? actionHtml.replace('__CONTENT__', contentHtml) : contentHtml) + '</th>';
      }

      function buildPeriodSegments(dateHeaders) {
        const segments = [];
        let cursor = 0;
        while (cursor < dateHeaders.length) {
          const header = dateHeaders[cursor];
          const matched = DATA.periodBands.find((band) => header.dateKey >= band.startDate && header.dateKey <= band.endDate);
          if (!matched) {
            const gapStart = cursor;
            while (cursor < dateHeaders.length && !DATA.periodBands.find((band) => dateHeaders[cursor].dateKey >= band.startDate && dateHeaders[cursor].dateKey <= band.endDate)) {
              cursor += 1;
            }
            segments.push({ type: 'gap', key: 'gap-' + gapStart, colSpan: cursor - gapStart });
            continue;
          }
          const segmentStart = cursor;
          while (cursor < dateHeaders.length && dateHeaders[cursor].dateKey >= matched.startDate && dateHeaders[cursor].dateKey <= matched.endDate) {
            cursor += 1;
          }
          segments.push({ type: 'band', key: matched.label + '-' + segmentStart, colSpan: cursor - segmentStart, label: matched.label, startDate: matched.startDate, endDate: matched.endDate, sessionId: matched.id || '' });
        }
        return segments;
      }

      function getTableDensityClass(dateHeaders) {
        if (dateHeaders.length >= 28) return 'is-dense';
        if (dateHeaders.length >= 18) return 'is-compact';
        return '';
      }

      function buildCellMap(cells) {
        const map = new Map();
        cells.forEach((cell) => {
          map.set(cell.dateKey + '_' + cell.slotNumber, cell);
        });
        return map;
      }

      function buildStudentAssignments(cells) {
        const map = new Map();
        cells.forEach((cell) => {
          cell.desks.forEach((desk) => {
            if (!desk.lesson) return;
            desk.lesson.students.forEach((student) => {
              const studentKey = student.linkedStudentId || student.name;
              if (!map.has(studentKey)) map.set(studentKey, []);
              map.get(studentKey).push({ dateKey: cell.dateKey, slotNumber: cell.slotNumber, teacher: desk.teacher, timeLabel: cell.timeLabel, lesson: student });
            });
          });
        });
        return map;
      }

      function buildTeacherAssignments(cells) {
        const map = new Map();
        cells.forEach((cell) => {
          cell.desks.forEach((desk) => {
            if (!desk.teacher || !desk.lesson) return;
            if (!map.has(desk.teacher)) map.set(desk.teacher, []);
            map.get(desk.teacher).push({ dateKey: cell.dateKey, slotNumber: cell.slotNumber, timeLabel: cell.timeLabel, students: desk.lesson.students, note: desk.lesson.note || '' });
          });
        });
        return map;
      }

      function toCountRows(countMap, desiredCountMap) {
        const mergedLabels = Array.from(new Set([
          ...Object.keys(countMap || {}),
          ...Object.keys(desiredCountMap || {}),
        ])).sort((left, right) => left.localeCompare(right, 'ja'));
        if (!mergedLabels.length) return '<tr><td>予定なし</td><td>0</td></tr>';
        return mergedLabels.map((label) => {
          const count = Number(countMap && countMap[label] ? countMap[label] : 0);
          const desiredCount = Number(desiredCountMap && desiredCountMap[label] ? desiredCountMap[label] : count);
          return '<tr><td>' + escapeHtml(label) + '</td><td>' + count + '(' + desiredCount + ')</td></tr>';
        }).join('');
      }

      function hasCountMismatch(countMap, desiredCountMap) {
        const mergedLabels = Array.from(new Set([
          ...Object.keys(countMap || {}),
          ...Object.keys(desiredCountMap || {}),
        ]));
        return mergedLabels.some((label) => {
          const count = Number(countMap && countMap[label] ? countMap[label] : 0);
          const desiredCount = Number(desiredCountMap && desiredCountMap[label] ? desiredCountMap[label] : count);
          return count !== desiredCount;
        });
      }

      function renderStudentCellCard(entry) {
        return '<div class="lesson-card"><div class="lesson-main">' + escapeHtml(entry.subject) + '</div><div class="lesson-sub">' + escapeHtml(lessonTypeLabels[entry.lessonType] || entry.lessonType) + '</div></div>';
      }

      function getSpecialSessionsForDate(dateKey) {
        return (DATA.specialSessions || []).filter((session) => dateKey >= session.startDate && dateKey <= session.endDate);
      }

      function getUnavailableSlotsForStudent(studentId) {
        const unavailableSlots = new Set();
        (DATA.specialSessions || []).forEach((session) => {
          const input = session.studentInputs && typeof session.studentInputs === 'object' ? session.studentInputs[studentId] : null;
          if (!input || !Array.isArray(input.unavailableSlots)) return;
          input.unavailableSlots.forEach((slotKey) => {
            if (typeof slotKey === 'string' && slotKey) unavailableSlots.add(slotKey);
          });
        });
        return unavailableSlots;
      }

      function getUnavailableSlotsForTeacher(teacherId) {
        const unavailableSlots = new Set();
        (DATA.specialSessions || []).forEach((session) => {
          const input = session.teacherInputs && typeof session.teacherInputs === 'object' ? session.teacherInputs[teacherId] : null;
          if (!input || !Array.isArray(input.unavailableSlots)) return;
          input.unavailableSlots.forEach((slotKey) => {
            if (typeof slotKey === 'string' && slotKey) unavailableSlots.add(slotKey);
          });
        });
        return unavailableSlots;
      }

      function buildDesiredLectureCountMap(studentId, startDate, endDate) {
        const countMap = {};
        (DATA.specialSessions || []).forEach((session) => {
          if (!session || session.endDate < startDate || session.startDate > endDate) return;
          const input = getStudentSessionInput(studentId, session.id);
          if (!input.countSubmitted) return;
          if (input.regularOnly) return;
          Object.entries(input.subjectSlots || {}).forEach(([subject, value]) => {
            const normalizedValue = Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
            if (normalizedValue <= 0) return;
            countMap[subject] = (countMap[subject] || 0) + normalizedValue;
          });
        });
        return countMap;
      }

      function areStudentSlotsUnavailable(studentId, slotKeys) {
        if (!studentId || !Array.isArray(slotKeys) || !slotKeys.length) return false;
        const unavailableSlots = getUnavailableSlotsForStudent(studentId);
        return slotKeys.every((slotKey) => unavailableSlots.has(slotKey));
      }

      function areTeacherSlotsUnavailable(teacherId, slotKeys) {
        if (!teacherId || !Array.isArray(slotKeys) || !slotKeys.length) return false;
        const unavailableSlots = getUnavailableSlotsForTeacher(teacherId);
        return slotKeys.every((slotKey) => unavailableSlots.has(slotKey));
      }

      function getEditableStudentSlotKeys(studentId, dateHeaders, slotNumbers, cellMap, filters) {
        const slotKeys = [];
        dateHeaders.forEach((dateHeader) => {
          if (filters && filters.dateKey && filters.dateKey !== dateHeader.dateKey) return;
          if (!getEditableSpecialSessionsForStudent(studentId, dateHeader.dateKey).length) return;
          slotNumbers.forEach((slotNumber) => {
            if (filters && filters.slotNumber && Number(filters.slotNumber) !== slotNumber) return;
            const slotKey = dateHeader.dateKey + '_' + slotNumber;
            const cell = cellMap.get(slotKey);
            if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) return;
            slotKeys.push(slotKey);
          });
        });
        return sortSlotKeys(slotKeys);
      }

      function getEditableTeacherSlotKeys(teacherId, dateHeaders, slotNumbers, cellMap, filters) {
        const slotKeys = [];
        dateHeaders.forEach((dateHeader) => {
          if (filters && filters.dateKey && filters.dateKey !== dateHeader.dateKey) return;
          if (!getEditableSpecialSessionsForTeacher(teacherId, dateHeader.dateKey).length) return;
          slotNumbers.forEach((slotNumber) => {
            if (filters && filters.slotNumber && Number(filters.slotNumber) !== slotNumber) return;
            const slotKey = dateHeader.dateKey + '_' + slotNumber;
            const cell = cellMap.get(slotKey);
            if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) return;
            slotKeys.push(slotKey);
          });
        });
        return sortSlotKeys(slotKeys);
      }

      function updateUnavailableSlotsLocally(sessionId, personId, unavailableSlots) {
        DATA.specialSessions = (DATA.specialSessions || []).map((session) => {
          if (session.id !== sessionId) return session;
          const currentInput = session.studentInputs?.[personId] || defaultStudentSessionInput();
          return {
            ...session,
            studentInputs: {
              ...(session.studentInputs || {}),
              [personId]: {
                unavailableSlots: sortSlotKeys(unavailableSlots),
                subjectSlots: normalizeSubjectSlots(currentInput.subjectSlots),
                regularOnly: Boolean(currentInput.regularOnly),
                countSubmitted: Boolean(currentInput.countSubmitted),
              },
            },
          };
        });
      }

      function updateStudentCountLocally(sessionId, personId, subjectSlots, regularOnly, countSubmitted) {
        DATA.specialSessions = (DATA.specialSessions || []).map((session) => {
          if (session.id !== sessionId) return session;
          const currentInput = session.studentInputs?.[personId] || defaultStudentSessionInput();
          return {
            ...session,
            studentInputs: {
              ...(session.studentInputs || {}),
              [personId]: {
                unavailableSlots: sortSlotKeys(currentInput.unavailableSlots),
                subjectSlots: regularOnly ? {} : normalizeSubjectSlots(subjectSlots),
                regularOnly: Boolean(regularOnly),
                countSubmitted: Boolean(countSubmitted),
              },
            },
          };
        });
      }

      function updateTeacherUnavailableSlotsLocally(sessionId, personId, unavailableSlots) {
        DATA.specialSessions = (DATA.specialSessions || []).map((session) => {
          if (session.id !== sessionId) return session;
          const currentInput = session.teacherInputs?.[personId] || defaultTeacherSessionInput();
          return {
            ...session,
            teacherInputs: {
              ...(session.teacherInputs || {}),
              [personId]: {
                unavailableSlots: sortSlotKeys(unavailableSlots),
                countSubmitted: Boolean(currentInput.countSubmitted),
              },
            },
          };
        });
      }

      function updateTeacherCountLocally(sessionId, personId, countSubmitted) {
        DATA.specialSessions = (DATA.specialSessions || []).map((session) => {
          if (session.id !== sessionId) return session;
          const currentInput = session.teacherInputs?.[personId] || defaultTeacherSessionInput();
          return {
            ...session,
            teacherInputs: {
              ...(session.teacherInputs || {}),
              [personId]: {
                unavailableSlots: sortSlotKeys(currentInput.unavailableSlots),
                countSubmitted: Boolean(countSubmitted),
              },
            },
          };
        });
      }

      function persistUnavailableSlots(sessionId, personId, unavailableSlots) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-student-unavailable-save',
            sessionId,
            personId,
            unavailableSlots: sortSlotKeys(unavailableSlots),
          }, '*');
        } catch {}
      }

      function persistStudentCount(sessionId, personId, subjectSlots, regularOnly, countSubmitted) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-student-count-save',
            sessionId,
            personId,
            subjectSlots: regularOnly ? {} : normalizeSubjectSlots(subjectSlots),
            regularOnly: Boolean(regularOnly),
            countSubmitted: Boolean(countSubmitted),
          }, '*');
        } catch {}
      }

      function persistTeacherUnavailableSlots(sessionId, personId, unavailableSlots) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-teacher-unavailable-save',
            sessionId,
            personId,
            unavailableSlots: sortSlotKeys(unavailableSlots),
          }, '*');
        } catch {}
      }

      function persistTeacherCount(sessionId, personId, countSubmitted) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-teacher-count-save',
            sessionId,
            personId,
            countSubmitted: Boolean(countSubmitted),
          }, '*');
        } catch {}
      }

      function applyStudentUnavailableSlots(studentId, slotKeys) {
        if (!studentId || !Array.isArray(slotKeys) || !slotKeys.length) return;
        const normalizedSlotKeys = sortSlotKeys(Array.from(new Set(slotKeys.filter((slotKey) => typeof slotKey === 'string' && slotKey))));
        if (!normalizedSlotKeys.length) return;

        const targetSessions = new Map();
        normalizedSlotKeys.forEach((slotKey) => {
          const [dateKey] = slotKey.split('_');
          if (!dateKey) return;
          getEditableSpecialSessionsForStudent(studentId, dateKey).forEach((session) => {
            targetSessions.set(session.id, session);
          });
        });
        if (!targetSessions.size) return;

        const shouldSelect = normalizedSlotKeys.some((slotKey) => !getUnavailableSlotsForStudent(studentId).has(slotKey));

        Array.from(targetSessions.values()).forEach((session) => {
          const currentSlots = new Set(session.studentInputs?.[studentId]?.unavailableSlots || []);
          normalizedSlotKeys.forEach((slotKey) => {
            const [dateKey] = slotKey.split('_');
            if (!dateKey || dateKey < session.startDate || dateKey > session.endDate) return;
            if (shouldSelect) currentSlots.add(slotKey);
            else currentSlots.delete(slotKey);
          });
          const nextSlots = sortSlotKeys(Array.from(currentSlots));
          updateUnavailableSlotsLocally(session.id, studentId, nextSlots);
          persistUnavailableSlots(session.id, studentId, nextSlots);
        });

        syncPayloadFingerprint();
        refreshStudentUnavailableUi(studentId);
      }

      function toggleStudentUnavailableSlot(studentId, slotKey) {
        applyStudentUnavailableSlots(studentId, [slotKey]);
      }

      function applyTeacherUnavailableSlots(teacherId, slotKeys) {
        if (!teacherId || !Array.isArray(slotKeys) || !slotKeys.length) return;
        const normalizedSlotKeys = sortSlotKeys(Array.from(new Set(slotKeys.filter((slotKey) => typeof slotKey === 'string' && slotKey))));
        if (!normalizedSlotKeys.length) return;

        const targetSessions = new Map();
        normalizedSlotKeys.forEach((slotKey) => {
          const [dateKey] = slotKey.split('_');
          if (!dateKey) return;
          getEditableSpecialSessionsForTeacher(teacherId, dateKey).forEach((session) => {
            targetSessions.set(session.id, session);
          });
        });
        if (!targetSessions.size) return;

        const shouldSelect = normalizedSlotKeys.some((slotKey) => !getUnavailableSlotsForTeacher(teacherId).has(slotKey));

        Array.from(targetSessions.values()).forEach((session) => {
          const currentSlots = new Set(session.teacherInputs?.[teacherId]?.unavailableSlots || []);
          normalizedSlotKeys.forEach((slotKey) => {
            const [dateKey] = slotKey.split('_');
            if (!dateKey || dateKey < session.startDate || dateKey > session.endDate) return;
            if (shouldSelect) currentSlots.add(slotKey);
            else currentSlots.delete(slotKey);
          });
          const nextSlots = sortSlotKeys(Array.from(currentSlots));
          updateTeacherUnavailableSlotsLocally(session.id, teacherId, nextSlots);
          persistTeacherUnavailableSlots(session.id, teacherId, nextSlots);
        });

        syncPayloadFingerprint();
        refreshTeacherUnavailableUi(teacherId);
      }

      function toggleTeacherUnavailableSlot(teacherId, slotKey) {
        applyTeacherUnavailableSlots(teacherId, [slotKey]);
      }

      function renderStudentSlotContent(studentId, slotKey, content, title, isDisabled) {
        const hasEditableSession = !isDisabled && getEditableSpecialSessionsForStudent(studentId, slotKey.split('_')[0] || '').length > 0;
        const unavailableSlots = getUnavailableSlotsForStudent(studentId);
        const isUnavailable = unavailableSlots.has(slotKey);
        if (!hasEditableSession) {
          return '<div class="slot-static">' + content + '</div>';
        }
        const buttonClasses = ['slot-button'];
        if (isUnavailable) buttonClasses.push('is-unavailable');
        return '<button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-student-unavailable" data-student-id="' + studentId + '" data-slot-key="' + slotKey + '" data-testid="student-schedule-cell-button-' + studentId + '-' + slotKey + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + content + '</button>';
      }

      function renderStudentDateHeaderCell(studentId, dateHeader, slotNumbers, cellMap) {
        const slotKeys = getEditableStudentSlotKeys(studentId, [dateHeader], slotNumbers, cellMap);
        const headerClass = !dateHeader.isOpenDay ? 'holiday-col' : '';
        const labelHtml = '<span class="date-label">' + Number(dateHeader.dateKey.split('-')[2]) + '</span>';
        if (!slotKeys.length) return '<th class="' + headerClass + '">' + labelHtml + '</th>';
        const buttonClasses = ['header-toggle'];
        if (areStudentSlotsUnavailable(studentId, slotKeys)) buttonClasses.push('is-unavailable');
        return '<th class="' + headerClass + '"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-student-unavailable-date" data-student-id="' + studentId + '" data-date-key="' + dateHeader.dateKey + '" data-testid="student-schedule-day-toggle-' + studentId + '-' + dateHeader.dateKey + '" title="この日の出席不可を一括切替">' + labelHtml + '</button></th>';
      }

      function renderTeacherDateHeaderCell(teacherId, dateHeader, slotNumbers, cellMap) {
        const slotKeys = getEditableTeacherSlotKeys(teacherId, [dateHeader], slotNumbers, cellMap);
        const headerClass = !dateHeader.isOpenDay ? 'holiday-col' : '';
        const labelHtml = '<span class="date-label">' + Number(dateHeader.dateKey.split('-')[2]) + '</span>';
        if (!slotKeys.length) return '<th class="' + headerClass + '">' + labelHtml + '</th>';
        const buttonClasses = ['header-toggle'];
        if (areTeacherSlotsUnavailable(teacherId, slotKeys)) buttonClasses.push('is-unavailable');
        return '<th class="' + headerClass + '"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-teacher-unavailable-date" data-teacher-id="' + teacherId + '" data-date-key="' + dateHeader.dateKey + '" data-testid="teacher-schedule-day-toggle-' + teacherId + '-' + dateHeader.dateKey + '" title="この日の参加不可を一括切替">' + labelHtml + '</button></th>';
      }

      function renderStudentTimeHeaderCell(studentId, timeLabel, slotNumber, dateHeaders, cellMap) {
        const slotKeys = getEditableStudentSlotKeys(studentId, dateHeaders, [slotNumber], cellMap);
        if (!slotKeys.length) return renderTimeHeaderCell(timeLabel, slotNumber);
        const buttonClasses = ['header-toggle'];
        if (areStudentSlotsUnavailable(studentId, slotKeys)) buttonClasses.push('is-unavailable');
        const actionHtml = '<button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-student-unavailable-slot" data-student-id="' + studentId + '" data-slot-number="' + slotNumber + '" data-testid="student-schedule-slot-toggle-' + studentId + '-' + slotNumber + '" title="この時限の出席不可を一括切替">__CONTENT__</button>';
        return renderTimeHeaderCell(timeLabel, slotNumber, actionHtml);
      }

      function renderTeacherTimeHeaderCell(teacherId, timeLabel, slotNumber, dateHeaders, cellMap) {
        const slotKeys = getEditableTeacherSlotKeys(teacherId, dateHeaders, [slotNumber], cellMap);
        if (!slotKeys.length) return renderTimeHeaderCell(timeLabel, slotNumber);
        const buttonClasses = ['header-toggle'];
        if (areTeacherSlotsUnavailable(teacherId, slotKeys)) buttonClasses.push('is-unavailable');
        const actionHtml = '<button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-teacher-unavailable-slot" data-teacher-id="' + teacherId + '" data-slot-number="' + slotNumber + '" data-testid="teacher-schedule-slot-toggle-' + teacherId + '-' + slotNumber + '" title="この時限の参加不可を一括切替">__CONTENT__</button>';
        return renderTimeHeaderCell(timeLabel, slotNumber, actionHtml);
      }

      function renderStudentPeriodBandCell(studentId, segment) {
        if (segment.type === 'gap') return '<th class="period-gap" colspan="' + segment.colSpan + '"></th>';
        if (!segment.sessionId) return '<th class="period-band" colspan="' + segment.colSpan + '"><span class="period-pill">' + renderPeriodPill(segment) + '</span></th>';
        const input = getStudentSessionInput(studentId, segment.sessionId);
        const buttonClasses = ['period-pill-button'];
        if (input.countSubmitted) buttonClasses.push('is-registered');
        const stateClassName = input.countSubmitted ? 'period-pill-state' : 'period-pill-state print-only-hidden';
        const stateLabel = input.countSubmitted ? '希望科目数登録済' : '希望科目数設定はここをクリック';
        return '<th class="period-band" colspan="' + segment.colSpan + '"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="open-student-count-modal" data-student-id="' + studentId + '" data-session-id="' + segment.sessionId + '" data-testid="student-schedule-period-button-' + studentId + '-' + segment.sessionId + '"><span class="period-pill">' + renderPeriodPill(segment, '<span class="' + stateClassName + '">' + escapeHtml(stateLabel) + '</span>') + '</span></button></th>';
      }

      function renderTeacherPeriodBandCell(teacherId, segment) {
        if (segment.type === 'gap') return '<th class="period-gap" colspan="' + segment.colSpan + '"></th>';
        if (!segment.sessionId) return '<th class="period-band" colspan="' + segment.colSpan + '"><span class="period-pill">' + renderPeriodPill(segment) + '</span></th>';
        const input = getTeacherSessionInput(teacherId, segment.sessionId);
        const buttonClasses = ['period-pill-button'];
        if (input.countSubmitted) buttonClasses.push('is-registered');
        const stateClassName = input.countSubmitted ? 'period-pill-state' : 'period-pill-state print-only-hidden';
        const stateLabel = input.countSubmitted ? '参加不可登録済' : '参加不可登録はここをクリック';
        return '<th class="period-band" colspan="' + segment.colSpan + '"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="open-teacher-register-modal" data-teacher-id="' + teacherId + '" data-session-id="' + segment.sessionId + '" data-testid="teacher-schedule-period-button-' + teacherId + '-' + segment.sessionId + '"><span class="period-pill">' + renderPeriodPill(segment, '<span class="' + stateClassName + '">' + escapeHtml(stateLabel) + '</span>') + '</span></button></th>';
      }

      function refreshStudentUnavailableUi(studentId) {
        if (!studentId) return;
        const section = pagesElement.querySelector('[data-role="student-sheet"][data-student-id="' + studentId + '"]');
        if (!(section instanceof HTMLElement)) {
          render();
          return;
        }

        const unavailableSlots = getUnavailableSlotsForStudent(studentId);

        section.querySelectorAll('[data-role="student-slot-cell"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const slotKey = element.getAttribute('data-slot-key') || '';
          const isUnavailable = Boolean(slotKey) && unavailableSlots.has(slotKey);
          element.classList.toggle('is-unavailable', isUnavailable);

          const button = element.querySelector('[data-role="toggle-student-unavailable"]');
          if (button instanceof HTMLElement) {
            button.classList.toggle('is-unavailable', isUnavailable);
          }
        });

        section.querySelectorAll('[data-role="toggle-student-unavailable-date"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const dateKey = element.getAttribute('data-date-key') || '';
          if (!dateKey) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="student-slot-cell"][data-editable="true"][data-date-key="' + dateKey + '"]'))
            .map((cell) => cell.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          element.classList.toggle('is-unavailable', slotKeys.length > 0 && slotKeys.every((slotKey) => unavailableSlots.has(slotKey)));
        });

        section.querySelectorAll('[data-role="toggle-student-unavailable-slot"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const slotNumber = element.getAttribute('data-slot-number') || '';
          if (!slotNumber) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="student-slot-cell"][data-editable="true"][data-slot-number="' + slotNumber + '"]'))
            .map((cell) => cell.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          element.classList.toggle('is-unavailable', slotKeys.length > 0 && slotKeys.every((slotKey) => unavailableSlots.has(slotKey)));
        });
      }

      function refreshTeacherUnavailableUi(teacherId) {
        if (!teacherId) return;
        const section = pagesElement.querySelector('[data-role="teacher-sheet"][data-teacher-id="' + teacherId + '"]');
        if (!(section instanceof HTMLElement)) {
          render();
          return;
        }

        const unavailableSlots = getUnavailableSlotsForTeacher(teacherId);

        section.querySelectorAll('[data-role="teacher-slot-cell"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const slotKey = element.getAttribute('data-slot-key') || '';
          const isUnavailable = Boolean(slotKey) && unavailableSlots.has(slotKey);
          element.classList.toggle('is-unavailable', isUnavailable);

          const button = element.querySelector('[data-role="toggle-teacher-unavailable"]');
          if (button instanceof HTMLElement) {
            button.classList.toggle('is-unavailable', isUnavailable);
          }
        });

        section.querySelectorAll('[data-role="toggle-teacher-unavailable-date"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const dateKey = element.getAttribute('data-date-key') || '';
          if (!dateKey) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="teacher-slot-cell"][data-editable="true"][data-date-key="' + dateKey + '"]'))
            .map((cell) => cell.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          element.classList.toggle('is-unavailable', slotKeys.length > 0 && slotKeys.every((slotKey) => unavailableSlots.has(slotKey)));
        });

        section.querySelectorAll('[data-role="toggle-teacher-unavailable-slot"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const slotNumber = element.getAttribute('data-slot-number') || '';
          if (!slotNumber) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="teacher-slot-cell"][data-editable="true"][data-slot-number="' + slotNumber + '"]'))
            .map((cell) => cell.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          element.classList.toggle('is-unavailable', slotKeys.length > 0 && slotKeys.every((slotKey) => unavailableSlots.has(slotKey)));
        });
      }

      function renderTeacherSlotContent(teacherId, slotKey, content, title, isDisabled) {
        const hasEditableSession = !isDisabled && getEditableSpecialSessionsForTeacher(teacherId, slotKey.split('_')[0] || '').length > 0;
        const unavailableSlots = getUnavailableSlotsForTeacher(teacherId);
        const isUnavailable = unavailableSlots.has(slotKey);
        if (!hasEditableSession) {
          return '<div class="slot-static">' + content + '</div>';
        }
        const buttonClasses = ['slot-button'];
        if (isUnavailable) buttonClasses.push('is-unavailable');
        return '<button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-teacher-unavailable" data-teacher-id="' + teacherId + '" data-slot-key="' + slotKey + '" data-testid="teacher-schedule-cell-button-' + teacherId + '-' + slotKey + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + content + '</button>';
      }

      function formatTeacherLessonLabel(student) {
        const lessonLabel = lessonTypeLabels[student.lessonType] || student.lessonType;
        const teacherLabel = teacherTypeLabels[student.teacherType] || '';
        return teacherLabel ? lessonLabel + '(' + teacherLabel + ')' : lessonLabel;
      }

      function renderTeacherCellCard(students) {
        const cardClass = 'lesson-card lesson-card-teacher ' + (students.length > 1 ? 'is-pair' : 'is-single');
        return '<div class="' + cardClass + '">' + students.map((student) => '<div class="teacher-lesson-person"><span class="teacher-lesson-line teacher-lesson-name">' + escapeHtml(student.name) + '</span><span class="teacher-lesson-line teacher-lesson-meta">' + escapeHtml([student.subject, formatTeacherLessonLabel(student)].filter(Boolean).join(' ')) + '</span></div>').join('') + '</div>';
      }

      function makeCornerYearHtml(dateHeaders) {
        return getVisibleYears(dateHeaders).map((year) => '<span class="time-corner-year">' + year + '</span>').join('');
      }

      function makeMonthHeaderHtml(dateHeaders) {
        return buildMonthGroups(dateHeaders).map((group) => '<th colspan="' + group.count + '">' + group.month + '月</th>').join('');
      }

      function makeDateHeaderHtml(dateHeaders) {
        return dateHeaders.map((header) => '<th class="' + (!header.isOpenDay ? 'holiday-col' : '') + '"><span class="date-label">' + Number(header.dateKey.split('-')[2]) + '</span></th>').join('');
      }

      function makeWeekdayHeaderHtml(dateHeaders) {
        return dateHeaders.map((header) => {
          const cls = [!header.isOpenDay ? 'holiday-col' : '', header.weekday === 0 ? 'weekday-sun' : '', header.weekday === 6 ? 'weekday-sat' : ''].filter(Boolean).join(' ');
          return '<th class="' + cls + '"><span class="weekday-label">' + dayLabels[header.weekday] + '</span></th>';
        }).join('');
      }

      function renderBottomSection(commonKey, individualKey, makeupRows, regularCounts, lectureCounts, lectureWarningHtml) {
        return '<div class="bottom-grid">' +
          '<div class="box-stack"><div class="box-table-title">共通連絡事項</div><div class="box-panel"><textarea class="box-textarea memo-input" data-note-key="' + escapeHtml(commonKey) + '"></textarea></div></div>' +
          '<div class="box-stack"><div class="box-table-title">個別連絡事項</div><div class="box-panel"><textarea class="box-textarea memo-input" data-note-key="' + escapeHtml(individualKey) + '"></textarea></div></div>' +
          '<div class="box-stack"><div class="box-table-title">振替授業</div><table class="makeup-table"><tbody>' + makeupRows + '</tbody></table></div>' +
          '<div class="count-stack"><div class="count-stack-block"><div class="box-table-title">通常回数(希望数)</div><table class="count-table"><tbody>' + regularCounts + '</tbody></table></div><div class="count-stack-block"><div><div class="box-table-title">講習回数(希望数)</div><table class="count-table"><tbody>' + lectureCounts + '</tbody></table></div>' + (lectureWarningHtml || '') + '</div></div>' +
        '</div>';
      }

      function formatCompactDateSlot(dateKey, slotNumber) {
        const date = new Date(dateKey + 'T00:00:00');
        return (date.getMonth() + 1) + '/' + date.getDate() + '(' + dayLabels[date.getDay()] + ')' + slotNumber + '限';
      }

      function compactMakeupSourceLabel(label) {
        return String(label || '').replace(/\s+/g, '');
      }

      function formatMakeupNote(subject, sourceLabel, targetDateKey, targetSlotNumber) {
        if (!sourceLabel) return '';
        return [subject, compactMakeupSourceLabel(sourceLabel), '→', formatCompactDateSlot(targetDateKey, targetSlotNumber)].filter(Boolean).join(' ');
      }

      function formatTeacherMakeupNote(studentName, subject, sourceLabel, targetDateKey, targetSlotNumber) {
        if (!sourceLabel) return '';
        return [studentName, subject, compactMakeupSourceLabel(sourceLabel), '→', formatCompactDateSlot(targetDateKey, targetSlotNumber)].filter(Boolean).join(' ');
      }

      function toMakeupRows(makeupNotes, minimumRowCount) {
        return Array.from({ length: Math.max(minimumRowCount, makeupNotes.length) }, (_, rowIndex) => {
          const note = makeupNotes[rowIndex] ?? '';
          return '<tr><td colspan="3">' + escapeHtml(note) + '</td></tr>';
        }).join('');
      }

      function collectStudentMakeupNotes(entries) {
        return entries.reduce((notes, entry) => {
          const note = formatMakeupNote(entry.lesson.subject, entry.lesson.makeupSourceLabel, entry.dateKey, entry.slotNumber);
          if (note) notes.push(note);
          return notes;
        }, []);
      }

      function collectTeacherMakeupNotes(entries) {
        return entries.reduce((notes, entry) => {
          entry.students.forEach((student) => {
            const note = formatTeacherMakeupNote(student.name, student.subject, student.makeupSourceLabel, entry.dateKey, entry.slotNumber);
            if (note) notes.push(note);
          });
          return notes;
        }, []);
      }

      function renderPeriodPill(segment, stateHtml) {
        return '<span class="period-pill-edge">◀</span><span class="period-pill-label">' + escapeHtml(segment.label) + '</span>' + (stateHtml || '') + '<span class="period-pill-edge">▶</span>';
      }

      function renderStudentCountModal() {
        if (!activeCountDialog || !activeCountDialog.studentId || !activeCountDialog.sessionId) return '';
        const student = DATA.students.find((entry) => entry.id === activeCountDialog.studentId);
        const session = getSpecialSessionById(activeCountDialog.sessionId);
        if (!student || !session) return '';
        const input = getStudentSessionInput(student.id, session.id);
        const unavailableCount = input.unavailableSlots.filter((slotKey) => {
          const [dateKey] = String(slotKey || '').split('_');
          return Boolean(dateKey) && dateKey >= session.startDate && dateKey <= session.endDate;
        }).length;
        const rowsHtml = subjectDefinitions.map((subject) => '<tr><td>' + escapeHtml(subject) + '</td><td><input type="number" min="0" step="1" value="' + escapeHtml(String(Number(input.subjectSlots[subject] || 0))) + '" data-role="student-count-subject-input" data-subject="' + subject + '" data-testid="student-schedule-count-subject-' + subject + '"' + (input.regularOnly ? ' disabled' : '') + '></td></tr>').join('');
        return '<div class="count-modal-backdrop" data-role="student-count-modal-backdrop"><div class="count-modal" role="dialog" aria-modal="true" data-testid="student-schedule-count-modal"><div class="count-modal-head"><div class="count-modal-title">' + escapeHtml(formatStudentHeaderName(student, startInput.value || DATA.defaultStartDate || DATA.availableStartDate)) + '</div><div class="count-modal-subtitle">' + escapeHtml(session.label + ' (' + formatMonthDay(session.startDate) + ' - ' + formatMonthDay(session.endDate) + ')') + '</div><div class="count-modal-note">' + escapeHtml(input.countSubmitted ? '登録解除するとこの期間の参加不可コマを再編集できます。' : '登録するとこの期間の参加不可コマを FIX します。') + ' 現在の参加不可: ' + unavailableCount + ' コマ</div></div><div class="count-modal-body"><table class="count-modal-table"><tbody>' + rowsHtml + '<tr><td>通常のみ</td><td><label class="count-modal-check"><input type="checkbox" data-role="student-count-regular-only" data-testid="student-schedule-count-regular-only"' + (input.regularOnly ? ' checked' : '') + '>通常のみ</label></td></tr></tbody></table></div><div class="count-modal-actions"><button type="button" class="secondary" data-role="close-student-count-modal" data-testid="student-schedule-count-cancel">キャンセル</button>' + (input.countSubmitted ? '<button type="button" class="secondary" data-role="unsubmit-student-count-modal" data-testid="student-schedule-count-unregister">登録解除</button>' : '') + '<button type="button" data-role="submit-student-count-modal" data-testid="student-schedule-count-register">登録</button></div></div></div>';
      }

      function renderTeacherRegisterModal() {
        if (!activeTeacherRegisterDialog || !activeTeacherRegisterDialog.teacherId || !activeTeacherRegisterDialog.sessionId) return '';
        const teacher = DATA.teachers.find((entry) => entry.id === activeTeacherRegisterDialog.teacherId);
        const session = getSpecialSessionById(activeTeacherRegisterDialog.sessionId);
        if (!teacher || !session) return '';
        const input = getTeacherSessionInput(teacher.id, session.id);
        const unavailableCount = input.unavailableSlots.filter((slotKey) => {
          const [dateKey] = String(slotKey || '').split('_');
          return Boolean(dateKey) && dateKey >= session.startDate && dateKey <= session.endDate;
        }).length;
        return '<div class="count-modal-backdrop" data-role="teacher-register-modal-backdrop"><div class="count-modal" role="dialog" aria-modal="true" data-testid="teacher-schedule-register-modal"><div class="count-modal-head"><div class="count-modal-title">' + escapeHtml(formatTeacherHeaderName(teacher)) + '</div><div class="count-modal-subtitle">' + escapeHtml(session.label + ' (' + formatMonthDay(session.startDate) + ' - ' + formatMonthDay(session.endDate) + ')') + '</div><div class="count-modal-note">' + escapeHtml(input.countSubmitted ? '登録解除するとこの期間の参加不可コマを再編集できます。' : '登録するとこの期間の参加不可コマを FIX します。') + ' 現在の参加不可: ' + unavailableCount + ' コマ</div></div><div class="count-modal-body"><div class="count-modal-note">講師日程では希望科目設定はありません。参加不可コマだけを確認して登録してください。</div></div><div class="count-modal-actions"><button type="button" class="secondary" data-role="close-teacher-register-modal" data-testid="teacher-schedule-register-cancel">キャンセル</button>' + (input.countSubmitted ? '<button type="button" class="secondary" data-role="unsubmit-teacher-register-modal" data-testid="teacher-schedule-register-unregister">登録解除</button>' : '') + '<button type="button" data-role="submit-teacher-register-modal" data-testid="teacher-schedule-register-submit">登録</button></div></div></div>';
      }

      function openStudentCountModal(studentId, sessionId) {
        if (!studentId || !sessionId) return;
        activeCountDialog = { studentId, sessionId };
        render();
      }

      function openTeacherRegisterModal(teacherId, sessionId) {
        if (!teacherId || !sessionId) return;
        activeTeacherRegisterDialog = { teacherId, sessionId };
        render();
      }

      function closeStudentCountModal() {
        if (!activeCountDialog) return;
        activeCountDialog = null;
        render();
      }

      function closeTeacherRegisterModal() {
        if (!activeTeacherRegisterDialog) return;
        activeTeacherRegisterDialog = null;
        render();
      }

      function submitStudentCountModal() {
        if (!activeCountDialog || !activeCountDialog.studentId || !activeCountDialog.sessionId) return;
        const regularOnlyElement = document.querySelector('[data-role="student-count-regular-only"]');
        const regularOnly = regularOnlyElement instanceof HTMLInputElement ? Boolean(regularOnlyElement.checked) : false;
        const subjectSlots = {};
        document.querySelectorAll('[data-role="student-count-subject-input"]').forEach((element) => {
          if (!(element instanceof HTMLInputElement)) return;
          const subject = element.getAttribute('data-subject') || '';
          if (!subject) return;
          const normalizedValue = Number.isFinite(Number(element.value)) ? Math.max(0, Math.trunc(Number(element.value))) : 0;
          if (normalizedValue > 0) subjectSlots[subject] = normalizedValue;
        });

        updateStudentCountLocally(activeCountDialog.sessionId, activeCountDialog.studentId, subjectSlots, regularOnly, true);
        persistStudentCount(activeCountDialog.sessionId, activeCountDialog.studentId, subjectSlots, regularOnly, true);
        activeCountDialog = null;
        syncPayloadFingerprint();
        render();
      }

      function unsubmitStudentCountModal() {
        if (!activeCountDialog || !activeCountDialog.studentId || !activeCountDialog.sessionId) return;
        const currentInput = getStudentSessionInput(activeCountDialog.studentId, activeCountDialog.sessionId);
        updateStudentCountLocally(activeCountDialog.sessionId, activeCountDialog.studentId, currentInput.subjectSlots, currentInput.regularOnly, false);
        persistStudentCount(activeCountDialog.sessionId, activeCountDialog.studentId, currentInput.subjectSlots, currentInput.regularOnly, false);
        activeCountDialog = null;
        syncPayloadFingerprint();
        render();
      }

      function submitTeacherRegisterModal() {
        if (!activeTeacherRegisterDialog || !activeTeacherRegisterDialog.teacherId || !activeTeacherRegisterDialog.sessionId) return;
        updateTeacherCountLocally(activeTeacherRegisterDialog.sessionId, activeTeacherRegisterDialog.teacherId, true);
        persistTeacherCount(activeTeacherRegisterDialog.sessionId, activeTeacherRegisterDialog.teacherId, true);
        activeTeacherRegisterDialog = null;
        syncPayloadFingerprint();
        render();
      }

      function unsubmitTeacherRegisterModal() {
        if (!activeTeacherRegisterDialog || !activeTeacherRegisterDialog.teacherId || !activeTeacherRegisterDialog.sessionId) return;
        updateTeacherCountLocally(activeTeacherRegisterDialog.sessionId, activeTeacherRegisterDialog.teacherId, false);
        persistTeacherCount(activeTeacherRegisterDialog.sessionId, activeTeacherRegisterDialog.teacherId, false);
        activeTeacherRegisterDialog = null;
        syncPayloadFingerprint();
        render();
      }

      function getSortedPeriodBands() {
        return DATA.periodBands
          .slice()
          .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate) || left.label.localeCompare(right.label, 'ja'));
      }

      function buildPeriodValue(band) {
        return band.startDate + '|' + band.endDate + '|' + band.label;
      }

      function syncPeriodSelectOptions(preferredValue) {
        const previousValue = preferredValue ?? periodSelect.value;
        const options = ['<option value="">選択してください</option>'];
        const sortedBands = getSortedPeriodBands();
        sortedBands.forEach((band) => {
          const value = buildPeriodValue(band);
          options.push('<option value="' + escapeHtml(value) + '">' + escapeHtml(band.label + ' (' + formatMonthDay(band.startDate) + ' - ' + formatMonthDay(band.endDate) + ')') + '</option>');
        });
        periodSelect.innerHTML = options.join('');
        if (Array.from(periodSelect.options).some((option) => option.value === previousValue)) {
          periodSelect.value = previousValue;
          return;
        }

        const matchedBand = sortedBands.find((band) => band.startDate === startInput.value && band.endDate === endInput.value);
        periodSelect.value = matchedBand ? buildPeriodValue(matchedBand) : '';
      }

      function buildHeaderHtml(title, nameLabel, subLabel, pageIndex, periodLabel, qrHtml) {
        return '<div class="sheet-top">'
          + '<div class="logo-box" data-shared-image="logo"><span class="logo-placeholder">ロゴ欄</span></div>'
          + '<div class="school-box"><textarea class="school-input shared-input" data-shared-input="school-info" rows="2" placeholder="校舎名&#10;TEL等"></textarea></div>'
          + '<div class="title-box"><input class="title-input shared-input" data-shared-input="sheet-title" value="" placeholder="授業日程表" /></div>'
          + '<div class="meta-box"><div class="meta-row"><span class="meta-label">期間:</span> ' + escapeHtml(periodLabel) + '</div><div class="meta-row person-meta-row">' + (qrHtml || '') + '<span class="page-count print-only-hidden">' + (pageIndex + 1) + 'ページ目</span><span><span class="meta-label">' + escapeHtml(nameLabel) + ':</span> ' + escapeHtml(subLabel) + '</span></div></div>'
          + '</div>';
      }

      function formatStudentHeaderName(student, referenceDate) {
        const gradeLabel = getGradeLabel(student.birthDate, referenceDate);
        const sourceName = student.fullName || student.name;
        return gradeLabel ? sourceName + '(' + gradeLabel + ')' : sourceName;
      }

      function formatTeacherHeaderName(teacher) {
        return teacher.fullName || teacher.name;
      }

      function renderStudentPages(startDate, endDate) {
        const filteredCells = filterCells(startDate, endDate);
        const dateHeaders = buildDateHeaders(startDate, endDate);
        const slotNumbers = getSlotNumbers();
        const cellMap = buildCellMap(filteredCells);
        const assignmentMap = buildStudentAssignments(filteredCells);
        const periodSegments = buildPeriodSegments(dateHeaders);
        const cornerYearHtml = makeCornerYearHtml(dateHeaders);
        const monthHeaderHtml = makeMonthHeaderHtml(dateHeaders);
        const weekdayHeaderHtml = makeWeekdayHeaderHtml(dateHeaders);
        const tableDensityClass = getTableDensityClass(dateHeaders);
        const students = DATA.students.filter((student) => isVisibleInRange(student, startDate, endDate)).sort((left, right) => left.name.localeCompare(right.name, 'ja'));
        const showQr = shouldShowScheduleQr();
        pagesElement.innerHTML = students.map((student, index) => {
          const entries = assignmentMap.get(student.id) || assignmentMap.get(student.name) || [];
          const keyMap = new Map(entries.map((entry) => [entry.dateKey + '_' + entry.slotNumber, entry]));
          const unavailableSlots = getUnavailableSlotsForStudent(student.id);
          const subjectCounts = {};
          const lectureCounts = {};
          const desiredLectureCounts = buildDesiredLectureCountMap(student.id, startDate, endDate);
          const makeupNotes = collectStudentMakeupNotes(entries);
          entries.forEach((entry) => {
            if (entry.lesson.lessonType === 'special') lectureCounts[entry.lesson.subject] = (lectureCounts[entry.lesson.subject] || 0) + 1;
            else subjectCounts[entry.lesson.subject] = (subjectCounts[entry.lesson.subject] || 0) + 1;
          });
          const lectureCountWarningHtml = hasCountMismatch(lectureCounts, desiredLectureCounts)
            ? '<div class="count-warning-stamp print-only-hidden" data-testid="student-schedule-lecture-count-warning">希望数と予定数が一致していません！</div>'
            : '';
          const rows = slotNumbers.map((slotNumber) => {
            const timeLabel = filteredCells.find((cell) => cell.slotNumber === slotNumber)?.timeLabel || slotNumber + '限';
            const cellsHtml = dateHeaders.map((dateHeader) => {
              const cell = cellMap.get(dateHeader.dateKey + '_' + slotNumber);
              const assignment = keyMap.get(dateHeader.dateKey + '_' + slotNumber);
              const slotKey = dateHeader.dateKey + '_' + slotNumber;
              const isEditable = getEditableSpecialSessionsForStudent(student.id, dateHeader.dateKey).length > 0 && dateHeader.isOpenDay && (!cell || cell.isOpenDay);
              const classes = ['slot-cell'];
              if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) classes.push('is-holiday');
              if (isEditable) classes.push('is-editable');
              if (unavailableSlots.has(slotKey)) classes.push('is-unavailable');
              let content = '<div class="empty-label"></div>';
              if (assignment) content = renderStudentCellCard(assignment.lesson);
              const title = assignment ? [assignment.lesson.subject, lessonTypeLabels[assignment.lesson.lessonType] || assignment.lesson.lessonType, assignment.teacher].filter(Boolean).join(' / ') : '';
              return '<td class="' + classes.join(' ') + '" data-role="student-slot-cell" data-student-id="' + student.id + '" data-date-key="' + dateHeader.dateKey + '" data-slot-number="' + slotNumber + '" data-slot-key="' + slotKey + '" data-editable="' + (isEditable ? 'true' : 'false') + '" data-testid="student-schedule-cell-' + student.id + '-' + slotKey + '"><div class="slot-cell-content">' + renderStudentSlotContent(student.id, slotKey, content, title, !isEditable) + '</div></td>';
            }).join('');
            return '<tr>' + renderStudentTimeHeaderCell(student.id, timeLabel, slotNumber, dateHeaders, cellMap) + cellsHtml + '</tr>';
          }).join('');
          const makeupRows = toMakeupRows(makeupNotes, 7);
          const periodRowHtml = periodSegments.length ? '<tr class="period-row"><th class="time-col"></th>' + periodSegments.map((segment) => renderStudentPeriodBandCell(student.id, segment)).join('') + '</tr>' : '';
          const qrHtml = student.qrSvg ? '<span class="qr-code' + (showQr ? '' : ' is-hidden') + '">' + student.qrSvg + '</span>' : '';
          const dateHeaderHtml = dateHeaders.map((header) => renderStudentDateHeaderCell(student.id, header, slotNumbers, cellMap)).join('');
          return '<section class="sheet" data-role="student-sheet" data-student-id="' + student.id + '">' + buildHeaderHtml('授業日程表', '生徒名', formatStudentHeaderName(student, startDate), index, formatRangeLabel(startDate, endDate), qrHtml) + '<table class="schedule-table ' + tableDensityClass + '"><thead>' + periodRowHtml + '<tr class="month-row"><th class="time-col time-corner" rowspan="3"><div class="time-corner-box">' + cornerYearHtml + '</div></th>' + monthHeaderHtml + '</tr><tr class="date-row">' + dateHeaderHtml + '</tr><tr class="weekday-row">' + weekdayHeaderHtml + '</tr></thead><tbody>' + rows + '</tbody></table>' + renderBottomSection('student-common', 'student-' + student.id, makeupRows, toCountRows(subjectCounts), toCountRows(lectureCounts, desiredLectureCounts), lectureCountWarningHtml) + '</section>';
        }).join('');
      }

      function renderTeacherPages(startDate, endDate) {
        const filteredCells = filterCells(startDate, endDate);
        const dateHeaders = buildDateHeaders(startDate, endDate);
        const slotNumbers = getSlotNumbers();
        const cellMap = buildCellMap(filteredCells);
        const assignmentMap = buildTeacherAssignments(filteredCells);
        const periodSegments = buildPeriodSegments(dateHeaders);
        const cornerYearHtml = makeCornerYearHtml(dateHeaders);
        const monthHeaderHtml = makeMonthHeaderHtml(dateHeaders);
        const dateHeaderHtml = makeDateHeaderHtml(dateHeaders);
        const weekdayHeaderHtml = makeWeekdayHeaderHtml(dateHeaders);
        const tableDensityClass = getTableDensityClass(dateHeaders);
        const teachers = DATA.teachers.filter((teacher) => isVisibleInRange(teacher, startDate, endDate)).sort((left, right) => left.name.localeCompare(right.name, 'ja'));
        const showQr = shouldShowScheduleQr();
        pagesElement.innerHTML = teachers.map((teacher, index) => {
          const entries = assignmentMap.get(teacher.name) || (teacher.fullName ? assignmentMap.get(teacher.fullName) || [] : []);
          const keyMap = new Map(entries.map((entry) => [entry.dateKey + '_' + entry.slotNumber, entry]));
          const unavailableSlots = getUnavailableSlotsForTeacher(teacher.id);
          const regularCounts = {};
          const lectureCounts = {};
          const makeupNotes = collectTeacherMakeupNotes(entries);
          entries.forEach((entry) => {
            entry.students.forEach((student) => {
              if (student.lessonType === 'special') lectureCounts[student.subject] = (lectureCounts[student.subject] || 0) + 1;
              else regularCounts[student.subject] = (regularCounts[student.subject] || 0) + 1;
            });
          });
          const rows = slotNumbers.map((slotNumber) => {
            const timeLabel = filteredCells.find((cell) => cell.slotNumber === slotNumber)?.timeLabel || slotNumber + '限';
            const cellsHtml = dateHeaders.map((dateHeader) => {
              const cell = cellMap.get(dateHeader.dateKey + '_' + slotNumber);
              const entry = keyMap.get(dateHeader.dateKey + '_' + slotNumber);
              const slotKey = dateHeader.dateKey + '_' + slotNumber;
              const isEditable = getEditableSpecialSessionsForTeacher(teacher.id, dateHeader.dateKey).length > 0 && dateHeader.isOpenDay && (!cell || cell.isOpenDay);
              const classes = ['slot-cell'];
              if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) classes.push('is-holiday');
              if (isEditable) classes.push('is-editable');
              if (unavailableSlots.has(slotKey)) classes.push('is-unavailable');
              let content = '<div class="empty-label"></div>';
              if (entry) content = renderTeacherCellCard(entry.students);
              const title = entry ? entry.students.map((student) => [student.name, student.subject, formatTeacherLessonLabel(student)].filter(Boolean).join(' ')).join(' / ') : '';
              return '<td class="' + classes.join(' ') + '" data-role="teacher-slot-cell" data-teacher-id="' + teacher.id + '" data-date-key="' + dateHeader.dateKey + '" data-slot-number="' + slotNumber + '" data-slot-key="' + slotKey + '" data-editable="' + (isEditable ? 'true' : 'false') + '" data-testid="teacher-schedule-cell-' + teacher.id + '-' + slotKey + '"><div class="slot-cell-content">' + renderTeacherSlotContent(teacher.id, slotKey, content, title, !isEditable) + '</div></td>';
            }).join('');
            return '<tr>' + renderTeacherTimeHeaderCell(teacher.id, timeLabel, slotNumber, dateHeaders, cellMap) + cellsHtml + '</tr>';
          }).join('');
          const makeupRows = toMakeupRows(makeupNotes, 7);
          const periodRowHtml = periodSegments.length ? '<tr class="period-row"><th class="time-col"></th>' + periodSegments.map((segment) => renderTeacherPeriodBandCell(teacher.id, segment)).join('') + '</tr>' : '';
          const qrHtml = teacher.qrSvg ? '<span class="qr-code' + (showQr ? '' : ' is-hidden') + '">' + teacher.qrSvg + '</span>' : '';
          const teacherDateHeaderHtml = dateHeaders.map((header) => renderTeacherDateHeaderCell(teacher.id, header, slotNumbers, cellMap)).join('');
          return '<section class="sheet" data-role="teacher-sheet" data-teacher-id="' + teacher.id + '">' + buildHeaderHtml('授業日程表', '講師名', formatTeacherHeaderName(teacher), index, formatRangeLabel(startDate, endDate), qrHtml) + '<table class="schedule-table ' + tableDensityClass + '"><thead>' + periodRowHtml + '<tr class="month-row"><th class="time-col time-corner" rowspan="3"><div class="time-corner-box">' + cornerYearHtml + '</div></th>' + monthHeaderHtml + '</tr><tr class="date-row">' + teacherDateHeaderHtml + '</tr><tr class="weekday-row">' + weekdayHeaderHtml + '</tr></thead><tbody>' + rows + '</tbody></table>' + renderBottomSection('teacher-common', 'teacher-' + teacher.id, makeupRows, toCountRows(regularCounts), toCountRows(lectureCounts), '') + '</section>';
        }).join('');
      }

      function applyIncomingPayload(nextPayload) {
        const nextFingerprint = JSON.stringify(nextPayload);
        const currentStartDate = startInput.value;
        const currentEndDate = endInput.value;
        const currentPeriodValue = periodSelect.value;
        if (skipNextEquivalentPayload && nextFingerprint === payloadFingerprint) {
          DATA = nextPayload;
          payloadFingerprint = nextFingerprint;
          skipNextEquivalentPayload = false;
          syncPeriodSelectOptions(currentPeriodValue);
          return;
        }

        skipNextEquivalentPayload = false;
        DATA = nextPayload;
        payloadFingerprint = nextFingerprint;
        syncPeriodSelectOptions(currentPeriodValue);
        if (currentStartDate && currentEndDate) {
          render();
          return;
        }
        const preferredRange = getPreferredRange();
        setRangeAndRender(
          preferredRange.startDate,
          preferredRange.endDate,
          preferredRange.periodValue,
        );
      }

      function bindNotes() {
        document.querySelectorAll('.memo-input').forEach((element) => {
          const noteKey = element.getAttribute('data-note-key');
          const key = 'schedule-note:' + VIEW_TYPE + ':' + noteKey;
          const storage = getSharedStorage();
          try {
            const saved = storage ? storage.getItem(key) : null;
            if (saved !== null && !element.value) element.value = saved;
          } catch {}
          element.addEventListener('input', () => {
            try { storage && storage.setItem(key, element.value); } catch {}
            document.querySelectorAll('.memo-input[data-note-key="' + noteKey + '"]').forEach((other) => {
              if (other !== element) other.value = element.value;
            });
          });
        });
      }

      function bindSharedInputs() {
        document.querySelectorAll('.shared-input').forEach((element) => {
          const sharedKey = element.getAttribute('data-shared-input');
          const storageKey = sharedStoragePrefix + sharedKey;
          const storage = getSharedStorage();
          try {
            const saved = storage ? storage.getItem(storageKey) : null;
            if (saved !== null) element.value = saved;
            if (saved === null && sharedKey === 'sheet-title') element.value = '授業日程表';
          } catch {}
          element.addEventListener('input', () => {
            try { storage && storage.setItem(storageKey, element.value); } catch {}
            document.querySelectorAll('.shared-input[data-shared-input="' + sharedKey + '"]').forEach((other) => {
              if (other !== element) other.value = element.value;
            });
            if (sharedKey === 'school-info') syncScheduleQrVisibility();
          });
        });
      }

      function readStoredRange() {
        const storage = getSharedStorage();
        try {
          return {
            startDate: storage ? storage.getItem(rangeStoragePrefix + 'start') || '' : '',
            endDate: storage ? storage.getItem(rangeStoragePrefix + 'end') || '' : '',
            periodValue: storage ? storage.getItem(rangeStoragePrefix + 'period') || '' : '',
          };
        } catch {
          return { startDate: '', endDate: '', periodValue: '' };
        }
      }

      function writeStoredRange(startDate, endDate, periodValue) {
        const storage = getSharedStorage();
        try {
          if (!storage) return;
          storage.setItem(rangeStoragePrefix + 'start', startDate || '');
          storage.setItem(rangeStoragePrefix + 'end', endDate || '');
          storage.setItem(rangeStoragePrefix + 'period', periodValue || '');
        } catch {}
      }

      function notifyRangeChange(startDate, endDate, periodValue) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-range-update',
            viewType: VIEW_TYPE,
            startDate: startDate || '',
            endDate: endDate || '',
            periodValue: periodValue || '',
          }, '*');
        } catch {}
      }

      function requestRefresh() {
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({
              type: 'schedule-refresh-request',
              viewType: VIEW_TYPE,
            }, '*');
          }
        } catch {}
        render();
      }

      function handleTeacherUnavailableClick(target) {
        const role = target.getAttribute('data-role') || '';
        if (role === 'open-teacher-register-modal') {
          openTeacherRegisterModal(target.getAttribute('data-teacher-id') || '', target.getAttribute('data-session-id') || '');
          return;
        }

        if (role === 'close-teacher-register-modal' || role === 'teacher-register-modal-backdrop') {
          closeTeacherRegisterModal();
          return;
        }

        if (role === 'submit-teacher-register-modal') {
          submitTeacherRegisterModal();
          return;
        }

        if (role === 'unsubmit-teacher-register-modal') {
          unsubmitTeacherRegisterModal();
          return;
        }

        if (role === 'toggle-teacher-unavailable-date') {
          const section = target.closest('[data-role="teacher-sheet"]');
          const teacherId = target.getAttribute('data-teacher-id') || '';
          const dateKey = target.getAttribute('data-date-key') || '';
          if (!(section instanceof HTMLElement) || !teacherId || !dateKey) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="teacher-slot-cell"][data-editable="true"][data-date-key="' + dateKey + '"]'))
            .map((element) => element.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          applyTeacherUnavailableSlots(teacherId, slotKeys);
          return;
        }

        if (role === 'toggle-teacher-unavailable-slot') {
          const section = target.closest('[data-role="teacher-sheet"]');
          const teacherId = target.getAttribute('data-teacher-id') || '';
          const slotNumber = target.getAttribute('data-slot-number') || '';
          if (!(section instanceof HTMLElement) || !teacherId || !slotNumber) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="teacher-slot-cell"][data-editable="true"][data-slot-number="' + slotNumber + '"]'))
            .map((element) => element.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          applyTeacherUnavailableSlots(teacherId, slotKeys);
          return;
        }

        const cellTarget = role === 'teacher-slot-cell' ? target : target.closest('[data-role="teacher-slot-cell"]');
        if (!(cellTarget instanceof HTMLElement) || cellTarget.getAttribute('data-editable') !== 'true') return;
        const teacherId = cellTarget.getAttribute('data-teacher-id') || target.getAttribute('data-teacher-id') || '';
        const slotKey = cellTarget.getAttribute('data-slot-key') || target.getAttribute('data-slot-key') || '';
        if (!teacherId || !slotKey) return;
        toggleTeacherUnavailableSlot(teacherId, slotKey);
      }

      function handleStudentUnavailableClick(target) {
        const role = target.getAttribute('data-role') || '';
        if (role === 'open-student-count-modal') {
          openStudentCountModal(target.getAttribute('data-student-id') || '', target.getAttribute('data-session-id') || '');
          return;
        }

        if (role === 'close-student-count-modal' || role === 'student-count-modal-backdrop') {
          closeStudentCountModal();
          return;
        }

        if (role === 'submit-student-count-modal') {
          submitStudentCountModal();
          return;
        }

        if (role === 'unsubmit-student-count-modal') {
          unsubmitStudentCountModal();
          return;
        }

        if (role === 'toggle-student-unavailable-date') {
          const section = target.closest('[data-role="student-sheet"]');
          const studentId = target.getAttribute('data-student-id') || '';
          const dateKey = target.getAttribute('data-date-key') || '';
          if (!(section instanceof HTMLElement) || !studentId || !dateKey) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="student-slot-cell"][data-editable="true"][data-date-key="' + dateKey + '"]'))
            .map((element) => element.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          applyStudentUnavailableSlots(studentId, slotKeys);
          return;
        }

        if (role === 'toggle-student-unavailable-slot') {
          const section = target.closest('[data-role="student-sheet"]');
          const studentId = target.getAttribute('data-student-id') || '';
          const slotNumber = target.getAttribute('data-slot-number') || '';
          if (!(section instanceof HTMLElement) || !studentId || !slotNumber) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="student-slot-cell"][data-editable="true"][data-slot-number="' + slotNumber + '"]'))
            .map((element) => element.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          applyStudentUnavailableSlots(studentId, slotKeys);
          return;
        }

        const cellTarget = role === 'student-slot-cell' ? target : target.closest('[data-role="student-slot-cell"]');
        if (!(cellTarget instanceof HTMLElement) || cellTarget.getAttribute('data-editable') !== 'true') return;
        const studentId = cellTarget.getAttribute('data-student-id') || target.getAttribute('data-student-id') || '';
        const slotKey = cellTarget.getAttribute('data-slot-key') || target.getAttribute('data-slot-key') || '';
        if (!studentId || !slotKey) return;
        toggleStudentUnavailableSlot(studentId, slotKey);
      }

      function handleUnavailablePointerDown(target) {
        const role = target.getAttribute('data-role') || '';
        if (!role.includes('unavailable') && role !== 'student-slot-cell' && role !== 'teacher-slot-cell') return false;
        if (role.includes('modal')) return false;
        if (role.includes('teacher')) {
          handleTeacherUnavailableClick(target);
          return true;
        }
        handleStudentUnavailableClick(target);
        return true;
      }

      function isDateWithinAvailableRange(dateKey) {
        return !dateKey || (dateKey >= DATA.availableStartDate && dateKey <= DATA.availableEndDate);
      }

      function getPreferredRange() {
        const stored = readStoredRange();
        const startDate = isDateWithinAvailableRange(stored.startDate) ? stored.startDate : '';
        const endDate = isDateWithinAvailableRange(stored.endDate) ? stored.endDate : '';
        return {
          startDate: startDate || DATA.defaultStartDate || DATA.availableStartDate,
          endDate: endDate || DATA.defaultEndDate || DATA.availableEndDate,
          periodValue: stored.periodValue || DATA.defaultPeriodValue || '',
        };
      }

      function syncLogo(src) {
        document.querySelectorAll('[data-shared-image="logo"]').forEach((element) => {
          element.innerHTML = src ? '<img class="logo-image" src="' + src + '" alt="logo" />' : '<span class="logo-placeholder">ロゴ欄</span>';
        });
      }

      function bindLogoControls() {
        const logoInput = document.getElementById('schedule-logo-input');
        const storageKey = sharedStoragePrefix + 'logo';
        const readStoredLogo = () => {
          const storage = getSharedStorage();
          try {
            return storage ? storage.getItem(storageKey) || '' : '';
          } catch {
            return '';
          }
        };
        try {
          syncLogo(readStoredLogo());
        } catch {
          syncLogo('');
        }
        document.addEventListener('click', (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const logoBox = target.closest('[data-shared-image="logo"]');
          if (!logoBox) return;
          logoInput.click();
        });
        logoInput.addEventListener('change', () => {
          const file = logoInput.files && logoInput.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            syncLogo(result);
            try {
              const storage = getSharedStorage();
              storage && storage.setItem(storageKey, result);
            } catch {}
          };
          reader.readAsDataURL(file);
        });
        return readStoredLogo;
      }

      function render() {
        let startDate = startInput.value || DATA.defaultStartDate || DATA.availableStartDate;
        let endDate = endInput.value || DATA.defaultEndDate || DATA.availableEndDate;
        if (startDate > endDate) {
          const previous = startDate;
          startDate = endDate;
          endDate = previous;
          setDateInputValue(startInput, startDate);
          setDateInputValue(endInput, endDate);
        }
        summaryLabel.textContent = '表示中: ' + formatRangeLabel(startDate, endDate);
        document.title = VIEW_LABEL + ' | ' + formatRangeLabel(startDate, endDate);
        try {
          if (VIEW_TYPE === 'student') renderStudentPages(startDate, endDate);
          else renderTeacherPages(startDate, endDate);
          if (VIEW_TYPE === 'student') pagesElement.insertAdjacentHTML('beforeend', renderStudentCountModal());
          if (VIEW_TYPE === 'teacher') pagesElement.insertAdjacentHTML('beforeend', renderTeacherRegisterModal());
        } catch (error) {
          pagesElement.innerHTML = '<div class="empty-state">表示中にエラーが発生しました: ' + escapeHtml(String(error)) + '</div>';
        }
        bindNotes();
        bindSharedInputs();
        if (window.__scheduleReadStoredLogo) syncLogo(window.__scheduleReadStoredLogo());
        syncScheduleQrVisibility();
      }

      function setRangeAndRender(nextStartDate, nextEndDate, nextPeriodValue) {
        let startDate = nextStartDate || DATA.defaultStartDate || DATA.availableStartDate;
        let endDate = nextEndDate || DATA.defaultEndDate || DATA.availableEndDate;
        if (startDate > endDate) {
          const previous = startDate;
          startDate = endDate;
          endDate = previous;
        }
        setDateInputValue(startInput, startDate);
        setDateInputValue(endInput, endDate);
        syncPeriodSelectOptions(nextPeriodValue);
        writeStoredRange(startDate, endDate, periodSelect.value || nextPeriodValue || '');
        notifyRangeChange(startDate, endDate, periodSelect.value || nextPeriodValue || '');
        render();
      }

      function handleDateInputChange() {
        setRangeAndRender(startInput.value, endInput.value, '');
      }

      const preferredRange = getPreferredRange();
      startInput.addEventListener('input', handleDateInputChange);
      endInput.addEventListener('input', handleDateInputChange);
      startInput.addEventListener('change', handleDateInputChange);
      endInput.addEventListener('change', handleDateInputChange);
      startInput.addEventListener('blur', handleDateInputChange);
      endInput.addEventListener('blur', handleDateInputChange);
      periodSelect.addEventListener('input', () => {
        if (!periodSelect.value) return;
        const [startDate, endDate] = periodSelect.value.split('|');
        setRangeAndRender(startDate, endDate, periodSelect.value);
      });
      periodSelect.addEventListener('change', () => {
        if (!periodSelect.value) return;
        const [startDate, endDate] = periodSelect.value.split('|');
        setRangeAndRender(startDate, endDate, periodSelect.value);
      });
      refreshButton.addEventListener('click', requestRefresh);
      pagesElement.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const toggleTarget = target.closest('[data-role="toggle-student-unavailable"], [data-role="student-slot-cell"], [data-role="toggle-student-unavailable-date"], [data-role="toggle-student-unavailable-slot"], [data-role="toggle-teacher-unavailable"], [data-role="teacher-slot-cell"], [data-role="toggle-teacher-unavailable-date"], [data-role="toggle-teacher-unavailable-slot"]');
        if (!toggleTarget || !(toggleTarget instanceof HTMLElement)) return;
        if (!handleUnavailablePointerDown(toggleTarget)) return;
        suppressNextToggleClick = true;
        window.setTimeout(() => {
          suppressNextToggleClick = false;
        }, 0);
        event.preventDefault();
      });
      pagesElement.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const toggleTarget = target.closest('[data-role="toggle-student-unavailable"], [data-role="student-slot-cell"], [data-role="toggle-student-unavailable-date"], [data-role="toggle-student-unavailable-slot"], [data-role="open-student-count-modal"], [data-role="close-student-count-modal"], [data-role="submit-student-count-modal"], [data-role="unsubmit-student-count-modal"], [data-role="student-count-modal-backdrop"], [data-role="toggle-teacher-unavailable"], [data-role="teacher-slot-cell"], [data-role="toggle-teacher-unavailable-date"], [data-role="toggle-teacher-unavailable-slot"], [data-role="open-teacher-register-modal"], [data-role="close-teacher-register-modal"], [data-role="submit-teacher-register-modal"], [data-role="unsubmit-teacher-register-modal"], [data-role="teacher-register-modal-backdrop"]');
        if (!toggleTarget || !(toggleTarget instanceof HTMLElement)) return;
        if (suppressNextToggleClick) {
          suppressNextToggleClick = false;
          return;
        }
        if (toggleTarget.getAttribute('data-role') === 'student-count-modal-backdrop' && toggleTarget !== target) return;
        if (toggleTarget.getAttribute('data-role') === 'teacher-register-modal-backdrop' && toggleTarget !== target) return;
        if ((toggleTarget.getAttribute('data-role') || '').includes('teacher')) {
          handleTeacherUnavailableClick(toggleTarget);
          return;
        }
        handleStudentUnavailableClick(toggleTarget);
      });
      pagesElement.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.getAttribute('data-role') !== 'student-count-regular-only') return;
        document.querySelectorAll('[data-role="student-count-subject-input"]').forEach((element) => {
          if (element instanceof HTMLInputElement) element.disabled = Boolean(target.checked);
        });
      });
      window.addEventListener('beforeunload', () => {
        notifyRangeChange(startInput.value, endInput.value, periodSelect.value);
      });
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || message.type !== 'schedule-data-update' || message.viewType !== VIEW_TYPE || !message.payload) return;
        applyIncomingPayload(message.payload);
      });
      window.__scheduleReadStoredLogo = bindLogoControls();
      setRangeAndRender(preferredRange.startDate, preferredRange.endDate, preferredRange.periodValue);
      window.setTimeout(render, 0);
      window.addEventListener('load', render, { once: true });
    </script>
  </body>
</html>`
}

function openScheduleHtml(payload: SchedulePayload, viewType: 'student' | 'teacher', targetWindow?: Window | null) {
  const popupWindow = createPopupWindow(payload.titleLabel + '-' + viewType, targetWindow)
  if (!popupWindow) {
    alert(`${viewType === 'student' ? '生徒' : '講師'}日程を開けませんでした。ポップアップを許可してください。`)
    return null
  }

  const html = createScheduleHtml(payload, viewType)
  const writeScheduleDocument = () => {
    popupWindow.document.open()
    popupWindow.document.write(html)
    popupWindow.document.close()
  }

  writeScheduleDocument()
  window.setTimeout(() => {
    try {
      if (!popupWindow.document.getElementById('schedule-pages') || !popupWindow.document.querySelector('.sheet')) {
        writeScheduleDocument()
      }
    } catch {
      writeScheduleDocument()
    }
  }, 0)
  popupWindow.focus()
  return popupWindow
}

function postSchedulePayload(targetWindow: Window | null | undefined, viewType: 'student' | 'teacher', payload: SchedulePayload) {
  if (!targetWindow || targetWindow.closed) return
  targetWindow.postMessage({ type: 'schedule-data-update', viewType, payload }, '*')
}

export function openStudentScheduleHtml(params: OpenStudentScheduleHtmlParams) {
  return openScheduleHtml(buildStudentPayload(params), 'student', params.targetWindow)
}

export function openTeacherScheduleHtml(params: OpenTeacherScheduleHtmlParams) {
  return openScheduleHtml(buildTeacherPayload(params), 'teacher', params.targetWindow)
}

export function syncStudentScheduleHtml(params: OpenStudentScheduleHtmlParams) {
  postSchedulePayload(params.targetWindow, 'student', buildStudentPayload(params))
}

export function syncTeacherScheduleHtml(params: OpenTeacherScheduleHtmlParams) {
  postSchedulePayload(params.targetWindow, 'teacher', buildTeacherPayload(params))
}

export function formatWeeklyScheduleTitle(startDate: string, endDate: string) {
  if (!startDate || !endDate) return '週間予定表'
  const startParts = startDate.split('-')
  const endParts = endDate.split('-')
  return `週間予定表${Number(startParts[1])}月${Number(startParts[2])}日-${Number(endParts[1])}月${Number(endParts[2])}日`
}