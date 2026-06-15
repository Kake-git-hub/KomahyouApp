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

  it('keeps a single roster column for 25 or fewer attendees', () => {
    const attendees = Array.from({ length: 25 }, (_, i) => ({ name: `生徒${i + 1}`, present: true }))
    const html = buildGroupAttendanceHtml({ ...base, attendees })
    expect(html.match(/class="roster-col"/g) ?? []).toHaveLength(1)
  })

  it('splits 26-50 attendees into two roster columns with continuous numbering (A4 portrait fit)', () => {
    const attendees = Array.from({ length: 50 }, (_, i) => ({ name: `生徒${i + 1}`, present: i % 2 === 0 }))
    const html = buildGroupAttendanceHtml({ ...base, attendees })
    // 2列に分割される（最大25名/列）。
    expect(html.match(/class="roster-col"/g) ?? []).toHaveLength(2)
    // 通し番号は列をまたいで連続（1〜50）。
    expect(html).toContain('>1</td>')
    expect(html).toContain('>26</td>')
    expect(html).toContain('>50</td>')
    expect(html).toContain('出席 25 名 / 欠席 25 名（合計 50 名）')
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
