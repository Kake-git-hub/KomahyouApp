// 週単位の分割保存(docs/spec-save-restore.md §9)の【書く形式の選択】= 機能フラグ `weeklySplitSnapshotStorage` のサーバー述語と、
// 古い画面からの保存の拒否(§9-7-3・CLIENT_TOO_OLD)。段階 B(2026-10-28)。
//
// ★フラグは**書く形式の選択にだけ**使う(§9-7-1)。読むのはフラグに関係なく両形式(readClassroomSnapshotPayload)。
//   クライアント側の featureRolloutRegistry.weeklySplitSnapshotStorage は台帳(developmentStatusLedger)と整合テストのための印で、
//   クライアントは「読んだ文書が分割形式かどうか」だけで振る舞う(フラグを見ない)。権威はこのサーバー述語。
// ★一方通行(§9-7-1): 分割形式になった教室はフラグ OFF でも旧形式へ戻さない。判定は resolveSnapshotWriteFormat が 1 か所で行う。
// ★段階: 開発用教室(v1.5.654・2026-10-28 に移行を確認) → **全教室**(オーナー指示 2026-10-28「staging は確認しなくていいので、問題なければ
//   本番環境へ全教室展開して」= §9-15 Q4 の staging・日大前校の段を省略)。BASE_SCOPE を 'all-classrooms' に上げた(v1.5.656)。
//   クライアントの featureRollout.ts の scope も同じ値(パリティテストが検出)。教室指定 WEEKLY_SPLIT_SNAPSHOT_CLASSROOM_ALLOWLIST は
//   「全教室より先に特定の教室だけ出す」ための段で、全教室展開後は空のまま残す(回帰で development-only / staging-environment へ戻さない:
//   戻すと新しく移る教室が止まるだけで、既に分割形式の教室は分割形式のまま=一方通行)。
import { isDevelopmentClassroomIdentity } from './developmentClassroomIdentity'
import { resolveCompanyFeatureDefault, resolveFeatureEnabledByLayers } from './generated/companyFeatureDefaults'

export const WEEKLY_SPLIT_SNAPSHOT_FEATURE_KEY = 'weeklySplitSnapshotStorage'
export const WEEKLY_SPLIT_SNAPSHOT_STAGING_PROJECT_ID = 'komahyouapp-staging'

/**
 * 基本スコープ(クライアント featureRollout.ts の scope と同じ語彙・同じ意味)。
 *  - 'staging-environment' … staging プロジェクトの全教室 ＋ どの環境でも登録済みの検証用教室(開発用・テスト教室)。
 *  - 'all-classrooms'      … 全教室。
 * 段階 B の開始時点(v1.5.654)は 'staging-environment'。2026-10-28 オーナー指示で 'all-classrooms' へ(v1.5.656)。
 */
export const WEEKLY_SPLIT_SNAPSHOT_BASE_SCOPE: 'staging-environment' | 'all-classrooms' = 'all-classrooms'

export type WeeklySplitSnapshotClassroomRef = { workspaceKey: string; classroomId: string; label: string }

/**
 * 「教室指定」の段(§9-13 本番の切り替え順の 3 番目 = 日大前校)。基本スコープに関係なく、この教室だけ分割形式で書く。
 * 足すときは同じ push で CHANGELOG・台帳 developmentStatusLedger・確認リストを更新し、室長へ「切り替え日に一度ハードリロード」を案内する(§9-7-3)。
 */
export const WEEKLY_SPLIT_SNAPSHOT_CLASSROOM_ALLOWLIST: readonly WeeklySplitSnapshotClassroomRef[] = [
  // 2026-10-28 段階 B 開始時点は空。同日オーナー指示で基本スコープを全教室へ上げたので、教室指定の段は使わなかった(空のまま)。
]

export type WeeklySplitSnapshotClassroomIdentity = {
  workspaceKey: string
  classroomId: string
  /** 実行中のプロジェクト ID(GCLOUD_PROJECT 等)。staging 判定に使う。不明なら null。 */
  projectId: string | null | undefined
}

/** 基本スコープの判定(純関数・環境を引数で受ける)。 */
export function isWeeklySplitSnapshotScopeEnabled(
  scope: typeof WEEKLY_SPLIT_SNAPSHOT_BASE_SCOPE,
  context: { isStaging: boolean; isDevelopmentClassroom: boolean; isAllowlisted: boolean },
): boolean {
  if (context.isAllowlisted) return true
  if (scope === 'all-classrooms') return true
  return context.isStaging || context.isDevelopmentClassroom
}

/**
 * この教室の**新しい保存**を分割形式で書くか(フラグ ON か)。2 段解決(基本スコープ → 会社既定)はクライアントの
 * isFeatureEnabledForClassroom と同じ resolveFeatureEnabledByLayers を使う(保護者ポータルと同じ作法)。
 * ★既に分割形式の教室はこの関数の結果に関係なく分割形式のまま(resolveSnapshotWriteFormat)。
 */
export function isWeeklySplitSnapshotStorageEnabledForClassroom(identity: WeeklySplitSnapshotClassroomIdentity): boolean {
  const workspaceKey = (identity.workspaceKey ?? '').trim()
  const classroomId = (identity.classroomId ?? '').trim()
  if (!workspaceKey || !classroomId) return false
  return resolveFeatureEnabledByLayers({
    scopeEnabled: isWeeklySplitSnapshotScopeEnabled(WEEKLY_SPLIT_SNAPSHOT_BASE_SCOPE, {
      isStaging: (identity.projectId ?? '').trim() === WEEKLY_SPLIT_SNAPSHOT_STAGING_PROJECT_ID,
      isDevelopmentClassroom: isDevelopmentClassroomIdentity({ workspaceKey, classroomId }),
      isAllowlisted: WEEKLY_SPLIT_SNAPSHOT_CLASSROOM_ALLOWLIST.some((entry) => entry.workspaceKey === workspaceKey && entry.classroomId === classroomId),
    }),
    companyDefault: resolveCompanyFeatureDefault(workspaceKey, WEEKLY_SPLIT_SNAPSHOT_FEATURE_KEY),
  })
}

export type SnapshotWriteFormat = 'legacy' | 'weekly-parts'

/**
 * 保存で書く形式(純関数)。
 *  - 前回の文書が分割形式の目次 → 'weekly-parts'(★一方通行: フラグ OFF でも旧形式へ戻さない・AC-27)。
 *  - それ以外(旧形式・文書なし) → フラグ ON なら 'weekly-parts'(この保存で移行)、OFF なら 'legacy'。
 */
export function resolveSnapshotWriteFormat(params: { previousIsPartsManifest: boolean; flagEnabled: boolean }): SnapshotWriteFormat {
  if (params.previousIsPartsManifest) return 'weekly-parts'
  return params.flagEnabled ? 'weekly-parts' : 'legacy'
}

// ---------------------------------------------------------------------------
// 古い画面からの保存の拒否(§9-7-3・AC-18・オーナー確定 Q2=A)
// ---------------------------------------------------------------------------

/**
 * 分割形式を読める最初の版(段階 A = v1.5.651)。これより古い版(または版を送らない)の画面は分割形式の教室を
 * 「空の教室」として表示してしまうため、その画面からの保存は分割形式で書く前に拒否する。
 * ★分割形式へ**移る保存**にも適用する(仕様 §9-7-3 の「分割形式の教室への保存」より広い・安全側): 古い画面が移行の保存を
 *   通してしまうと、その画面は自分が書いた教室を読み直せず、次の保存で空データ上書き拒否をすり抜けて教室を壊しうる。
 */
export const SNAPSHOT_PARTS_MIN_CLIENT_APP_VERSION = '1.5.651'

/** クライアント/サーバーで CLIENT_TOO_OLD を見分ける安定マーカー(STALE_SNAPSHOT と同じ作法・メッセージ先頭)。 */
export const CLIENT_TOO_OLD_ERROR_MARKER = 'CLIENT_TOO_OLD'

/** 'v1.5.651' / '1.5.651' / '1.5.651-dev' を [1, 5, 651] に。読めなければ null。 */
export function parseAppVersion(value: string | null | undefined): number[] | null {
  const text = (value ?? '').trim().replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(text)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** 左が右より古ければ負・同じなら 0・新しければ正。 */
export function compareAppVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * 分割形式で書く保存を受け付けてよい画面か。版が無い(旧クライアントは client を送らない)・読めない・段階 A より古い → false。
 */
export function isClientNewEnoughForSnapshotParts(appVersion: string | null | undefined, minVersion = SNAPSHOT_PARTS_MIN_CLIENT_APP_VERSION): boolean {
  const parsed = parseAppVersion(appVersion)
  const min = parseAppVersion(minVersion)
  if (!parsed || !min) return false
  return compareAppVersions(parsed, min) >= 0
}

/** 利用者に出す文言(旧版の画面には通常の失敗処理=JSON 自動退避＋再読み込みの案内が出る)。先頭にマーカー。 */
export function buildClientTooOldMessage(): string {
  return `${CLIENT_TOO_OLD_ERROR_MARKER}:お使いの画面が古いため、保存できませんでした。画面を再読み込み(Ctrl+Shift+R)してから、もう一度保存してください。`
}
