// 講師日程共有(BoardShareScreen)の机の並び(docs/spec-schedule-pdf.md §N・2026-11-15 オーナー確定)を字面で固定する。
// 1 行 = 1 机で、左から 席番｜講師名｜生徒 1｜生徒 2。旧形(講師の帯の下に生徒 2 人・講師 10px / 生徒 9px 固定)へ戻さない。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SCREEN = readFileSync(fileURLToPath(new URL('./BoardShareScreen.tsx', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const CSS = readFileSync(fileURLToPath(new URL('../../App.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

// `.selector {` で始まる最上位の区画(最初の 1 つ)の中身を返す。無ければ null。
function readCssBlock(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = CSS.match(new RegExp(`(^|\\n)${escaped} \\{\\n([\\s\\S]*?)\\n\\}`))
  return match ? match[2] : null
}

// 括弧の中の空白では分けずに、値を空白で区切る。
function splitTopLevelTokens(value: string): string[] {
  const tokens: string[] = []
  let depth = 0
  let current = ''
  for (const char of value.trim()) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (/\s/.test(char) && depth === 0) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

describe('講師日程共有の机の並び: 画面', () => {
  it('旧形の入れ物(講師の帯＋生徒 2 人の箱)を使わない', () => {
    expect(SCREEN).not.toContain('board-share-desk-body')
    expect(SCREEN).not.toContain('board-share-students')
    expect(SCREEN).not.toContain('board-share-lesson-type')
  })

  it('生徒の欄は 2 段(名前 / 印・学年・科目)で、文字は resolveBoardShareSeatLines で組み立てる', () => {
    expect(SCREEN).toContain('board-share-student-name')
    expect(SCREEN).toContain('board-share-student-detail')
    expect(SCREEN).toContain('board-share-student-marker')
    expect(SCREEN).toContain('resolveBoardShareSeatLines(')
  })

  it('2 段の文字は resolveBoardShareSeatView の戻り値(visibleStudent / visibleStatus)から作る。生の status を渡さない(INV-04)', () => {
    expect(SCREEN).toContain('resolveBoardShareSeatLines(visibleStudent, visibleStatus,')
    expect(SCREEN).not.toMatch(/resolveBoardShareSeatLines\((student|visibleStudent), status\b/)
  })

  it('記録の印は名前の span の直後の別の span(名前だけが「…」で縮み、印は残る)', () => {
    expect(SCREEN).toMatch(/<span className="board-share-student-name">\{lines\.name\}<\/span>\s*\{lines\.statusLabel \? <span className="board-share-student-status-label">/)
  })

  it('机の中は 席番 → 講師 → 生徒 の順', () => {
    const deskStart = SCREEN.indexOf('<section className="board-share-desk"')
    expect(deskStart).toBeGreaterThan(-1)
    const seat = SCREEN.indexOf('board-share-seat', deskStart)
    const teacher = SCREEN.indexOf('board-share-teacher', deskStart)
    const student = SCREEN.indexOf('board-share-student', deskStart)
    expect(seat).toBeGreaterThan(deskStart)
    expect(teacher).toBeGreaterThan(seat)
    expect(student).toBeGreaterThan(teacher)
  })
})

describe('講師日程共有の机の並び: CSS', () => {
  it('.board-share-desk は 4 列の grid で、行をコンテナにする(container-type: size)', () => {
    const block = readCssBlock('.board-share-desk')
    expect(block).not.toBeNull()
    const columnsLine = block!.split('\n').find((line) => line.trim().startsWith('grid-template-columns:'))
    expect(columnsLine).toBeDefined()
    const value = columnsLine!.split(':').slice(1).join(':').replace(/;\s*$/, '')
    expect(splitTopLevelTokens(value)).toHaveLength(4)
    expect(block).toContain('container-type: size')
  })

  it('旧形の区画(.board-share-desk-body / .board-share-students / .board-share-lesson-type)が無い', () => {
    expect(readCssBlock('.board-share-desk-body')).toBeNull()
    expect(readCssBlock('.board-share-students')).toBeNull()
    expect(readCssBlock('.board-share-lesson-type')).toBeNull()
  })

  it('記録の印は縮めない(flex: none)', () => {
    expect(readCssBlock('.board-share-student-status-label')).toContain('flex: none')
  })

  it('コンテナクエリ非対応の大きさは画面の高さと机の数から決める(固定 px にしない)', () => {
    const outside = CSS.slice(0, CSS.indexOf('@supports (container-type: size)'))
    expect(outside).toContain('calc((100vh - 110px) / var(--board-share-desk-count, 14) * 0.38)')
    expect(outside).toContain('calc((100vh - 110px) / var(--board-share-desk-count, 14) * 0.28)')
  })

  it('行が低いときは講師名を 1 行にする(@container の max-height で line-clamp: 1)', () => {
    const supportsStart = CSS.indexOf('@supports (container-type: size)')
    expect(supportsStart).toBeGreaterThan(-1)
    const supportsBlock = CSS.slice(supportsStart)
    expect(supportsBlock).toMatch(/@container \(max-height: \d+px\) \{[\s\S]*?\.board-share-teacher \{[\s\S]*?-webkit-line-clamp: 1;/)
  })

  it('全部の机がスクロールなしで 1 画面に収まる行の割り方は残す', () => {
    expect(readCssBlock('.board-share-desk-list')).toContain('grid-template-rows: repeat(var(--board-share-desk-count, 14), minmax(0, 1fr))')
  })

  it('旧形の固定の小さい字(生徒 9px・講師 10px)に戻さない', () => {
    expect(readCssBlock('.board-share-student') ?? '').not.toContain('font-size: 9px')
    expect(readCssBlock('.board-share-teacher') ?? '').not.toContain('font-size: 10px')
  })
})
