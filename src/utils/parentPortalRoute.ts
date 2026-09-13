// 保護者向け固定QR の公開ページ経路(docs/spec-parent-portal.md §C)。
// `/p/{token}`(本番・短縮)と `#/parent/{token}`(ローカル開発)を判定し、トークンだけを取り出す。
// src/main.tsx がこれで分岐し、App 本体(認証・Firestore 購読)を読み込まない軽量経路へ流す。
// 組み立て側は src/utils/scheduleQrConfig.ts buildParentPortalUrl(こちらと対で保つ・往復テストあり)。
// 講習提出の `/s/{token}` / `#/submit/{token}` とはプレフィックスで用途を分け、ここでは決して拾わない(§K-6 取り違え防止)。

// トークンの文字集合と長さ。サーバー発行は base64url 32 文字(randomBytes(24))だが、
// 講習提出の経路正規表現(main.tsx)と同じ 16〜64 を許容し、サーバー側 PARENT_PORTAL_TOKEN_PATTERN と一致させる。
export const PARENT_PORTAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

// 経路は前後を固定(anchored)。`/p/{token}/extra` や `/p/{token}/` のような余分は拾わない
// (URL の末尾に付いたゴミで別トークン扱いになったり、意図しないページに到達したりしないようにする)。
const HASH_ROUTE_PATTERN = /^#\/parent\/([A-Za-z0-9_-]{16,64})$/
const PATH_ROUTE_PATTERN = /^\/p\/([A-Za-z0-9_-]{16,64})$/

// ハッシュ経路を先に見る(ローカル開発では pathname が '/' のまま hash で切り替えるため)。
// 見つからなければ短縮パス。どちらにも一致しなければ null(通常の App 起動へ)。
export function extractParentPortalToken(pathname: string, hash: string): string | null {
  const hashMatch = (hash ?? '').match(HASH_ROUTE_PATTERN)
  if (hashMatch?.[1] && PARENT_PORTAL_TOKEN_PATTERN.test(hashMatch[1])) return hashMatch[1]
  const pathMatch = (pathname ?? '').match(PATH_ROUTE_PATTERN)
  if (pathMatch?.[1] && PARENT_PORTAL_TOKEN_PATTERN.test(pathMatch[1])) return pathMatch[1]
  return null
}
