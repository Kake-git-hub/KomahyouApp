import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'

const defaultSpecialSessions = [
  {
    id: 'session_2026_summer',
    label: '2026 夏期講習',
    startDate: '2026-07-21',
    endDate: '2026-08-28',
    teacherInputs: {},
    studentInputs: {},
    createdAt: '2026-03-10 09:30',
    updatedAt: '2026-03-12 18:20',
  },
  {
    id: 'session_2026_spring',
    label: '2026 新年度準備講座',
    startDate: '2026-03-23',
    endDate: '2026-04-05',
    teacherInputs: {},
    studentInputs: {},
    createdAt: '2026-03-01 10:15',
    updatedAt: '2026-03-08 13:40',
  },
  {
    id: 'session_2026_exam',
    label: '2026 定期試験対策',
    startDate: '2026-05-18',
    endDate: '2026-06-05',
    teacherInputs: {},
    studentInputs: {},
    createdAt: '2026-02-20 12:00',
    updatedAt: '2026-03-11 16:10',
  },
  {
    id: 'session_2026_winter',
    label: '2026 冬期講習',
    startDate: '2026-12-24',
    endDate: '2027-01-07',
    teacherInputs: {},
    studentInputs: {},
    createdAt: '2026-03-05 08:20',
    updatedAt: '2026-03-09 19:00',
  },
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
  ['forbidFirstPeriod', '1限禁止', '対象者を1 限に配置しないよう制限します。'],
]

function createDefaultAutoAssignRules() {
  return autoAssignRuleDefinitions.map(([key, label, description]) => ({
    key,
    label,
    description,
    targets: [],
    excludeTargets: [],
    priorityScore: 3,
    includeStudentIds: [],
    excludeStudentIds: [],
    updatedAt: '',
  }))
}

function toDateKey(date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function readWorkspaceKeyFromEnvFile() {
  for (const fileName of ['.env.local', '.env']) {
    try {
      const text = readFileSync(resolve(fileName), 'utf8')
      const match = text.match(/^VITE_FIREBASE_WORKSPACE_KEY=(.*)$/m)
      if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/g, '')
    } catch {
      // ignore missing env files
    }
  }
  return 'main'
}

function sanitizeClassroomId(value) {
  const trimmed = value.trim()
  if (!trimmed) return `classroom_${Date.now().toString(36)}`
  return trimmed.replace(/[^A-Za-z0-9_-]+/g, '_')
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      result[key] = 'true'
      continue
    }
    result[key] = next
    index += 1
  }
  return result
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
        closedWeekdays: [0],
        holidayDates: [],
        forceOpenDates: [],
        deskCount: 14,
        initialSetupCompletedAt: '',
        initialSetupMakeupStocks: [],
        initialSetupLectureStocks: [],
        googleHolidayCalendarSyncedDates: [],
        googleHolidayCalendarLastSyncedAt: '',
      },
      managers: [],
      teachers: [],
      students: [],
      regularLessons: [],
      groupLessons: [],
      specialSessions: defaultSpecialSessions,
      autoAssignRules: createDefaultAutoAssignRules(),
      pairConstraints: [],
      boardState: null,
    },
  }
}

function buildMarkdown(config) {
  const membersDoc = {
    displayName: config.managerName,
    email: config.managerEmail,
    role: 'manager',
    assignedClassroomId: config.classroomId,
  }

  const classroomDoc = {
    name: config.classroomName,
    contractStatus: 'active',
    contractStartDate: config.contractStartDate,
    contractEndDate: config.contractEndDate,
    managerUserId: config.managerUid,
    isTemporarilySuspended: false,
    temporarySuspensionReason: '',
    updatedAt: config.nowIso,
  }

  const snapshotDoc = createInitialSnapshot(config.nowIso, config.developerUid)

  return `# Firebase 初回教室作成メモ\n\n## 入力値\n\n- workspaceKey: ${config.workspaceKey}\n- classroomId: ${config.classroomId}\n- classroomName: ${config.classroomName}\n- managerUid: ${config.managerUid}\n- managerName: ${config.managerName}\n- managerEmail: ${config.managerEmail}\n- developerUid: ${config.developerUid}\n- contractStartDate: ${config.contractStartDate}\n\n## 作成先\n\n1. Authentication で Email/Password ユーザーを作成済みにする\n2. Firestore に以下を追加する\n\n### members\n\nパス: workspaces/${config.workspaceKey}/members/${config.managerUid}\n\n\`\`\`json\n${JSON.stringify(membersDoc, null, 2)}\n\`\`\`\n\n### classrooms\n\nパス: workspaces/${config.workspaceKey}/classrooms/${config.classroomId}\n\n\`\`\`json\n${JSON.stringify(classroomDoc, null, 2)}\n\`\`\`\n\n### classroomSnapshots\n\nパス: workspaces/${config.workspaceKey}/classroomSnapshots/${config.classroomId}\n\n\`\`\`json\n${JSON.stringify(snapshotDoc, null, 2)}\n\`\`\`\n\n## 確認\n\n- 管理者でログインできること\n- 開発者でログインすると教室一覧に表示されること\n- 保存後に classroomSnapshots/${config.classroomId} の savedAt が更新されること\n`
}

async function promptForMissingConfig(initialConfig) {
  const rl = createInterface({ input, output })
  try {
    const config = { ...initialConfig }
    const prompts = [
      ['workspaceKey', 'workspaceKey', config.workspaceKey],
      ['classroomId', 'classroomId', config.classroomId],
      ['classroomName', '教室名', config.classroomName],
      ['managerUid', 'managerUid', config.managerUid],
      ['managerName', '管理者名', config.managerName],
      ['managerEmail', '管理者メール', config.managerEmail],
      ['developerUid', 'developerUid', config.developerUid],
      ['contractStartDate', '契約開始日 (YYYY-MM-DD)', config.contractStartDate],
      ['contractEndDate', '契約終了日 (空欄で継続)', config.contractEndDate],
    ]

    for (const [key, label, defaultValue] of prompts) {
      if (config[key]) continue
      const answer = await rl.question(`${label}${defaultValue ? ` [${defaultValue}]` : ''}: `)
      config[key] = (answer || defaultValue || '').trim()
    }

    return config
  } finally {
    rl.close()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const nowIso = new Date().toISOString()
  const initialConfig = {
    workspaceKey: args['workspace-key']?.trim() || readWorkspaceKeyFromEnvFile(),
    classroomId: sanitizeClassroomId(args['classroom-id']?.trim() || ''),
    classroomName: args['classroom-name']?.trim() || '',
    managerUid: args['manager-uid']?.trim() || '',
    managerName: args['manager-name']?.trim() || '',
    managerEmail: args['manager-email']?.trim() || '',
    developerUid: args['developer-uid']?.trim() || '',
    contractStartDate: args['contract-start-date']?.trim() || toDateKey(new Date()),
    contractEndDate: args['contract-end-date']?.trim() || '',
    nowIso,
  }

  const config = args['non-interactive'] === 'true'
    ? initialConfig
    : await promptForMissingConfig(initialConfig)

  if (!config.classroomName || !config.managerUid || !config.managerName || !config.managerEmail || !config.developerUid) {
    throw new Error('必須値が不足しています。`npm run firebase:first-classroom` を対話形式で実行するか、必要な `--classroom-name` などを指定してください。')
  }

  const markdown = buildMarkdown(config)
  const outputPath = args.output?.trim()
  if (outputPath) {
    const absolutePath = resolve(outputPath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, markdown, 'utf8')
    output.write(`${absolutePath}\n`)
    return
  }

  output.write(`${markdown}\n`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})