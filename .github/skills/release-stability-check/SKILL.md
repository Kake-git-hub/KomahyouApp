---
name: release-stability-check
description: "Use when: running pre-release bug checks, data integrity checks, regression audits, QR submission verification, or development-classroom-only diagnostics for KomahyouApp. Triggers: リリース前チェック, バグチェック, データ整合性, 操作要件チェック, 開発用教室, QR提出."
---

# Release Stability Check

Use this skill before release or after risky board/schedule/submission changes.

## Scope

- Run diagnostics only in the app's development classroom (`開発用教室`, `dev*`, or `development*` classroom id).
- Do not add release-check UI to normal classrooms.
- Preserve visible board behavior unless the user explicitly approves a behavior change.

## Workflow

1. Identify the changed surface: board operation, stock calculation, schedule popup, QR submission, backup/restore, PDF, billing, or classroom management.
2. Search for existing tests around that surface and add focused regression coverage before broad changes.
3. In the development classroom, use the board toolbar:
   - `整合性チェック` to detect saved board/data contradictions.
   - `デバッグJSON` to copy and console-print current runtime data.
4. Check QR submission behavior when relevant:
   - Submitted Firestore docs still update classroom data.
   - The board shows a persistent submission banner in development classroom only.
   - The banner stays visible until clicked.
5. Run validation:
   - `npm run test:unit` for stock, QR, integrity, or data-model changes.
   - `npm run build` after board or schedule changes.
   - Playwright only when explicitly requested.

## Review checklist

- No normal classroom can see development-only diagnostics.
- Duplicate student placement in a single date/slot is rejected by operation logic or reported by diagnostics.
- QR tokens are not duplicated across students/teachers/sessions.
- Debug output contains enough actual app state to reproduce the issue without editing production classrooms.
- Version is bumped for deploy-capable changes.
