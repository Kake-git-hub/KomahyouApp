import type { DevelopmentClassroomIdentity } from './developmentClassroom'
import { isDevelopmentClassroom } from './developmentClassroom'

export type FeatureRolloutScope = 'development-only' | 'all-classrooms'

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
} as const satisfies Record<string, FeatureRolloutDefinition>

export type FeatureRolloutKey = keyof typeof featureRolloutRegistry

export function isFeatureEnabledForClassroom(
  featureKey: FeatureRolloutKey,
  classroom: DevelopmentClassroomIdentity | null | undefined,
) {
  const feature = featureRolloutRegistry[featureKey]
  if (feature.scope === 'all-classrooms') return true
  return isDevelopmentClassroom(classroom)
}
