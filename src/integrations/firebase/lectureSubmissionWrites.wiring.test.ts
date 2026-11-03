// 提出用QRの文書へ配布情報を後追い反映する 3 経路の配線(2026-11-03・INV-07 / INV-08)。
// 3 経路とも App.tsx から「操作中の教室 ID」を渡し、別教室の文書へ書かないこと、
// lectureSubmission.ts の実装が読んだ doc を丸ごと書き戻さない(setDoc({ ...data }) に戻らない)ことを字面で固定する。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')
const IMPL = readFileSync(fileURLToPath(new URL('./lectureSubmission.ts', import.meta.url)), 'utf8')

function functionBody(name: string) {
  const start = IMPL.indexOf(`export async function ${name}(`)
  expect(start, name).toBeGreaterThan(0)
  const next = IMPL.indexOf('\nexport ', start + 10)
  return IMPL.slice(start, next > 0 ? next : undefined)
}

describe('配布情報の後追い反映(App.tsx → lectureSubmission.ts)', () => {
  it('App は 3 経路とも操作中の教室 ID を渡す(INV-08)', () => {
    expect(APP).toContain('updateSubmissionOccupiedSlots(existingTokenEntries, actingClassroomId)')
    expect(APP).toContain('updateSubmissionGroupClassEligibility(token, [...sessionGroupClassSubjects], actingClassroomId)')
    expect(APP).toContain('updateSubmissionReopenedSlots(input.submissionToken, input.reopenedSlots ?? [], actingClassroomId)')
  })

  it('3 経路とも別教室ガードを通し、部分更新(updateDoc)だけで書く(INV-07)', () => {
    for (const name of ['updateSubmissionOccupiedSlots', 'updateSubmissionGroupClassEligibility', 'updateSubmissionReopenedSlots']) {
      const body = functionBody(name)
      expect(body, name).toContain('isForeignClassroomSubmissionDoc(')
      expect(body, name).toContain('await updateDoc(docRef, ')
      expect(body, name).not.toContain('setDoc(')
      expect(body, name).not.toContain('...data')
    }
  })
})
