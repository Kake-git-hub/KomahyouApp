# Runbook: 毎朝の健診(全教室展開週・2026-11-09〜11-15・読み取り専用)

11/8 に 4 機能(保護者QR・講習の公開・講師専用の特別講習・テンプレ保存の差分反映)を全教室へ出した(v1.5.711)。
その週は毎朝 7:40(JST)に Claude のスケジュール実行が本番 2 校を**読むだけ**で点検し、日本語で 1 通報告する。
計画: `docs/plan-2026-11-08-rollback-readiness-week.md`。異常が出たときの止め方: `docs/runbooks/feature-flag-rollback.md`。

> ⚠️ **やってはいけないこと**: Firestore / Storage への書き込み・復元・コピー・Cloud Functions の呼び出し。
> 異常を見つけても**報告だけ**にして直さない(オーナーが判断する)。出力に生徒名・講師名・保護者名を書かない(生徒は ID だけ)。

## 0. 準備(リポジトリと依存)

```bash
# リポジトリが無ければ(公開リポジトリ)
git clone https://github.com/Kake-git-hub/KomahyouApp.git && cd KomahyouApp
npm ci --no-audit --no-fund
export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs)   # 読み取り専用・1 時間有効
S=<スクラッチ領域>/health && mkdir -p "$S"
B='https://firestore.googleapis.com/v1/projects/komahyouapp-prod/databases/(default)/documents'
BK=komahyouapp-prod.firebasestorage.app
```

環境変数 `KOMAHYOU_READONLY_SA_JSON_B64`(読み取り専用サービスアカウント)が無ければここで止め、「健診を実行できない(トークン無し)」と報告する。

## 1. 時点を選ぶ

- **最新** = `workspaceAutoBackupSummaries` を `savedAt desc limit 1` で引いた文書 ID(例 `2026-11-09T07-30`)。
- **前日の基準** = 文書 ID `YYYY-MM-DDT03-00`(前日の JST 3:00 の日次アンカー。無ければ `T02-45`・`T03-15` の順に探す)。

```bash
curl -sS -H "Authorization: Bearer $FIRESTORE_ACCESS_TOKEN" -H 'Content-Type: application/json' -X POST "$B/workspaces/main:runQuery" \
  -d '{"structuredQuery":{"from":[{"collectionId":"workspaceAutoBackupSummaries"}],"orderBy":[{"field":{"fieldPath":"savedAt"},"direction":"DESCENDING"}],"limit":1}}'
# → document.name の末尾が最新の key。fields.layout は per-classroom-v1 のはず(legacy なら 15min/{key}.json 1 本)
```

## 2. 教室ファイルを落とす(2 校 × 2 時点・スクラッチ領域へ)

```bash
enc() { node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$1"; }
for KEY in <前日の key> <最新の key>; do
  for ID in 5w5OMueETerSKrSf14HC KzFnOQoTFLsCxwUp1tvh; do
    curl -sS -H "Authorization: Bearer $FIRESTORE_ACCESS_TOKEN" -o "$S/$KEY.$ID.json.gz" \
      "https://storage.googleapis.com/storage/v1/b/$BK/o/$(enc workspace-auto-backups/main/15min/$KEY/$ID.json.gz)?alt=media"
  done
done
```

(11/8 予行: 日大前 約 0.8MB・緑が丘 約 0.6MB。gzip のまま渡せる。)

## 3. 保存記録と利用者報告を引く(読み取り)

```bash
SINCE=$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S.000Z)          # 保存は直近 24 時間
RSINCE=$(date -u -d 'yesterday 22:40' +%Y-%m-%dT%H:%M:%S.000Z)      # 報告は前日 7:40 JST 以降
for ID in 5w5OMueETerSKrSf14HC KzFnOQoTFLsCxwUp1tvh; do
  curl -sS -H "Authorization: Bearer $FIRESTORE_ACCESS_TOKEN" -H 'Content-Type: application/json' -X POST "$B/workspaces/main/classroomSnapshots/$ID:runQuery" \
    -d "{\"structuredQuery\":{\"from\":[{\"collectionId\":\"saveAttempts\"}],\"where\":{\"fieldFilter\":{\"field\":{\"fieldPath\":\"savedAt\"},\"op\":\"GREATER_THAN_OR_EQUAL\",\"value\":{\"stringValue\":\"$SINCE\"}}},\"orderBy\":[{\"field\":{\"fieldPath\":\"savedAt\"},\"direction\":\"DESCENDING\"}],\"limit\":300}}" > "$S/saves.$ID.json"
done
curl -sS -H "Authorization: Bearer $FIRESTORE_ACCESS_TOKEN" -H 'Content-Type: application/json' -X POST "$B/workspaces/main:runQuery" \
  -d "{\"structuredQuery\":{\"from\":[{\"collectionId\":\"developerReports\"}],\"where\":{\"fieldFilter\":{\"field\":{\"fieldPath\":\"reportedAt\"},\"op\":\"GREATER_THAN_OR_EQUAL\",\"value\":{\"stringValue\":\"$RSINCE\"}}},\"orderBy\":[{\"field\":{\"fieldPath\":\"reportedAt\"},\"direction\":\"DESCENDING\"}],\"limit\":100}}" > "$S/reports.json"
```

- `savedAt`・`reportedAt` は **ISO 文字列**。`timestampValue` で引くと 0 件になる。`__name__` の並べ替えは複合索引が要るので使わない。
- 利用者報告の本文(`note`・`recentOperations`)は読まない。ツールが `isVerificationChecklist`・`isTest` を除き、件数・種類・教室だけを出す。

## 4. 健診ツールを回す(教室ごと)

```bash
for ID in 5w5OMueETerSKrSf14HC KzFnOQoTFLsCxwUp1tvh; do
  node tools/board-health-check.mjs "$S/<前日の key>.$ID.json.gz" "$S/<最新の key>.$ID.json.gz" --classroom $ID \
    --save-attempts "$S/saves.$ID.json" --reports "$S/reports.json" --known tools/board-health-known-issues.json
done
```

- `tools/board-health-known-issues.json` = 既知の 2 か所配置(除外)。緑が丘の生徒 s072・11/18・11/25・5 限(確認リスト mg-2・室長が直す)。
- 出力は warn → info → 件数の順。生徒は ID だけ。異常が無ければ「異常なし」1 行。

## 5. GitHub と外形監視

```bash
gh api -X GET search/issues -f q='repo:Kake-git-hub/KomahyouApp label:source:user-report is:open created:>=<前日の日付>' --jq '.items[] | "#\(.number) \(.title)"'
```

外形監視(`uptime-check.yml`)の最新実行が赤なら報告に入れる(GitHub MCP の actions_list か Actions 画面)。

## 6. 報告の形(日本語・実名なし)

```
11/10(月) 7:40 の健診
■ 日大前校: 異常なし(保存 12 回・保留 0・組 0)
■ 緑が丘校: ⚠ 同じコマに同じ生徒 2 か所: 11/12 5限 机3/机7 s0xx
■ 利用者報告: 1 件(request・緑が丘・自動エラー報告なし)
■ 外形監視: 緑
```

- 異常ゼロの日は 1 行(「異常なし(日大前 保存 n 回・緑が丘 保存 m 回)」)。
- 異常があれば、止める判断の材料として `docs/runbooks/feature-flag-rollback.md` の「症状→フラグ」の表を 1 行で添える。直さない。

## 7. 止め方

スケジュール実行は 11/15 までの日付で登録してあり、11/16 以降は自然に止まる。途中で止めるときはスケジュール一覧から無効化する。
