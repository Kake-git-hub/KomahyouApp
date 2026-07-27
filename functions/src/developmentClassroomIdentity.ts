// 検証用(サンドボックス)教室の判定(サーバー側)。
// クライアント側の src/utils/developmentClassroom.ts `isDevelopmentClassroom` と同一規則。
// **片方だけ変えない**(サーバーが許可しないとクライアントを解放しても機能しない/その逆も同じ)。
//
// 対象: 開発用教室 と テスト教室(オーナー確定 2026-07-28)。
// この判定は「他教室のバックアップをこの教室へ読み込む(Feature B)」のアクセス許可と、
// 読み込み元候補からサンドボックス教室自身を外すために使う。
export function isDevelopmentClassroomIdentity(id: string | null | undefined, name: string | null | undefined) {
  const normalizedId = (id ?? '').trim().toLowerCase()
  const normalizedName = (name ?? '').trim()
  return normalizedId === 'development'
    || normalizedId === 'dev'
    || normalizedId.includes('development')
    || normalizedId.startsWith('dev_')
    || normalizedName === '開発用教室'
    || normalizedName.includes('開発用教室')
    || normalizedName === 'テスト教室'
    || normalizedName.includes('テスト教室')
}
