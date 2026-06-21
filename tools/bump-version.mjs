import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// デプロイのたびに package.json の patch バージョンを1つ上げる。
// 例: 1.5.311 -> 1.5.312。dist/version.json は build 時に package.json から生成される。
function bumpPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/u.exec(version ?? '')
  if (!match) {
    throw new Error(`package.json の version 形式が想定外です: ${version}`)
  }
  const [, major, minor, patch, suffix] = match
  return `${major}.${minor}.${Number(patch) + 1}${suffix}`
}

function main() {
  const pkgPath = resolve('package.json')
  const raw = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(raw)
  const nextVersion = bumpPatchVersion(pkg.version)
  pkg.version = nextVersion
  // 末尾改行を維持して差分を最小化する。
  const hasTrailingNewline = raw.endsWith('\n')
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}${hasTrailingNewline ? '\n' : ''}`, 'utf8')
  console.log(`Bumped version to ${nextVersion}`)
}

main()
