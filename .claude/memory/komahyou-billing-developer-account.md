---
name: komahyou-billing-developer-account
description: billing(/billing)にログインできる開発者アカウントの作り方・許可リストは2箇所(コード+ルール)
metadata: 
  node_type: memory
  type: reference
  originSessionId: 25449240-730d-4ac6-bdad-9bba3e0ac75d
---

`https://komahyouapp-prod.web.app/billing` を使える開発者を追加するには **4点すべて** が必要。

1. Firebase Auth ユーザー(email+password)を作成。Identity Toolkit `accounts:signUp`(Web APIキー)で作成、既存なら `accounts:update`(gcloud トークン+ヘッダ `x-goog-user-project: komahyouapp-prod`)でパスワード変更。UID取得は `accounts:lookup`。
2. `workspaces/main/members/{uid}` に `{ displayName, email, role:'developer', assignedClassroomId:null }` を作成。Firestore REST PATCH を `gcloud auth print-access-token`(owner=オーナー の IAM)で実行するとルールを迂回して書ける(同ヘッダ必要)。
3. **billing許可リストは2箇所**(ここが罠・片方だけだと動かない):
   - クライアントゲート: `src/utils/billing.ts` の `BILLING_ALLOWED_EMAILS`
   - データゲート: `firebase/firestore.rules` の `isBillingDeveloper`(email を get(member).data.email と request.auth.token.email の両方に追加)
4. **本番デプロイ**: `npm run deploy:firebase`(= build + `firebase deploy --only hosting,firestore`)。これでアプリとルールが同時に出る。注意: アプリは作業ツリー全体を出荷するので未コミット変更も一緒に本番反映される。

`role:'developer'` は全教室アクセスを与える点に注意。本番membersへの書き込みなのでオーナー明示許可時のみ。[[komahyou-classroom-restore-cross-contamination]]
