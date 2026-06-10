# 確定仕様：自動割振ルール（To-Be 正本）

> 全体見直しセッション（2026-06-08）でオーナー確認済みの「目標仕様」。

## A. 画面の役割

- 振替・講習をコマ表へ自動割振するときの**「優先ルール」と「制約ルール」**を設定する場所。

## B. 区分（優先事項／制約事項／絶対事項）★再定義

- 区分は3種類：
  - **優先事項**：なるべくそうする（ソフト＝スコア加点）。
  - **制約事項**：必ず守る（ハード＝フィルタ）。
  - **絶対事項**：**固定・編集不可の区分**。根本的なルールの明示用。
- ★**ユーザーが各ルールで変更できるのは「優先事項 / 制約事項」の2つだけ。**
- ★**絶対事項は編集不可。ユーザーは他のルールを絶対事項に変更できない。**
- ★**区分の切替は「ルールごとに選べる区分を許可リストで制限」する**：
  - 性質上ソフトにしか使えないルール（登校日集約/分散・講師2人配置・時限優先・2コマ連続/一コマ空け/通常連結2コマ）は**「優先事項」のみ**選べる。
  - ハードとして効くルール（コマ数上限・指定時限禁止・科目対応講師のみ・通常講師のみ）は**「制約事項」（必要なら優先事項）**を選べる。
  - これにより、成立しない組合せ（例：登校日集約を絶対/制約）を作れないようにする。

## C. ルール一覧

### 維持するルール
- **登校日**：登校日集約／登校日分散
- **講師1人に生徒2人配置**
- **同日コマ数上限**：1コマ／2コマ／3コマ上限
- **連続・間隔**：2コマ連続／一コマ空け／通常連結2コマ
- **科目対応講師のみ**（講師の担当科目内の生徒だけ配置）
- **通常講師のみ**（その生徒の通常授業担当講師だけに制限）

### ★スライダー化するルール（時限系の作り直し）
- **時限優先**：旧「3,4,5限優先／2限寄り／5限寄り」の3ルールを統合し、**スライダーで優先する時限の範囲・順序を1〜5限で調整**できる1ルールにする。
- **指定時限禁止**：旧「1限禁止」を一般化し、**スライダーで禁止する時限を1〜5限で指定**できるようにする。

### 使わないルールの扱い
- 不要なルールは削除せず、**「対象なし」で運用**する（現状は全ルール残す）。

## D. ルールごとの操作

- 各ルールに **「＋対象」「－対象（除外）」** を指定できる。対象は **全員／学年／個別生徒**。
- 対象クリア・除外クリアができる。
- ルールグループごとに**優先順位を上げ下げ**できる。
- 対象と除外が重なったら**除外を優先**。

## E. ペア制約

- 「**この2人（講師or生徒）は同席させない**」制約を登録できる。
- 人物A／Bを種別（講師/生徒）付きで選び、追加・更新・削除。
- 区分：**既定は制約事項（必ず守る）。優先事項にも変更可能**（絶対事項へは変更不可）。
  - ★**優先／制約の2区分で確定**（2026-06-08 確認済み）。

## F. Excel管理

- ルールとペア制約を**Excelでテンプレ出力／現データ出力／取り込み**できる。

## G. グループ授業（★削除）／ ルール相互排他（★誤記訂正・残す）

- ★**訂正（2026-06-08 実装精査）**：コード上の `origin: 'group-conflict'` は「グループ授業の衝突」**ではなく**、
  自動割振の**ルール相互排他**（同じ優先グループ内のルールで対象生徒が重複したら自動で片方の除外へ回す。
  例：登校日集約↔分散）の仕組みだった。**これは使われている正当な機能なので残す**（削除しない）。
- ★本当の「**グループ授業（班）＝ `groupLessons`**」は**編集UIが無く**、スナップショット配管とサンプル種データのみ。
  画面上は既に不可視。撤去の深さ（種データを空にするだけ／データフィールドごと完全撤去）は別途判断。

---

## 現行からの主な差分（実装時TODO）

1. 区分モデルを「**ルールごとの許可リスト制限つきで 優先/制約 を変更可能**」に。絶対事項は固定・編集不可・割当不可。
2. 時限優先3ルール → **スライダー式の1ルール**へ統合（1〜5限の優先範囲/順序）。
3. 1限禁止 → **指定時限禁止（スライダーで時限指定）**へ一般化。
4. **グループ授業（`groupLessons`/班）を整理**（編集UIは元々無し。種データを空に or フィールドごと撤去）。
   ※ `origin: 'group-conflict'`（ルール相互排他）は別機能なので**残す**。
5. ペア制約の区分を 優先/制約 の2区分へ（既定＝制約事項）。

## 現状精査（2026-06-09・Phase 6 ⑧ 着手前）

- **区分は未モデル化**：`AutoAssignRuleRow` に category フィールド無し。区分は `AutoAssignRuleScreen.tsx` の
  `forcedRuleKeys = {forbidFirstPeriod, regularTeachersOnly, subjectCapableTeachersOnly}`（ハードコードSet）で
  「制約事項」、残りを「優先事項」として描画。絶対事項はアプリ固定テキスト（既存コマ不変／出席可能コマのみ）。
  - 注意: spec C では「同日コマ数上限(maxOne/Two/Three)」は制約事項に選べる想定だが、現状は優先事項(soft)のみ。
- **時限ルールは4つの個別キー**：`preferLateAfternoon`/`preferSecondPeriod`/`preferFifthPeriod`（優先順位グループ orderKey=preferLateAfternoon に統合済の表示）＋ `forbidFirstPeriod`。スライダー用の範囲/順序データモデルは無し。
- **ペア制約 `PairConstraintRow`**：`{personA/B, type:'incompatible'}` のみ。category 無し（現状は常にハード）。
- **割振アルゴリズム本体**は `ScheduleBoardScreen.tsx`（`lectureConstraintGroupDefinitions` ほか）。区分・スライダーの判定はここが参照する。

### 実装計画（増分・各層）

| TODO | モデル | UI(AutoAssignRuleScreen) | アルゴリズム(ScheduleBoardScreen) | 備考/要確認 |
|---|---|---|---|---|
| 1 区分許可リスト | `category:'priority'|'constraint'` を AutoAssignRuleRow に追加＋ルール別 `allowedCategories` メタ＋既定値。sanitize/移行で既定補完 | 各ルールに区分トグル（許可リスト内のみ）。絶対事項は固定表示 | `forcedRuleKeys` ハードコードを `rule.category==='constraint'` 判定へ置換 | 許可リスト割当（どのルールが制約可か）を最終確認 |
| 2 時限優先スライダー | 時限優先の範囲/順序を表す新データ（例 `timePreferenceOrder:number[]`）。旧3キーは「対象なし運用」or 1キーへ集約 | 1〜5限のスライダー/並べ替えUI | スコアリングを新データで算出 | 旧3ルールの後方互換（既存データ移行）を確認 |
| 3 指定時限禁止スライダー | `forbidFirstPeriod` を `forbiddenPeriods:number[]` 一般化 | 1〜5限トグル/スライダー | フィルタを forbiddenPeriods で判定 | 既存「1限禁止」を [1] に移行 |
| 4 groupLessons 整理 | 種データを空 or 型ごと撤去 | （UI無し） | スナップショット配管 | **撤去の深さは要オーナー判断**（§G） |
| 5 ペア制約2区分 | `PairConstraintRow.category:'priority'|'constraint'`（既定 constraint、移行で補完） | A/B選択UIに区分トグル | ペア制約の enforcement を hard/soft 分岐 | 既定=制約で現挙動維持 |

## 実装状況（2026-06-09・Phase 6 ⑧ 着手・phase6-auto-assign ブランチ）

- **TODO5（ペア制約2区分）✅ 実装（未デプロイ）**：
  - `pairConstraint.ts`：`category?:'priority'|'constraint'`（optional・後方互換）＋ `resolvePairConstraintCategory`（未設定=constraint）。
  - `ScheduleBoardScreen.tsx`：`resolvePairConstraintSeverity`（none/priority/constraint・複数一致は強い方）。制約=赤の「制約: 組み合わせ不可」、優先=非赤の「優先: 組み合わせ回避」。自動割振スコアは両方とも回避方向（`isPairConstraintBlocked` は severity!=='none'）。
  - `AutoAssignRuleScreen.tsx`：追加フォーム＋一覧に「区分」トグル、Excel入出力に「区分」列。
  - テスト：`pairConstraint.test.ts`（既定=制約/優先の解決）。
- **TODO4（groupLessons 整理）✅ 実装（未デプロイ）**：`initialGroupLessons` のサンプル種データを空配列に（型・スナップショット配管は維持＝オーナー判断）。
- **TODO3（指定時限禁止スライダー）✅ 実装（未デプロイ）**：`forbidFirstPeriod` を一般化。`forbiddenPeriods?:number[]`＋`resolveForbiddenPeriods`（未設定=[1]）。ルールカードに1〜5限トグル、割振スコア／警告を forbiddenPeriods で判定、Excel「禁止時限」列、ラベル「指定時限禁止」。テスト追加。
- **TODO2（時限優先スライダー）✅ 実装（未デプロイ）**：
  - `autoAssignRuleModel.ts`：`periodPriorityOrder?:number[]`＋`resolvePeriodPriorityOrder`（未設定=[5,4,3,2,1]＝旧「3,4,5限優先」。欠けは既定順で補完し常に1〜5全時限の並びに正規化）。`preferLateAfternoon` を「時限優先」へ改称・定義一本化（`preferSecondPeriod`/`preferFifthPeriod` は定義から削除、型 union は旧スナップショット互換で残置＝対象なし運用）。
  - `ScheduleBoardScreen.tsx`：`lectureConstraintGroupDefinitions` time-preference を `['preferLateAfternoon']` に集約。`buildCommonAutoAssignScoreParts` の時限スコアを優先順ランクで算出（index0 が最高得点）。ルール未設定時は従来どおり遅い時限優先のまま。
  - `AutoAssignRuleScreen.tsx`：時限優先カードに 1〜5限の並べ替えUI（上へ/下へ）。Excel「優先時限順」列の入出力。
  - テスト：`resolvePeriodPriorityOrder`（既定/補完/範囲外除外）。
- **TODO1（区分許可リスト）✅ 実装（未デプロイ・挙動はソフト維持）**：
  - `autoAssignRuleModel.ts`：`AutoAssignRuleCategory='priority'|'constraint'`＋`AutoAssignRuleRow.category?`。許可リスト `getAllowedRuleCategories`（制約可＝コマ数上限/指定時限禁止/科目対応講師のみ/通常講師のみ。他は優先のみ）＋`getDefaultRuleCategory`（既定＝旧 forcedRuleKeys：指定時限禁止/科目対応講師のみ/通常講師のみ＝制約、コマ数上限＝優先）＋`resolveRuleCategory`（許可外/未設定は既定へ丸め）。
  - `AutoAssignRuleScreen.tsx`：ハードコード `forcedRuleKeys` を `resolveRuleCategory==='constraint'` へ置換。制約事項セクション＝区分=制約のルール、優先事項グループ＝区分=優先のみ表示（全て制約へ移ったグループは非表示）。各ルールカードに区分トグル（許可リスト内のみ）。`moveRuleGroup` を区分移動に伴う重複排除＋残置キー保全に対応。Excel「分類」列を取り込み（許可外は丸め）。
  - `ScheduleBoardScreen.tsx`：盤面の赤字警告ラベル（科目対応講師のみ/指定時限禁止/通常講師のみ）を区分に応じて「制約事項/優先事項」へ切替。**割振アルゴリズム自体は不変（区分=制約でもハードフィルタ化しない＝オーナー確認済みの方針／本番割振結果を変えない）。**
  - テスト：`getAllowedRuleCategories`/`getDefaultRuleCategory`/`resolveRuleCategory`（許可リスト・既定・丸め）。
- **残（オーナー判断）**：
  - 区分=制約事項を将来「ハードフィルタ化」するか（現状はソフト＝強い減点＋赤字警告のまま）。spec B「必ず守る＝ハード」に厳密化する場合は本番割振の再検証＋ゴールデンスナップショット更新が必要。
  - 旧「2限寄り/5限寄り」を明示設定していた教室の自動移行（現状は未移行＝既定の遅い時限優先へ戻る。時限優先は再設定で対応）。

> アルゴリズム層（ScheduleBoardScreen）の割振挙動は TODO2 の時限スコア式のみ変化（ルール未設定時の既定は不変）。TODO1 は区分のソフト扱いを維持し割振結果を変えない。検証＝build／test:unit（278件グリーン）。書込検証は開発用教室のみ。
