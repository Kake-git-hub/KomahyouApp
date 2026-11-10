// tools/ui-patrol/loadApp.mjs が esbuild で束ねて読む入口。アプリ・巡回の純関数を再輸出するだけ(ここに処理を書かない)。
export * from './anonymize'
export * from './boardFacts'
export * from './checks'
export { auditClassroomSnapshot } from '../invAuditEntry'
export { resolveNextMondayDateKey } from '../../src/components/schedule-board/templateDefinitionDiff'
