// tools/ui-patrol/selectors.mjs(台本が頼る testid と長押しの長さ)を固定する。
// 画面の巡回はブラウザで流すので毎 push の CI では動かない。testid の名前が変わったら巡回が黙って空振りしないよう、
// ソースに字面で残っていることをここ(毎 push のユニットテスト)で確かめる。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DRIVER_TIMING, SOURCE_FILES_WITH_TESTIDS, TESTIDS, TESTID_PREFIXES } from './selectors.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

function readSources() {
  // App.tsx は CRLF のことがあるので改行を直してから読む。
  return SOURCE_FILES_WITH_TESTIDS.map((file) => readFileSync(path.join(REPO_ROOT, file), 'utf8').replace(/\r\n/g, '\n')).join('\n')
}

describe('selectors', () => {
  it('台本が頼る testid は、アプリのソースに字面で存在する(名前が変わったら毎 push のテストで気づく)', () => {
    const source = readSources()
    const missing = Object.entries(TESTIDS).filter(([, value]) => !source.includes(`data-testid="${value}"`)).map(([key, value]) => `${key}=${value}`)
    expect(missing).toEqual([])
    const missingPrefixes = Object.entries(TESTID_PREFIXES).filter(([, value]) => !source.includes(`data-testid={\`${value}`)).map(([key, value]) => `${key}=${value}`)
    expect(missingPrefixes).toEqual([])
  })

  it('長押しの長さと取り消しの距離がアプリと合っている', () => {
    // 変わったら driver の待ち(DRIVER_TIMING)を見直す合図。
    const screen = readFileSync(path.join(REPO_ROOT, 'src/components/schedule-board/ScheduleBoardScreen.tsx'), 'utf8')
    expect(screen).toContain('DRAG_LONG_PRESS_MS = 250')
    expect(screen).toContain('PRE_ARM_CANCEL_PX = 8')
    expect(DRIVER_TIMING.longPressMs).toBeGreaterThan(250)
    expect(DRIVER_TIMING.dragSteps).toBeGreaterThan(1)
  })
})
