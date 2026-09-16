import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// 【2026-09-16 回帰防止・src 全体を走査】検証用(開発用・サンドボックス)教室の判定は
// 登録台帳 src/utils/developmentClassroomRegistry.ts の **(workspaceKey, 教室ID)** だけを見る。
// したがって `isDevelopmentClassroom(...)` / `isFeatureEnabledForClassroom(...)` の呼び出しは
// **必ず教室ID を持つ識別子**を渡さなければならない。`{ name: classroomName }` のように名前だけを
// 渡す旧形が 1 か所でも残ると、その画面の development-only 機能が開発用教室でも丸ごと無効になる
// (講習履歴ボタンが出ない・盤面ベース予定数が旧方式に戻る・AI 即答の表示が出ない)。
//
// ★型でも落ちる(DevelopmentClassroomIdentity から name を削除済み)が、型は
//   「`{ id: 何か }` の *何か* が教室IDでない」までは見てくれない。既存の 2 ファイル限定の字面テスト
//   (ScheduleBoardScreen.featureFlags.wiring.test.ts)は**新しいファイルで増えた呼び出しを見逃す**ため、
//   ここで src 全体を走査して「呼び出しは必ず id を含む」を固定する(兄弟テスト)。
// ★App.tsx は CRLF なので、読み取り時に改行を正規化してから走査する。

const SRC_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

const TARGET_FUNCTIONS = ['isDevelopmentClassroom', 'isFeatureEnabledForClassroom'] as const

// 教室の識別子が何番目の引数か(0 始まり)。
const CLASSROOM_ARGUMENT_INDEX: Record<(typeof TARGET_FUNCTIONS)[number], number> = {
  isDevelopmentClassroom: 0,
  isFeatureEnabledForClassroom: 1,
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full))
      continue
    }
    if (!/\.tsx?$/u.test(entry.name)) continue
    if (/\.test\.tsx?$/u.test(entry.name)) continue // テストは対象外(意図的に異常値を渡すため)
    files.push(full)
  }
  return files
}

/** 括弧の対応を数えて 1 回の呼び出しの引数リスト(文字列)を切り出す。文字列リテラル中の括弧は無視する。 */
function splitCallArguments(source: string, openParenIndex: number): string[] | null {
  let depth = 0
  let quote: string | null = null
  const args: string[] = []
  let current = ''
  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index]!
    if (quote) {
      current += char
      if (char === quote && source[index - 1] !== '\\') quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1
      if (depth === 1) continue // 呼び出しの開き括弧そのものは捨てる
      current += char
      continue
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1
      if (depth === 0) {
        args.push(current)
        return args
      }
      current += char
      continue
    }
    if (char === ',' && depth === 1) {
      args.push(current)
      current = ''
      continue
    }
    current += char
  }
  return null
}

type CallSite = { file: string; functionName: string; classroomArgument: string; text: string }

function collectCallSites(): CallSite[] {
  const sites: CallSite[] = []
  for (const file of listSourceFiles(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8').replace(/\r\n/gu, '\n')
    for (const functionName of TARGET_FUNCTIONS) {
      const pattern = new RegExp(`\\b${functionName}\\(`, 'gu')
      let match = pattern.exec(source)
      while (match) {
        const openParenIndex = match.index + match[0].length - 1
        // 宣言(`export function isDevelopmentClassroom(`)は呼び出しではないので飛ばす。
        if (/\bfunction\s+$/u.test(source.slice(Math.max(0, match.index - 20), match.index))) {
          match = pattern.exec(source)
          continue
        }
        const args = splitCallArguments(source, openParenIndex)
        if (args) {
          const argumentIndex = CLASSROOM_ARGUMENT_INDEX[functionName]
          sites.push({
            file: relative(SRC_ROOT, file).replace(/\\/gu, '/'),
            functionName,
            classroomArgument: (args[argumentIndex] ?? '').trim(),
            text: source.slice(match.index, openParenIndex + 1) + args.join(',') + ')',
          })
        }
        match = pattern.exec(source)
      }
    }
  }
  return sites
}

describe('検証用教室の判定は必ず教室ID を渡す(src 全体の呼び出し走査・2026-09-16)', () => {
  const callSites = collectCallSites()

  it('走査自体が機能している(呼び出しを見つけられている)', () => {
    // 呼び出しが激減したら走査が壊れたか、機能フラグの配線が消えた合図。どちらも見逃さない。
    expect(callSites.length).toBeGreaterThanOrEqual(15)
    const files = new Set(callSites.map((site) => site.file))
    expect(files.has('App.tsx')).toBe(true) // CRLF ファイルも走査できている
    expect(files.has('components/schedule-board/ScheduleBoardScreen.tsx')).toBe(true)
    expect(files.has('utils/scheduleHtml.ts')).toBe(true)
  })

  it('どの呼び出しも教室ID を渡している(オブジェクトリテラルなら id: を含む)', () => {
    for (const site of callSites) {
      const label = `${site.file}: ${site.text}`
      const argument = site.classroomArgument
      expect(argument, label).not.toBe('')
      if (argument.startsWith('{')) {
        // リテラルを直接渡す形は id を必須にする(型でも落ちるが、ここは「id という名前で渡す」ことの固定)。
        expect(argument, label).toMatch(/\bid\s*[:,}]/u)
      } else {
        // 変数・プロパティ参照(App.tsx の actingClassroom など)は教室オブジェクトごと渡す形。
        expect(argument, label).toMatch(/^[A-Za-z_$][\w$]*(\?\.|\.)?[\w$.?]*$/u)
      }
    }
  })

  it('教室名だけを渡す旧形(name: ... のみ)が 1 つも残っていない', () => {
    for (const site of callSites) {
      const label = `${site.file}: ${site.text}`
      expect(site.classroomArgument, label).not.toMatch(/^\{\s*name\s*[:,}]/u)
      expect(site.classroomArgument, label).not.toMatch(/^classroomName\b/u)
    }
  })
})
