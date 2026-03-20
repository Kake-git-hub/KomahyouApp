import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { AppMenu } from '../navigation/AppMenu'
import { getReferenceDateKey, getStudentDisplayName, getTeacherDisplayName, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import {
  createAutoAssignTargetId,
  listAutoAssignTargetGrades,
  resolveStudentGradeLabel,
  type AutoAssignRuleKey,
  type AutoAssignRuleRow,
  type AutoAssignTarget,
  type AutoAssignTargetGrade,
} from './autoAssignRuleModel'
import { createPairConstraintId, type PairConstraintRow } from '../../types/pairConstraint'

type AutoAssignRuleScreenProps = {
  rules: AutoAssignRuleRow[]
  teachers: TeacherRow[]
  students: StudentRow[]
  pairConstraints: PairConstraintRow[]
  onUpdateRules: Dispatch<SetStateAction<AutoAssignRuleRow[]>>
  onUpdatePairConstraints: Dispatch<SetStateAction<PairConstraintRow[]>>
  onBackToBoard: () => void
  onOpenBasicData: () => void
  onOpenSpecialData: () => void
  onOpenBackupRestore: () => void
}

type TargetDraftType = 'all' | 'grade' | 'students'
type SelectionModalMode = 'target' | 'exclude'
type RuleGroupKey = 'two-students' | 'lesson-limit' | 'lesson-pattern' | 'time-preference'

const forcedRuleKeys = new Set<AutoAssignRuleKey>(['forbidFirstPeriod', 'regularTeachersOnly'])
const singleTargetRuleKeys = new Set<AutoAssignRuleKey>(['maxOneLesson', 'maxTwoLessons', 'maxThreeLessons'])
const fixedForcedConstraints = [
  {
    key: 'keep-existing',
    label: '既存コマは変更しない',
    description: '割振は既存コマの変更を行わず、空いているところへの追加割り振りだけで行います。',
  },
  {
    key: 'attendance-only',
    label: '出席可能コマのみ',
    description: '生徒の出席可能コマだけを候補にして割り振ります。',
  },
] as const
const ruleGroupDefinitions: Array<{
  key: RuleGroupKey
  label: string
  description: string
  orderKey: AutoAssignRuleKey
  ruleKeys: AutoAssignRuleKey[]
}> = [
  {
    key: 'two-students',
    label: '講師1人に生徒2人配置',
    description: '講師1人に生徒2人配置を独立した制約として優先順位付けします。',
    orderKey: 'preferTwoStudentsPerTeacher',
    ruleKeys: ['preferTwoStudentsPerTeacher'],
  },
  {
    key: 'lesson-limit',
    label: '同日コマ数制約',
    description: '1コマ上限 / 2コマ上限 / 3コマ上限をひとかたまりとして優先順位を付けます。',
    orderKey: 'maxOneLesson',
    ruleKeys: ['maxOneLesson', 'maxTwoLessons', 'maxThreeLessons'],
  },
  {
    key: 'lesson-pattern',
    label: '連続・通常連結',
    description: '2コマ連続 / 一コマ空け / 通常連結2コマをひとかたまりとして優先順位を付けます。',
    orderKey: 'allowTwoConsecutiveLessons',
    ruleKeys: ['allowTwoConsecutiveLessons', 'requireBreakBetweenLessons', 'connectRegularLessons'],
  },
  {
    key: 'time-preference',
    label: '時限優先',
    description: '3,4,5限優先 / 2限寄り / 5限寄りをひとかたまりとして優先順位を付けます。',
    orderKey: 'preferLateAfternoon',
    ruleKeys: ['preferLateAfternoon', 'preferSecondPeriod', 'preferFifthPeriod'],
  },
]

function createEmptyPairConstraintDraft(): PairConstraintRow {
  return {
    id: '',
    personAType: 'teacher',
    personAId: '',
    personBType: 'student',
    personBId: '',
    type: 'incompatible',
  }
}

function updateTimestamp() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

function isSameTarget(left: AutoAssignTarget, right: AutoAssignTarget) {
  if (left.type !== right.type) return false
  if (left.type === 'all' && right.type === 'all') return true
  if (left.type === 'grade' && right.type === 'grade') return left.grade === right.grade
  if (left.type === 'students' && right.type === 'students') {
    return left.studentIds.length === right.studentIds.length
      && left.studentIds.every((studentId, index) => studentId === right.studentIds[index])
  }
  return false
}

function dedupeTargets(targets: AutoAssignTarget[]) {
  const uniqueTargets: AutoAssignTarget[] = []
  for (const target of targets) {
    if (uniqueTargets.some((currentTarget) => isSameTarget(currentTarget, target))) continue
    uniqueTargets.push(target)
  }
  return uniqueTargets
}

function normalizeRule(rule: AutoAssignRuleRow): AutoAssignRuleRow {
  const legacyIncludeTargets = (rule.includeStudentIds ?? []).map<AutoAssignTarget>((studentId) => ({
    id: `legacy_include_${studentId}`,
    type: 'students',
    studentIds: [studentId],
    origin: 'manual',
  }))
  const legacyExcludeTargets = (rule.excludeStudentIds ?? []).map<AutoAssignTarget>((studentId) => ({
    id: `legacy_exclude_${studentId}`,
    type: 'students',
    studentIds: [studentId],
    origin: 'manual',
  }))

  return {
    ...rule,
    targets: dedupeTargets([...(rule.targets ?? []), ...legacyIncludeTargets]).map((target) => ({ ...target, origin: target.origin ?? 'manual' })),
    excludeTargets: dedupeTargets([...(rule.excludeTargets ?? []), ...legacyExcludeTargets]).map((target) => ({ ...target, origin: target.origin ?? 'manual' })),
    priorityScore: rule.priorityScore ?? 3,
    includeStudentIds: [],
    excludeStudentIds: [],
  }
}

function buildPairConstraintSignature(row: PairConstraintRow) {
  return [`${row.personAType}:${row.personAId}`, `${row.personBType}:${row.personBId}`].sort().join('|')
}

export function AutoAssignRuleScreen({
  rules,
  teachers,
  students,
  pairConstraints,
  onUpdateRules,
  onUpdatePairConstraints,
  onBackToBoard,
  onOpenBasicData,
  onOpenSpecialData,
  onOpenBackupRestore,
}: AutoAssignRuleScreenProps) {
  const [statusMessage, setStatusMessage] = useState('')
  const [draftTypes, setDraftTypes] = useState<Record<string, TargetDraftType>>({})
  const [draftGrades, setDraftGrades] = useState<Record<string, AutoAssignTargetGrade[]>>({})
  const [draftStudentIds, setDraftStudentIds] = useState<Record<string, string[]>>({})
  const [openModalState, setOpenModalState] = useState<{ ruleKey: AutoAssignRuleKey; mode: SelectionModalMode } | null>(null)
  const [pairConstraintDraft, setPairConstraintDraft] = useState<PairConstraintRow>(createEmptyPairConstraintDraft())
  const referenceDate = getReferenceDateKey(new Date())

  const visibleStudents = useMemo(() => students
    .filter((student) => !student.isHidden)
    .slice()
    .sort((left, right) => getStudentDisplayName(left).localeCompare(getStudentDisplayName(right), 'ja')),
  [students])
  const visibleTeachers = useMemo(() => teachers
    .filter((teacher) => !teacher.isHidden)
    .slice()
    .sort((left, right) => getTeacherDisplayName(left).localeCompare(getTeacherDisplayName(right), 'ja')),
  [teachers])

  const studentNameById = useMemo(() => Object.fromEntries(visibleStudents.map((student) => [student.id, getStudentDisplayName(student)])), [visibleStudents])
  const teacherNameById = useMemo(() => Object.fromEntries(visibleTeachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)])), [visibleTeachers])
  const studentGradeById = useMemo(() => Object.fromEntries(visibleStudents.map((student) => [student.id, resolveStudentGradeLabel(student.birthDate, referenceDate)])), [referenceDate, visibleStudents])
  const gradeOptions = useMemo(() => listAutoAssignTargetGrades(visibleStudents, referenceDate), [referenceDate, visibleStudents])
  const normalizedRules = useMemo(() => rules.map(normalizeRule), [rules])
  const forcedRules = useMemo(() => normalizedRules.filter((rule) => forcedRuleKeys.has(rule.key)), [normalizedRules])
  const orderedRuleGroups = useMemo(() => ruleGroupDefinitions
    .map((group) => ({
      ...group,
      rules: group.ruleKeys
        .map((ruleKey) => normalizedRules.find((rule) => rule.key === ruleKey))
        .filter((rule): rule is AutoAssignRuleRow => Boolean(rule)),
      firstIndex: normalizedRules.findIndex((rule) => rule.key === group.orderKey),
    }))
    .sort((left, right) => left.firstIndex - right.firstIndex),
  [normalizedRules])

  const findRuleGroup = (ruleKey: AutoAssignRuleKey) => ruleGroupDefinitions.find((group) => group.ruleKeys.includes(ruleKey))
  const getGroupRuleKeys = (ruleKey: AutoAssignRuleKey) => findRuleGroup(ruleKey)?.ruleKeys ?? []

  const collectReservedTargets = (ruleKey: AutoAssignRuleKey) => {
    const siblingRuleKeys = getGroupRuleKeys(ruleKey).filter((currentRuleKey) => currentRuleKey !== ruleKey)
    const siblingRules = normalizedRules.filter((rule) => siblingRuleKeys.includes(rule.key))

    return {
      hasAll: siblingRules.some((rule) => rule.targets.some((target) => target.type === 'all')),
      grades: new Set(siblingRules.flatMap((rule) => rule.targets.filter((target) => target.type === 'grade').map((target) => target.grade))),
      students: new Set(siblingRules.flatMap((rule) => rule.targets.flatMap((target) => target.type === 'students' ? target.studentIds : []))),
    }
  }

  const createModalKey = (ruleKey: AutoAssignRuleKey, mode: SelectionModalMode) => `${ruleKey}:${mode}`
  const resolveDraftType = (ruleKey: AutoAssignRuleKey, mode: SelectionModalMode): TargetDraftType => {
    const key = createModalKey(ruleKey, mode)
    if (mode === 'exclude') return draftTypes[key] === 'all' ? 'grade' : (draftTypes[key] ?? 'grade')
    return draftTypes[key] ?? 'all'
  }
  const resolveDraftGrades = (ruleKey: AutoAssignRuleKey, mode: SelectionModalMode) => draftGrades[createModalKey(ruleKey, mode)] ?? []
  const resolveDraftStudentIds = (ruleKey: AutoAssignRuleKey, mode: SelectionModalMode) => draftStudentIds[createModalKey(ruleKey, mode)] ?? []

  const resetModalDraft = (ruleKey: AutoAssignRuleKey, mode: SelectionModalMode) => {
    const key = createModalKey(ruleKey, mode)
    setDraftTypes((current) => ({ ...current, [key]: mode === 'exclude' ? 'grade' : 'all' }))
    setDraftGrades((current) => ({ ...current, [key]: [] }))
    setDraftStudentIds((current) => ({ ...current, [key]: [] }))
  }

  const updateRules = (updater: (current: AutoAssignRuleRow[]) => AutoAssignRuleRow[], nextMessage: string) => {
    const nextTimestamp = updateTimestamp()
    onUpdateRules((current) => updater(current.map(normalizeRule)).map((rule) => ({
      ...rule,
      includeStudentIds: [],
      excludeStudentIds: [],
      updatedAt: nextTimestamp,
    })))
    setStatusMessage(nextMessage)
  }

  const resolveTargetStudentIds = (targets: AutoAssignTarget[]) => {
    const studentIds = new Set<string>()

    for (const target of targets) {
      if (target.type === 'all') {
        for (const student of visibleStudents) studentIds.add(student.id)
        continue
      }
      if (target.type === 'grade') {
        for (const student of visibleStudents) {
          if (studentGradeById[student.id] === target.grade) studentIds.add(student.id)
        }
        continue
      }
      for (const studentId of target.studentIds) studentIds.add(studentId)
    }

    return Array.from(studentIds).sort((left, right) => (studentNameById[left] ?? '').localeCompare(studentNameById[right] ?? '', 'ja'))
  }

  const buildDraftTargets = (ruleKey: AutoAssignRuleKey, mode: SelectionModalMode) => {
    const draftType = resolveDraftType(ruleKey, mode)
    const selectedGrades = resolveDraftGrades(ruleKey, mode)
    const selectedStudentIds = resolveDraftStudentIds(ruleKey, mode)
      .slice()
      .sort((left, right) => (studentNameById[left] ?? '').localeCompare(studentNameById[right] ?? '', 'ja'))

    if (draftType === 'all') {
      return [{ id: createAutoAssignTargetId(), type: 'all' as const }]
    }
    if (draftType === 'grade') {
      if (selectedGrades.length === 0) {
        setStatusMessage('学年別を選ぶ場合は対象学年を 1 つ以上選択してください。')
        return null
      }
      return selectedGrades.map((grade) => ({ id: createAutoAssignTargetId(), type: 'grade' as const, grade }))
    }
    if (selectedStudentIds.length === 0) {
      setStatusMessage(mode === 'target' ? '個人指定を選ぶ場合は生徒を 1 人以上選択してください。' : '対象外にする個人を 1 人以上選択してください。')
      return null
    }
    return [{ id: createAutoAssignTargetId(), type: 'students' as const, studentIds: selectedStudentIds }]
  }

  const collectOverlapNames = (rule: AutoAssignRuleRow, nextTargets: AutoAssignTarget[], mode: SelectionModalMode) => {
    const targetIds = resolveTargetStudentIds(mode === 'target' ? nextTargets : rule.targets)
    const excludeIds = resolveTargetStudentIds(mode === 'exclude' ? nextTargets : rule.excludeTargets)
    return targetIds.filter((studentId) => excludeIds.includes(studentId)).map((studentId) => studentNameById[studentId] ?? studentId)
  }

  const reconcileGroupTargets = (current: AutoAssignRuleRow[], changedRuleKey: AutoAssignRuleKey) => {
    const groupRuleKeys = getGroupRuleKeys(changedRuleKey)
    if (groupRuleKeys.length === 0) return current

    const changedRule = current.find((rule) => rule.key === changedRuleKey)
    if (!changedRule) return current

    const changedTargetIds = new Set(resolveTargetStudentIds(changedRule.targets))

    return current.map((rule) => {
      if (!groupRuleKeys.includes(rule.key) || rule.key === changedRuleKey) return rule

      const retainedExcludeTargets = rule.excludeTargets.filter((target) => !(target.origin === 'group-conflict' && target.sourceRuleKey === changedRuleKey))
      if (changedTargetIds.size === 0) {
        return {
          ...rule,
          excludeTargets: retainedExcludeTargets,
        }
      }

      const currentRuleTargetIds = new Set(resolveTargetStudentIds(rule.targets))
      const overlapStudentIds = Array.from(changedTargetIds).filter((studentId) => currentRuleTargetIds.has(studentId))
      const conflictTargets = overlapStudentIds.map<AutoAssignTarget>((studentId) => ({
        id: createAutoAssignTargetId(),
        type: 'students',
        studentIds: [studentId],
        origin: 'group-conflict',
        sourceRuleKey: changedRuleKey,
      }))

      return {
        ...rule,
        excludeTargets: dedupeTargets([...retainedExcludeTargets, ...conflictTargets]),
      }
    })
  }

  const addTargets = (ruleKey: AutoAssignRuleKey, mode: SelectionModalMode) => {
    const rule = normalizedRules.find((currentRule) => currentRule.key === ruleKey)
    if (!rule) return

    const nextTargets = buildDraftTargets(ruleKey, mode)
    if (!nextTargets) return

    const currentTargets = mode === 'target' ? rule.targets : rule.excludeTargets
    const uniqueNewTargets = nextTargets.filter((target) => !currentTargets.some((currentTarget) => isSameTarget(currentTarget, target)))
    if (uniqueNewTargets.length === 0) {
      setStatusMessage(mode === 'target' ? '同じ対象はすでに登録されています。' : '同じ対象外はすでに登録されています。')
      return
    }

    const overlapNames = collectOverlapNames(rule, uniqueNewTargets, mode)
    const overlapMessage = overlapNames.length > 0
      ? ` 対象外が優先されるため、${overlapNames.slice(0, 3).join(' / ')}${overlapNames.length > 3 ? ' ほか' : ''} は対象外として扱われます。`
      : ''

    updateRules((current) => {
      const nextRules = current.map((currentRule) => {
        if (currentRule.key !== ruleKey) return currentRule
        const normalizedRule = normalizeRule(currentRule)
        const manualNewTargets = uniqueNewTargets.map((target) => ({ ...target, origin: 'manual' as const, sourceRuleKey: undefined }))
        const nextRuleTargets = singleTargetRuleKeys.has(ruleKey)
          ? manualNewTargets
          : dedupeTargets([...normalizedRule.targets, ...manualNewTargets])
        const nextRuleExcludeTargets = mode === 'exclude'
          ? dedupeTargets([...normalizedRule.excludeTargets, ...manualNewTargets])
          : normalizedRule.excludeTargets

        return {
          ...normalizedRule,
          targets: mode === 'target' ? nextRuleTargets : normalizedRule.targets,
          excludeTargets: nextRuleExcludeTargets,
        }
      })

      return mode === 'target' ? reconcileGroupTargets(nextRules, ruleKey) : nextRules
    }, `${rule.label} に${mode === 'target' ? '対象' : '対象外'}を追加しました。${overlapMessage}`)

    setOpenModalState(null)
  }

  const clearTargets = (ruleKey: AutoAssignRuleKey) => {
    updateRules((current) => reconcileGroupTargets(current.map((rule) => rule.key === ruleKey ? { ...rule, targets: [] } : rule), ruleKey), '対象をクリアしました。')
  }

  const clearExcludeTargets = (ruleKey: AutoAssignRuleKey) => {
    updateRules((current) => current.map((rule) => rule.key === ruleKey ? { ...rule, excludeTargets: [] } : rule), '対象外をクリアしました。')
  }

  const moveRuleGroup = (groupKey: RuleGroupKey, direction: 'up' | 'down') => {
    const currentIndex = orderedRuleGroups.findIndex((group) => group.key === groupKey)
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedRuleGroups.length) return

    const nextGroupOrder = orderedRuleGroups.map((group) => group.key)
    ;[nextGroupOrder[currentIndex], nextGroupOrder[targetIndex]] = [nextGroupOrder[targetIndex], nextGroupOrder[currentIndex]]

    updateRules((current) => {
      const byRuleKey = new Map(current.map((rule) => [rule.key, rule]))
      const nextForcedRules = current.filter((rule) => forcedRuleKeys.has(rule.key))
      const nextGroupedRules = nextGroupOrder.flatMap((currentGroupKey) => {
        const groupDefinition = ruleGroupDefinitions.find((group) => group.key === currentGroupKey)
        if (!groupDefinition) return []
        return groupDefinition.ruleKeys
          .map((ruleKey) => byRuleKey.get(ruleKey))
          .filter((rule): rule is AutoAssignRuleRow => Boolean(rule))
      })
      return [...nextForcedRules, ...nextGroupedRules]
    }, direction === 'up' ? '制約グループの優先順位を上げました。' : '制約グループの優先順位を下げました。')
  }

  const toggleGrade = (ruleKey: AutoAssignRuleKey, mode: SelectionModalMode, grade: AutoAssignTargetGrade) => {
    const key = createModalKey(ruleKey, mode)
    setDraftGrades((current) => {
      const currentGrades = current[key] ?? []
      return {
        ...current,
        [key]: currentGrades.includes(grade)
          ? currentGrades.filter((currentGrade) => currentGrade !== grade)
          : [...currentGrades, grade],
      }
    })
  }

  const toggleStudent = (ruleKey: AutoAssignRuleKey, mode: SelectionModalMode, studentId: string) => {
    const key = createModalKey(ruleKey, mode)
    setDraftStudentIds((current) => {
      const currentIds = current[key] ?? []
      return {
        ...current,
        [key]: currentIds.includes(studentId)
          ? currentIds.filter((id) => id !== studentId)
          : [...currentIds, studentId],
      }
    })
  }

  const describeTarget = (target: AutoAssignTarget) => {
    if (target.type === 'all') return '全員'
    if (target.type === 'grade') return target.grade
    return target.studentIds.map((studentId) => studentNameById[studentId] ?? studentId).join(' / ')
  }

  const describeTargetTooltip = (target: AutoAssignTarget) => {
    if (target.type === 'all') return '全生徒を対象にします。'
    if (target.type === 'grade') return `${target.grade} の生徒を対象にします。`
    return target.studentIds.map((studentId) => studentNameById[studentId] ?? studentId).join('\n')
  }

  const summarizeTargets = (targets: AutoAssignTarget[], emptyLabel: string) => {
    if (targets.length === 0) return emptyLabel
    return targets.map((target) => describeTarget(target)).join(' / ')
  }

  const resolvePairPersonName = (personType: PairConstraintRow['personAType'], personId: string) => (
    personType === 'teacher' ? teacherNameById[personId] ?? personId : studentNameById[personId] ?? personId
  )

  const addPairConstraint = () => {
    if (!pairConstraintDraft.personAId || !pairConstraintDraft.personBId) {
      setStatusMessage('ペア制約を追加するには人物Aと人物Bを選択してください。')
      return
    }
    if (pairConstraintDraft.personAType === pairConstraintDraft.personBType && pairConstraintDraft.personAId === pairConstraintDraft.personBId) {
      setStatusMessage('同じ人物どうしはペア制約に登録できません。')
      return
    }

    const nextConstraint = { ...pairConstraintDraft, id: createPairConstraintId() }
    const nextSignature = buildPairConstraintSignature(nextConstraint)
    if (pairConstraints.some((row) => buildPairConstraintSignature(row) === nextSignature)) {
      setStatusMessage('同じペア制約はすでに登録されています。')
      return
    }

    onUpdatePairConstraints((current) => [...current, nextConstraint])
    setPairConstraintDraft(createEmptyPairConstraintDraft())
    setStatusMessage('ペア制約を追加しました。')
  }

  const updatePairConstraint = (id: string, patch: Partial<PairConstraintRow>) => {
    onUpdatePairConstraints((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
    setStatusMessage('ペア制約を更新しました。')
  }

  const removePairConstraint = (id: string) => {
    if (!window.confirm('このペア制約を削除します。よろしいですか。')) {
      setStatusMessage('ペア制約の削除をキャンセルしました。')
      return
    }
    onUpdatePairConstraints((current) => current.filter((row) => row.id !== id))
    setStatusMessage('ペア制約を削除しました。')
  }

  const renderStaticForcedConstraint = (constraint: typeof fixedForcedConstraints[number]) => (
    <section key={constraint.key} className="auto-assign-rule-row auto-assign-rule-row-static" data-testid={`auto-assign-static-constraint-${constraint.key}`}>
      <div className="auto-assign-rule-topline">
        <div className="auto-assign-rule-title-group">
          <span className="status-chip danger">最優先</span>
          <h3>{constraint.label}</h3>
        </div>
      </div>
      <p className="auto-assign-rule-description">{constraint.description}</p>
      <div className="auto-assign-rule-summary">
        <span className="auto-assign-rule-summary-segment">＋対象: 全員</span>
        <span className="auto-assign-rule-summary-segment">変更不可</span>
      </div>
    </section>
  )

  const renderRuleCard = (
    rule: AutoAssignRuleRow,
    priorityLabel: string,
    tone: 'force' | 'constraint',
    options?: { hideTopline?: boolean; hideDescription?: boolean },
  ) => (
    <section key={rule.key} className={`auto-assign-rule-row${tone === 'force' ? ' is-absolute' : ''}`} data-testid={`auto-assign-rule-card-${rule.key}`}>
      {!options?.hideTopline ? (
        <div className="auto-assign-rule-topline">
          <div className="auto-assign-rule-title-group">
            <span className={`status-chip${tone === 'force' ? ' danger' : ''}`} data-testid={`auto-assign-rule-priority-${rule.key}`}>
              {priorityLabel}
            </span>
            <h3>{rule.label}</h3>
          </div>
        </div>
      ) : null}
      {!options?.hideDescription ? <p className="auto-assign-rule-description">{rule.description}</p> : null}
      <div className="auto-assign-rule-summary" data-testid={`auto-assign-rule-summary-${rule.key}`}>
        <span className="auto-assign-rule-summary-segment" data-testid={`auto-assign-rule-targets-${rule.key}`} title={rule.targets.map((target) => describeTargetTooltip(target)).join('\n\n')}>
          ＋対象: {summarizeTargets(rule.targets, 'なし')}
        </span>
        <span className="auto-assign-rule-summary-segment" data-testid={`auto-assign-exclude-list-${rule.key}`} title={rule.excludeTargets.map((target) => describeTargetTooltip(target)).join('\n\n')}>
          －対象: {summarizeTargets(rule.excludeTargets, 'なし')}
        </span>
      </div>
      <div className="auto-assign-rule-actions-row">
        <div className="auto-assign-rule-action-buttons">
          <button className="secondary-button slim" type="button" onClick={() => { resetModalDraft(rule.key, 'target'); setOpenModalState({ ruleKey: rule.key, mode: 'target' }) }} data-testid={`auto-assign-open-modal-${rule.key}`}>＋ 対象</button>
          <button className="secondary-button slim" type="button" onClick={() => { resetModalDraft(rule.key, 'exclude'); setOpenModalState({ ruleKey: rule.key, mode: 'exclude' }) }} data-testid={`auto-assign-open-exclude-modal-${rule.key}`}>－ 対象</button>
        </div>
        <div className="auto-assign-rule-action-buttons">
          <button className="secondary-button slim" type="button" onClick={() => clearTargets(rule.key)} disabled={rule.targets.length === 0} data-testid={`auto-assign-clear-targets-${rule.key}`}>対象クリア</button>
          <button className="secondary-button slim" type="button" onClick={() => clearExcludeTargets(rule.key)} disabled={rule.excludeTargets.length === 0} data-testid={`auto-assign-clear-exclude-targets-${rule.key}`}>除外クリア</button>
        </div>
      </div>
    </section>
  )

  const renderPairConstraintSection = () => (
    <section className="auto-assign-group-card auto-assign-pair-panel" data-testid="auto-assign-pair-constraints-panel">
      <div className="auto-assign-group-topline">
        <div className="auto-assign-rule-title-group">
          <span className="status-chip danger">強制制約</span>
          <h3>ペア制約</h3>
        </div>
      </div>
      <p className="auto-assign-rule-description">ここで指定した組み合わせは、自動割振で常に同席不可として扱います。</p>
      <div className="basic-data-form-row wrap align-center auto-assign-pair-form">
        <select value={pairConstraintDraft.personAType} onChange={(event) => setPairConstraintDraft((current) => ({ ...current, personAType: event.target.value as PairConstraintRow['personAType'], personAId: '' }))} data-testid="auto-assign-pair-draft-person-a-type">
          <option value="teacher">講師</option>
          <option value="student">生徒</option>
        </select>
        <select value={pairConstraintDraft.personAId} onChange={(event) => setPairConstraintDraft((current) => ({ ...current, personAId: event.target.value }))} data-testid="auto-assign-pair-draft-person-a-id">
          <option value="">人物Aを選択</option>
          {(pairConstraintDraft.personAType === 'teacher' ? visibleTeachers : visibleStudents).map((person) => <option key={person.id} value={person.id}>{pairConstraintDraft.personAType === 'teacher' ? teacherNameById[person.id] : studentNameById[person.id]}</option>)}
        </select>
        <span className="basic-data-xmark">×</span>
        <select value={pairConstraintDraft.personBType} onChange={(event) => setPairConstraintDraft((current) => ({ ...current, personBType: event.target.value as PairConstraintRow['personBType'], personBId: '' }))} data-testid="auto-assign-pair-draft-person-b-type">
          <option value="teacher">講師</option>
          <option value="student">生徒</option>
        </select>
        <select value={pairConstraintDraft.personBId} onChange={(event) => setPairConstraintDraft((current) => ({ ...current, personBId: event.target.value }))} data-testid="auto-assign-pair-draft-person-b-id">
          <option value="">人物Bを選択</option>
          {(pairConstraintDraft.personBType === 'teacher' ? visibleTeachers : visibleStudents).map((person) => <option key={person.id} value={person.id}>{pairConstraintDraft.personBType === 'teacher' ? teacherNameById[person.id] : studentNameById[person.id]}</option>)}
        </select>
        <button className="primary-button" type="button" onClick={addPairConstraint} data-testid="auto-assign-pair-save-button">保存</button>
      </div>
      <table className="basic-data-table" data-testid="auto-assign-pair-constraints-table">
        <thead>
          <tr>
            <th>人物A</th>
            <th></th>
            <th>人物B</th>
            <th>種別</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {pairConstraints.map((row) => (
            <tr key={row.id} data-testid={`auto-assign-pair-constraint-row-${row.id}`}>
              <td>
                <div className="basic-data-person-cell">
                  <select value={row.personAType} onChange={(event) => updatePairConstraint(row.id, { personAType: event.target.value as PairConstraintRow['personAType'], personAId: '' })} data-testid={`auto-assign-pair-person-a-type-${row.id}`}>
                    <option value="teacher">講師</option>
                    <option value="student">生徒</option>
                  </select>
                  <select value={row.personAId} onChange={(event) => updatePairConstraint(row.id, { personAId: event.target.value })} data-testid={`auto-assign-pair-person-a-id-${row.id}`}>
                    <option value="">人物Aを選択</option>
                    {(row.personAType === 'teacher' ? visibleTeachers : visibleStudents).map((person) => <option key={person.id} value={person.id}>{row.personAType === 'teacher' ? teacherNameById[person.id] : studentNameById[person.id]}</option>)}
                  </select>
                </div>
              </td>
              <td className="basic-data-xmark-cell">×</td>
              <td>
                <div className="basic-data-person-cell">
                  <select value={row.personBType} onChange={(event) => updatePairConstraint(row.id, { personBType: event.target.value as PairConstraintRow['personBType'], personBId: '' })} data-testid={`auto-assign-pair-person-b-type-${row.id}`}>
                    <option value="teacher">講師</option>
                    <option value="student">生徒</option>
                  </select>
                  <select value={row.personBId} onChange={(event) => updatePairConstraint(row.id, { personBId: event.target.value })} data-testid={`auto-assign-pair-person-b-id-${row.id}`}>
                    <option value="">人物Bを選択</option>
                    {(row.personBType === 'teacher' ? visibleTeachers : visibleStudents).map((person) => <option key={person.id} value={person.id}>{row.personBType === 'teacher' ? teacherNameById[person.id] : studentNameById[person.id]}</option>)}
                  </select>
                </div>
              </td>
              <td><span className="status-chip secondary">組み合わせ不可</span></td>
              <td>
                <div className="basic-data-row-actions">
                  <button className="secondary-button slim" type="button" onClick={() => removePairConstraint(row.id)} data-testid={`auto-assign-pair-remove-${row.id}`}>削除</button>
                </div>
              </td>
            </tr>
          ))}
          {pairConstraints.length === 0 ? <tr><td colSpan={5} className="basic-data-empty-row">ペア制約はまだありません。</td></tr> : null}
        </tbody>
      </table>
      <div className="auto-assign-pair-list" data-testid="auto-assign-pair-summary-list">
        {pairConstraints.map((row) => (
          <span key={`summary_${row.id}`} className="selection-pill auto-assign-target-chip">
            {resolvePairPersonName(row.personAType, row.personAId)} × {resolvePairPersonName(row.personBType, row.personBId)}
          </span>
        ))}
      </div>
    </section>
  )

  return (
    <div className="page-shell page-shell-basic-data">
      <section className="toolbar-panel" aria-label="自動割振ルールの操作バー">
        <div className="toolbar-row toolbar-row-primary">
          <div className="toolbar-group toolbar-group-compact">
            <AppMenu
              currentScreen="auto-assign-rules"
              onNavigate={(screen) => {
                if (screen === 'board') onBackToBoard()
                if (screen === 'basic-data') onOpenBasicData()
                if (screen === 'special-data') onOpenSpecialData()
                if (screen === 'backup-restore') onOpenBackupRestore()
              }}
              buttonTestId="auto-assign-rules-menu-button"
              boardItemTestId="auto-assign-rules-menu-open-board-button"
              basicDataItemTestId="auto-assign-rules-menu-open-basic-data-button"
              specialDataItemTestId="auto-assign-rules-menu-open-special-data-button"
              backupRestoreItemTestId="auto-assign-rules-menu-open-backup-button"
            />
          </div>
          <div className="toolbar-group toolbar-group-end">
            <button className="secondary-button slim" type="button" onClick={onBackToBoard} data-testid="auto-assign-rules-back-button">コマ表へ戻る</button>
          </div>
        </div>
        {statusMessage ? (
          <div className="toolbar-row toolbar-row-secondary">
            <div className="toolbar-status" data-testid="auto-assign-rules-status">{statusMessage}</div>
          </div>
        ) : null}
      </section>

      <main className="page-main page-main-board-only">
        <section className="board-panel board-panel-unified special-session-panel" data-testid="auto-assign-rules-screen">
          <div className="basic-data-header">
            <div>
              <h2>自動割振ルール</h2>
              <p className="basic-data-subcopy">強制制約事項が最優先で守られ、その下で制約グループをひとかたまりとして優先順位付けします。同じ制約グループ内では同じ対象を重ねず、重なった場合は最後に編集した制約側を優先して他方を対象外へ移します。</p>
            </div>
          </div>

          <div className="auto-assign-rule-group-head">強制制約事項</div>
          <div className="auto-assign-rule-list">
            {fixedForcedConstraints.map((constraint) => renderStaticForcedConstraint(constraint))}
            {forcedRules.map((rule) => renderRuleCard(rule, '強制制約', 'force'))}
            {renderPairConstraintSection()}
          </div>

          <div className="auto-assign-rule-group-head">制約事項</div>
          <div className="auto-assign-rule-groups">
            {orderedRuleGroups.map((group, index) => (
              <section key={group.key} className="auto-assign-group-card" data-testid={`auto-assign-group-${group.key}`}>
                <div className="auto-assign-group-topline">
                  <div className="auto-assign-rule-title-group">
                    <span className="status-chip" data-testid={`auto-assign-group-priority-${group.key}`}>{`制約 ${index + 1}`}</span>
                    <h3>{group.label}</h3>
                  </div>
                  <div className="auto-assign-rule-order-actions">
                    <button className="secondary-button slim" type="button" onClick={() => moveRuleGroup(group.key, 'up')} disabled={index === 0} data-testid={`auto-assign-group-move-up-${group.key}`}>上へ</button>
                    <button className="secondary-button slim" type="button" onClick={() => moveRuleGroup(group.key, 'down')} disabled={index === orderedRuleGroups.length - 1} data-testid={`auto-assign-group-move-down-${group.key}`}>下へ</button>
                  </div>
                </div>
                {group.rules.length > 1 ? <p className="auto-assign-rule-description">{group.description}</p> : null}
                <div className="auto-assign-group-rules">
                  {group.rules.map((rule) => renderRuleCard(rule, `制約 ${index + 1}`, 'constraint', group.rules.length === 1 ? { hideTopline: true, hideDescription: true } : undefined))}
                </div>
              </section>
            ))}
          </div>
        </section>
      </main>

      {openModalState !== null && (() => {
        const rule = normalizedRules.find((currentRule) => currentRule.key === openModalState.ruleKey)
        if (!rule) return null

        const draftType = resolveDraftType(rule.key, openModalState.mode)
        const selectedGrades = resolveDraftGrades(rule.key, openModalState.mode)
        const selectedStudentIds = resolveDraftStudentIds(rule.key, openModalState.mode)
        const reservedTargets = openModalState.mode === 'target' ? collectReservedTargets(rule.key) : null
        const visibleGradeOptions = openModalState.mode === 'target'
          ? gradeOptions.filter((grade) => !reservedTargets?.grades.has(grade))
          : gradeOptions
        const selectableStudents = openModalState.mode === 'target'
          ? visibleStudents.filter((student) => !reservedTargets?.students.has(student.id))
          : visibleStudents

        return (
          <div
            className="auto-assign-modal-overlay"
            data-testid={`auto-assign-modal-overlay-${openModalState.mode}-${rule.key}`}
            onClick={(event) => { if (event.target === event.currentTarget) setOpenModalState(null) }}
            onKeyDown={(event) => { if (event.key === 'Escape') setOpenModalState(null) }}
            role="presentation"
          >
            <div className="auto-assign-modal" data-testid={`auto-assign-modal-${openModalState.mode}-${rule.key}`} role="dialog" aria-modal="true">
              <div className="auto-assign-modal-title">{openModalState.mode === 'target' ? `＋対象 - ${rule.label}` : `－対象 - ${rule.label}`}</div>

              <div className="auto-assign-type-buttons">
                {openModalState.mode === 'target' && !reservedTargets?.hasAll ? (
                  <button
                    className={`secondary-button slim${draftType === 'all' ? ' active' : ''}`}
                    type="button"
                    aria-pressed={draftType === 'all'}
                    onClick={() => setDraftTypes((current) => ({ ...current, [createModalKey(rule.key, openModalState.mode)]: 'all' }))}
                    data-testid={`auto-assign-type-all-${rule.key}`}
                  >全員</button>
                ) : null}
                <button
                  className={`secondary-button slim${draftType === 'grade' ? ' active' : ''}`}
                  type="button"
                  aria-pressed={draftType === 'grade'}
                  onClick={() => setDraftTypes((current) => ({ ...current, [createModalKey(rule.key, openModalState.mode)]: 'grade' }))}
                  data-testid={`auto-assign-type-grade-${rule.key}`}
                >学年</button>
                <button
                  className={`secondary-button slim${draftType === 'students' ? ' active' : ''}`}
                  type="button"
                  aria-pressed={draftType === 'students'}
                  onClick={() => setDraftTypes((current) => ({ ...current, [createModalKey(rule.key, openModalState.mode)]: 'students' }))}
                  data-testid={`auto-assign-type-students-${rule.key}`}
                >個人</button>
              </div>

              {draftType === 'grade' ? (
                <div className="auto-assign-grade-buttons">
                  {visibleGradeOptions.map((grade) => (
                    <button
                      key={grade}
                      className={`secondary-button slim${selectedGrades.includes(grade) ? ' active' : ''}`}
                      type="button"
                      aria-pressed={selectedGrades.includes(grade)}
                      onClick={() => toggleGrade(rule.key, openModalState.mode, grade)}
                      data-testid={`auto-assign-grade-${grade}-${rule.key}`}
                    >{grade}</button>
                  ))}
                  {visibleGradeOptions.length === 0 ? <div className="auto-assign-target-empty">同じ制約グループ内で選べる学年はありません。</div> : null}
                </div>
              ) : null}

              {draftType === 'students' ? (
                <div className="auto-assign-student-picker" data-testid={`auto-assign-student-picker-${rule.key}`}>
                  {selectableStudents.map((student) => {
                    const isSelected = selectedStudentIds.includes(student.id)
                    return (
                      <button
                        key={student.id}
                        className={`secondary-button slim auto-assign-student-toggle${isSelected ? ' active' : ''}`}
                        type="button"
                        onClick={() => toggleStudent(rule.key, openModalState.mode, student.id)}
                        data-testid={openModalState.mode === 'target'
                          ? `auto-assign-student-toggle-${rule.key}-${student.id}`
                          : `auto-assign-exception-toggle-exclude-${rule.key}-${student.id}`}
                        aria-pressed={isSelected}
                      >
                        {studentNameById[student.id]}
                      </button>
                    )
                  })}
                  {selectableStudents.length === 0 ? <div className="auto-assign-target-empty">同じ制約グループ内で選べる個人はありません。</div> : null}
                </div>
              ) : null}

              <div className="auto-assign-modal-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => addTargets(rule.key, openModalState.mode)}
                  data-testid={openModalState.mode === 'target' ? `auto-assign-modal-confirm-${rule.key}` : `auto-assign-exception-confirm-exclude-${rule.key}`}
                >追加</button>
                <button className="secondary-button slim" type="button" onClick={() => setOpenModalState(null)} data-testid={`auto-assign-modal-cancel-${openModalState.mode}-${rule.key}`}>キャンセル</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}