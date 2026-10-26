---
name: komahyou-dev-classroom-qr-token-contamination
description: 開発用教室のQRテストが本番教室へ混入した事故(2026-07-09)と恒久対策(発行元教室タグ+dev限定ガード)
metadata: 
  node_type: memory
  type: project
  originSessionId: aaac1be4-838f-4308-a71d-aee1caacfc05
---

2026-07-09 発生・v1.5.415 で恒久対策。**開発用教室(v8OZ...)でのQRテスト提出が、本番の日大前校(5w5OMueE)へ書き込まれた**混入事故。

**メカニズム**: 開発用教室は他教室の生データをコピーして本番相当でテストする環境。コピー元(日大前)の
提出トークン(classroomId=5w5OMueE を指す)が開発用の studentInputs に残っていると、開発用の**日程表が
その日大前トークンでQRを生成**→スキャン→Functions が**日大前(本番)のドキュメント/スナップショットへ書き込み**。
提出先を決めるのは**トークンdocの classroomId**であって、セッションIDではない(同事故でセッションIDは日大前と
同一だったが、それ自体は原因ではない)。フォレンジック: 提出doc の createdAt/classroomId と、開発/本番
スナップショットのトークン集合の突き合わせ(Firestore REST 読み取り専用)で確定。生徒C/生徒D/生徒Eの3件は
本番へ混入(理社込み)。ユーザー依頼で本番は手動復旧済み。

**恒久対策(すべて dev 限定・本番の発行/表示/印刷配布済みトークンは不変)**:
- 発行トークンに発行元教室ID `submissionTokenClassroomId` を刻む(`applyIssuedSubmissionTokensToSessions` /
  `reflectIssuedSubmissionTokens` に classroomId 引数)。追記なので本番既存トークンは従来どおり。
- 他教室→開発用コピー時に token と tag の両方を除去(`buildDevelopmentClassroomCopyPayload`)。
- **開発用教室でのみ**、日程表へ渡す前に「自教室が発行したものでないトークン(未タグ含む)」を除去して
  QRを出せなくする(`applyDevelopmentScheduleTokenGuard` → `stripForeignSubmissionTokensFromInputs`)。
  判定は純関数 `isSubmissionTokenOwnedByClassroom`(tag===acting のみ信用)。本番教室ではガード自体が走らない。

**再発防止の勘所**: 開発用へデータを入れる経路は必ずトークンを除去する(Feature B=他教室バックアップ読込は
`buildDevelopmentClassroomCopyPayload` で除去済み)。dev限定ガードは「未タグ/他教室タグ」を弾くので、
コピー漏れや旧トークンでも日程表QRは出ない=本番への誤スキャンが構造的に起きない。
関連 [[komahyou-classroom-restore-cross-contamination]] [[komahyou-save-architecture]]。

**運用注意(この調査で判明)**: 別セッションが同一作業ディレクトリで `feature/schedule-react-view`(日程表
コマ組み・main マージ禁止)を開くと、こちらのディレクトリも同ブランチに切り替わる。本番修正は必ず
`git checkout -b ... origin/main` で main ベースに切ってから行い、完了後に元ブランチへ戻すこと。
