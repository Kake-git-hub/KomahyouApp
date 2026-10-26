---
name: komahyou-handoff-restore-720
description: 【実行待ち引き継ぎ】7/20休日振替を4名分だけ未消化振替へ復帰させる一時ボタンの実装→本番デプロイ→室長がクリック→機能削除、の手順（メカニズム検証済み）
metadata: 
  node_type: memory
  type: project
  originSessionId: fb7ebdf1-1563-42c4-9c7e-5d66561a1bf6
---

# 引き継ぎ: 7/20 休日振替の一時復帰ボタン（新規セッションで実行）

**状態(完了 2026-07-03): 全工程完了。実装(v1.5.366)→室長が緑が丘・日大前でクリック&手動保存→本番反映を読み取り確認(4キーとも manual に7/20あり・suppressed から除去済み)→一時機能を撤去(v1.5.367 デプロイ済)。ボタン/ハンドラ/import/restore720Holiday.ts/.test.ts は削除済み。撤去はコード削除のみでデータ非干渉のため7/20は在庫に残存。以後この引き継ぎタスクは不要(記録として保持)。**
実装当時の設計: 純粋ロジックとキー定義を新規 `restore720Holiday.ts` に分離、未消化振替パネル(`data-testid="makeup-stock-panel"`)に対象教室(classroomStorageKey=actingClassroomId)限定でボタン表示、保存は既存 `commitWeeks`、回帰テストは両手順必須/冪等/非対象不変/教室ゲート。live実データで各キー+1・他生徒不変を出荷前検証。

--- 以下は着手時の設計メモ(記録として保持) ---
**当初状態: 実装未着手。メカニズムは実データで検証済み(2026-07-03)。** 実装時 main は v1.5.365。

## 目的
テンプレ凍結で在庫計算から漏れた「7/20(海の日)の休日振替」を、**対象4名だけ**未消化振替として復帰させる。オーナーが**室長アカウントでボタンを1クリック**するだけで載るようにし、実行後に機能を削除する。

## 真因（なぜ通常手段が効かないか・再調査不要）
- makeup在庫(`buildMakeupStockEntries`)は現行 `regularLessons` だけで origin 計算。対象生徒の行は **start=2026-08-31(templateFreezeBeforeDate)** なので、凍結前の7/20は origin 未生成(autoShortage=0)。
- ∴ **抑制解除だけでは+0**（検証済み・その機能は破棄済み）。手動追加(振替)は makeupSourceDate 未設定で日程表に「元:7/20」が出ない。
- schedule表示は `buildCombinedRegularLessonsFromHistory` で凍結前も補うが makeup在庫は履歴合成しない。在庫を履歴合成化すると全生徒の凍結前振替が大量復活=数量激変で危険。だから**対象4名だけをピンポイントで復帰**する。

## 確定メカニズム（実データ検証済み・これを実装する）
各対象キー `studentKey__subject` に対し**両方**を行う（片方だけは抑制で+0）:
1. `manualMakeupAdjustments[key]` に `{ dateKey: '2026-07-20' }` を追加（既にあれば追加しない=冪等）。
2. `suppressedMakeupOrigins[key]` から `2026-07-20` を除去（空配列ならキー削除）。

補助関数は ScheduleBoardScreen.tsx に既存: `appendMakeupOrigin(map,key,date)`(追加) / `removeMakeupOrigin(map,key,date)`(除去)。保存は `handleDeleteMakeupOriginItem`(~7534) と同じ `commitWeeks(weeks, weekIndex, selectedCellId, selectedDeskIndex, holidayDates, forceOpenDates, nextManualMakeupAdjustments, nextSuppressedMakeupOrigins, fallbackMakeupStudents, manualLectureStockCounts, manualLectureStockOrigins, fallbackLectureStockStudents)` パターン。

**検証結果**: 4名全員 balance+1・remain に7/20・理由「休日振替」(生徒s068は既存manualありでnext理由は手動調整)。教室総数 緑88→90 / 日大206→208、総計 **294→298(ちょうど+4・無関係生徒不変)**。

## 対象4名（教室別・studentKeyは教室内ローカルid）
| 教室 | classroomId | key | 生徒 |
|---|---|---|---|
| 緑が丘 | KzFnOQoTFLsCxwUp1tvh | s031__数 | （実名省略） |
| 緑が丘 | KzFnOQoTFLsCxwUp1tvh | s024__英 | （実名省略） |
| 日大前 | 5w5OMueETerSKrSf14HC | s068__数 | （実名省略） |
| 日大前 | 5w5OMueETerSKrSf14HC | s076__理 | （実名省略） |

（薬円台 6xnnbSTbwgGrBLy0EJKb は対象なし）。ボタンは **actingClassroomId ごとに対象キー配列をハードコード**し、その教室の対象生徒がいるときだけ表示。

## 実装手順
1. ブランチ `feat/temp-restore-720-button`。
2. ScheduleBoardScreen: 対象キー定数（classroomId→[key...]）を用意。未消化振替パネル内などに「7/20休日振替を復帰(生徒s031・生徒s024 等)」ボタンを1つ表示（actingClassroomId が対象教室のときのみ）。onClick で対象キー全てに 上記メカニズム(manual追加+抑制除去)を適用し commitWeeks。冪等に。
3. **ユニットテスト必須**（純粋関数で）: 対象キーに manual追加+抑制除去した map を作り `buildMakeupStockEntries` で balance+1・remain=[2026-07-20]・**他生徒不変**を確認。「manualのみ→+0 / 両方→+1」も固定（前回失敗の再発防止）。`buildMakeupStockEntries` は変更しない=ゴールデン(makeupStockSnapshot/lectureStockSnapshot)不変を確認。
4. lint/unit/build 緑 → main マージ → 本番デプロイ（safe-release / release-checklist §6 在庫数量チェック）。

## 実行フロー（オーナー）
5. 各対象教室を**室長アカウント（シークレットウィンドウ推奨=開発者ローカルに触れない）**で開く。※代理ログインのローカル影響は「教室データのクロス汚染なし(Firebaseが正本)・ローカルキャッシュは一時上書きだが開発者再ログインで復旧」= [[komahyou-occupied-origin-and-suppressed-makeup]] 参照、mergeWorkspaceWithLocalPreferences がlocal教室データをremoteに被せない設計。
6. ボタンをクリック → 手動保存 → 未消化振替に7/20が出るのを確認（緑2件/日大2件）。必要なら盤面へ配置。
7. **機能削除ブランチ → main マージ → デプロイ**（ボタン撤去）。撤去後も **manualMakeupAdjustments追加/suppressedMakeupOrigins除去は保存済みデータに残るので7/20は在庫に残り続ける**（撤去は挙動に無影響）。

## 安全策（他が変わってない確認・read-only）
- 変更前後で対象教室スナップショットを読み取り取得→展開→deep-diff。**対象4キーの manual/suppress 以外は不変**＋**総数+4**を確認。
- 本番スナップショット取得: `curl -H "Authorization: Bearer $(gcloud auth print-access-token)" "https://firestore.googleapis.com/v1/projects/komahyouapp-prod/databases/(default)/documents/workspaces/main/classroomSnapshots/{classroomId}"` → `fields.compressedData.stringValue` を base64→gzip解凍で AppSnapshot JSON。`data.boardState.{manualMakeupAdjustments,suppressedMakeupOrigins,weeks}`、`data.students`。resolveStudentKey は `s.manualAdded?'manual:'+id:id`。

## 検証ハーネス雛形（scratchなvitestで実行・commitしない）
`buildMakeupStockEntries({students,teachers,regularLessons,classroomSettings,weeks(=boardState.weeksをArray化),manualAdjustments,suppressedOrigins,fallbackStudents,resolveStudentKey})` を、manual0/supp0 と「manual+7/20・supp-7/20」で2回回して各keyの balance/remainingOriginDates を比較。

関連: [[komahyou-occupied-origin-and-suppressed-makeup]](真因の詳細) / [[komahyou-save-architecture]] / 本番書込みは室長がアプリ経由(Claudeは直書き禁止・CLAUDE.md)。
