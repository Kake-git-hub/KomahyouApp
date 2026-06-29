// staging(komahyouapp-staging)の教室に検証用データ(講師40・生徒150・通常授業)を投入する。
//
// 読み込み経路(workspaceStore.readFirebaseSnapshotPayload)は classroomSnapshots/{id}.data
// のプレーンオブジェクトをそのまま使うため、ここに生成データを書き込む。
// 既存の specialSessions / autoAssignRules / classroomSettings は維持する。
//
// 安全装置: projectId が komahyouapp-staging 以外なら中断(本番保護)。
//
// 実行(CI): GOOGLE_APPLICATION_CREDENTIALS=<staging SA> STAGING_PROJECT_ID=komahyouapp-staging \
//           node functions/scripts/staging-seed-data.mjs --config functions/scripts/staging-bootstrap.config.json

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const ALLOWED_PROJECT_ID = 'komahyouapp-staging'
const TEACHER_COUNT = 40
const STUDENT_COUNT = 150
const SUBJECTS = ['数', '英', '国', '理', '社']
const GRADE_CEILINGS = ['中', '高1', '高2', '高3']

const SURNAMES = [
  '佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤',
  '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '斎藤', '清水',
  '山崎', '森', '池田', '橋本', '阿部', '石川', '山下', '中島', '石井', '小川',
  '前田', '岡田', '長谷川', '藤田', '後藤', '近藤', '村上', '遠藤', '青木', '坂本',
  '斉藤', '福田', '太田', '西村', '藤井', '岡本', '三浦', '藤原', '松田', '中川',
  '中野', '原田', '小野', '田村', '竹内', '金子', '和田', '中山', '石田', '上田',
]
const GIVEN_MALE = ['翔太', '大輝', '陽斗', '蓮', '颯太', '悠斗', '陸', '湊', '大和', '樹', '健太', '直人', '匠', '海斗', '蒼']
const GIVEN_FEMALE = ['結衣', '陽菜', '美咲', '葵', '凜', '咲良', '芽依', '莉子', '心春', '優奈', '花', '七海', '美月', '彩音', '玲奈']

function pick(arr, i) { return arr[i % arr.length] }

function pad(n, len) { return String(n).padStart(len, '0') }

// 学年(小1..高3)→ 概ねの誕生年(2026年度・4月始まり基準)。月は6月固定でその年度コホートに収める。
const GRADE_BIRTH_YEARS = [
  ['小1', 2019], ['小2', 2018], ['小3', 2017], ['小4', 2016], ['小5', 2015], ['小6', 2014],
  ['中1', 2013], ['中2', 2012], ['中3', 2011], ['高1', 2010], ['高2', 2009], ['高3', 2008],
]
// 個別塾らしく中・高を厚めに配分(合計の重み)。
const GRADE_WEIGHTS = { 小1: 1, 小2: 1, 小3: 2, 小4: 2, 小5: 3, 小6: 4, 中1: 6, 中2: 6, 中3: 7, 高1: 5, 高2: 5, 高3: 4 }

function buildStudentBirthYearPlan(total) {
  const entries = GRADE_BIRTH_YEARS.map(([g, y]) => ({ grade: g, year: y, weight: GRADE_WEIGHTS[g] ?? 1 }))
  const weightSum = entries.reduce((a, e) => a + e.weight, 0)
  const plan = []
  for (const e of entries) {
    const count = Math.max(1, Math.round((e.weight / weightSum) * total))
    for (let i = 0; i < count; i += 1) plan.push(e.year)
  }
  // total に合わせて調整
  while (plan.length < total) plan.push(2012)
  return plan.slice(0, total)
}

function generateTeachers() {
  const teachers = []
  for (let i = 0; i < TEACHER_COUNT; i += 1) {
    const surname = pick(SURNAMES, i)
    const name = `${surname}先生`
    const subjectCount = 1 + (i % 3) // 1〜3科目
    const subjectCapabilities = []
    for (let s = 0; s < subjectCount; s += 1) {
      const subject = pick(SUBJECTS, i + s)
      if (subjectCapabilities.some((c) => c.subject === subject)) continue
      subjectCapabilities.push({ subject, maxGrade: pick(GRADE_CEILINGS, i + s + 2) })
    }
    teachers.push({
      id: `t${pad(i + 1, 3)}`,
      name,
      displayName: surname,
      email: `teacher${pad(i + 1, 3)}@staging.example.com`,
      entryDate: '2024-04-01',
      withdrawDate: '未定',
      subjectCapabilities,
    })
  }
  return teachers
}

function generateStudents() {
  const birthYears = buildStudentBirthYearPlan(STUDENT_COUNT)
  const students = []
  for (let i = 0; i < STUDENT_COUNT; i += 1) {
    const surname = pick(SURNAMES, i * 7 + 3)
    const given = i % 2 === 0 ? pick(GIVEN_MALE, i) : pick(GIVEN_FEMALE, i)
    const birthYear = birthYears[i]
    const birthMonth = pad(((i % 9) + 1), 2) // 1〜9月(年度コホートが明確になる範囲)
    const birthDay = pad(((i % 27) + 1), 2)
    students.push({
      id: `s${pad(i + 1, 3)}`,
      name: `${surname} ${given}`,
      displayName: `${surname}${given}`,
      email: `student${pad(i + 1, 3)}@staging.example.com`,
      entryDate: '2024-04-01',
      withdrawDate: '未定',
      birthDate: `${birthYear}-${birthMonth}-${birthDay}`,
    })
  }
  return students
}

// 通常授業: 月〜土(1..6)×2〜5限。各(曜日,限)で講師を机に割り当て、生徒1〜2名を着席。
function generateRegularLessons(teachers, students, schoolYear) {
  const lessons = []
  let studentCursor = 0
  let lessonSeq = 0
  const desksPerSlot = 10 // 14席中10席を通常で使用
  for (let dayOfWeek = 1; dayOfWeek <= 6; dayOfWeek += 1) {
    for (let slotNumber = 2; slotNumber <= 5; slotNumber += 1) {
      for (let desk = 0; desk < desksPerSlot; desk += 1) {
        const teacher = teachers[(dayOfWeek * 7 + slotNumber * 3 + desk) % teachers.length]
        const subject = pick(teacher.subjectCapabilities.map((c) => c.subject), desk)
        const s1 = students[studentCursor % students.length]; studentCursor += 1
        const seatTwo = (desk % 2 === 0) // 半分は2人着席
        const s2 = seatTwo ? students[studentCursor % students.length] : null
        if (seatTwo) studentCursor += 1
        lessonSeq += 1
        lessons.push({
          id: `rl${pad(lessonSeq, 4)}`,
          schoolYear,
          teacherId: teacher.id,
          student1Id: s1.id,
          subject1: subject,
          student1Note: '',
          startDate: '',
          endDate: '',
          student2Id: s2 ? s2.id : '',
          subject2: s2 ? pick(SUBJECTS, desk + 1) : '',
          student2Note: '',
          student2StartDate: '',
          student2EndDate: '',
          nextStudent1Id: '',
          nextSubject1: '',
          nextStudent2Id: '',
          nextSubject2: '',
          dayOfWeek,
          slotNumber,
        })
      }
    }
  }
  return lessons
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

function resolveSchoolYear(today = new Date()) {
  const start = new Date(today.getFullYear(), 3, 1)
  return today >= start ? today.getFullYear() : today.getFullYear() - 1
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const projectId = (process.env.STAGING_PROJECT_ID || '').trim()
  if (projectId !== ALLOWED_PROJECT_ID) {
    throw new Error(`STAGING_PROJECT_ID が "${projectId}" です。"${ALLOWED_PROJECT_ID}" のときだけ実行できます(本番保護)。`)
  }

  const cfgRaw = JSON.parse(readFileSync(resolve(args.config || 'functions/scripts/staging-bootstrap.config.json'), 'utf8'))
  const workspaceKey = (cfgRaw.workspaceKey || 'main').trim()
  const classroomId = (cfgRaw.classroomId || '').trim()
  if (!classroomId) throw new Error('config に classroomId がありません。')

  const app = initializeApp({ credential: applicationDefault(), projectId })
  if ((app.options.projectId || projectId) !== ALLOWED_PROJECT_ID) {
    throw new Error('SA のプロジェクトが staging ではありません。中断します。')
  }
  const db = getFirestore(app)

  const snapshotRef = db.collection('workspaces').doc(workspaceKey).collection('classroomSnapshots').doc(classroomId)
  const existing = await snapshotRef.get()
  if (!existing.exists) {
    throw new Error(`classroomSnapshots/${classroomId} が見つかりません。先に staging-bootstrap を実行してください。`)
  }
  const current = existing.data() || {}
  const currentData = (current.data && typeof current.data === 'object') ? current.data : {}

  const schoolYear = resolveSchoolYear()
  const teachers = generateTeachers()
  const students = generateStudents()
  const regularLessons = generateRegularLessons(teachers, students, schoolYear)
  const nowIso = new Date().toISOString()

  // 既存の data を土台に、基本データだけ差し替える(specialSessions/autoAssignRules/settings は維持)。
  const nextData = {
    ...currentData,
    screen: currentData.screen || 'board',
    managers: currentData.managers || [],
    teachers,
    students,
    regularLessons,
    groupLessons: currentData.groupLessons || [],
    boardState: currentData.boardState ?? null,
  }

  const nextVersion = (typeof current.version === 'number' ? current.version : 0) + 1

  // プレーン data として保存(split/圧縮エンコードは使わない=loader が data を直接読む)。
  // set(merge:false) で過去の split 系フィールドが残っていても確実に消す。
  await snapshotRef.set({
    schemaVersion: current.schemaVersion ?? 1,
    savedAt: nowIso,
    data: nextData,
    updatedBy: current.updatedBy || 'staging-seed',
    updatedAt: nowIso,
    version: nextVersion,
  })

  console.log('staging シード投入完了:')
  console.log(`  教室: workspaces/${workspaceKey}/classroomSnapshots/${classroomId}`)
  console.log(`  講師: ${teachers.length} / 生徒: ${students.length} / 通常授業: ${regularLessons.length}`)
  console.log(`  schoolYear: ${schoolYear} / version: ${nextVersion}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
