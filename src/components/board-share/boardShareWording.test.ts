// コマ表の共有ページ(BoardShareScreen / boardShare.ts)の利用者向け文言を字面で固定する
// (オーナー確定 2026-10-10・文言一覧レビュー #85〜#89/#91: 「配布用盤面」→「コマ表」に用語統一)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SCREEN = readFileSync(fileURLToPath(new URL('./BoardShareScreen.tsx', import.meta.url)), 'utf8')
const SHARE = readFileSync(fileURLToPath(new URL('../../integrations/firebase/boardShare.ts', import.meta.url)), 'utf8')

describe('コマ表共有ページの文言', () => {
  it('読み込み中・遅い・見つからない・失敗・範囲外の文言は「コマ表」で統一する', () => {
    expect(SCREEN).toContain("useState('コマ表を読み込んでいます。')")
    expect(SCREEN).toContain('コマ表の読み込みに時間がかかっています。通信状態を確認してください。')
    expect(SCREEN).toContain('コマ表が見つかりませんでした。URLを確認してください。')
    expect(SCREEN).toContain('コマ表の読み込みに失敗しました。')
    expect(SCREEN).toContain('この日のコマ表はありません。')
    expect(SCREEN).not.toContain('配布データに含まれていません')
  })

  it('利用者に見える文字列リテラルに「配布用盤面」を出さない(コメントは除く)', () => {
    const literals = SCREEN.split('\n').filter((line) => !line.trim().startsWith('//') && line.includes('配布用盤面'))
    expect(literals).toEqual([])
  })

  it('圧縮データ未対応ブラウザの文言は技術用語を使わず対処を示す', () => {
    expect(SHARE).toContain('このブラウザでは表示できません。Chrome か Edge の最新版で開いてください。')
    expect(SHARE).not.toContain('圧縮データ読込に未対応')
  })
})
