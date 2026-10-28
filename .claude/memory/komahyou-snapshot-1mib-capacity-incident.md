---
name: komahyou-snapshot-1mib-capacity-incident
description: 日大前校の教室データが Firestore 1 文書 1MiB 上限に達し保存が全部失敗した事故(2026-10-26/27)・つなぎ v1.5.646・恒久対策は週単位の分割保存
metadata:
  node_type: memory
  type: project
---

**事故(2026-10-26 17:58〜21:15・10/27 14:46〜)**: 日大前校(`5w5OMueETerSKrSf14HC`)の保存が全部 Firestore に拒否された。
教室データ(非圧縮 8.3MB)を gzip+base64 で `classroomSnapshots/{id}` の 1 文書に入れており、実文書は 1,048,549 バイト
(上限 1,048,576 の 27 バイト手前)。室長報告は「21 時までに保存した振替と実績入力が消えた・21 時のバックアップにも無い」。
- 見え方: saveAttempts が status=started のまま版数 11702 で止まり続ける(書き込みで HttpsError でない例外 → 画面は INTERNAL
  =「接続を確認して」の案内・自動再試行・メールなし)。21:24 に室長が再読み込みして 17:57 の版から入れ直したので 3 時間分が消えた。
- 残存: サーバーには無い(saveAttempts に中身なし・操作痕跡は成功時だけ)。室長 PC の「Firebase同期失敗時バックアップ」JSON だけ。
- 中身の内訳: `boardState.weeks` が 7.35MB(46 週・過去週は出欠つきで捨てられず年々増える・講習週は 35〜40 万字)。

**つなぎ(v1.5.646・2026-10-27)**: 圧縮 level 9(余裕約 56KB＝2〜4 週間)、書き込みを try で包み too-large / write-failed を記録＋メール、
saveAttempts に documentByteLength / capacityRatio、85% 以上で capacity-warning(1 日 1 通・別の間引き文書 `{id}__capacity`)、
画面は容量超過専用の案内(閉じない・再読み込みしない)。
v1.5.647 操作痕跡の要約 400→2000 字(机を 14 台動かした 19:12 の操作が切れて読めなかった)。v1.5.648 保存できなかった内容を IndexedDB に控え、失敗時(初回・一時的な失敗は 3 回目から・隠れたタブでは聞かない)と次回起動時に「開発者へ送る」(質問・要望と同じ経路・版数衝突は控えない・書き戻しはしない)。
消えた作業は 21:24 の保存に相乗りした操作痕跡 158 件から読み戻せた(失敗時のバックアップ JSON は室長 PC に無かった=「保存」ボタンの失敗でしか作られず、自動保存の失敗では作られない)。分類は純関数 `classifySnapshotWriteFailure`(functions/src/snapshotCapacity.ts)。
見積もりだけで書き込みを止めない(Firestore の拒否を正とする・見積もりは実文書と 1 バイト単位で一致)。

**恒久対策(オーナー承認 2026-10-27)**: 週単位の分割保存＋差分保存(目次文書＋週ごとの文書・1 トランザクションで版数照合・
組み立て関数 1 つで今と同じ AppSnapshotPayload に戻す・新旧両読みを先に出す)。仕様は docs/spec-save-restore.md §9(Q1〜Q6 全件オーナー確定 2026-10-27・INV-14 新設)。**次セッションの着手手順は docs/plan-2026-10-27-weekly-split-snapshot-handoff.md が正本**(段階 0〜D・期限に効くのは段階 B)。
冬期講習(12 月)前に本番へ。過去週を閲覧専用にするかは「今は決めない」(オーナー 2026-10-27)。

**進捗(2026-10-28・段階 B 本番反映 v1.5.654・開発用教室は分割形式へ移行済み)**: 段階 A(v1.5.651)は本番反映済み・sp-1 オーナー確認 OK。段階 B＝サーバーが分割して書く(2026-10-28 00:10 UTC 反映・開発用教室は版 822 で移行＝48 部品・最大文書 60KB＝5.8%／版 823・824 は変わった部品だけ／QR マージは版 823 のまま core 部品を書いた・sp-2/sp-3 OK):
フラグ述語 `functions/src/snapshotStorageFormat.ts`(基本スコープ staging-environment＝検証用教室＋staging／教室指定 `WEEKLY_SPLIT_SNAPSHOT_CLASSROOM_ALLOWLIST`〔日大前校はここに足す〕／会社既定・一方通行・`CLIENT_TOO_OLD`＝v1.5.651 未満の画面を拒否)、
書き手の純関数 `functions/src/snapshotPartsWriter.ts`(`planSnapshotPartsCommit`・`verifySnapshotPartsReadback`・QR マージ・容量通知)、`index.ts` の `saveClassroomSnapshotAsParts`(1 トランザクション→読み戻し→失敗は目次を直前へ戻す)・
`pruneSnapshotParts`(掃除・`SNAPSHOT_PART_GC_DRY_RUN=1`)。仕様との差分は spec §9-17。**2026-10-28 オーナー指示「staging は確認しなくていいので、問題なければ本番環境へ全教室展開して」で v1.5.656 から全教室 ON**(staging・日大前校だけの段は省略・展開時 日大前 95.0%/緑が丘 75.5%/テスト教室 98.8%)。**日大前校は 05:02 UTC の保存で移行済み**(版 11790・49 書き込み・1.1 秒・7.0%・以後 23 回 verified・バックアップ/ロールバック/版履歴も正常)。緑が丘・テスト教室は次の保存で移行。段階 C(差分送信)は未着手。
**(2026-10-27 夜の記録)**: 段階 0(共有純関数 `src/utils/classroomSnapshotParts.ts`・sync-shared 複製)と
段階 A(読める版)を実装。サーバーは**唯一の読み手** `readClassroomSnapshotPayload`(旧形式 `readLegacyStoredSnapshotPayload`／目次は
`snapshotPartsReader.ts` が getAll で組み立て・欠けたら例外)に 9 箇所を集約。クライアントは `readFirebaseSnapshotPayload` 先頭で目次判定
(`snapshotPartsClientRead.ts`・DecompressionStream＋crypto.subtle)。段階 A の暫定ガード=分割形式の教室への保存・QR 取り込みは断る
(段階 B で書き手に置き換える)。ルール `snapshotParts` は read のみ・write 全面禁止。INV-14 マトリクス 20 件。反映順は Functions → ルール → Hosting。
`npm run test:rules` はクラウドのサンドボックス(Java 無し)で未実行。

**Why:** 1 文書に教室全体を入れる設計は、データが時間とともに増える限り必ず上限に当たる。圧縮やエンコードの工夫は数か月の延命にしかならない。
**How to apply:** 保存の不具合報告では最初に saveAttempts の status 列と capacityRatio を読む(started が並ぶ＝書き込みで落ちている)。
読み取りは `export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs)` → runQuery(select で軽く)。
緑が丘校も 827KB(79%)あるので同じ道をたどる。[[komahyou-save-architecture]] [[owner-postmortem-expectations]]
