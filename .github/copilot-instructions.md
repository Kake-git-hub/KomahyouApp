<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->
- [x] Verify that the copilot-instructions.md file in the .github directory is created.

- [x] Clarify Project Requirements
	Initial requirement: separate new workspace for a next-generation lesson scheduling admin web app using Vite + React + TypeScript. Initial users are only the developer and classroom manager.

- [x] Scaffold the Project
	Scaffolded a React + TypeScript Vite app in the current workspace root.

- [x] Customize the Project
	Expanded the UI-first admin app into a working board workflow with コマ表画面, コマ詳細パネル, 振替ストック, 基本データ, 講習データ, PDF 出力, 日程表 popup, and regression-tested board interactions.

- [x] Install Required Extensions
	No extensions needed.

- [x] Compile the Project
	Build completed successfully with npm run build.

- [x] Create and Run Task
	No workspace task added yet. Fast UI iteration can use the existing npm scripts directly for now.

- [ ] Launch the Project
	Only after user confirmation.

- [x] Ensure Documentation is Complete
	Updated README.md and this file to reflect the current workspace purpose, current board-centric behavior, and current operation rules.

- Current implementation notes
	- Remove standalone `未入力` date-clear buttons when the calendar UI already provides cancellation.
	- Treat manual-added students as excluded from 振替ストック counts.
	- Regular lesson `月 4 回` monthly cap has been removed entirely; all weekly occurrences in a month are placed without cap. Monthly count control is handled by the classroom manager via deletion operations.
	- Keep warning display scoped per student slot rather than per desk when only one side is problematic.
	- Keep 振替ストック visible across board operations unless the user explicitly closes it.
	- Student/teacher schedule tabs auto-apply date input changes, and the lecture-period selector must stay sorted by `startDate` ascending.
	- Student/teacher schedule tabs share school-info and logo inputs across popup windows.
	- Schedule popup no longer exposes a manual refresh button; board-side sync is the only refresh path.
	- Schedule popup labels lecture lessons as `講習`, not `特別`.
	- Stocked-but-unassigned regular lessons must disappear from schedule actual display; only placed 振替 lessons stay visible.
	- Student schedule regular counts compare actual assigned lessons against planned managed lessons.
	- Regular warning stamps stay directly below the regular count table; lecture warning stamps stay directly below the lecture count table.
	- Student schedule subject lists must show only one math label: `算` for elementary grades, `数` for middle/high grades.
	- Student special-lecture count registration must also collapse legacy elementary math labels for middle/high students: `算` and `算国` must not remain visible when the header grade is `中*` or `高*`; treat them as `数` in that UI.
	- Keep focused unit coverage for stock math in `src/components/schedule-board/makeupStock.test.ts`, including holiday shortage, manual-added exclusion, and occupied-slot shortage cases.
	- Keep PDF export rules documented in `docs/board-pdf-design.md`; time-column labels must stay large and centered, and stock side panels must stay out of exported PDFs.
	- Sending an existing 振替授業 back to stock must not double-count stock; compare against the original regular lesson basis.
	- When 振替 or 移動 would place the same student into the same slot twice, reject the action, show a warning, and keep the current selection state.
	- Teacher delete on the normal board uses `teacherAssignmentSource: 'deleted'` with `manualTeacher: true` so the merge preserves the deletion without triggering the manual-teacher warning color.
	- The 講師未選択 dropdown option has been removed; use the 講師削除 button instead.
	- Student move on the normal board supports swap: when the target slot is occupied, the two students are swapped.
	- Template save uses overwrite mode only: clears all board data for dates >= effectiveStartDate and rebuilds from template. A confirmation dialog is shown before execution. The toolbar also provides a clear-template button.
	- New classrooms and reset states must start with empty `specialSessions`; the legacy sample session IDs `session_2026_summer`, `session_2026_spring`, `session_2026_exam`, and `session_2026_winter` should be removed from loaded classroom data.
	- `classroomSettings.holidayDates` must be cleared on load/import so all classrooms treat holidays as normal weekdays.
	- Classroom-screen auto-backup restore now extracts only the acting classroom from the workspace-wide daily backup, keeping other classrooms unchanged.
	- Firebase server auto-backup can run daily without an open browser only on Blaze with Functions and Cloud Storage; the current developer-screen backup list still reflects browser-local auto backups.
	- For board operation changes that can alter previous user actions, present the behavior change and get approval before modifying the rule. Add both positive and negative regression tests across direct helpers and merge/render paths.
	- `packSortCellDesks` and `mergeManagedWeek` must not left-pack slot 2 into slot 1 when `statusSlots[0]` already contains `attended`, `absent`, or `absent-no-makeup` history.
	- `buildManagedRegularLessonsRange` must skip teacher-conflict checks so the same teacher can teach multiple desks in the same slot (common in small classrooms). Only student duplication is blocked. `computeScheduleConflictOrigins` and `computeOccupiedSlotOrigins` must also skip teacher-conflict checks for the same reason.
	- `computeOccupiedSlotOrigins` must treat managed lessons from old template history the same as current template managed lessons: if ANY `managed_*` lesson in a cell already contains a participant student, skip that cell to avoid spurious occupied-slot origins after template row ID changes.
	- Template student move must reject the operation when the destination cell already contains the same student in another desk/slot. Keep the move selection active, show a warning, and avoid saving duplicate-student template states that later corrupt board reconstruction.
	- When the developer enters an existing Firebase Auth UID during classroom creation, reuse that existing Auth account and password as-is. Do not auto-generate or display a replacement password in that path.
	- Firebase classroom manager UID reassignment must delete the previous Firebase Auth user when Functions automation is enabled, and classroom provisioning should clean up orphaned stale Auth users that are no longer referenced by the workspace before retrying email-based account creation.
	- After board or schedule changes, run `npm run build`. Run Playwright only when the user explicitly requests E2E verification.
	- After stock calculation or PDF changes, also run `npm run test:unit`.
	- Every deploy-capable change must bump `package.json` version (patch level) before building.

- [x] Maintain regression coverage
	Current expected regression baseline: `tests/schedule-board.spec.ts` remains the E2E reference suite, but only run it when the user explicitly asks for Playwright verification.


- Work through each checklist item systematically.
- Keep communication concise and focused.
- Follow development best practices.
