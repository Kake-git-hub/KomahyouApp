// tools/ui-patrol/loadApp.mjs が esbuild で束ねて読む入口。アプリ・巡回の純関数を再輸出するだけ(ここに処理を書かない)。
export * from './anonymize'
export * from './autoAssign'
export * from './boardFacts'
export * from './checks'
export * from './dayOps'
export * from './stock'
export * from './templateEdit'
export { isActiveOnDate } from '../../src/components/basic-data/basicDataModel'
export { auditClassroomSnapshot } from '../invAuditEntry'
export { resolveNextMondayDateKey } from '../../src/components/schedule-board/templateDefinitionDiff'
// でたらめ操作が元に戻すの履歴の上限をアプリと合わせる(randomOps.mjs)。
export { MAX_HISTORY_DEPTH } from '../../src/components/schedule-board/ScheduleBoardScreen'
