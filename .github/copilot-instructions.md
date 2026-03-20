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
	- Period-limited regular lessons still use the contract rule of counting lessons as inclusive month count × 4.
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
	- Sending an existing 振替授業 back to stock must not double-count stock; compare against the original regular lesson basis.
	- When 振替 or 移動 would place the same student into the same slot twice, reject the action, show a warning, and keep the current selection state.
	- After board or schedule changes, run both `npm run build` and `npx playwright test tests/schedule-board.spec.ts`.

- [x] Maintain regression coverage
	Current expected regression baseline: full `tests/schedule-board.spec.ts` Playwright suite passes after board/schedule behavior changes.


- Work through each checklist item systematically.
- Keep communication concise and focused.
- Follow development best practices.
