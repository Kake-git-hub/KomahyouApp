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
export const VERIFICATION_CHECKLIST_VERSION = 'v1.5.540'

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
 * 第19版(v1.5.550・2026-09-19): 保護者QRを「休み連絡」専用へ(docs/spec-parent-portal.md §0-5・開発用教室限定)。q-1〜q-5 を追加
 *   (版は v1.5.540 据え置き・結果待ち項目を消さないため)。スマホ(保護者ページ)と PC(盤面)の両方を使う。
 *   ★Cloud Functions のデプロイが緑になってから確認する(Hosting が先に出た数分間は休み連絡の送信が 400 になる)。
 */
export const VERIFICATION_CHECKLIST: VerificationChecklistDefinition = {
  version: VERIFICATION_CHECKLIST_VERSION,
  items: [
    {
      id: 'y-1',
      area: '準備(日大前データ)',
      title: '準備: 開発用教室へ日大前のバックアップ(1/1→1/29・1/2→1/30 丸ごと振替＋休日設定済み)を読み込む',
      prep: '開発用教室の今のデータは上書きされる。以降の項目はすべてこの日大前データの上で行う',
      steps: [
        'バックアップ・復元画面 →「他教室のバックアップをこの教室に読み込む」→「読み込み候補を取得」',
        '読み込み元=日大前校、時点=2026-09-16 の「丸ごと振替＋12/30〜1/2 休日設定」の後を選ぶ → 確認画面の人数が日大前と合っているか見て読み込み → 保存',
      ],
      check: [
        '盤面: 2027/1/1(金)・1/2(土)が休日で空、1/29(金)・1/30(土)に振替コマが並ぶ',
        '未消化振替・未消化講習の残数を控える(以降の項目では「変わらない」だけを見る)',
        '食い違い(1/1 に何か残っている・1/29 が空など)があればメモに書いて、ここで止める',
      ],
      introducedIn: 'v1.5.541',
    },
    {
      id: 'b-2',
      area: '基本データ',
      title: '「退塾」ボタンを押すと、今日から退塾扱いになる(一覧・盤面の通常授業から消え、削除ボタンが出る)',
      prep: '今日の盤面に通常授業がある生徒を1人選び、その生徒の講習か振替のコマを今日へ1つ手で置いておく',
      steps: [
        '基本データ → 生徒タブ → その生徒の「退塾」→ 確認画面(「本日から非在籍」「手で置いた講習・振替のコマは残ります」)→「退塾にする」',
      ],
      check: [
        '一覧からすぐ消え、「非在籍生徒表示」を押すと出る(退塾日=今日)。その行に「削除」ボタンが今日から出ている(押さない)',
        '盤面: その生徒の今日(と今日以降)の通常授業が消えている。手で置いた講習・振替のコマは残っている',
        '生徒日程表: その生徒が一覧に出ない',
      ],
      introducedIn: 'v1.5.528',
    },
    {
      id: 'r-1',
      area: '盤面',
      title: '通常授業を別の日へドラッグ移動すると、移動元が「休)」表示になる(内部の会計は移動のまま)',
      steps: ['通常授業の生徒名を長押し → 別の日のコマへドラッグ移動'],
      check: [
        '移動元: 「氏名(休 月/日」(「移」ではなく「休」・日付は移動先の日)。クリックすると「休)表示解除(移動元)」ボタンがある',
        '移動先: 振替として置かれている',
        '未消化振替の残数が変わらない',
      ],
      introducedIn: 'v1.5.540',
    },
    {
      id: 'r-2',
      area: '盤面',
      title: '丸ごと振替をすると、振替元の日の通常授業の生徒が全員「休)」表示で残る',
      steps: ['通常授業のある日の日付メニュー →「丸ごと振替」→ 別の営業日をクリック → 確認画面で実行'],
      check: [
        '振替元の日: 通常授業だった生徒ごとに「氏名(休 月/日」(日付は振替先)。振替・講習・増コマ・体験だった生徒は何も残らない',
        '未消化振替・未消化講習の残数が変わらない',
        '同じ日をもう一度丸ごと振替しようとすると「出欠記録があるため丸ごと振替できません」(仕様)',
      ],
      introducedIn: 'v1.5.540',
    },
    {
      id: 'r-3',
      area: '盤面',
      title: '休日設定しても、その日の生徒が「休」として残る(リロードしても消えない)',
      prep: '未出欠・出席・振無休・休みの生徒が混じる日を選ぶ',
      steps: ['その日を休日設定 → 保存 → Ctrl+Shift+R'],
      check: [
        'セルは灰色で、生徒ごとに「休」が残る(休みだった生徒は休みのまま)。講師名や授業は出ない',
        '「休」をクリックすると「休日記録の表示解除」ボタンだけが出る',
        '未消化の残数は、休日設定で戻った分だけ増える(休みだった生徒の分は増えない)',
      ],
      introducedIn: 'v1.5.540',
    },
    {
      id: 'r-4',
      area: '盤面',
      title: '丸ごと振替 → 振替元の日を休日設定、の流れで「休)」が残る',
      prep: 'r-2 で丸ごと振替した振替元の日で行う',
      steps: ['その日を休日設定 → 保存 → Ctrl+Shift+R'],
      check: [
        '全員の「休」が残っている。「休」をクリックすると解除ボタンだけ出て、押すとその1件だけ消える',
        '未消化の残数が丸ごと振替の前と変わらない',
      ],
      introducedIn: 'v1.5.540',
    },
    {
      id: 'r-5',
      area: '盤面',
      title: '休日を解除すると、その席は休日設定前と同じように操作できる',
      prep: 'r-3 で休日設定した日で行う',
      steps: [
        '休日を解除 → Ctrl+Shift+R',
        '「休」が残る席へ別の生徒をドラッグ移動する。別の席では「休」をクリック →「生徒追加」で生徒を置く',
      ],
      check: [
        '「休」が残る机の講師が休日設定前と同じ。「休」をクリックすると「生徒追加・体験授業・メモ・休日記録の表示解除」の4ボタン',
        'ドラッグで置いた席は「休」が消える。未消化の残数は変わらない',
        '「生徒追加」で置いた席は「休」が生徒の下に隠れて残り、生徒を外すとまた見える(移動元の記録と同じ仕様)',
      ],
      introducedIn: 'v1.5.540',
    },
    {
      id: 'r-6',
      area: '日程表',
      title: '生徒日程表の振替欄が、振替元の日から「科目 元 → 先 / 未定」で出る',
      prep: '振替元の日だけが表示期間に入り、振替先の日は期間外になる生徒を選ぶ',
      steps: ['その生徒の生徒日程表を開く(休みの多い生徒なら印刷プレビューも開く)'],
      check: [
        '振替欄: 「科目 振替元(月/日 限) → 振替先(月/日 限)」。まだ振替を組んでいない(未消化一覧にある)授業は「→ 未定」',
        'r-1 移動元・r-2 丸ごと振替・r-3 休日設定で「休」になった授業も振替欄に出る。元も先も期間内の振替は1行だけ(2回出ない)',
        '印刷プレビューで振替欄が枠からはみ出さない',
      ],
      introducedIn: 'v1.5.540',
    },
    {
      id: 'r-7',
      area: '日程表',
      title: '「休」の記録が、生徒日程表のコマ表示には出て、回数・講師日程表・給与には数えられない',
      steps: ['r-1〜r-3 の生徒の生徒日程表と、その講師の講師日程表を開く'],
      check: [
        '生徒日程表: 該当コマに「休 月/日」のカードが出る。長押ししても掴めない(コマ組みで動かせない)',
        '通常回数の実績が、移動・丸ごと振替・休日設定の前後で増えていない',
        '講師日程表: その講師のセル・給与・交通費の日数・回数が増えていない',
      ],
      introducedIn: 'v1.5.540',
    },
    {
      id: 'r-8',
      area: '配布用盤面',
      title: '配布用盤面でも、移動元・休日の記録が盤面と同じ「休」表記になる',
      steps: ['盤面の共有(配布用盤面)を開き、r-1〜r-3 のコマを見る'],
      check: [
        '盤面と同じ「休」表記になっている(「移」ではない)',
        '休日の日の記録がある机に講師名が出るのは既知の挙動(直すかは結果メモで指示してください)',
      ],
      introducedIn: 'v1.5.540',
    },
    {
      id: 'y-2',
      area: '予行(日大前データ)',
      title: '手順1〜2: 1/1 の休日を解除し、1/29 から 1/1 へ丸ごと振替で戻す(1/2 と 1/30 も同じ)',
      steps: [
        '1/1 の休日設定を解除する',
        '1/29 の日付メニュー →「丸ごと振替」→ 1/1 をクリック → 確認画面の件数を見て実行',
      ],
      check: [
        '休日解除の直後、1/1 は営業日になるがテンプレの通常授業や講師は湧かず空のまま',
        '丸ごと振替のあと、1/1 に生徒が「通常授業(通)」として戻り、講師も 1/29 と同じ机に並ぶ。1/29 は空',
        '未消化の残数が y-1 の控えと同じ',
        '1/2 → 休日解除、1/30 → 1/2 へ丸ごと振替、でも同じ',
      ],
      introducedIn: 'v1.5.541',
    },
    {
      id: 'y-3',
      area: '予行(日大前データ)',
      title: '手順3: 1/1 から 1/29 へもう一度丸ごと振替すると、1/1 に全員の「休)」が残る(1/2 と 1/30 も同じ)',
      steps: ['1/1 の日付メニュー →「丸ごと振替」→ 1/29 をクリック → 実行'],
      check: [
        '1/29: 生徒が「振替(振)」として並び、講師も元の机に戻る。1/1: 通常授業だった生徒ごとに「氏名(休 1/29」が残る',
        '未消化の残数が y-1 の控えと同じ',
        '1/2 → 1/30 でも同じ',
      ],
      introducedIn: 'v1.5.541',
    },
    {
      id: 'y-4',
      area: '予行(日大前データ)',
      title: '手順4: 1/1 を再び休日設定しても「休)」が残り、残数が最初と同じ(1/2 も同じ)',
      steps: ['1/1 と 1/2 を休日設定 → 保存 → Ctrl+Shift+R'],
      check: [
        '完了メッセージが「移行対象の授業はありませんでした」(ストックへ移る件数 0)。セルは灰色で全員の「休」が残り、リロード後も残る',
        '未消化の残数が y-1 の控えと最後まで同じ(違ったら、どの生徒・どちらの一覧で何件違うかをメモに)',
        '生徒日程表: 1/1 のコマが「休 1/29」、振替欄に「科目 1/1 N限 → 1/29 N限」。12/30・12/31 など他の日は予行の前と変わっていない',
        '問題なければ、日大前・緑が丘の本番で同じ手順を行えるように「全教室展開してよい」とメモで指示してください',
      ],
      introducedIn: 'v1.5.541',
    },
    {
      id: 'c-2',
      area: '確認リスト',
      title: '確認リストの文字が大きくなり、拡大しなくても読める',
      steps: ['右下の「確認リスト」ボタンでパネルを開く'],
      check: [
        '見出し・手順・OK/要改善・メモ欄の文字が以前より大きく(本文 15px 程度)、パネルの幅も広い。長い項目も横に途切れず折り返す',
        '高さは画面の 85% まででスクロールでき、下の「保存して送信」ボタンが隠れない',
        'まだ小さい・大きすぎる部分があれば、どこ(見出し／手順／ボタン)をどれくらいにしてほしいかをメモに',
      ],
      introducedIn: 'v1.5.542',
    },
    {
      id: 'c-3',
      area: '確認リスト',
      title: '各項目が「前提／操作／見るところ」に分かれ、操作が1〜2個で済む書き方になった',
      steps: ['どの項目でもよいので1つ読む'],
      check: [
        '灰色の「前提」(ある項目だけ)→ 番号つきの「操作」(1〜2個)→ 「見るところ」の順で並び、前より短く読める',
        'まだ手数が多い・準備が重い項目があれば、その id をメモに(準備は Claude が先回りして減らします)',
      ],
      introducedIn: 'v1.5.543',
    },
    // 複数会社展開 Phase 1(会社レイヤ・docs/spec-multi-tenant.md §11): 既定値では見た目・帳票が変わらないことを確かめる。
    {
      id: 'm-1',
      area: '会社レイヤ(変化なしの確認)',
      title: 'タブ名・ログイン画面・アカウント一覧の役割表示が今までと同じ',
      steps: ['ログイン画面 → 開発者でログイン → 開発用教室を開く'],
      check: [
        'ログイン画面の題名が「コマ表アプリログイン」、アカウント一覧の役割が「開発者」「教室管理者」のまま',
        'ブラウザのタブ名が「開発用教室 | コマ表アプリ」(開発者画面は「開発者画面 | コマ表アプリ」)のまま',
        '違う文言が出ていたら、その画面と文言をメモに',
      ],
      introducedIn: 'v1.5.544',
    },
    {
      id: 'm-2',
      area: '会社レイヤ(変化なしの確認)',
      title: '生徒日程表・講師日程表・空フォーマットの上部(ロゴ欄/校舎名/題名/期間/氏名)と末尾が今までと同じ',
      steps: ['盤面「生徒日程」→ 誰か 1 人を表示 →「空フォーマット印刷」も開く', '盤面「講師日程」→ 誰か 1 人を表示'],
      check: [
        '各表の上部にロゴ欄(ロゴを入れていれば自分のロゴ)・校舎名欄・題名欄・期間/氏名/ページが従来どおり並ぶ',
        '回数表の下に見覚えのない注記や枠が増えていない',
        '講習集計結果の「提出方法」が「QR提出」「室長登録」のまま',
      ],
      introducedIn: 'v1.5.544',
    },
    {
      id: 'm-3',
      area: '会社レイヤ(変化なしの確認)',
      title: '盤面ツールバーとメニューのボタン数が今までと同じ',
      steps: ['盤面で「メニュー」を開く', 'ツールバー左側(並べ替え〜質問・要望)を見る'],
      check: [
        'メニューは「コマ表／基本データ／特別講習データ／自動割振ルール／バックアップ/復元/初期設定／ログアウト」だけ',
        'ツールバーに見覚えのないボタンが増えていない',
      ],
      introducedIn: 'v1.5.544',
    },
    // 室長の自教室復元(docs/spec-save-restore.md §4-1・フラグ managerSelfRestore・開発用教室限定)。
    {
      id: 's-1',
      area: 'バックアップ/復元',
      title: '「サーバーバックアップから復元(直近3日)」で、画面中央に大きな確認メッセージが出る(パスワードは聞かれない)',
      steps: [
        'メニュー → バックアップ/復元/初期設定 →「バックアップ時点を取得」→ 時点を1つ選んで「この時点へ復元」',
        '確認メッセージを読んで「やめる」を押す',
      ],
      check: [
        '時点の一覧が直近3日分だけ・新しい順に並ぶ(直近24時間は15分毎)',
        '確認メッセージが画面中央に大きく出て、教室名・戻す時点・生徒数/講師数/テンプレのコマ数が読める',
        '「復元しても戻らないもの」の枠に、QR提出の講習希望・保護者からの連絡・「通常授業履歴」の記録・操作の記録が並ぶ(わかりにくい言葉があればメモに)',
        '「やめる」で閉じ、盤面のデータは変わらない',
      ],
      introducedIn: 'v1.5.549',
    },
    {
      id: 's-2',
      area: 'バックアップ/復元',
      title: '確認メッセージで「この時点を読み込む」を押すと過去の時点が読み込まれ、保存前なら「直前の状態に戻す」で取り消せる',
      prep: '保存はしない(開発用教室には y 系の確認用に日大前データを入れてあるため、読み込んだら必ず取り消す)',
      steps: [
        '同じ画面で、できるだけ古い時点を選び「この時点へ復元」→ 確認メッセージの「この時点を読み込む」',
        '盤面に切り替わったら内容を見て、上部の「直前の状態に戻す」を押す',
      ],
      check: [
        '読み込み後は盤面が選んだ時点の内容になり、保存ボタンが未保存の状態になる(自動では保存されない)',
        '「直前の状態に戻す」で読み込む前の内容(日大前データ)に戻る',
      ],
      introducedIn: 'v1.5.549',
    },
    {
      id: 's-3',
      area: 'バックアップ/復元',
      title: '本番教室(日大前・緑が丘)の復元画面には、まだこのパネルが出ない',
      steps: ['開発者でログイン → 日大前校か緑が丘校を開く → メニュー → バックアップ/復元/初期設定(見るだけ・何も押さない)'],
      check: [
        '「サーバーバックアップから復元(直近3日)」のパネルが無い(手動バックアップ・復元・初期設定フローだけ)',
      ],
      introducedIn: 'v1.5.548',
    },
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
