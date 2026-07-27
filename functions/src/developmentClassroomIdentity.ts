// 検証用(サンドボックス)教室として明示的に許可する【教室ID】(サーバー側)。
// クライアント src/utils/developmentClassroom.ts の SANDBOX_CLASSROOM_IDS と**必ず同じ内容**にする。
// オーナー指示 2026-07-28: 教室名での判定は不安なので ID で固定する(教室名を変えても揺れない)。
//  - test_classroom_20260507_dai = テスト教室(管理者 石川 / dai.in.the.mood@gmail.com /
//    UID 6HptuGOIqHcuEAqlXxZFb7Nv3Yu1。workspaces/main/members から確認済み)
// ID は大文字小文字を区別する Firestore のドキュメントIDなので、正規化せず完全一致で比べる。
export const SANDBOX_CLASSROOM_IDS: readonly string[] = ['test_classroom_20260507_dai']

// 検証用(サンドボックス)教室の判定(サーバー側)。
// クライアント側の `isDevelopmentClassroom` と同一規則。
// **片方だけ変えない**(サーバーが許可しないとクライアントを解放しても機能しない/その逆も同じ)。
//
// 対象: 開発用教室 と 上の ID 許可リストの教室(テスト教室)。
// この判定は「他教室のバックアップをこの教室へ読み込む(Feature B)」のアクセス許可と、
// 読み込み元候補からサンドボックス教室自身を外すために使う。
export function isDevelopmentClassroomIdentity(id: string | null | undefined, name: string | null | undefined) {
  const rawId = (id ?? '').trim()
  const normalizedId = rawId.toLowerCase()
  const normalizedName = (name ?? '').trim()
  return SANDBOX_CLASSROOM_IDS.includes(rawId)
    || normalizedId === 'development'
    || normalizedId === 'dev'
    || normalizedId.includes('development')
    || normalizedId.startsWith('dev_')
    || normalizedName === '開発用教室'
    || normalizedName.includes('開発用教室')
}
