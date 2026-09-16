// GENERATED FROM src/utils/developmentClassroomRegistry.ts — 手で編集しない。npm --prefix functions run sync-shared で再生成。
// 検証用(開発用・サンドボックス)教室の【登録台帳】= この 1 ファイルが唯一の正本。
// 正本仕様: docs/spec-multi-tenant.md / 計画 docs/plan-2026-09-15-multi-company-architecture.md §6-2・§6-3。
//
// ★なぜ台帳にしたか(オーナー確定 2026-09-16)
//   旧実装は「教室名が『開発用教室』」「教室ID に dev/development を含む」という**曖昧一致**で判定していた。
//   複数会社(workspace)へ広げると、他社が同じ名前の教室を作っただけで検証用教室の特権
//   (他教室バックアップの読み込み = Feature B・先行機能の解放)が付いてしまう。
//   そこで判定を **(workspaceKey, classroomId) の完全一致**へ変え、登録した教室だけを検証用とする。
//   会社(workspace)の壁も同時に張る: 同じ classroomId でも別会社なら false。
//
// ★このファイルの制約(必ず守る)
//   - **自己完結**(import 文 0 行・ビルド時メタ情報の参照・CommonJS の読み込み関数すべて禁止)。functions/scripts/sync-shared.mjs が
//     functions/src/generated/developmentClassroomRegistry.ts へそのまま複製するため、複製先で解決できない
//     依存を書くと sync-shared が失敗する(= ビルドで気づける)。
//   - クライアントとサーバーの二重実装は禁止。サーバー側 functions/src/developmentClassroomIdentity.ts は
//     生成物を読むだけの薄いラッパで、ズレは functions/src/developmentClassroomRegistry.parity.test.ts が検出する。
//   - classroomId は Firestore のドキュメントIDなので **大文字小文字を区別し完全一致**で比べる
//     (前後の空白だけ落とす)。前方一致・部分一致は入れない(2026-07-28 オーナー指示「名前判定じゃ不安」の延長)。
//
// ★教室を足すとき
//   ここへ 1 行足すだけでよい(クライアント・サーバーの両方に効く)。足したら
//   `npm --prefix functions run sync-shared` を実行して生成物もコミットする。

/** development = その会社の開発用教室(1 会社 1 教室) / sandbox = 追加の検証用教室(テスト教室など)。 */
export type DevelopmentClassroomKind = 'development' | 'sandbox'

export type DevelopmentClassroomRegistryEntry = {
  /** 会社 = workspace のキー(`workspaces/{workspaceKey}`)。 */
  workspaceKey: string
  /** Firestore ドキュメントID(大文字小文字を区別・完全一致)。 */
  classroomId: string
  kind: DevelopmentClassroomKind
  /** 人間向けメモ(判定には使わない)。 */
  label: string
}

// 登録済みの検証用教室。**ここに無い教室は、名前が何であっても検証用教室ではない**。
export const DEVELOPMENT_CLASSROOM_REGISTRY: readonly DevelopmentClassroomRegistryEntry[] = [
  // 既存運営会社(workspaces/main)の開発用教室。本番 Firestore で書き込みが許される唯一の教室(CLAUDE.md)。
  { workspaceKey: 'main', classroomId: 'v8OZ7zH8vONNHjjYVcR1', kind: 'development', label: '既存運営会社の開発用教室' },
  // テスト教室(管理者 石川 / dai.in.the.mood@gmail.com / UID 6HptuGOIqHcuEAqlXxZFb7Nv3Yu1)。
  // オーナー確定 2026-07-28: 手動テスト手順書をこの教室で回すため、検証用教室に含める(commit 020cd46)。
  { workspaceKey: 'main', classroomId: 'test_classroom_20260507_dai', kind: 'sandbox', label: 'テスト教室(石川・2026-07-28 オーナー確定)' },
]

function normalizeKey(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 登録台帳から (workspaceKey, classroomId) の完全一致で 1 件引く。無ければ null。 */
export function findDevelopmentClassroomEntry(
  workspaceKey: string | null | undefined,
  classroomId: string | null | undefined,
): DevelopmentClassroomRegistryEntry | null {
  const ws = normalizeKey(workspaceKey)
  const id = normalizeKey(classroomId)
  if (!ws || !id) return null
  return DEVELOPMENT_CLASSROOM_REGISTRY.find((entry) => entry.workspaceKey === ws && entry.classroomId === id) ?? null
}

/**
 * その教室が検証用(開発用・サンドボックス)教室か。kind は問わない
 * (= 旧 `isDevelopmentClassroom` / `isDevelopmentClassroomIdentity` の意味「検証用教室」)。
 * 未登録・別会社・空文字はすべて false(fail-closed)。
 */
export function isRegisteredDevelopmentClassroom(
  workspaceKey: string | null | undefined,
  classroomId: string | null | undefined,
): boolean {
  return findDevelopmentClassroomEntry(workspaceKey, classroomId) !== null
}

/**
 * その会社の「開発用教室」(kind === 'development')の教室ID。未登録の会社は null。
 * 1 会社 1 教室(重複はテスト developmentClassroomRegistry.test.ts が禁止する)。
 */
export function resolveDevelopmentClassroomId(workspaceKey: string | null | undefined): string | null {
  const ws = normalizeKey(workspaceKey)
  if (!ws) return null
  return DEVELOPMENT_CLASSROOM_REGISTRY.find((entry) => entry.workspaceKey === ws && entry.kind === 'development')?.classroomId ?? null
}
