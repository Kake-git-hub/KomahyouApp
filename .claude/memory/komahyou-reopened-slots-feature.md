---
name: komahyou-reopened-slots-feature
description: 不可コマ「後から出席可能に変更」(黄色コマ・reopenedSlots)の確定仕様と実装・リリース状態(2026-07-18)
metadata: 
  node_type: memory
  type: project
  originSessionId: 223a89f4-869a-42c2-a7b3-d0266cfcd41a
---

# 不可コマの「後から出席可能に変更」(黄色コマ・reopenedSlots)

講師K の LINE 要望(2026-07-18合意)。正本は `docs/spec-special-session-submission.md` §C-1b。
ブランチ `feature/reopened-unavailable-slots`(734116f)。

## 確定仕様(オーナー回答 2026-07-18・AskUserQuestion)
- **確認ダイアログあり**(生徒=配置/移動/入替/手動追加/日程表D&Dの5経路で不可コマ着地時。D&Dは別タブ側confirm+`reopenApproved`二重ゲート)
- **講師はシンプルに講師日程表の不可(グレー)セルクリック→確認→黄色化**(提出済み講師のみ・配置連動なし)
- **完全に可能コマ扱い**(赤警告消去+自動割振/講師自動配置の候補化+○×記号は○)
- **既存の不可コマ上の配置は自動変換しない**(新規操作のみ)
- 登録解除でも黄色キープ(doc配布情報・resetでクリアしない)・QR新規再提出でリセット・戻す操作なし(ラチェット)・色は暫定 #f9e79f

## 実装の要(巻き戻すな)
- 実効不可= `resolveEffectiveUnavailableSlots`(unavailableSlots−reopenedSlots)へ**一元化**。警告/自動割振/○×/在庫pending/埋め込みJSが共有。unavailableSlots直読みへ戻すと黄色コマに赤警告が出続ける回帰
- 提出データ `unavailableSlots` は**不変**(INV-07)。reopenedSlotsは上書きレイヤで、適用点はApp.tsxの `applyReopenedSlotConversions` 1箇所(ラチェット純関数 `appendReopenedSlots`・冪等)
- 埋め込みJS内の文字列 `\n` は `\\n` エスケープ必須(new Function構文テストが検知・今回も1回踏んだ)
- ⚠️監視点(regression-reviewer): `collectStudentMoveLandingPlacements` は着地を computeStudentMove と**独立に再導出**。computeStudentMoveのswap意味論を変えるときは必ず両方見直す(6793374型ドリフト候補)

## リリース状態
- ✅ **v1.5.449 で本番反映済み(2026-07-18)**。Hosting=version.json 1.5.449確認・Functionsも `lectureSubmissionApi` の Successful update をログで確認(409なし)。全814ユニット緑・regression-reviewer「マージ可」・inv-guard合格(matrix無改変)
- **staging実機確認で1件検出→修正済み**: 別タブ日程表の**ローカル明示再構築4関数**(updateUnavailableSlotsLocally/updateStudentCountLocally/updateTeacherUnavailableSlotsLocally/updateTeacherCountLocally)がreopenedSlotsを落とし、講師の登録解除の瞬間に黄色が剥がれた(v1.5.318型保全漏れの兄弟)。生徒側は盤面自動同期のechoで偶然復活して見えるだけで同じ穴だった。**タブ内ローカル再構築に項目を足すときは4関数対称に**(文字列アサートの回帰テストあり)
- 既存の不可コマ上の配置(リリース前の赤警告配置)は自動変換されない=黄色にするには置き直しが必要(オーナー確定・講師Kの7月分は教室で置き直し)
- テスト補強候補(次サイクル): App.tsxハンドラのreopenedSlots保全の純関数化テスト/executeScheduleViewMoveの未承認ゲート分岐/QR購読反映のリセット

## 検証環境の教訓
- staging ログインはオーナーのみ(パスワードはコンソール設定・Claudeは入力不可)。Claudeの実機検証は dev-local(localモード・port5199・仮ログイン)だが、**プレビューペインで「生徒日程」(別タブ生成HTML・巨大document.write)を開くとペインが固まり復旧不能**になった。別タブ日程表の実機検証はオーナー実機で行う
