// tools/check-dist-dev-hooks.mjs(開発用の読み口が本番ビルドに入っていないかの番人)を固定する。
// 番人が「呼ばれていない」「見ている文字がアプリとずれている」と、黙って素通りになるのでその 2 点も見る。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { DEV_HOOK_MARKERS, findDevHookMarkers } from './check-dist-dev-hooks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('本番ビルドの番人(開発用の読み口)', () => {
  it('読み口の文字を含むファイルだけを返す', () => {
    expect(findDevHookMarkers([{ path: 'a.js', text: 'x=1' }, { path: 'b.js', text: 'window.__komahyouUiPatrol={}' }])).toEqual(['b.js'])
    expect(findDevHookMarkers([])).toEqual([])
  })

  it('npm run build の最後でこの検査を呼ぶ', () => {
    const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'))
    expect(pkg.scripts.build.trim().endsWith('node tools/check-dist-dev-hooks.mjs')).toBe(true)
  })

  it('印の文字はアプリの UI_PATROL_GLOBAL_KEY と同じ', () => {
    const source = readFileSync(`${ROOT}src/utils/uiPatrolHook.ts`, 'utf8')
    expect(source).toContain(`UI_PATROL_GLOBAL_KEY = '${DEV_HOOK_MARKERS[0]}'`)
  })
})
