import { describe, expect, it } from 'vitest'
import { validateImportedBasicDataBundle } from './basicDataImportValidation'
import { createTemplateBundle, mergeImportedBundle } from './BasicDataScreen'

describe('basicDataImportValidation', () => {
  it('reports duplicate ids before importing Excel data', () => {
    const bundle = createTemplateBundle()
    const errors = validateImportedBasicDataBundle({
      ...bundle,
      teachers: [
        bundle.teachers[0]!,
        { ...bundle.teachers[1]!, id: bundle.teachers[0]!.id },
      ],
    })

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('講師IDが重複しています'),
    ]))
  })

  it('preserves initial setup fields when basic data is merged from Excel', () => {
    const bundle = createTemplateBundle()
    const merged = mergeImportedBundle({
      ...bundle,
      classroomSettings: {
        ...bundle.classroomSettings,
        closedWeekdays: [0, 1],
        deskCount: 18,
      },
    }, {
      ...bundle,
      classroomSettings: {
        ...bundle.classroomSettings,
        initialSetupCompletedAt: '2026-03-27T00:00:00.000Z',
        initialSetupMakeupStocks: [{ id: 'm1', studentId: 's001', subject: '英', count: 2 }],
        initialSetupLectureStocks: [{ id: 'l1', studentId: 's001', subject: '英', sessionId: 'session-1', count: 1 }],
      },
    })

    expect(merged.classroomSettings).toEqual(expect.objectContaining({
      closedWeekdays: [0, 1],
      deskCount: 18,
      initialSetupCompletedAt: '2026-03-27T00:00:00.000Z',
      initialSetupMakeupStocks: [{ id: 'm1', studentId: 's001', subject: '英', count: 2 }],
      initialSetupLectureStocks: [{ id: 'l1', studentId: 's001', subject: '英', sessionId: 'session-1', count: 1 }],
    }))
  })
})