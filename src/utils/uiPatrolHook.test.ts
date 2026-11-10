// 画面の自動巡回（tools/ui-patrol.mjs・docs/test-strategy.md 層 5）の読み口のテスト。
//
// 読み口はブラウザの外から盤面の状態を読むためのもので、**開発用ビルド かつ ローカルモード**だけに出す。
// 本番ビルドに入らないことは tools/check-dist-dev-hooks.mjs が見るが、ここでは
// 「取り付けの条件」と「App.tsx の配線（DEV の if の中だけ）」を字面で固定する。

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AppSnapshotPayload, WorkspaceSnapshot } from '../types/appState'
import {
  installUiPatrolHook,
  pickUiPatrolClassroom,
  shouldInstallUiPatrolHook,
  UI_PATROL_GLOBAL_KEY,
  type UiPatrolHook,
} from './uiPatrolHook'

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url))
const APP_TSX = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

function makeClassrooms(): Pick<WorkspaceSnapshot, 'classrooms'> {
  const dataA = { marker: 'A' } as unknown as AppSnapshotPayload
  const dataB = { marker: 'B' } as unknown as AppSnapshotPayload
  const base = { name: '', contractStatus: 'active', contractStartDate: '', contractEndDate: '', managerUserId: '' }
  return {
    classrooms: [
      { ...base, id: 'room-a', data: dataA },
      { ...base, id: 'room-b', data: dataB },
    ] as unknown as WorkspaceSnapshot['classrooms'],
  }
}

function makeHook(): UiPatrolHook {
  return { version: 1, backendMode: 'local', appVersion: 'test', readClassroom: () => null }
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full))
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    if (/\.test\./.test(name)) continue
    out.push(full)
  }
  return out
}

describe('画面の自動巡回の読み口（開発用ビルド かつ ローカルモードだけ）', () => {
  it('入れてよいのは 開発用ビルド かつ Firebase 無効 のときだけ', () => {
    expect(shouldInstallUiPatrolHook({ isDevBuild: true, backendEnabled: false })).toBe(true)
    expect(shouldInstallUiPatrolHook({ isDevBuild: true, backendEnabled: true })).toBe(false)
    expect(shouldInstallUiPatrolHook({ isDevBuild: false, backendEnabled: false })).toBe(false)
    expect(shouldInstallUiPatrolHook({ isDevBuild: false, backendEnabled: true })).toBe(false)
  })

  it('今開いている教室の分だけを返す。教室が無い・ID が無いときは null', () => {
    const snapshot = makeClassrooms()
    const read = pickUiPatrolClassroom(snapshot, 'room-b')
    expect(read).not.toBeNull()
    expect(read?.classroomId).toBe('room-b')
    expect(read?.payload).toBe(snapshot.classrooms[1].data)
    expect(pickUiPatrolClassroom(snapshot, null)).toBeNull()
    expect(pickUiPatrolClassroom(snapshot, '')).toBeNull()
    expect(pickUiPatrolClassroom(snapshot, 'room-unknown')).toBeNull()
    expect(pickUiPatrolClassroom({ classrooms: [] }, 'room-a')).toBeNull()
  })

  it('取り付けと取り外し。別の物に置き換わっていたら消さない', () => {
    const target: Record<string, unknown> = {}
    const hook = makeHook()
    const uninstall = installUiPatrolHook(target, hook)
    expect(target[UI_PATROL_GLOBAL_KEY]).toBe(hook)
    uninstall()
    expect(target[UI_PATROL_GLOBAL_KEY]).toBeUndefined()
    expect(UI_PATROL_GLOBAL_KEY in target).toBe(false)

    // 再マウント等で新しい読み口が先に入った場合、古い方の取り外しで新しい方を消さない。
    const uninstallOld = installUiPatrolHook(target, makeHook())
    const replacement = makeHook()
    target[UI_PATROL_GLOBAL_KEY] = replacement
    uninstallOld()
    expect(target[UI_PATROL_GLOBAL_KEY]).toBe(replacement)
  })

  it('配線: App.tsx は import.meta.env.DEV の if の中でだけ取り付ける', () => {
    const occurrences = APP_TSX.split('installUiPatrolHook(').length - 1
    expect(occurrences).toBe(1)
    const index = APP_TSX.indexOf('installUiPatrolHook(')
    const before = APP_TSX.slice(Math.max(0, index - 600), index)
    expect(before).toContain('if (import.meta.env.DEV) {')
    expect(before).toContain('shouldInstallUiPatrolHook(')
  })

  it('配線: 読み口の名前を使うのは uiPatrolHook.ts と App.tsx だけ', () => {
    const users = listSourceFiles(SRC_DIR)
      .filter((file) => {
        const text = readFileSync(file, 'utf8')
        return text.includes('uiPatrolHook') || text.includes('__komahyouUiPatrol')
      })
      .map((file) => relative(SRC_DIR, file).split(sep).join('/'))
      .sort()
    expect(users).toEqual(['App.tsx', 'utils/uiPatrolHook.ts'])
  })
})
