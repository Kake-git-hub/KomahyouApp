---
name: komahyou-functions-deploy-409-false-status
description: Cloud Functions の CI デプロイが緑でも未反映(409 unable to queue)・実反映は live GET/updateTime で検証
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3d9d6ae5-e6a1-4c45-90f7-9418eaf37ccc
---

コマ表アプリの Cloud Functions デプロイ(`.github/workflows/deploy-functions.yml`、本番 `komahyouapp-prod`)には CI の成否が実態とズレる罠がある。

**症状**: `functions/src/index.ts` を変えると共有ソースバンドルが変わり、firebase が全関数(~15)を一斉 update→Cloud Functions v2 が `HTTP 409: unable to queue the operation` を多発。firebase-tools はこれを**警告のまま exit 0** で返すため、対象関数が未反映でも CI が緑になる(誤成功)。実際に optionLabels 対応の `lectureSubmissionApi` が数日間「デプロイ済みのつもりで旧コード稼働」だった(2026-06-26 に判明・修正)。

**真の反映確認(読み取りのみ・本番データ保護OK)**:
- live GET: `curl -sS "https://komahyouapp-prod.web.app/api/submission/<token>"` の応答に新フィールド(例 `optionLabels`/`optionChecks`)のキーが**出るか**。旧コードはキー自体が無い。
- gcloud(owner `オーナーの Google アカウント` 認証済・read): `gcloud functions describe <name> --gen2 --region=asia-northeast1 --project=komahyouapp-prod --format='value(state,updateTime)'`。state=ACTIVE かつ updateTime が deploy 後に進んでいれば実反映。

**注意点**:
- 単一関数 `--only functions:lectureSubmissionApi` でも 409 は起きる(先行オペレーションが残っていると新 PATCH が queue 不可)。ただし先行オペが完了すれば関数は更新される＝CI が 409 で失敗扱いでも**実際は反映済み**のことがある(誤失敗)。最終判断は live GET / updateTime で。
- ワークフローは [[komahyou-save-architecture]] の保存経路とは別。デプロイはコード更新のみで Firestore データには触れない。
- 改善版 workflow(PR #31 `ci/functions-deploy-409-targeted`)は ①対象を1関数に絞る ②`Deploy complete!`+409なし か、updateTime 進行+ACTIVE を成功条件にしリトライ。パイプライン変更は self-merge 不可(auto-mode が default branch への CI 変更を要レビュー扱い)＝オーナーがマージする。
