// 提出用QRの提出後の画面で組まれたコマを見せるか(日程公開・オーナー確定 2026-11-03)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isSubmissionSchedulePublished, resolveSubmittedViewOccupiedSlots, SUBMISSION_SCHEDULE_PENDING_MESSAGE } from './submissionScheduleVisibility'

const occupiedSlots = { '2026-12-24_1': '通英', '2026-12-25_2': '講数' }

describe('resolveSubmittedViewOccupiedSlots', () => {
  it('非公開(false)の間は組まれたコマを出さない(通常も講習も)', () => {
    expect(resolveSubmittedViewOccupiedSlots({ schedulePublished: false, occupiedSlots })).toEqual({})
    expect(isSubmissionSchedulePublished({ schedulePublished: false })).toBe(false)
  })

  it('公開(true)と未設定(この項目ができる前の文書・旧 functions の応答)は今までどおり出す', () => {
    expect(resolveSubmittedViewOccupiedSlots({ schedulePublished: true, occupiedSlots })).toEqual(occupiedSlots)
    expect(resolveSubmittedViewOccupiedSlots({ occupiedSlots })).toEqual(occupiedSlots)
    expect(resolveSubmittedViewOccupiedSlots({ schedulePublished: null, occupiedSlots: null })).toEqual({})
    expect(isSubmissionSchedulePublished({})).toBe(true)
  })

  it('案内文は内部語を含まない', () => {
    expect(SUBMISSION_SCHEDULE_PENDING_MESSAGE).not.toMatch(/公開|schedule|フラグ/)
  })
})

describe('SubmissionPage の配線', () => {
  const PAGE = readFileSync(fileURLToPath(new URL('./SubmissionPage.tsx', import.meta.url)), 'utf8')

  it('提出後の画面は resolveSubmittedViewOccupiedSlots を通して組まれたコマを読む(occupiedSlots を直読みしない)', () => {
    const submittedIndex = PAGE.indexOf('if (submitted) {')
    expect(submittedIndex).toBeGreaterThan(0)
    const head = PAGE.slice(submittedIndex, submittedIndex + 800)
    expect(head).toContain('const viewOccupiedSlots = resolveSubmittedViewOccupiedSlots(data)')
    expect(head).not.toContain('data.occupiedSlots ?? {}')
  })

  it('非公開の間は案内文を出す', () => {
    expect(PAGE).toContain('{!viewSchedulePublished && (')
    expect(PAGE).toContain('{SUBMISSION_SCHEDULE_PENDING_MESSAGE}')
  })
})

describe('提出用QRの GET 応答(functions/src/index.ts)', () => {
  const FUNCTIONS_INDEX = readFileSync(fileURLToPath(new URL('../../../functions/src/index.ts', import.meta.url)), 'utf8')

  it('schedulePublished を返す(未設定は公開)', () => {
    expect(FUNCTIONS_INDEX).toContain('schedulePublished: data.schedulePublished !== false,')
  })
})
