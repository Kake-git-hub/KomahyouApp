// 15 分ごとの自動バックアップを**どの形式で書くか**の設定(docs/spec-save-restore.md §10-7・段階 2)。
//
// ★設定は**書く形式の選択にだけ**使う。読むのは設定に関係なく両形式(要約の layout で読み分ける・§10-5)。
// ★元に戻せる: 設定を legacy に戻せば次の回から旧形式で書く。両方の形式が混ざっても要約の layout で読み分けるので壊れない
//   (§9 の分割保存と違って一方通行にする理由は無い)。
//
// 既定はコードの定数 WORKSPACE_AUTO_BACKUP_DEFAULT_LAYOUT(2026-10-30 オーナー選択「A: Claude がコードで切り替え」: GitHub secret を触らずに
// commit → main → Functions の自動デプロイだけで切り替え・戻せるようにするため)。runtime env は上書き用(緊急に戻すときは secret 側でも戻せる):
//   WORKSPACE_AUTO_BACKUP_LAYOUT            … 全会社の既定を上書き。'legacy' または 'per-classroom-v1'。未設定・空 = コードの既定。
//   WORKSPACE_AUTO_BACKUP_LAYOUT_OVERRIDES  … 会社ごとの指定。'main=per-classroom-v1,demo=legacy' の形(空白は無視・空は無指定)。
// (functions/.env.<projectId>・CI は PROD_FUNCTIONS_ENV / staging は deploy-staging.yml が書く)
// 知らない値はコードの既定として扱い、警告を返す(打ち間違いで書けなくならないように・安全側)。
import { WORKSPACE_BACKUP_LAYOUT_LEGACY, WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM, type WorkspaceBackupLayout } from './generated/workspaceBackupLayout'

export const WORKSPACE_AUTO_BACKUP_LAYOUT_ENV = 'WORKSPACE_AUTO_BACKUP_LAYOUT'
export const WORKSPACE_AUTO_BACKUP_LAYOUT_OVERRIDES_ENV = 'WORKSPACE_AUTO_BACKUP_LAYOUT_OVERRIDES'

/**
 * コードの既定(env が無いときの書く形式)。
 *  - 2026-10-29 v1.5.662: 'legacy'(段階 0〜2 のコードを出した時点ではまだ旧形式)。
 *  - 2026-10-30 v1.5.663: **'per-classroom-v1'**(オーナー選択 A・staging 省略・本番 main の 4 教室を同時に切り替え)。
 * 戻すときはここを 'legacy' に戻して main へ(次の回から旧形式。両形式が混ざっても要約の layout で読み分ける・§10-7)。
 */
export const WORKSPACE_AUTO_BACKUP_DEFAULT_LAYOUT: WorkspaceBackupLayout = WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM

export type WorkspaceAutoBackupLayoutConfig = {
  defaultLayout: WorkspaceBackupLayout
  overrides: ReadonlyMap<string, WorkspaceBackupLayout>
  /** 無視した値(ログに出す)。 */
  warnings: string[]
}

/** env の値を形式にする。空 = 指定なし(null ではなく undefined)・知らない値 = null。 */
function parseLayoutValue(raw: string | undefined): WorkspaceBackupLayout | null | undefined {
  const value = (raw ?? '').trim()
  if (value === '') return undefined
  if (value === WORKSPACE_BACKUP_LAYOUT_LEGACY) return WORKSPACE_BACKUP_LAYOUT_LEGACY
  if (value === WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM) return WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM
  return null
}

/** env を読んで設定にする(純関数・env は引数で受ける)。 */
export function parseWorkspaceAutoBackupLayoutConfig(env: Record<string, string | undefined>): WorkspaceAutoBackupLayoutConfig {
  const warnings: string[] = []
  const defaultRaw = env[WORKSPACE_AUTO_BACKUP_LAYOUT_ENV]
  let defaultLayout = parseLayoutValue(defaultRaw) ?? WORKSPACE_AUTO_BACKUP_DEFAULT_LAYOUT
  if (parseLayoutValue(defaultRaw) === null) {
    warnings.push(`${WORKSPACE_AUTO_BACKUP_LAYOUT_ENV}=${String(defaultRaw)} は知らない値のためコードの既定(${WORKSPACE_AUTO_BACKUP_DEFAULT_LAYOUT})として扱います`)
    defaultLayout = WORKSPACE_AUTO_BACKUP_DEFAULT_LAYOUT
  }
  const overrides = new Map<string, WorkspaceBackupLayout>()
  const overridesRaw = (env[WORKSPACE_AUTO_BACKUP_LAYOUT_OVERRIDES_ENV] ?? '').trim()
  if (overridesRaw) {
    for (const entry of overridesRaw.split(',')) {
      const trimmed = entry.trim()
      if (!trimmed) continue
      const separator = trimmed.indexOf('=')
      if (separator <= 0) {
        warnings.push(`${WORKSPACE_AUTO_BACKUP_LAYOUT_OVERRIDES_ENV} の "${trimmed}" は key=layout の形でないため無視します`)
        continue
      }
      const workspaceKey = trimmed.slice(0, separator).trim()
      const layout = parseLayoutValue(trimmed.slice(separator + 1))
      if (!workspaceKey || layout === null || layout === undefined) {
        warnings.push(`${WORKSPACE_AUTO_BACKUP_LAYOUT_OVERRIDES_ENV} の "${trimmed}" は知らない値のため無視します`)
        continue
      }
      overrides.set(workspaceKey, layout)
    }
  }
  return { defaultLayout, overrides, warnings }
}

/** この会社(workspace)の 15 分ごとのバックアップを書く形式。会社指定 → 既定の順。 */
export function resolveWorkspaceAutoBackupLayout(workspaceKey: string, config: WorkspaceAutoBackupLayoutConfig): WorkspaceBackupLayout {
  return config.overrides.get(workspaceKey) ?? config.defaultLayout
}

/** 復元用ダウンロードの目的(§10-5・Q8)。'local-sync'(開発者のローカル同期フォルダ)では復元前の控えを書かない。それ以外・未指定(古い画面)は 'restore'(控えを書く・BK-7)。 */
export type ServerAutoBackupDownloadPurpose = 'restore' | 'local-sync'

export function readBackupDownloadPurpose(value: unknown): ServerAutoBackupDownloadPurpose {
  return value === 'local-sync' ? 'local-sync' : 'restore'
}
