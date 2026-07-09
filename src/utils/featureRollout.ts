import type { DevelopmentClassroomIdentity } from './developmentClassroom'
import { isDevelopmentClassroom } from './developmentClassroom'
import { getFirebaseBackendConfig } from '../integrations/firebase/config'

// staging 検証環境(komahyouapp-staging)の判定。日程表 React ビュー等の staging 先行機能は
// 教室IDではなく環境(プロジェクトID)で有効化する(stagingテスト教室は開発用教室IDではないため)。
// 2026-07-08 オーナー確定: 対話用日程表の React 化は staging だけに実装し、チェック合格まで本番へ出さない。
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
  // オーナー確定で全教室へ昇格予定。回帰で development-only へ戻さない。
  teacherDragAndDropMove: {
    scope: 'development-only',
    description: 'Long-press drag-and-drop move/swap of a teacher between desks within the same slot column.',
  },
  // 対話用日程表(生徒/講師)を生成HTMLタブではなく同一 React ツリーのビュー(ドック⇄ポップアウト)で
  // 表示する土台(spec-schedule-interactive-view)。staging 先行・オーナーチェック合格まで本番展開しない
  // (2026-07-08 確定)。印刷/PDF(全員表示・空フォーマット)は従来の生成HTML経路のまま。
  scheduleInteractiveReactView: {
    scope: 'staging-environment',
    description: 'Interactive schedule view as an in-tree React component (dock/popout) instead of generated HTML tabs.',
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

export function isFeatureEnabledForClassroom(
  featureKey: FeatureRolloutKey,
  classroom: DevelopmentClassroomIdentity | null | undefined,
) {
  const feature = featureRolloutRegistry[featureKey]
  return isFeatureScopeEnabled(feature.scope, {
    isStaging: isStagingEnvironment(),
    isDevelopmentClassroom: isDevelopmentClassroom(classroom),
  })
}
