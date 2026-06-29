// staging(komahyouapp-staging)に最初の「管理者ユーザー＋教室」をブートストラップするスクリプト。
//
// 役割: firebase-admin(SA 認証)で Firestore に members / classrooms / classroomSnapshots を作成する。
//       Auth ユーザー自体は事前に Firebase コンソールで作成し、その UID を config で渡す前提。
//
// 安全装置(最重要): projectId が `komahyouapp-staging` でなければ即座に中断する。
//   本番(komahyouapp-prod)へは絶対に書き込まない。CLAUDE.md 本番データ保護ルールに従う。
//
// 実行(CI): GOOGLE_APPLICATION_CREDENTIALS=<staging SA json> STAGING_PROJECT_ID=komahyouapp-staging \
//           node functions/scripts/staging-bootstrap-first-classroom.mjs \
//             --config functions/scripts/staging-bootstrap.config.json

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const ALLOWED_PROJECT_ID = 'komahyouapp-staging'

const defaultSpecialSessions = [
  { id: 'session_2026_summer', label: '2026 夏期講習', startDate: '2026-07-21', endDate: '2026-08-28', teacherInputs: {}, studentInputs: {}, createdAt: '2026-03-10 09:30', updatedAt: '2026-03-12 18:20' },
  { id: 'session_2026_spring', label: '2026 新年度準備講座', startDate: '2026-03-23', endDate: '2026-04-05', teacherInputs: {}, studentInputs: {}, createdAt: '2026-03-01 10:15', updatedAt: '2026-03-08 13:40' },
  { id: 'session_2026_exam', label: '2026 定期試験対策', startDate: '2026-05-18', endDate: '2026-06-05', teacherInputs: {}, studentInputs: {}, createdAt: '2026-02-20 12:00', updatedAt: '2026-03-11 16:10' },
  { id: 'session_2026_winter', label: '2026 冬期講習', startDate: '2026-12-24', endDate: '2027-01-07', teacherInputs: {}, studentInputs: {}, createdAt: '2026-03-05 08:20', updatedAt: '2026-03-09 19:00' },
]

const autoAssignRuleDefinitions = [
  ['preferDateConcentration', '登校日集約', '同じ日に複数コマをまとめつつ、登校日どうしは期間内でほどよく間隔が空く候補を優先します。'],
  ['preferNextDayOrLater', '登校日分散', '同じ日にまとめるより、別日の登校へ分散できる候補を優先します。'],
  ['preferTwoStudentsPerTeacher', '講師1人に生徒2人配置', '可能な限り 1 卓に 2 人着席を優先します。'],
  ['maxOneLesson', '1コマ上限', '同一日の授業数を 1 コマまでに抑えます。'],
  ['maxTwoLessons', '2コマ上限', '同一日の授業数を 2 コマまでに抑えます。'],
  ['maxThreeLessons', '3コマ上限', '同一日の授業数を 3 コマまでに抑えます。'],
  ['allowTwoConsecutiveLessons', '2コマ連続', '連続 2 コマを優先候補に含めます。'],
  ['requireBreakBetweenLessons', '一コマ空け', '授業の間に 1 コマ空ける形を優先します。'],
  ['connectRegularLessons', '通常連結2コマ', '通常授業と連続する配置を優先候補に含めます。'],
  ['subjectCapableTeachersOnly', '科目対応講師のみ', '講師の科目担当に収まる生徒だけを配置候補にします。'],
  ['regularTeachersOnly', '通常講師のみ', '割振りを通常授業で担当している講師だけに制限します。'],
  ['preferLateAfternoon', '3,4,5限優先', '3 限から 5 限を先に使う優先順です。'],
  ['preferSecondPeriod', '2限寄り(2＞3＞4＞5限の優先順位)', '2 限から順に近いコマを優先します。'],
  ['preferFifthPeriod', '5限寄り(5＞4＞3＞2限の優先順位)', '5 限から順に近いコマを優先します。'],
  ['forbidFirstPeriod', '指定時限禁止', '対象者を、指定した時限（既定は1限）に配置しないよう制限します。'],
]

function createDefaultAutoAssignRules() {
  return autoAssignRuleDefinitions.map(([key, label, description]) => ({
    key, label, description, targets: [], excludeTargets: [], priorityScore: 3, includeStudentIds: [], excludeStudentIds: [], updatedAt: '',
  }))
}

function createInitialSnapshot(nowIso, developerUid) {
  return {
    schemaVersion: 1,
    savedAt: nowIso,
    updatedBy: developerUid,
    updatedAt: nowIso,
    data: {
      screen: 'board',
      classroomSettings: {
        closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 14,
        initialSetupCompletedAt: '', initialSetupMakeupStocks: [], initialSetupLectureStocks: [],
      },
      managers: [], teachers: [], students: [], regularLessons: [], groupLessons: [],
      specialSessions: defaultSpecialSessions,
      autoAssignRules: createDefaultAutoAssignRules(),
      pairConstraints: [], boardState: null,
    },
  }
}

function parseArgs(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) { result[key] = 'true'; continue }
    result[key] = next; i += 1
  }
  return result
}

function loadConfig(configPath) {
  const raw = JSON.parse(readFileSync(resolve(configPath), 'utf8'))
  const cfg = {
    workspaceKey: (raw.workspaceKey || 'main').trim(),
    classroomId: (raw.classroomId || '').trim(),
    classroomName: (raw.classroomName || '').trim(),
    managerUid: (raw.managerUid || '').trim(),
    managerName: (raw.managerName || '').trim(),
    managerEmail: (raw.managerEmail || '').trim(),
    contractStartDate: (raw.contractStartDate || new Date().toISOString().slice(0, 10)).trim(),
    contractEndDate: (raw.contractEndDate || '').trim(),
  }
  const missing = ['classroomId', 'classroomName', 'managerUid', 'managerName', 'managerEmail'].filter((k) => !cfg[k])
  if (missing.length) {
    throw new Error(`config の必須値が不足しています: ${missing.join(', ')}（Auth ユーザー作成後に managerUid を埋めてください）`)
  }
  return cfg
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const projectId = (process.env.STAGING_PROJECT_ID || '').trim()

  // --- 安全装置: staging 以外には絶対に書き込まない ---
  if (projectId !== ALLOWED_PROJECT_ID) {
    throw new Error(`STAGING_PROJECT_ID が "${projectId}" です。"${ALLOWED_PROJECT_ID}" のときだけ実行できます（本番保護）。`)
  }

  const cfg = loadConfig(args.config || 'functions/scripts/staging-bootstrap.config.json')
  const nowIso = new Date().toISOString()

  const app = initializeApp({ credential: applicationDefault(), projectId })

  // SA の実プロジェクトが staging であることも二重チェック（ADC の取り違え防止）。
  const saProjectId = app.options.projectId || projectId
  if (saProjectId !== ALLOWED_PROJECT_ID) {
    throw new Error(`SA のプロジェクトが "${saProjectId}" です。staging 以外への書き込みを中断しました。`)
  }

  const db = getFirestore(app)

  const base = db.collection('workspaces').doc(cfg.workspaceKey)
  const membersRef = base.collection('members').doc(cfg.managerUid)
  const classroomRef = base.collection('classrooms').doc(cfg.classroomId)
  const snapshotRef = base.collection('classroomSnapshots').doc(cfg.classroomId)

  const membersDoc = {
    displayName: cfg.managerName,
    email: cfg.managerEmail,
    role: 'manager',
    assignedClassroomId: cfg.classroomId,
  }
  const classroomDoc = {
    name: cfg.classroomName,
    contractStatus: 'active',
    contractStartDate: cfg.contractStartDate,
    contractEndDate: cfg.contractEndDate,
    managerUserId: cfg.managerUid,
    isTemporarilySuspended: false,
    temporarySuspensionReason: '',
    updatedAt: nowIso,
  }
  const snapshotDoc = createInitialSnapshot(nowIso, cfg.managerUid)

  // 親 workspace ドキュメント本体(workspaces/main)が無いとアプリが
  // 「対象 workspace が Firestore に見つかりません」で止まる。プロビジョニングと同じ形で作る。
  await base.set({ name: cfg.workspaceKey, schemaVersion: 1, updatedAt: nowIso }, { merge: true })

  // 既存スナップショットを誤って初期化しないよう、既にあれば snapshot はスキップ。
  const existingSnapshot = await snapshotRef.get()
  await membersRef.set(membersDoc, { merge: true })
  await classroomRef.set(classroomDoc, { merge: true })
  if (existingSnapshot.exists) {
    console.log(`既存の classroomSnapshots/${cfg.classroomId} を検出したため初期スナップショットの上書きはスキップしました。`)
  } else {
    await snapshotRef.set(snapshotDoc)
  }

  console.log('staging ブートストラップ完了:')
  console.log(`  workspace:         workspaces/${cfg.workspaceKey}`)
  console.log(`  members:           workspaces/${cfg.workspaceKey}/members/${cfg.managerUid}`)
  console.log(`  classrooms:        workspaces/${cfg.workspaceKey}/classrooms/${cfg.classroomId}`)
  console.log(`  classroomSnapshots:workspaces/${cfg.workspaceKey}/classroomSnapshots/${cfg.classroomId}`)
  console.log(`  ログイン: ${cfg.managerEmail} （コンソールで設定したパスワード）`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
