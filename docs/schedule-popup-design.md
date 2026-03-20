# 日程表 Popup 設計メモ

## 目的

生徒日程表 / 講師日程表 popup の表示ルールと、コマ表・stock・講習希望数との関係をコード外でも追えるようにする。

## 対象ファイル

- `src/components/schedule-board/ScheduleBoardScreen.tsx`
- `src/utils/scheduleHtml.ts`
- `src/utils/pdf.ts`

## 用語

- `managed cells`
  - 基本データの通常授業から機械的に生成した日程表の基準データ
- `board cells`
  - 現在のコマ表状態。手動移動、振替配置、講習配置、削除結果を含む
- `planned cells`
  - popup に渡す `managed cells`。希望数・予定数比較の基準に使う
- `actual cells`
  - popup に渡す `board cells` overlay 後の結果。現在の表示に使う

## 表示ルール

### 通常授業

- popup の `planned` は managed regular lessons を使う
- popup の `actual` は board overlay 後の cells を使う
- 通常授業を振替ストックへ回しただけで未割当の origin は、`actual` から消す
- 実際に振替として配置されたものだけ `actual` に残す

### 振替授業

- 振替配置済みの授業は `lessonType = makeup` として popup に表示する
- 元コマへ戻った場合は通常授業へ正規化する

### 講習授業

- popup 表示ラベルは `講習`
- 講習 stock から配置された授業のみ popup の `actual` に出る
- 講習希望数は special session の student input から集計する

## 回数表

### 通常回数(希望数)

- 左値: `actual` の通常授業数
- 右括弧内: `planned` の通常授業数
- mismatch 時の警告スタンプは通常回数表の直下に置く

### 講習回数(希望数)

- 左値: `actual` の講習授業数
- 右括弧内: special session の登録希望数
- mismatch 時の警告スタンプは講習回数表の直下に置く

## 科目表示

- `算` と `数` は同時表示しない
- 小学生: `算`
- 中学生以上: `数`
- それ以外の科目は常時表示対象
- 生徒日程の回数表と希望科目数モーダルで同じルールを使う

## Popup 入力共有

- `school-info` と `logo` は生徒日程 / 講師日程で共有する
- 期間入力は view type ごとに保持する

## refresh 方針

- popup に手動更新ボタンは置かない
- board 側の sync により再描画する

## テスト観点

- popup 期間変更の即時反映
- popup 開きっぱなしでの追従更新
- stock へ回した未割当通常授業が popup に残らないこと
- `算` / `数` の学年別出し分け
- 通常 / 講習スタンプの配置
- QR の校舎名依存表示