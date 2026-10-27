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

**Why:** 1 文書に教室全体を入れる設計は、データが時間とともに増える限り必ず上限に当たる。圧縮やエンコードの工夫は数か月の延命にしかならない。
**How to apply:** 保存の不具合報告では最初に saveAttempts の status 列と capacityRatio を読む(started が並ぶ＝書き込みで落ちている)。
読み取りは `export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs)` → runQuery(select で軽く)。
緑が丘校も 827KB(79%)あるので同じ道をたどる。[[komahyou-save-architecture]] [[owner-postmortem-expectations]]
