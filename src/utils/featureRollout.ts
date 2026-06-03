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
