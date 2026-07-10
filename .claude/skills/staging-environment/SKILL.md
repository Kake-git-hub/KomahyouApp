---
name: staging-environment
description: コマ表アプリの検証用 staging 環境（komahyouapp-staging）の使い方。本番と分離した書き込み自由な環境で実機検証するときに従う。staging へのデプロイ方法、本番との違い、やってよい/だめの境界、未整備時の代替を定める。クラウド側の初期セットアップは docs/runbooks/staging-setup.md。
---

# staging 環境の使い方（komahyouapp-staging）

本番（`komahyouapp-prod`）と**完全分離**した検証用 Firebase プロジェクト。
**ここは書き込み自由**で、Claude の実機検証先。本番内「開発用教室1つ」依存（教室取り違え汚染の温床）を解消する。

- URL: `https://komahyouapp-staging.web.app`
- デプロイ: GitHub → Actions → **「Deploy to Staging」**（`.github/workflows/deploy-staging.yml`、手動実行）
- 初期セットアップ（オーナー作業・未整備なら先にこれ）: `docs/runbooks/staging-setup.md`

## ⚠️ 使い始める前に本番と版を合わせる（オーナー指示 2026-07-10・厳守）

オーナーは**本番でも staging でも動作確認する**。古い staging のまま検証すると「本番と挙動が違う」と誤判定して
しまう。そこで、**staging で新機能の実装・検証を始めるとき（＝staging を使うタイミング）は、その直前に最新を
staging へ反映して本番と版を揃える**。常時 CI で自動追従はしない（本番は push ごとに自動 bump するのに対し
staging は bump しない構造のため、放置すると必ずずれる。必要なタイミングで都度合わせるのが本方針）。

手順:
1. まず本番の版を確認: `curl -s https://komahyouapp-prod.web.app/version.json`。
2. ローカル main を最新化（`git fetch origin && git switch main && git pull --ff-only`）。
   `node -p "require('./package.json').version"` が本番 version.json と一致すれば「main = 本番」。
3. GitHub → Actions →「Deploy to Staging」を **main（新機能の検証なら作業ブランチ）** から Run workflow。
4. 反映後、両者の版が揃っているか照合:
   ```bash
   curl -s https://komahyouapp-prod.web.app/version.json
   curl -s https://komahyouapp-staging.web.app/version.json   # version が本番と一致すること
   ```
   - 作業ブランチから staging を出した場合、staging の版はそのブランチ時点の `package.json`（本番の最新版と同値）に
     なる。検証中に本番がさらに bump したら再度合わせ直す。
5. 揃ったら `komahyouapp-staging.web.app` を**ハードリロード（Ctrl+Shift+R）**して検証開始。

## やってよいこと
- 教室・生徒・コマの作成/編集/削除、保存、自動割振、QR 提出、復元など**全操作**。
- 壊れてもよい検証用データを自由に作る。

## やってはいけないこと
- **本番データを staging にコピーして持ち込む**こと（個人情報・他教室データの混入）。検証用ダミーを手で作る。
- staging の認証情報・SA を本番用と混同すること（secret は `STAGING_*` で別管理）。

## 本番との違い・注意点
- **functions の Storage バケット**: `functions/src/index.ts` は `STORAGE_BUCKET` 未設定だと本番バケットを
  既定参照する。staging CI は `STAGING_STORAGE_BUCKET` を `functions/.env.komahyouapp-staging` に注入して
  staging バケットへ向ける。手動で functions をいじるときもこの env を忘れない（さもないと staging から本番を触る）。
- staging は patch bump しない（版管理対象外）。本番のような自動 version bump は走らない。
- staging では firestore/storage ルールも一緒にデプロイする（本番 hosting CI はルールを出さない）。

## 未整備のときの代替
- staging プロジェクトがまだ無い場合はローカル `npm run dev`（local モード）や
  Firebase エミュレータ（`npm run emulators:firebase`）で代替し、**その旨を明示**する。
- 「本番そっくりの実機確認」は staging が整うまで完全には満たせない点を、リリース判断時に正直に伝える。

リリース全体の流れは `safe-release` スキルを参照。
