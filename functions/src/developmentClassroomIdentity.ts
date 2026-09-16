// 検証用(開発用・サンドボックス)教室の判定(サーバー側)。
//
// ★実装は持たない。正本は **クライアント側の登録台帳** `src/utils/developmentClassroomRegistry.ts` で、
//   functions/scripts/sync-shared.mjs がビルド前に ./generated/developmentClassroomRegistry.ts へ複製する。
//   このファイルはその生成物へ委譲するだけの薄いラッパ(サーバーに二度目の規則を書かない)。
//   ズレは developmentClassroomRegistry.parity.test.ts が検出する。
//
// ★2026-09-16 の是正(docs/spec-multi-tenant.md・計画 §6-2/§6-3)
//   旧実装は教室名「開発用教室」や ID の dev/development 曖昧一致で判定していた。複数会社(workspace)に
//   広げると他社が同名教室を作るだけで検証用教室の特権(Feature B・先行機能)が付くため、
//   **(workspaceKey, classroomId) の完全一致**へ変更した。呼び出し側は必ず workspaceKey を渡す。
//   オーナー指示 2026-07-28「名前判定じゃ不安・ID で固定する」(commit 020cd46)の延長で、
//   テスト教室 test_classroom_20260507_dai も台帳に登録済み。
//
// この判定の用途:
//  - 「他教室のバックアップをこの教室へ読み込む(Feature B)」のアクセス許可と、読み込み元候補からの自教室除外
//  - 開発用教室限定の機能(確認リストの通知抑止・質問への AI 即時回答・保護者ポータル第1段)
// クライアント側の混入防止ガード(自教室が発行していないトークンを剥がす)と**必ずセット**で効かせる
// (片方だけ広げると 2026-07-09 のQR混入事故が再発する)。
import { isRegisteredDevelopmentClassroom, resolveDevelopmentClassroomId } from './generated/developmentClassroomRegistry'

/**
 * 判定に渡す識別情報。**名前付き引数(オブジェクト)**にしてある(2026-09-16 レビュー指摘の是正)。
 *
 * ★なぜオブジェクトか(回帰防止): 旧シグネチャは `(workspaceKey: string, id: string)` の同型 2 引数で、
 *   呼び出し側が順序を取り違えても**型エラーにならず静かに false** を返した(＝検証用教室の特権・
 *   開発用教室限定機能・保護者ポータルが理由不明のまま無効になり、原因追跡が難しい)。
 *   キー名を必須にして、取り違えをコンパイル時に落とす。位置引数へ戻さない。
 */
export type DevelopmentClassroomLookup = {
  /** 会社 = workspace のキー(`workspaces/{workspaceKey}`)。 */
  workspaceKey: string | null | undefined
  /** Firestore の教室ドキュメントID。 */
  classroomId: string | null | undefined
}

/** その会社(workspaceKey)で登録済みの検証用教室か。未登録・別会社・空文字は false(fail-closed)。 */
export function isDevelopmentClassroomIdentity({ workspaceKey, classroomId }: DevelopmentClassroomLookup): boolean {
  return isRegisteredDevelopmentClassroom(workspaceKey, classroomId)
}

/** その会社の「開発用教室」の教室ID(kind='development')。未登録の会社は null。 */
export { resolveDevelopmentClassroomId }
