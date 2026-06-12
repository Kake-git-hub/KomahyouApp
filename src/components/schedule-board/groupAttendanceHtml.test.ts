import { describe, expect, it } from 'vitest'
import { buildGroupAttendanceHtml } from './groupAttendanceHtml'

describe('buildGroupAttendanceHtml', () => {
  const base = {
    schoolName: 'スクールIE テスト校',
    dateLabel: '2026-07-21 (火)',
    bandTimeLabel: '10:00-11:00',
    subject: '集団理科',
    teacherName: '山田先生',
  }

  it('includes header fields (教室/日付/時間帯/科目/講師)', () => {
    const html = buildGroupAttendanceHtml({ ...base, attendees: [] })
    expect(html).toContain('スクールIE テスト校')
    expect(html).toContain('2026-07-21 (火)')
    expect(html).toContain('集団 10:00-11:00')
    expect(html).toContain('集団理科')
    expect(html).toContain('山田先生')
  })

  it('lists attendees with 出席/欠席 and a running number', () => {
    const html = buildGroupAttendanceHtml({
      ...base,
      attendees: [
        { name: '青木太郎', present: true },
        { name: '伊藤花', present: false },
        { name: '上田陽介', present: true },
      ],
    })
    expect(html).toContain('青木太郎')
    expect(html).toContain('伊藤花')
    expect(html).toContain('上田陽介')
    expect(html).toContain('出席')
    expect(html).toContain('欠席')
  })

  it('summarises present / absent counts', () => {
    const html = buildGroupAttendanceHtml({
      ...base,
      attendees: [
        { name: 'A', present: true },
        { name: 'B', present: true },
        { name: 'C', present: false },
      ],
    })
    expect(html).toContain('出席 2 名 / 欠席 1 名（合計 3 名）')
  })

  it('shows an empty-state row when there are no attendees', () => {
    const html = buildGroupAttendanceHtml({ ...base, attendees: [] })
    expect(html).toContain('出席者がいません')
    expect(html).toContain('出席 0 名 / 欠席 0 名（合計 0 名）')
  })

  it('omits optional 教室 / 講師 lines when not provided', () => {
    const html = buildGroupAttendanceHtml({
      dateLabel: '2026-07-22',
      bandTimeLabel: '11:10-12:10',
      subject: '集団社会',
      attendees: [{ name: 'A', present: true }],
    })
    expect(html).not.toContain('<span class="label">教室</span>')
    expect(html).not.toContain('<span class="label">担当講師</span>')
    expect(html).toContain('集団社会')
  })

  it('escapes HTML in names to avoid markup injection', () => {
    const html = buildGroupAttendanceHtml({
      ...base,
      attendees: [{ name: '<script>alert(1)</script>', present: true }],
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
