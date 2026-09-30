// 開発用教室だけに出す「確認事項チェックリスト」の純粋ロジック(2026-09-12 オーナー指示)。
//
// 目的: 新機能を開発用教室で触りながら「OK か・どこを直してほしいか」をその場で書き留め、
// まとめて開発者へ送れるようにする。送信経路は既存の「要望・報告」(submitDeveloperReport)を
// そのまま使う(= developerReports に蓄積されメール通知が飛ぶ)。新しい保存先は作らない。
//
// 本番教室では一切出さない(App 側の isActingDevelopmentClassroom で条件付け・source-scan テストで固定)。
//
// このファイルは純データ＋純関数のみ。localStorage / DOM / ネットワークには触らない
// (テストしやすさのため。呼び出し側が入出力を担う)。

import { DEVELOPER_REPORT_NOTE_LIMIT } from './developerReport'

/** 1項目の確認状態。未確認は送信対象から外す(省略)。 */
export const VERIFICATION_CHECKLIST_STATUSES = ['unchecked', 'ok', 'needs-fix'] as const
export type VerificationChecklistStatus = (typeof VERIFICATION_CHECKLIST_STATUSES)[number]

export type VerificationChecklistItem = {
  /** 送信本文に載る短い識別子。生徒名などの個人情報は含めない。 */
  id: string
  /** 画面上の分類見出し(盤面 / PDF / 日程表 …)。 */
  area: string
  title: string
  /** 前提(あれば1行)。どの状態で始めるか・何を選ぶか。オーナーの準備を最小にするため、できるだけ書かない。 */
  prep?: string
  /** 操作。1〜2手順に収める(オーナー指示 2026-09-17「手順が多すぎて大変」・テストで上限を固定)。 */
  steps: string[]
  /** 見るところ。操作のあと何を確かめるか(最大4つ)。 */
  check?: string[]
  /** この項目を追加した版(あとから「いつからの確認項目か」を追える)。 */
  introducedIn: string
}

export type VerificationChecklistDefinition = {
  version: string
  items: readonly VerificationChecklistItem[]
}

/** 確認リストの版。項目を足したら上げる(下書きは版ごとに分かれる)。 */
export const VERIFICATION_CHECKLIST_VERSION = 'v1.5.573'

/**
 * 確認項目の正本(2026-09-12 初版・v1.5.504 で第2版・v1.5.506 で第3版・v1.5.508 で第4版・v1.5.509 で第5版)。
 * ★ 第3版からの運用(オーナー指摘 2026-09-12「以前確認し終わったものが残っている」): 前回の確認リストで OK だった項目は
 *   **載せない**。載せるのは「前回 要改善 → 今回の修正を確認してほしい項目」と「今回の新機能」だけ。
 *   OK 済みの項目は git 履歴(v1.5.502 / v1.5.504 の定義)と Issue #62 / #63 に残る。
 * 第3版: v1.5.504 の結果(Issue #63)で要改善だった p-2/p-3(行高さ)・h-2(履歴 INTERNAL)の再確認と、
 *   その他要望(PDF 出力中のスピナー・確認リストの整理)の確認項目。
 * 第4版(v1.5.508・2026-09-13): 第3版の結果で要改善だった p-2/p-3(文字が大きすぎてセルからはみ出る)の再確認のみ。
 * 第5版(v1.5.509・2026-09-13): 第4版の結果で要改善だった p-3(講師名の見切れ)の再確認と、集団行ガイドの空白化 p-12。
 * 第6版(v1.5.512・2026-09-13): 第5版は p-3/p-12 とも OK(Issue #66)だったので載せない。**保護者向け固定QR の第1段**
 *   (開発用教室限定・docs/spec-parent-portal.md)の確認項目だけにした。QR の URL は /p/{トークン} で、
 *   スマホで開いて確認する(講習提出の /s/ とは別物)。**本番教室では QR ボタンが出ないこと**も確認項目に含める。
 * 第7版(v1.5.518・2026-09-14): 第6版の結果で要改善だった k-4(表示は1か月単位・授業のある日だけ・講習期間も具体的に・
 *   教室休みは出す)と k-5(月単位で前後1か月だけ動かす)の再確認のみ。講習は講習提出QRで案内するので、このページは
 *   講習期間中も通常授業だけを出す(オーナー回答 2026-09-14)。教室休みは臨時・祝日休み(休校日)だけを出す。
 * 第8版(v1.5.519・2026-09-14): 第7版は k-5 OK。k-4 は「前の月の出席データが出ず休みの日しか出ない」で要改善 →
 *   実データでは講習だけの月(夏期講習中に入塾した生徒の 8 月)だった。講習コマは出さず注記を出す(オーナー回答)。k-4 の再確認のみ。
 * 第9版(v1.5.521・2026-09-14): 第8版は k-4 OK。これまでの「その他」欄の要望 5 件の確認項目(読み取りツールが「- その他:」行を
 *   落としていたため、v1.5.512/v1.5.518 のその他要望が未対応だった分を含む)。
 * 第10版(v1.5.526・2026-09-14): 第9版は k-10/h-9/b-1 OK。要改善の k-11(休みの日の行が出ない・1行表示)/k-12(QR準備中の表示)の
 *   再確認と、その他要望(通常授業履歴の振替元列を状態欄へまとめる)の h-10。
 * 第11版(v1.5.527・2026-09-15): 第10版は k-11/k-12/h-10 とも OK。その他要望(退塾ボタンを押したらすぐ一覧から消す)の b-2 のみ。
 * 第12版(v1.5.528・2026-09-15): 第11版 b-2 は要改善(「今日の盤面からも消してほしい・退塾日当日はもう退塾」「非在籍一覧で削除ボタンが出ない」)。
 *   生徒の退塾日を「その日から非在籍」に改定したので、b-2 を新しい定義の確認手順に差し替えて再確認。
 * 第13版(v1.5.540・2026-09-17): 第12版 b-2 はまだ結果が無いので残す。v1.5.538/539 の新機能(スクールIE要望・
 *   フラグ transferSourceRestDisplay・開発用教室限定)= 移動元/丸ごと振替/休日設定の「休)」表示と記録保持、
 *   休日解除後の席操作、生徒日程表の振替欄(元起点・未定)の r-1〜r-8 を追加。
 *   ★オーナー指示(2026-09-17): 新機能追加や修正のたびに必ずこのリストを更新する(確認リストで全チェックするため)。
 * 第14版(v1.5.541・2026-09-17): 第13版に、日大前・緑が丘の本番(1/1→1/29・1/2→1/30 を旧版で丸ごと振替→休日設定済み)へ
 *   後から「休)」を付ける手順の予行 y-1〜y-4 を追加。オーナー判断で薬円台校は検証用教室に登録せず、開発用教室へ日大前の
 *   バックアップを読み込んでオーナーが操作する(書き込みは開発用教室だけ)。
 *   ★版(VERSION)は v1.5.540 のまま据え置く: 下書きは版ごとに保存されるので、第13版を出した数時間後に版を上げると
 *     書きかけの結果が消える。項目の追加だけなら据え置き、項目を差し替える(OK 済みを外す)ときに上げる。
 * 第15版(v1.5.542・2026-09-17): オーナー指摘「確認リストの文字が小さすぎて読めない」→ パネルの文字を 15〜18px・幅 560px に拡大。
 *   その確認項目 c-2 を追加(版は引き続き v1.5.540 据え置き・第13版の結果待ち項目を消さないため)。
 * 第16版(v1.5.543・2026-09-17): オーナー指摘「手順が多すぎて大変」→ 全項目を「前提(prep・任意1行)／操作(steps・1〜2)／
 *   見るところ(check・最大4)」に分けて書き直した(id・版は据え置き・下書きはそのまま生きる)。準備 y-1 を先頭に移し、
 *   以降の項目は読み込んだ日大前データの上で行う前提にして、項目ごとの準備を減らした。確認項目 c-3 を追加。
 *   ★以後の書き方(オーナー確定 2026-09-17): 準備は Claude 側でできる限り済ませ、オーナーに頼むのは「操作 1〜2 個 → 見る場所」だけ。
 * 第17版(v1.5.548・2026-09-18): 室長の自教室復元(フラグ managerSelfRestore・開発用教室限定・docs/spec-save-restore.md §4-1)の
 *   s-1〜s-3 を追加(版は v1.5.540 据え置き・結果待ち項目を消さないため)。★s-2 は**保存しないで取り消す**手順にしてある
 *   (開発用教室には y 系の予行用に日大前データを読み込んであるので、復元を確定するとその準備が消える)。
 * 第18版(v1.5.549・2026-09-18): オーナー指示で室長復元を「パスワード → 画面中央の大きな確認モーダル(復元しても戻らないものを表示)」
 *   「直近7日 → 3日」へ変更。s-1/s-2 を新しい手順へ差し替え(id 据え置き・どちらも未確認のまま差し替えたので結果は失われない)。
 * 第20版その2(v1.5.553・2026-09-20): r-5 の結果「要改善」(オーナー確定 2026-09-20: 休日を解除したら「休」の生徒を元の席へ
 *   戻してほしい＝休日設定の逆操作)を受けて、r-5 を新仕様(復元・在庫の巻き戻し・別日に組んだ振替コマの削除)の
 *   確認手順へ差し替えた(id・版は据え置き。未確認のまま差し替えたので結果は失われない)。y-2 の注記に
 *   「丸ごと振替の『休』は戻らない(戻るのは休日設定で作られた『休』だけ)」を補記。
 * 第20版(v1.5.553・2026-09-20): b-2 の結果「要改善」(オーナー確定 2026-09-20: 退塾にしたら今日以降の手置きのコマと記録も
 *   消してほしい)を受けて、退塾スイープ(computeStudentWithdrawSweep)の確認手順へ差し替えた(id・版は据え置き。
 *   未確認のまま差し替えたので結果は失われない)。未消化へ戻さない・昨日以前は残る・他の生徒は無事、を見る。
 * 第22版(v1.5.555・2026-09-22): オーナー指摘「Webの確認リストが最新になっていない」→ 版を v1.5.540 から v1.5.555 へ上げた
 *   (据え置いたままだと v1.5.540 の下書き=前回の OK/要改善 の印がパネルに残り、差し替えた b-2/r-2/r-5 が確認済みに見えていた)。
 *   OK 済みの y-1(準備)を外し、y-2〜y-4 は「予行を始める前に控えた残数」と比べる書き方へ。前回その他欄の
 *   「最新データ表示なのに保存されていない」の修正(v1.5.553・INV-02)の確認 v-1 を追加。
 * 第23版(v1.5.556・2026-09-22): 第22版の結果(受付 e541141c)を反映。OK 済みの r-2/r-5/v-1/r-8/c-3/m-1〜m-3/s-1〜s-3 を外す。
 *   y-2 は要改善だが「本番教室では以降の丸ごと振替だけ今の仕様なら問題ないので、この予行は不要」(オーナー)→ y-2〜y-4 を外す
 *   (予行は中止。休日設定で作られた「休」が丸ごと振替の対象に選べない点は仕様どおり=振替対象は配置のあるコマだけ)。
 *   c-2 は要改善「すべての文字サイズが今の倍に」→ パネルの文字を全部 2 倍(24〜36px)・幅 1120px にして再確認へ差し替え。
 *   その他欄の 2 件: 「振替をさらに別日へ動かすと元の授業の振替先日が追いつかない(日程表は正しい)」の修正 t-1、
 *   「サーバーバックアップから復元(直近3日)を本番へ展開」= フラグ managerSelfRestore を全教室へ昇格した確認 s-4(本番教室では見るだけ)。
 *   b-2/b-3(退塾)・q-1〜q-6(保護者QR)は結果待ちのまま残す。版は v1.5.556 へ(差し替えた c-2 の前回の印を残さないため)。
 * 第24版(v1.5.557・2026-09-25): 開発ダッシュボード(開発者画面のサブページ・docs/spec-developer-report.md §E-3)の確認 d-1 を追加。
 *   第23版の項目(b-2/b-3/c-2/t-1/s-4/q-1〜q-6)は結果待ちのまま残す。★版は v1.5.556 据え置き(項目を足しただけ・
 *   第14版の決まり=版を上げると書きかけの下書きが消え、送信済みの結果もダッシュボードで「未確認」に戻る。regression-reviewer 指摘)。
 * 第25版(v1.5.558・2026-09-26): 緑が丘 室長指摘「講師日程共有の画面で振替先日付が追従していない」の修正確認 t-2 を追加
 *   (振替先を今週より前の週へ動かし直したとき、配布用盤面の「休」の日付が盤面と同じになる)。版は v1.5.556 据え置き(項目を足しただけ)。
 * 第26版(v1.5.559・2026-09-26): オーナー報告「開発者画面に講師の QR 提出モーダルが出た」の修正確認 d-2 を追加
 *   (開発者画面では教室の通知を購読しない。教室を開いた時点で改めて通知する)。版は v1.5.556 据え置き(項目を足しただけ)。
 * 第27版(v1.5.560・2026-09-26): オーナー決定「開発者は本番教室では表示だけで通知済みを記録しない」の確認 d-3 を追加
 *   (本番教室では見るだけ・書き込まない)。版は v1.5.556 据え置き(項目を足しただけ)。
 * 第28版(v1.5.562・2026-09-28): 緑が丘 室長報告「講師日程共有で 9/28 4限 体)小5算 が休み表示」の修正確認 t-3 を追加
 *   (別の生徒の休み記録が残る席に体験生を追加しても、配布用盤面でその生徒に「(休」が付かない)。版は v1.5.556 据え置き(項目を足しただけ)。
 * 第29版(v1.5.563・2026-09-28): オーナー指示「ダッシュボードの情報量が多い。未対応を一画面で・その画面から Claude Code に投げたい」
 *   → 既定を未対応一覧に替えた確認 d-4 を追加し、d-1 の手順を「詳細を見る」経由に直した(id は据え置き)。版は v1.5.556 据え置き(項目を足しただけ)。
 * 第30版(v1.5.564・2026-09-28): 第23〜29版の結果(受付 5e95f35b)を反映。OK 済みの b-2/b-3/c-2/t-1/s-4 を外す。
 *   d-4 は要改善「内容をクリックで詳細・Claude に投げる文章をもっとシンプルに・投げる文章をダッシュボードで事前に打てるように・
 *   ダッシュボードと確認リストの役割が重複しないように」→ 修正の確認手順へ差し替えた(id 据え置き)。
 *   t-2/t-3/q-1〜q-6/d-1〜d-3 は結果待ちのまま残す。版は v1.5.564 へ(差し替えた d-4 の前回の印を残さないため)。
 * 第31版(v1.5.565・2026-09-28): 「質問・要望」への回答を画面で返す(docs/spec-developer-report.md §G-3/§G-5・オーナー確定 2026-09-28
 *   「LINE ではなく画面で」「バッジだけ・自動では開かない」「全教室で即時」)。a-1〜a-3 を追加。版は v1.5.564 据え置き(項目を足しただけ)。
 *   ★Cloud Functions のデプロイが緑になり、Firestore ルール(reportAnswers)を反映してから確認する(ルールは main マージでは反映されない)。
 * 第19版(v1.5.550・2026-09-19): 保護者QRを「休み連絡」専用へ(docs/spec-parent-portal.md §0-5・開発用教室限定)。q-1〜q-5 を追加
 *   (版は v1.5.540 据え置き・結果待ち項目を消さないため)。スマホ(保護者ページ)と PC(盤面)の両方を使う。
 *   ★Cloud Functions のデプロイが緑になってから確認する(Hosting が先に出た数分間は休み連絡の送信が 400 になる)。
 * 第32版(v1.5.570・2026-09-28): 第31版の結果(受付 20260928-103642968-d4c32a94)で t-2/t-3/d-1〜d-4/a-1〜a-3 が OK → 外す。
 *   その他欄「回答だけでなく解決済みボタンも設けて対応完了したのがわかるように。解決済みは室長側には非表示でOK」の実装確認 a-4 を追加。
 *   q-1〜q-6 は結果待ちのまま残す。版は v1.5.570 へ(OK 済みを外したので上げる)。
 *   ★Cloud Functions(resolveDeveloperReport)のデプロイが緑になってから確認する。
 * 第33版(v1.5.572・2026-09-29): テンプレ差分反映の保留(2 行・緑)の盤面表示と解決操作(Issue #72・第 1 段 (B)・
 *   機能フラグ templateDiffApply・開発用教室限定)の tp-1〜tp-6 を追加。q-1〜q-6/a-4 は結果待ちのまま残す。
 *   版は v1.5.570 据え置き(項目を足しただけ・書きかけの下書きを消さないため)。
 * 第34版(v1.5.572・2026-09-29): テンプレ差分反映の第 1 段 (A) の実機確認 tp-7〜tp-12(講師交代の保存の確認文・講師の揃えと手置きの残存・
 *   削除した講師が戻らない・保存→再読込/別タブで保留が残る・QR 自動割振り講師が残り二重にならない・保存前の自動バックアップとレポート見出し)と、
 *   (C) の tp-13〜tp-15(保留の机が詰め替え・講習の自動割当・自己修復で動かない／退塾で下段も消える／保護者の休み連絡が下段の生徒では
 *   自動処理されない)を追加し、tp-4 に下段の移動の出席不可コマ確認を足した。q-1〜q-6/a-4/tp-1〜tp-6 は結果待ちのまま残す。
 *   版は v1.5.572 へ(次にデプロイされる版。オーナー指示で上げる＝v1.5.570 の書きかけの下書きはパネルから見えなくなる)。
 * 第35版(v1.5.573・2026-09-30): 第34版の結果(受付 20260930-024853040-0e2c42f6)で a-4・tp-1〜tp-14・tp-16 が OK → 外す。
 *   tp-15 は要改善「確認リストの保護者連絡の欄に入れて」→ 欄(area)を保護者QR(休み連絡)へ移して q-1〜q-6 の後に置いた(中身は据え置き・再確認)。
 *   その他欄「生徒 1 と生徒 2 の重複は別々で処理して…」の実装(テンプレ差分反映の席ごとの突き合わせ)の確認 tp-17〜tp-20 を追加。
 *   q-1〜q-6 は結果待ちのまま残す。版は v1.5.573 へ(OK 済みを外したので上げる)。
 */
export const VERIFICATION_CHECKLIST: VerificationChecklistDefinition = {
  version: VERIFICATION_CHECKLIST_VERSION,
  items: [
    // 保護者QRを「休み連絡」専用へ(docs/spec-parent-portal.md §0-5・開発用教室限定)。
    // ★Cloud Functions のデプロイが緑になってから確認する(Hosting が先に出た数分間は送信が 400 になる)。
    {
      id: 'q-1',
      area: '保護者QR(休み連絡)',
      title: '保護者ページに来月と連絡の入力欄が無くなり、授業の行をタップすると休み連絡の確認が出る',
      prep: '基本データで今月これから授業がある生徒の「QR」を開き、スマホで読み込む',
      steps: [
        '「次の月」が今月で止まること、ページ下部に文章やお名前の入力欄が無いことを見る',
        '今日以降の授業の行をタップ → 確認の画面で「やめる」',
      ],
      check: [
        '来月へは進めない(先月と今月だけ)',
        '今日以降の授業の行だけタップできる(過去の行・お休みの行・教室休みの行は反応しない)',
        '確認の画面に日付・時限・科目と、取り消しは電話で、の案内が出る(当日のコマは電話の案内が1行増える)',
        '「やめる」で何も送られない',
      ],
      introducedIn: 'v1.5.550',
    },
    {
      id: 'q-2',
      area: '保護者QR(休み連絡)',
      title: '休み連絡を送ると行に「休み連絡済」が付き、PCの盤面に四択のモーダルが出る',
      prep: 'PCで開発用教室の盤面を開いておく',
      steps: [
        'スマホで今日以降の授業の行をタップ →「お休みを連絡する」',
        'PCの盤面に出たモーダルを読む(まだ何も押さない)',
      ],
      check: [
        'スマホ: その行に「休み連絡済」が付き、もう一度タップしても送れない',
        'PC: 「保護者からの休み連絡」に生徒名・日付・時限・科目と、休み／振無休／振替先を今決める／何もしない の4つが出る',
        '「あとで(盤面を見る)」で左下の「保護者の休み連絡 1件」に畳め、押すとまた開く',
      ],
      introducedIn: 'v1.5.550',
    },
    {
      id: 'q-3',
      area: '保護者QR(休み連絡)',
      title: '「休み」を選ぶとそのコマが休みになり、保存すると次回から通知が出ない。保護者ページは「教室確認済」になる',
      prep: 'q-2 の続き(モーダルが出ている状態)',
      steps: [
        'モーダルで「休み」を押す → 盤面がその週へ移動し、その生徒が休みになったのを見て「保存」',
        'スマホのページを開き直す。そのあとPCをリロードする',
      ],
      check: [
        '盤面: その生徒のコマが「休み」になり、未消化振替に1件入る(メニューから休みにしたときと同じ)',
        'スマホ: 保存後に開き直すと、その行が「お休み(振替日は調整中です)」になっている(保存前は「教室確認済」だけ先に付く)',
        'PCをリロードしても同じ連絡のモーダルは出ない',
      ],
      introducedIn: 'v1.5.550',
    },
    {
      id: 'q-4',
      area: '保護者QR(休み連絡)',
      title: '「振替先を今決める」を選ぶと、休みにしたあとそのまま振替先の空席を選べる',
      prep: '別のコマでもう一度スマホから休み連絡を送っておく',
      steps: [
        'モーダルで「振替先を今決める」→ モーダルが畳まれ、盤面が振替の配置待ちになる',
        '別の日の空席を左クリックして振替を置き、保存する',
      ],
      check: [
        '元のコマは「休み」、クリックした空席に振替が入る(未消化振替から置いたときと同じ見た目)',
        '配置のあと、残りの休み連絡があればモーダルがもう一度開く',
        '途中で「キャンセル」した場合は、元のコマが休み＋未消化振替に1件で残る',
        'スマホ: 保存後、その行が「◯/◯ ◯限に振替」になる',
      ],
      introducedIn: 'v1.5.550',
    },
    {
      id: 'q-5',
      area: '保護者QR(休み連絡)',
      title: '四択を押しても保存せずに閉じたら、次に開いたとき同じ連絡がもう一度出る',
      prep: '別のコマでもう一度スマホから休み連絡を送っておく',
      steps: [
        'モーダルで「振無休」を押す → 盤面が振無休になったのを見る(保存しない)',
        '保存せずにPCをリロードする(未保存の確認が出たらそのまま離れる)',
      ],
      check: [
        'リロード後、同じ連絡のモーダルがもう一度出て「前回『振無休』を選びましたが、保存された盤面で確認が取れなかった…」の注意が付く',
        '盤面のそのコマは振無休になっていない(保存していないので元のまま)',
        'もう一度「何もしない」を押すとモーダルが消え、盤面は変わらず、リロードしても出ない',
      ],
      introducedIn: 'v1.5.550',
    },
    {
      id: 'q-6',
      area: '保護者QR(休み連絡)',
      title: '盤面の「保護者連絡」ボタンで休み連絡の履歴が見られ、未確認の行からモーダルを開ける',
      prep: 'スマホから休み連絡を 1 件送り、モーダルは「あとで(盤面を見る)」で畳んでおく',
      steps: [
        '盤面上部「通常授業テンプレ作成」の右の「保護者連絡」を押す(未確認の件数が数字で付いている)',
        '「未確認」の行を押す → 開いた休み連絡のモーダルで「休み」を選び、盤面を保存してからもう一度「保護者連絡」を開く',
      ],
      check: [
        '履歴は受信日時の新しい順で、q-1〜q-5 で処理した連絡に「確認済」と選んだ処理(休み/振無休 など)が付いている',
        '未確認の行を押すと、いつもの休み連絡モーダル(四択)が開く。確認済の行は押せない',
        '四択のどれかを押した時点で(保存前でも)その行が「確認済」になり、ボタンの数字が消える',
        '確認済が 10 件を超えたら古いものから表示されなくなる(未確認は古くても残る)',
      ],
      introducedIn: 'v1.5.552',
    },
    // 第35版(v1.5.573): tp-15 はオーナー指示(確認リスト v1.5.572 の要改善「確認リストの保護者連絡の欄に入れて」)で
    // 保護者QR(休み連絡)の欄へ移した(保護者QR から休み連絡を送る手順なので q-1〜q-6 と一緒に確かめる)。
    {
      id: 'tp-15',
      area: '保護者QR(休み連絡)',
      title: '保護者の休み連絡: 上段の生徒は従来どおり処理され、下段にしかいない生徒は自動処理されず一覧に残る',
      prep: '緑の机(手で振替を置いた席に、テンプレで別の生徒を入れて保存した机)の上段・下段の生徒それぞれの保護者QRから、その日の休み連絡を 1 件ずつ送っておく',
      steps: [
        '盤面の「保護者連絡」で、上段の生徒の連絡に「休み」、下段の生徒の連絡に「休み」を押す',
      ],
      check: [
        '上段の生徒は休みになり、机は緑でない 1 行に戻る',
        '下段の生徒の連絡は「保留（2 行・緑）の下段にいるため、自動では処理しませんでした」が出て一覧に残る',
        '下段の生徒には休みが付かない(盤面は変わらない)',
      ],
      introducedIn: 'v1.5.572',
    },
    // 席ごとの突き合わせ(オーナー指示 2026-09-30・確認リスト v1.5.572 その他欄「生徒 1 と生徒 2 の重複は別々で処理して。
    // そうすればテンプレ空白なら既存があれば自動で 1 行になるはず。また片方が通常同士なのに 2 行になることもない」)。
    // docs/spec-template-behavior.md §H Q34。開発用教室限定(機能フラグ templateDiffApply)。
    {
      id: 'tp-17',
      area: '盤面(テンプレ保留)',
      title: '生徒 1 が通常授業・生徒 2 に振替の机は、講師だけ交代してテンプレ保存しても緑(2 行)にならず 1 行のまま',
      prep: '反映日以降の、生徒 1 に通常授業がある机の生徒 2 の空席に振替を 1 件手で置いておく',
      steps: [
        '通常授業テンプレ作成でその机の講師だけを別の講師に替えて(生徒は変えない)、反映開始日以降を保存する(確認文を読んでから OK)',
      ],
      check: [
        '確認文に「テンプレの空いた席に既存の生徒を残して 1 行にする 1机」が出る',
        '保存後、その机は緑にならず、生徒 1 の通常授業・生徒 2 の振替・新しい講師の 1 行',
        '未消化振替の件数は保存前と同じ。リロードしても同じ',
      ],
      introducedIn: 'v1.5.573',
    },
    {
      id: 'tp-18',
      area: '盤面(テンプレ保留)',
      title: '生徒 1 の通常授業をテンプレで別の生徒に替えても、生徒 2 の振替は残って 1 行のまま',
      prep: 'tp-17 と同じ形の机(生徒 1 に通常授業・生徒 2 に手置きの振替)を用意する',
      steps: [
        '通常授業テンプレ作成でその机の生徒 1 を別の生徒に替え(生徒 2 は空のまま)、反映開始日以降を保存する',
      ],
      check: [
        'その机は緑にならず、生徒 1 が新しいテンプレの生徒・生徒 2 が振替の 1 行',
        '生徒 1 だった生徒はその日のそのコマから消える(ほかの机にも増えない)',
      ],
      introducedIn: 'v1.5.573',
    },
    {
      id: 'tp-19',
      area: '盤面(テンプレ保留)',
      title: 'テンプレが生徒 1・生徒 2 の両方を埋めると、ぶつかった生徒 2 の席だけ緑の下段になり、「既存を採用」は生徒 2 だけ入れ替わる',
      prep: 'tp-17 と同じ形の机(生徒 1 に通常授業・生徒 2 に手置きの振替)を用意する',
      steps: [
        '通常授業テンプレ作成でその机の生徒 2 に別の生徒を入れて(生徒 1 は同じ)、反映開始日以降を保存する',
        '緑の机の下段を押して「既存を採用」→ OK',
      ],
      check: [
        '保存後、下段には生徒 2 の席の振替だけが出る(生徒 1 の席の下段は空)',
        '「既存を採用」の後は、生徒 1 の通常授業はそのまま・生徒 2 が振替の 1 行になる',
        'メッセージで取り下げたのは生徒 2 に入れたテンプレの生徒だけ',
      ],
      introducedIn: 'v1.5.573',
    },
    {
      id: 'tp-20',
      area: '盤面(テンプレ保留)',
      title: '生徒 2 の席だけ緑の机で、上段の生徒 2 を削除するとその席に下段の振替が戻って 1 行になる',
      prep: 'tp-19 の 1 つ目の操作で緑の机を作る(「既存を採用」は押さない)',
      steps: [
        '緑の机の上段の生徒 2 を押して「削除」',
      ],
      check: [
        '机が緑でない 1 行に戻り、生徒 1 の通常授業はそのまま・生徒 2 の席に振替が戻る',
        '「元に戻す」1 回で緑の 2 行に戻る',
      ],
      introducedIn: 'v1.5.573',
    },
  ],
}

export type VerificationChecklistEntry = {
  status: VerificationChecklistStatus
  memo: string
}

export type VerificationChecklistDraft = {
  version: string
  entries: Record<string, VerificationChecklistEntry>
  /** 項目に紐づかない自由記入(その他の気づき)。 */
  otherNotes: string
}

/** 下書きの localStorage キー接頭辞。教室別・版別に分ける(他教室の下書きが混ざらない)。 */
export const VERIFICATION_CHECKLIST_STORAGE_PREFIX = 'verification-checklist'
/** 折りたたみ状態のキー(教室をまたいで共通)。 */
export const VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY = `${VERIFICATION_CHECKLIST_STORAGE_PREFIX}:collapsed`

export function verificationChecklistStorageKey(
  classroomId: string | null | undefined,
  version: string = VERIFICATION_CHECKLIST.version,
): string {
  return `${VERIFICATION_CHECKLIST_STORAGE_PREFIX}:${classroomId ?? 'unknown'}:${version}`
}

export function createEmptyVerificationChecklistDraft(
  version: string = VERIFICATION_CHECKLIST.version,
): VerificationChecklistDraft {
  return { version, entries: {}, otherNotes: '' }
}

function normalizeStatus(raw: unknown): VerificationChecklistStatus {
  return typeof raw === 'string' && (VERIFICATION_CHECKLIST_STATUSES as readonly string[]).includes(raw)
    ? (raw as VerificationChecklistStatus)
    : 'unchecked'
}

export function serializeVerificationChecklistDraft(draft: VerificationChecklistDraft): string {
  return JSON.stringify({
    version: draft.version,
    entries: draft.entries,
    otherNotes: draft.otherNotes,
  })
}

/**
 * 保存済み文字列を下書きへ戻す。壊れた JSON・別版・想定外の形はすべて空の下書きとして扱う
 * (下書きが壊れてもパネルが落ちない・本番データには一切影響しない)。
 */
export function parseVerificationChecklistDraft(
  raw: unknown,
  version: string = VERIFICATION_CHECKLIST.version,
): VerificationChecklistDraft {
  const empty = createEmptyVerificationChecklistDraft(version)
  if (typeof raw !== 'string' || !raw.trim()) return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return empty
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty
  const candidate = parsed as { version?: unknown; entries?: unknown; otherNotes?: unknown }
  if (typeof candidate.version === 'string' && candidate.version !== version) return empty
  const entries: Record<string, VerificationChecklistEntry> = {}
  if (candidate.entries && typeof candidate.entries === 'object' && !Array.isArray(candidate.entries)) {
    for (const [id, value] of Object.entries(candidate.entries as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = value as { status?: unknown; memo?: unknown }
      const status = normalizeStatus(entry.status)
      const memo = typeof entry.memo === 'string' ? entry.memo : ''
      if (status === 'unchecked' && !memo) continue
      entries[id] = { status, memo }
    }
  }
  return {
    version,
    entries,
    otherNotes: typeof candidate.otherNotes === 'string' ? candidate.otherNotes : '',
  }
}

/** 1項目を書き換えた新しい下書きを返す(純関数・元は変えない)。 */
export function setVerificationChecklistEntry(
  draft: VerificationChecklistDraft,
  id: string,
  patch: Partial<VerificationChecklistEntry>,
): VerificationChecklistDraft {
  const current = draft.entries[id] ?? { status: 'unchecked' as VerificationChecklistStatus, memo: '' }
  const next: VerificationChecklistEntry = {
    status: patch.status ?? current.status,
    memo: patch.memo ?? current.memo,
  }
  return { ...draft, entries: { ...draft.entries, [id]: next } }
}

/**
 * メモ欄の入力を反映する(純関数)。メモ欄は結果に関わらず常に出すので、**未確認のままメモを書いたら要改善に切り替える**
 * (未確認の行は送信本文に載らない＝書いたメモが黙って捨てられるのを防ぐ・2026-09-13)。OK/要改善はそのまま。
 */
export function setVerificationChecklistMemo(
  draft: VerificationChecklistDraft,
  id: string,
  memo: string,
): VerificationChecklistDraft {
  const current = getVerificationChecklistEntry(draft, id)
  const status: VerificationChecklistStatus = current.status === 'unchecked' && memo.trim() ? 'needs-fix' : current.status
  return setVerificationChecklistEntry(draft, id, { status, memo })
}

export function setVerificationChecklistOtherNotes(
  draft: VerificationChecklistDraft,
  otherNotes: string,
): VerificationChecklistDraft {
  return { ...draft, otherNotes }
}

export function getVerificationChecklistEntry(
  draft: VerificationChecklistDraft,
  id: string,
): VerificationChecklistEntry {
  return draft.entries[id] ?? { status: 'unchecked', memo: '' }
}

export type VerificationChecklistProgress = {
  total: number
  checked: number
  ok: number
  needsFix: number
  remaining: number
}

/** 進捗カウント(折りたたみボタンの「確認リスト n/N」用)。 */
export function countVerificationChecklistProgress(
  draft: VerificationChecklistDraft,
  items: readonly VerificationChecklistItem[] = VERIFICATION_CHECKLIST.items,
): VerificationChecklistProgress {
  let ok = 0
  let needsFix = 0
  for (const item of items) {
    const status = getVerificationChecklistEntry(draft, item.id).status
    if (status === 'ok') ok += 1
    else if (status === 'needs-fix') needsFix += 1
  }
  const checked = ok + needsFix
  return { total: items.length, checked, ok, needsFix, remaining: items.length - checked }
}

/** 送信本文の先頭に必ず付く目印。開発者が受信メールで確認リストだと判別できるようにする。 */
export function buildVerificationChecklistMarker(version: string = VERIFICATION_CHECKLIST.version): string {
  return `[確認リスト ${version}]`
}

function singleLineMemo(memo: string): string {
  return memo.replace(/\r\n?/gu, '\n').split('\n').map((line) => line.trim()).filter(Boolean).join(' / ')
}

/** 送信本文の明細行(未確認は省略)。生徒名などは載せない＝項目 id とメモだけ。 */
function buildVerificationChecklistLines(
  draft: VerificationChecklistDraft,
  items: readonly VerificationChecklistItem[],
): string[] {
  const lines: string[] = []
  for (const item of items) {
    const entry = getVerificationChecklistEntry(draft, item.id)
    if (entry.status === 'unchecked') continue
    const memo = singleLineMemo(entry.memo)
    if (entry.status === 'ok') lines.push(memo ? `- ${item.id} OK: ${memo}` : `- ${item.id} OK`)
    else lines.push(memo ? `- ${item.id} 要改善: ${memo}` : `- ${item.id} 要改善`)
  }
  const other = singleLineMemo(draft.otherNotes)
  if (other) lines.push(`- その他: ${other}`)
  return lines
}

function packLines(lines: string[], header: string, limit: number): string[] {
  const budget = limit - header.length - 1
  const parts: string[] = []
  let buffer: string[] = []
  let used = 0
  for (const rawLine of lines) {
    // 1行だけで上限を超える長文メモは、その行を切って必ず収める(送信不能にしない)。
    const line = rawLine.length > budget ? `${rawLine.slice(0, Math.max(0, budget - 1))}…` : rawLine
    const cost = buffer.length === 0 ? line.length : line.length + 1
    if (buffer.length > 0 && used + cost > budget) {
      parts.push(buffer.join('\n'))
      buffer = [line]
      used = line.length
      continue
    }
    buffer.push(line)
    used += cost
  }
  if (buffer.length > 0) parts.push(buffer.join('\n'))
  return parts
}

/**
 * 確認リストを「要望・報告」の本文(複数通)に整形する。
 *  - 先頭行は必ず目印 `[確認リスト <版>]`(分割時は `(1/2)` 等を付ける)。
 *  - 未確認の項目は省略。何も確認していなければ空配列を返す(= 送らない)。
 *  - 1通が DEVELOPER_REPORT_NOTE_LIMIT(2000字)を超えないように分割する。
 */
export function buildVerificationChecklistReportNotes(
  draft: VerificationChecklistDraft,
  options?: { items?: readonly VerificationChecklistItem[]; limit?: number },
): string[] {
  const items = options?.items ?? VERIFICATION_CHECKLIST.items
  const limit = options?.limit ?? DEVELOPER_REPORT_NOTE_LIMIT
  const lines = buildVerificationChecklistLines(draft, items)
  if (lines.length === 0) return []
  const marker = buildVerificationChecklistMarker(draft.version)

  const single = `${marker}\n${lines.join('\n')}`
  if (single.length <= limit) return [single]

  // 分割が必要。通数は「(i/n)」の桁数に依存するので、通数が安定するまで数回試す。
  let total = packLines(lines, `${marker} (1/9)`, limit).length
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const header = `${marker} (1/${total})`
    const parts = packLines(lines, header, limit)
    if (parts.length === total) {
      return parts.map((body, index) => `${marker} (${index + 1}/${total})\n${body}`)
    }
    total = parts.length
  }
  const parts = packLines(lines, `${marker} (1/${total})`, limit)
  return parts.map((body, index) => `${marker} (${index + 1}/${parts.length})\n${body}`)
}

const STATUS_LABELS: Record<VerificationChecklistStatus, string> = {
  unchecked: '未確認',
  ok: 'OK',
  'needs-fix': '要改善',
}

export function verificationChecklistStatusLabel(status: VerificationChecklistStatus): string {
  return STATUS_LABELS[status]
}

/** クリップボード用の Markdown(送信できないときの保険)。未確認も含めて全項目を出す。 */
export function buildVerificationChecklistMarkdown(
  draft: VerificationChecklistDraft,
  items: readonly VerificationChecklistItem[] = VERIFICATION_CHECKLIST.items,
): string {
  const progress = countVerificationChecklistProgress(draft, items)
  const lines: string[] = [
    `# ${buildVerificationChecklistMarker(draft.version)}`,
    `確認 ${progress.checked}/${progress.total}(OK ${progress.ok} / 要改善 ${progress.needsFix})`,
    '',
  ]
  let currentArea = ''
  for (const item of items) {
    if (item.area !== currentArea) {
      currentArea = item.area
      lines.push(`## ${currentArea}`)
    }
    const entry = getVerificationChecklistEntry(draft, item.id)
    const box = entry.status === 'ok' ? 'x' : ' '
    lines.push(`- [${box}] ${item.id} ${item.title} — ${verificationChecklistStatusLabel(entry.status)}`)
    const memo = singleLineMemo(entry.memo)
    if (memo) lines.push(`  - メモ: ${memo}`)
  }
  const other = singleLineMemo(draft.otherNotes)
  if (other) {
    lines.push('')
    lines.push('## その他の気づき')
    lines.push(`- ${other}`)
  }
  return lines.join('\n')
}
