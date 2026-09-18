import type { DevelopmentClassroomIdentity } from './developmentClassroom'
import { isDevelopmentClassroom } from './developmentClassroom'
import { resolveCompanyFeatureDefault, resolveFeatureEnabledByLayers } from './companyFeatureDefaults'
import { getFirebaseBackendConfig } from '../integrations/firebase/config'

// staging 検証環境(komahyouapp-staging)の判定。staging 先行機能は教室IDではなく環境(プロジェクトID)で
// 有効化する(stagingテスト教室は開発用教室IDではないため)。現在 staging-environment スコープを使う
// 機能は無いが、将来の staging 先行機能のために判定基盤は残す。
export const STAGING_PROJECT_ID = 'komahyouapp-staging'

export function isStagingEnvironment(projectId?: string): boolean {
  const resolvedProjectId = projectId ?? getFirebaseBackendConfig().projectId
  return resolvedProjectId === STAGING_PROJECT_ID
}

export type FeatureRolloutScope = 'development-only' | 'all-classrooms' | 'staging-environment'

type FeatureRolloutDefinition = {
  scope: FeatureRolloutScope
  description: string
}

export const featureRolloutRegistry = {
  // Validated in 開発用教室 and promoted to every classroom: all classrooms now share the
  // same save flow (retries, immediate progress bar, fallback backup on Firebase failures).
  manualFirebaseSaveStability: {
    scope: 'all-classrooms',
    description: 'Manual save retries and fallback backup download on Firebase failures.',
  },
  // Already promoted to all classrooms.
  scheduleQrPopupBehavior: {
    scope: 'all-classrooms',
    description: 'QR submission behavior in schedule popups (show submitted state and submitted QR).',
  },
  // 生徒日程表: 休み欄を削除し振替授業欄を左に詰め、空いたスペースにオプション欄(2列5行)を追加する。
  // 左列=学年共通のテキスト入力、右列=QR提出のチェック状態。開発用教室で検証後、全教室へ展開済み
  // (オーナー指示 2026-06-27)。
  studentScheduleOptionField: {
    scope: 'all-classrooms',
    description: 'Student schedule: remove absence box, shift makeup left, add 2-col x 5-row option field.',
  },
  // 生徒名を長押し(約250ms)してから掴み、別の机コマへドラッグ&ドロップで移動できる。ライブ盤面の
  // 机ベース生徒(通常/振替/講習)のみ。実移動は既存 executeMoveStudent を再利用(入れ替え/各種ブロック踏襲)。
  // 開発用教室で先行後、オーナー指示で全教室へ展開(2026-06-28)。回帰で development-only へ戻さない。
  studentDragAndDropMove: {
    scope: 'all-classrooms',
    description: 'Long-press drag-and-drop move of a student name between desks on the live board.',
  },
  // 講師を生徒と同様に長押しD&Dして、同一コマ内の別の机へ移動/入れ替えできる。生徒は動かさず机の
  // 「講師ブロック」だけを入れ替える(移動先が空きなら単純移動、講師がいれば入れ替え)。同一コマ限定
  // (別コマへのドロップは無効)。実移動は純関数 computeTeacherMove に集約。開発用教室で先行検証後、
  // オーナー確定(2026-07-09)で全教室へ昇格。回帰で development-only へ戻さない。
  teacherDragAndDropMove: {
    scope: 'all-classrooms',
    description: 'Long-press drag-and-drop move/swap of a teacher between desks within the same slot column.',
  },
  // 日程表コマ組み(spec-student-schedule-dnd): 生徒日程表(別タブ)の授業カードを長押しD&Dで空きコマへ移し、
  // 机選択モーダルで席を選んで盤面の executeScheduleViewMove を呼ぶ。自動割振ルール・警告は無関係(物理的な空きのみ)。
  // staging→本番の開発用教室と段階検証し、オーナー確定(2026-07-09)で全教室へ展開。回帰で staging-environment へ戻さない。
  studentScheduleDndMove: {
    scope: 'all-classrooms',
    description: 'Drag-and-drop lesson move on the generated-HTML student schedule tab (long-press card -> empty slot -> desk picker -> board move).',
  },
  // 別タブ日程表の自動同期(盤面編集をデバウンス約1.5秒で自動反映)＋同期スピナー。コマ組み(別タブD&D)の移動結果を
  // 別タブへ即反映するために必要。2026-06-05 のポップアップ再生成メモリ障害はデバウンス+fingerprintスキップ+表示範囲限定で
  // 緩和済み。staging→開発用教室で検証後、コマ組みと同時に全教室へ展開(オーナー確定 2026-07-09)。回帰で戻さない。
  schedulePopupAutoSync: {
    scope: 'all-classrooms',
    description: 'Auto-sync (debounced) the generated-HTML schedule popup on board edits, with a syncing spinner.',
  },
  // 生徒日程表の「通常回数(予定数)」の括弧内を、テンプレ由来(expectedRegularOccurrences ± 表示調整)から
  // **盤面ベース**(その期間の実績 ＋ その期間の未振替の休み)へ切り替える。オーナー確定 2026-08-05。
  // 定義・移行段取り・仕様上の割り切りの正本は docs/spec-invariants.md INV-05（ここへ複製しない）。
  // ★有効時は増コマの予定側 +1 も同時に止める（盤面から直接数えるため。止めないと1コマで予定が2増える）。
  // ★デプロイした瞬間に既存の通常側 scheduleCountAdjustments を読み捨てるため過去月の数字が動く。
  //   開発用教室で実機確認 → staging → 全教室、の順で昇格する（オーナー確定の段階導入）。
  boardBasedPlannedCount: {
    scope: 'development-only',
    description: 'Student schedule: derive the regular planned count from the board (actual + outstanding absences) instead of template-derived occurrences.',
  },
  // 【INV-01/INV-02】生徒/講師日程表を「盤面そのまま」で描く。オーナー指示「必ず盤面と日程表が
  // そろうようにして」(2026-08-07)。従来の日程表は buildScheduleCellsForRange で通常授業テンプレを
  // 読み直し、盤面を上から重ねて作り直していた。盤面自身はこの作り直しをしないため、ここが
  // **盤面と日程表がズレる唯一の発生源**で、v1.5.471 の「出欠記録のある机がテンプレ足場講師に
  // 奪われる」不具合もここで起きた。
  // ★テンプレの二度読みである点が要点: 日程表へ渡す盤面は ensureWeeksCoverDateRange が
  //   未生成週をテンプレから生成済みなので、再マージを外しても未来週が空白になることはない。
  // ★唯一の体感差: 基本データ(通常授業テンプレ)を直しても、盤面を開いて反映するまで日程表に
  //   出なくなる(＝日程表は常に盤面の写しになる)。
  // ★「テンプレにだけ残る通常授業が日程表に湧く」件は**盤面が正**でオーナー裁定(2026-08-07)。
  // 開発用教室で先行(v1.5.472)→ オーナー確定で全教室へ昇格(2026-08-07)。回帰で development-only へ戻さない。
  boardOnlyScheduleCells: {
    scope: 'all-classrooms',
    description: 'Student/teacher schedule: render the board as-is instead of re-merging the regular-lesson template over it.',
  },
  // 盤面PDF出力の「コマ選択」(plan-2026-09-11-five-requests §5 / docs/spec-schedule-pdf.md §I)。
  // ON: 「PDF出力」でモーダルを開き、曜日×時限のチェック表で選んだコマだけを A3 縦に最大化して出す。
  // OFF: 従来どおりモーダルなしで表示週まるごと即出力する(入口の見え方も従来のまま)。
  // ★初期状態は全選択＝従来と同一出力なので、ON にしても手数が 1 つ増えるだけで結果は変わらない。
  // 用紙は A3 縦固定のまま(オーナー確定 2026-09-11)。開発用教室で先行検証(v1.5.500〜509・確認リスト第1〜5版で
  // 行高さ/文字はみ出し/講師名見切れ/集団行ガイドを是正)したうえで、オーナー指示(2026-09-13「指定コマPDFは完了した
  // ので全教室展開して」)で全教室へ昇格。回帰で development-only へ戻さない。
  boardPrintSelection: {
    scope: 'all-classrooms',
    description: 'Board PDF export: choose which day x slot cells to print (defaults to the whole week = current output).',
  },
  // 講習履歴(docs/plan-2026-09-11-five-requests.md §6 / H-1〜H-4): 生徒日程表タブに「講習履歴」ボタンを出し、
  // 生徒授業台帳(lessonLedgerDays)から出席/休み/振替/予定/未消化を期間指定(最大366日)で一覧する。
  // 台帳はクライアントから直接読めないため callable getStudentLessonHistory を本体が中継する(読み取りのみ)。
  // 新機能はフラグ付きで作る方針(§計画 フラグ表)に従い、まず開発用教室のみで先行検証する。
  lessonHistory: {
    scope: 'development-only',
    description: 'Student schedule tab: "講習履歴" button and overlay backed by the getStudentLessonHistory callable.',
  },
  // 保護者向け固定QR(docs/spec-parent-portal.md §H / docs/plan-2026-09-11-five-requests.md §7 K-2〜K-6)。
  // ON: 基本データ画面の在籍生徒に「QR」ボタン(表示・印刷・再発行)を出し、保護者からの連絡モーダルを購読する。
  // 教室別オプション基盤(O-1)は保留中のため、まず開発用教室のみで先行検証する(§H 公開順: 開発用→staging→本番1教室→全教室)。
  // ⚠️ サーバー側 functions/src/parentPortal.ts の isParentPortalEnabledForClassroom が**同一の述語**を持つ
  // (OFF の教室では parentPortalApi が 403)。昇格するときは**両側を同時に**変える(片方だけ広げると、QR は出るのに
  // ページが開けない/ページは開けるのに QR が出ない、の非対称になる)。昇格はオーナー確認後。
  // ★検証用教室の判定は登録台帳(workspaceKey + 教室ID)。2026-09-16 までの「教室名が開発用教室」は廃止。
  // ★scope は `staging-environment`(= staging プロジェクト全教室 ＋ どの環境でも開発用/テスト教室)。
  //   `development-only` だと staging の一般教室でボタンが出ず、サーバーだけ許可する非対称になって
  //   §H の「staging 実機で確認」が実行できない(レビュー指摘 2026-09-13)。
  parentPortalQr: {
    scope: 'staging-environment',
    description: 'Basic-data screen: per-student parent portal QR (issue/show/print/reissue) and the parent message notification modal.',
  },
  // 質問への AI 即時回答(docs/spec-developer-report.md §G-7・オーナー指示 2026-09-14「開発用教室にだけ実装」)。
  // ON: 「質問・要望」モーダルで質問を選ぶと注意文が「その場で AI が回答」に変わり、送信後の結果に AI の回答を出す。
  // ★AI を呼ぶかどうかの権威はサーバー(functions/src/questionAiAnswer.ts isQuestionAiAnswerEnabledForClassroom =
  //   検証用教室判定 → 会社既定の 2 段解決。shouldAnswerQuestionWithAi はその結果と「質問 × 確認リスト外」の合成)。
  //   このフラグは表示(注意文・送信中文言・日程表タブの待ち時間)だけを切り替える。昇格するときは**両側を同時に**変える。
  questionAiAnswer: {
    scope: 'development-only',
    description: 'Question/request modal: instant AI answer to questions (Claude on Vertex AI via submitDeveloperReport), development classroom only.',
  },
  // 振替元「休)」表示・振替欄の元起点統一・丸ごと振替/休日設定の記録保持(オーナー確定 2026-09-16)。
  // ON のとき:
  //   - 盤面/配布用盤面の移動元マーカー(moved)のラベルが「移」→「休」になる(記録の中身は moved のまま=INV-06)。
  //   - 別日 D&D に加えて**丸ごと振替**でも振替元の通常授業に移動元記録(moved)を残す。
  //   - **休日設定**が出欠記録を消さず、在庫へ返した配置/出席/振無休を新種別 'holiday'(表示専用)へ変換して残す。
  //   - 生徒日程表が moved/holiday を payload に載せ、振替欄を「元コマ起点」に統一して未配置は「未定」と出す。
  // ★このフラグは**表示と記録の保持**だけを切り替える。在庫会計(INV-06)は ON/OFF で同一(moved/holiday は
  //   どちらも会計対象外)。OFF では payload にも盤面にも新しい記録が生まれないため挙動は従来と完全一致する。
  // ★'holiday' 記録の**会計ガードと表示はフラグに依らず常に有効**(一度 ON で作った記録を OFF に戻しても
  //   正しく無視・表示される)。ここを「フラグ OFF なら holiday を absent と同じに扱う」へ変えてはいけない。
  // 開発用教室 → staging → 全教室の順に昇格する(昇格はオーナー確認後)。
  transferSourceRestDisplay: {
    scope: 'development-only',
    description: 'Show moved-source / holiday records as 休) with destination, source-origin makeup box with 未定, keep records on whole-day transfer and holiday setting.',
  },
  // 室長による自教室のサーバーバックアップ復元(オーナー確定 2026-09-18・docs/spec-save-restore.md §4-1)。
  // ON: バックアップ/復元画面に「サーバーバックアップから復元(直近7日)」パネルを出す。ログインパスワードの
  //     再認証 → 自教室の時点データを画面へ読込 → 室長が保存して確定(サーバーへ直接書く復元関数は作らない)。
  // ★教室取り違え防止(2026-06-06 事故)の権威は managerSelfRestore.ts の resolveManagerSelfRestoreGuard
  //   (担当 = 開いている = 復元対象 の 3 者一致)とサーバーの担当教室判定。フラグは入口の表示だけを切り替える。
  // 開発用教室で先行 → オーナー確認後に全教室へ昇格する(段階公開はオーナー確定)。
  managerSelfRestore: {
    scope: 'development-only',
    description: 'Backup/restore screen: manager restores own classroom from a server auto-backup (last 7 days) after password re-auth; load to screen, commit by manual save.',
  },
} as const satisfies Record<string, FeatureRolloutDefinition>

export type FeatureRolloutKey = keyof typeof featureRolloutRegistry

// 純粋なスコープ判定(テスト用に環境を引数で受ける)。staging-environment は staging プロジェクトで
// 全教室有効、それ以外の環境では開発用教室のみ(ローカル/開発用教室での動作検証を可能にするため。
// 本番3教室では無効のまま)。
export function isFeatureScopeEnabled(
  scope: FeatureRolloutScope,
  context: { isStaging: boolean; isDevelopmentClassroom: boolean },
): boolean {
  if (scope === 'all-classrooms') return true
  if (scope === 'staging-environment') return context.isStaging || context.isDevelopmentClassroom
  return context.isDevelopmentClassroom
}

// ⚠️ 2026-09-16 以降、検証用教室の判定は **教室ID**(会社=workspace ごとの登録台帳
// src/utils/developmentClassroomRegistry.ts)で行う。呼び出し側は必ず `id` を渡すこと
// (`{ name }` だけを渡すと development-only 機能が開発用教室でも無効になる)。
// workspaceKey は既定で現在の接続先。テストからは第3引数で明示する。
//
// ★2 段解決(2026-09-18・Phase 1 T1-2・docs/spec-multi-tenant.md §11): 基本スコープ → 会社既定。
//   会社既定はコア台帳 src/utils/companyFeatureDefaults.ts を (workspaceKey, featureKey) で引く(行が無ければ
//   基本スコープのとおり = 従来と同じ)。段の適用順は resolveFeatureEnabledByLayers 1 か所に集約し、
//   サーバー側述語(functions/src/parentPortal.ts・questionAiAnswer.ts)も同じ関数(sync-shared の複製)で解決する。
//   3 段目(教室別上書き O-1)は再開しない(FeatureLayerInput.classroomOverride は予約のみ)。
export function isFeatureEnabledForClassroom(
  featureKey: FeatureRolloutKey,
  classroom: DevelopmentClassroomIdentity | null | undefined,
  workspaceKey: string = getFirebaseBackendConfig().workspaceKey,
) {
  const feature = featureRolloutRegistry[featureKey]
  return resolveFeatureEnabledByLayers({
    scopeEnabled: isFeatureScopeEnabled(feature.scope, {
      isStaging: isStagingEnvironment(),
      isDevelopmentClassroom: isDevelopmentClassroom(classroom, workspaceKey),
    }),
    companyDefault: resolveCompanyFeatureDefault(workspaceKey, featureKey),
  })
}
