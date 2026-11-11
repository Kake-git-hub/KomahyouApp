// 画面の自動巡回 --baseline-ref: 変更前のアプリ(git の ref の時点のコード)を、今の作業ツリーに触れずに用意する。
// 流れ: ref を解決 → 依存(package-lock.json)が今と同じか → 巡回の読み口(src/utils/uiPatrolHook.ts)があるか → `git archive` を
// <out>/baseline-app へ展開 → node_modules はリポジトリのものへのリンク → 追跡されていない .env 系の設定を複製。
// ★作業ツリー・index・ブランチ・stash・worktree には触らない(git archive は読むだけ。git stash / checkout / worktree は使わない)。
//   手で git stash して流し直す手順は戻し忘れの元だった(それをなくすための道具)。
// ★断るとき(BaselineRefusal)は展開先を残さない。呼び出し側(tools/ui-patrol.mjs)が終了コード 2 と文にする。
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_BUFFER = 512 * 1024 * 1024
/** 展開先の名前(<out>/baseline-app)。 */
export const BASELINE_APP_DIRNAME = 'baseline-app'
/** 今のアプリと同じ設定で動かすため複製する、追跡されていない .env 系のファイル(vite が読む物のうち開発用サーバーで効くもの)。 */
const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local']

/** 「その ref のアプリを用意できない」断り。文はそのまま利用者に見せる(分かる文で)。 */
export class BaselineRefusal extends Error {
  constructor(message) {
    super(message)
    this.name = 'BaselineRefusal'
  }
}

async function git(repoRoot, args, { buffer = false } = {}) {
  const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, maxBuffer: MAX_BUFFER, encoding: buffer ? 'buffer' : 'utf8', windowsHide: true })
  return stdout
}

/** git の ref を完全なコミット ID にする。解決できなければ BaselineRefusal。 */
async function resolveRef(repoRoot, ref) {
  // 先頭が - の値は git のオプションに読まれる(validateArgs でも断るが、ここでも守る)。
  if (!ref || ref.startsWith('-')) throw new BaselineRefusal(`--baseline-ref の ref を解決できません: ${ref}`)
  try {
    return String(await git(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim()
  } catch {
    throw new BaselineRefusal(`--baseline-ref の ref を解決できません: ${ref}(ブランチ名・タグ・コミットを指定してください)`)
  }
}

async function showFile(repoRoot, sha, file) {
  try {
    return await git(repoRoot, ['show', `${sha}:${file}`], { buffer: true })
  } catch {
    return null
  }
}

/**
 * ref のアプリを <outDir>/baseline-app に用意する。戻り値 { appDir, cleanup }(cleanup は何度呼んでもよい)。
 * 断る(BaselineRefusal): ref が解決できない／ref の package-lock.json が今の作業ツリーと違う(依存が違うので node_modules を共有できない)／
 * ref に src/utils/uiPatrolHook.ts が無い(巡回の読み口が入る v1.5.718 より前の版)。
 */
export async function prepareBaselineApp({ repoRoot, ref, outDir: outDirInput }) {
  // git(cwd=repoRoot)と Node(cwd=呼び出し側)で相対 path の基準が違うので、最初に絶対 path にする(tar がリポジトリ側に書かれ、片づけが届かなくなるのを防ぐ)。
  const outDir = path.resolve(outDirInput)
  const sha = await resolveRef(repoRoot, ref)
  const refLock = await showFile(repoRoot, sha, 'package-lock.json')
  const nowLockFile = path.join(repoRoot, 'package-lock.json')
  const nowLock = existsSync(nowLockFile) ? readFileSync(nowLockFile) : null
  if (!refLock || !nowLock || !refLock.equals(nowLock)) {
    throw new BaselineRefusal(`--baseline-ref ${ref} の package-lock.json が今の作業ツリーと違うので、自動では比べられません(依存が違うと node_modules を共有できません)。`)
  }
  if (!(await showFile(repoRoot, sha, 'src/utils/uiPatrolHook.ts'))) {
    throw new BaselineRefusal(`--baseline-ref ${ref} には巡回の読み口 src/utils/uiPatrolHook.ts がありません(v1.5.718 より前の版)ので、比べられません。`)
  }
  const appDir = path.join(outDir, BASELINE_APP_DIRNAME)
  const tarFile = path.join(outDir, `${BASELINE_APP_DIRNAME}.tar`)
  const cleanup = async () => {
    // node_modules はリンクなので先にリンクだけ外す(リンク先のリポジトリの実物を消さないため)。
    rmSync(path.join(appDir, 'node_modules'), { recursive: false, force: true })
    rmSync(appDir, { recursive: true, force: true })
    rmSync(tarFile, { force: true })
  }
  try {
    await cleanup() // 前回の残り
    mkdirSync(appDir, { recursive: true })
    await git(repoRoot, ['archive', '--format=tar', '-o', tarFile, sha])
    await execFileAsync('tar', ['-xf', tarFile, '-C', appDir], { windowsHide: true })
    rmSync(tarFile, { force: true })
    // 'junction' は Windows でも管理者権限なしで張れるディレクトリのリンク(POSIX では無視される)。
    symlinkSync(realpathSync(path.join(repoRoot, 'node_modules')), path.join(appDir, 'node_modules'), 'junction')
    for (const name of ENV_FILES) {
      if (existsSync(path.join(repoRoot, name))) copyFileSync(path.join(repoRoot, name), path.join(appDir, name))
    }
  } catch (error) {
    await cleanup()
    if (error instanceof BaselineRefusal) throw error
    throw new Error(`--baseline-ref ${ref} のアプリを展開できませんでした(${error instanceof Error ? error.message.split('\n')[0] : String(error)})。`)
  }
  return { appDir, cleanup }
}
