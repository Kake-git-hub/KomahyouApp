// 確認リストの「準備する」(2026-11-06 案 C 第 1 段・spec-developer-report §E-2-4)のコマ表側の配線ガード(source-scan)。
// 判断は純関数(resolveChecklistPrepStep / planChecklistPrep / applyChecklistPrepOps・checklistPrep.test.ts)で固定し、ここでは
// 巨大コンポーネントの effect が落とすと事故になる配線を字面で固定する:
// - 処理済み requestId は ref(一過性リクエストを 1 回だけ処理・Issue #46 同型)。成功でも失敗でも必ず結果を返す。
// - 検証用教室・テンプレ編集中の判断を純関数へ渡す(断る分岐を effect に持たない)。
// - 置くのは室長の操作と同じ commitWeeks を 1 回(既定引数のまま)。保存は自動でしない。
// - 保護者連絡(parentAbsenceRequest)とは別の state・別の ref。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

function effectBody(): string {
  const start = BOARD_TSX.indexOf('if (!shouldProcessChecklistPrepRequest(checklistPrepRequest, processedChecklistPrepRequestIdRef.current, {')
  expect(start, 'checklist prep effect not found').toBeGreaterThan(0)
  const end = BOARD_TSX.indexOf('}, [', start)
  expect(end).toBeGreaterThan(start)
  return BOARD_TSX.slice(start, end)
}

describe('確認リストの「準備する」(ScheduleBoardScreen.tsx)', () => {
  it('props で一過性リクエストと結果の返し口を受ける', () => {
    expect(BOARD_TSX).toContain('checklistPrepRequest?: ChecklistPrepRequest | null')
    expect(BOARD_TSX).toContain('onChecklistPrepRequestProcessed?: (result: ChecklistPrepRequestResult) => void')
  })

  it('処理済みの requestId は保護者連絡とは別の ref で持ち、結果は成功でも失敗でも finish で返す', () => {
    expect(BOARD_TSX).toContain('const processedChecklistPrepRequestIdRef = useRef<number | null>(null)')
    const body = effectBody()
    expect(body).toContain('processedChecklistPrepRequestIdRef.current = request.requestId')
    expect(body).toContain('onChecklistPrepRequestProcessed?.({ requestId: request.requestId, ok, message })')
    expect(body).not.toContain('processedParentAbsenceRequestIdRef')
    expect(body).not.toContain('parentAbsenceJumpedRequestIdRef')
    // 早期 return の直前は finish か、週を移る(次のレンダーで続ける)だけ。
    const lines = body.split(/\r?\n/u)
    lines.forEach((line, index) => {
      if (line.trim() !== 'return') return
      const previous = (lines[index - 1] ?? '').trim()
      expect(previous, `return without finish: ${previous}`).toMatch(/finish\(|jumpToWeekByDate\(/u)
    })
  })

  it('断る判断(検証用教室でない・テンプレ編集中)と置き場は純関数 resolveChecklistPrepStep に渡す', () => {
    const body = effectBody()
    expect(body).toContain('resolveChecklistPrepStep({')
    expect(body).toContain('isVerificationClassroom: isDevelopmentClassroom({ id: classroomStorageKey ?? null })')
    expect(body).toContain('isTemplateMode,')
    // 置き場は開校ルール適用後の週(休校日を isOpenDay で見る)。保留の机は保留マップで避ける。
    expect(body).toContain('weeks: normalizedWeeks,')
    expect(body).toContain('templatePendingDesks: activeTemplatePendingDesks,')
  })

  it('押した教室(request.classroomId)とコマ表の教室が違う・教室データの読み込みが済んでいない間は処理しない(消費もせず待つ・要確認 1・INV-08)', () => {
    const body = effectBody()
    // 判断は純関数 shouldProcessChecklistPrepRequest(checklistPrep.test.ts で固定)。effect はコマ表の教室と読み込み済みの印を渡すだけ。
    expect(body).toContain('classroomId: classroomStorageKey ?? null,')
    expect(body).toContain('isEditingStateLoaded: isEditingStateLoadedForActingClassroom,')
    expect(body.indexOf('isEditingStateLoaded: isEditingStateLoadedForActingClassroom,')).toBeLessThan(body.indexOf('const finish = '))
    const depsStart = BOARD_TSX.indexOf('}, [', BOARD_TSX.indexOf(body))
    const deps = BOARD_TSX.slice(depsStart, BOARD_TSX.indexOf('])', depsStart))
    expect(deps).toContain('isEditingStateLoadedForActingClassroom')
    expect(deps).toContain('classroomStorageKey')
  })

  it('置くのは applyChecklistPrepOps → commitWeeks を 1 回(既定引数のまま)。置けなかった操作があれば commitWeeks を呼ばず失敗で返す。保存は呼ばない', () => {
    const body = effectBody()
    expect(body).toContain('const applied = applyChecklistPrepOps(weeks, step.plan.ops, buildTeacherAliasResolver(teachers))')
    const skippedIndex = body.indexOf('if (applied.skipped > 0) {')
    expect(skippedIndex).toBeGreaterThan(0)
    expect(body.slice(skippedIndex, skippedIndex + 200)).toContain('finish(false, CHECKLIST_PREP_DESK_SHORTAGE_MESSAGE)')
    expect(skippedIndex).toBeLessThan(body.indexOf('commitWeeks('))
    expect(body).toContain('commitWeeks(applied.weeks, weekIndex, step.plan.cellId, step.plan.deskIndex)')
    expect([...body.matchAll(/commitWeeks\(/gu)]).toHaveLength(1)
    expect(body).not.toContain('onSaveBoard')
    expect(body).not.toContain('setWeeks(')
  })

  it('講師メニューの「保存」の出自は権威関数 resolveManualTeacherAssignmentSource(準備と同じ 1 本)を通す(式を画面に複製しない)', () => {
    expect(BOARD_TSX).toContain('const teacherAssignmentSource = resolveManualTeacherAssignmentSource(targetDesk)')
    expect(BOARD_TSX).not.toContain("!targetDesk.lesson && targetDesk.teacher.trim() && !targetDesk.manualTeacher")
  })
})
