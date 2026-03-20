import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { AppMenu } from '../navigation/AppMenu'
import { getReferenceDateKey, getStudentDisplayName, type StudentRow } from '../basic-data/basicDataModel'
import {
  createAutoAssignTargetId,
  listAutoAssignTargetGrades,
  type AutoAssignRuleRow,
  type AutoAssignTarget,
  type AutoAssignTargetGrade,
} from './autoAssignRuleModel'

type AutoAssignRuleScreenProps = {
  rules: AutoAssignRuleRow[]
  students: StudentRow[]
  onUpdateRules: Dispatch<SetStateAction<AutoAssignRuleRow[]>>
  onBackToBoard: () => void
  onOpenBasicData: () => void
  onOpenSpecialData: () => void
  onOpenBackupRestore: () => void
}

type TargetDraftType = 'all' | 'grade' | 'students'

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

export function AutoAssignRuleScreen({ rules, students, onUpdateRules, onBackToBoard, onOpenBasicData, onOpenSpecialData, onOpenBackupRestore }: AutoAssignRuleScreenProps) {
  const [statusMessage, setStatusMessage] = useState('')
  const [draftTypes, setDraftTypes] = useState<Record<string, TargetDraftType>>({})
  const [draftGrades, setDraftGrades] = useState<Record<string, AutoAssignTargetGrade | ''>>({})
  const [draftStudentIds, setDraftStudentIds] = useState<Record<string, string[]>>({})
  const [draftIncludeStudentIds, setDraftIncludeStudentIds] = useState<Record<string, string>>({})
  const [draftExcludeStudentIds, setDraftExcludeStudentIds] = useState<Record<string, string>>({})
  const referenceDate = getReferenceDateKey(new Date())

  const visibleStudents = useMemo(() => students
    .filter((student) => !student.isHidden)
    .slice()
    .sort((left, right) => getStudentDisplayName(left).localeCompare(getStudentDisplayName(right), 'ja')),
  [students])

  const studentNameById = useMemo(() => Object.fromEntries(visibleStudents.map((student) => [student.id, getStudentDisplayName(student)])), [visibleStudents])
  const gradeOptions = useMemo(() => listAutoAssignTargetGrades(visibleStudents, referenceDate), [referenceDate, visibleStudents])

  const resolveDraftType = (ruleKey: string): TargetDraftType => draftTypes[ruleKey] ?? 'all'
  const resolveDraftGrade = (ruleKey: string): AutoAssignTargetGrade | '' => draftGrades[ruleKey] ?? gradeOptions[0] ?? ''
  const resolveDraftStudentIds = (ruleKey: string) => draftStudentIds[ruleKey] ?? []
  const resolveDraftIncludeStudentId = (ruleKey: string) => draftIncludeStudentIds[ruleKey] ?? ''
  const resolveDraftExcludeStudentId = (ruleKey: string) => draftExcludeStudentIds[ruleKey] ?? ''

  const resetDraft = (ruleKey: string) => {
    setDraftTypes((current) => ({ ...current, [ruleKey]: 'all' }))
    setDraftGrades((current) => ({ ...current, [ruleKey]: gradeOptions[0] ?? '' }))
    setDraftStudentIds((current) => ({ ...current, [ruleKey]: [] }))
  }

  const updateRule = (ruleKey: string, updater: (rule: AutoAssignRuleRow) => AutoAssignRuleRow, nextMessage: string) => {
    const nextTimestamp = updateTimestamp()
    onUpdateRules((current) => current.map((rule) => (
      rule.key === ruleKey
        ? { ...updater(rule), updatedAt: nextTimestamp }
        : rule
    )))
    setStatusMessage(nextMessage)
  }

  const addTarget = (rule: AutoAssignRuleRow) => {
    const draftType = resolveDraftType(rule.key)
    const draftGrade = resolveDraftGrade(rule.key)
    const selectedStudentIds = resolveDraftStudentIds(rule.key)
      .slice()
      .sort((left, right) => (studentNameById[left] ?? '').localeCompare(studentNameById[right] ?? '', 'ja'))

    let nextTarget: AutoAssignTarget | null = null
    if (draftType === 'all') {
      nextTarget = { id: createAutoAssignTargetId(), type: 'all' }
    }
    if (draftType === 'grade') {
      if (!draftGrade) {
        setStatusMessage('学年別を選ぶ場合は対象学年を選択してください。')
        return
      }
      nextTarget = { id: createAutoAssignTargetId(), type: 'grade', grade: draftGrade }
    }
    if (draftType === 'students') {
      if (selectedStudentIds.length === 0) {
        setStatusMessage('個人指定を選ぶ場合は生徒を 1 人以上選択してください。')
        return
      }
      nextTarget = { id: createAutoAssignTargetId(), type: 'students', studentIds: selectedStudentIds }
    }
    if (!nextTarget) return

    if (rule.targets.some((target) => isSameTarget(target, nextTarget as AutoAssignTarget))) {
      setStatusMessage('同じ対象はこのルールに既に追加されています。')
      return
    }

    updateRule(rule.key, (currentRule) => ({ ...currentRule, targets: [...currentRule.targets, nextTarget as AutoAssignTarget] }), `${rule.label} に対象を追加しました。`)
    resetDraft(rule.key)
  }

  const removeTarget = (ruleKey: string, targetId: string) => {
    updateRule(ruleKey, (rule) => ({ ...rule, targets: rule.targets.filter((target) => target.id !== targetId) }), '対象を削除しました。')
  }

  const addRuleException = (rule: AutoAssignRuleRow, mode: 'include' | 'exclude') => {
    const studentId = mode === 'include' ? resolveDraftIncludeStudentId(rule.key) : resolveDraftExcludeStudentId(rule.key)
    if (!studentId) {
      setStatusMessage(mode === 'include' ? '追加する個人を選択してください。' : '除外する個人を選択してください。')
      return
    }

    if (mode === 'include' && rule.includeStudentIds.includes(studentId)) {
      setStatusMessage('その生徒は追加済みです。')
      return
    }
    if (mode === 'exclude' && rule.excludeStudentIds.includes(studentId)) {
      setStatusMessage('その生徒は除外済みです。')
      return
    }
    if (mode === 'include' && rule.excludeStudentIds.includes(studentId)) {
      setStatusMessage('その生徒は除外側に入っています。先に除外から外してください。')
      return
    }
    if (mode === 'exclude' && rule.includeStudentIds.includes(studentId)) {
      setStatusMessage('その生徒は追加側に入っています。先に追加から外してください。')
      return
    }

    updateRule(rule.key, (currentRule) => ({
      ...currentRule,
      includeStudentIds: mode === 'include' ? [...currentRule.includeStudentIds, studentId] : currentRule.includeStudentIds,
      excludeStudentIds: mode === 'exclude' ? [...currentRule.excludeStudentIds, studentId] : currentRule.excludeStudentIds,
    }), mode === 'include' ? '対象外から追加する個人を登録しました。' : '対象内から除外する個人を登録しました。')

    if (mode === 'include') setDraftIncludeStudentIds((current) => ({ ...current, [rule.key]: '' }))
    else setDraftExcludeStudentIds((current) => ({ ...current, [rule.key]: '' }))
  }

  const removeRuleException = (ruleKey: string, mode: 'include' | 'exclude', studentId: string) => {
    updateRule(ruleKey, (rule) => ({
      ...rule,
      includeStudentIds: mode === 'include' ? rule.includeStudentIds.filter((id) => id !== studentId) : rule.includeStudentIds,
      excludeStudentIds: mode === 'exclude' ? rule.excludeStudentIds.filter((id) => id !== studentId) : rule.excludeStudentIds,
    }), mode === 'include' ? '個人追加を削除しました。' : '個人除外を削除しました。')
  }

  const moveRule = (ruleKey: string, direction: 'up' | 'down') => {
    onUpdateRules((current) => {
      const currentIndex = current.findIndex((rule) => rule.key === ruleKey)
      if (currentIndex < 0) return current

      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= current.length) return current

      const nextRules = current.slice()
      const [movedRule] = nextRules.splice(currentIndex, 1)
      nextRules.splice(targetIndex, 0, movedRule)
      return nextRules.map((rule) => ({ ...rule, updatedAt: rule.key === ruleKey ? updateTimestamp() : rule.updatedAt }))
    })
    setStatusMessage(direction === 'up' ? 'ルールの優先順位を上げました。' : 'ルールの優先順位を下げました。')
  }

  const toggleStudent = (ruleKey: string, studentId: string) => {
    setDraftStudentIds((current) => {
      const currentIds = current[ruleKey] ?? []
      return {
        ...current,
        [ruleKey]: currentIds.includes(studentId)
          ? currentIds.filter((id) => id !== studentId)
          : [...currentIds, studentId],
      }
    })
  }

  const describeTarget = (target: AutoAssignTarget) => {
    if (target.type === 'all') return '全員'
    if (target.type === 'grade') return `学年別: ${target.grade}`
    const names = target.studentIds.map((studentId) => studentNameById[studentId] ?? studentId)
    return `個人: ${names.join(' / ')}`
  }

  const describeTargetTooltip = (target: AutoAssignTarget) => {
    if (target.type === 'all') return '全生徒を対象にします。'
    if (target.type === 'grade') return `${target.grade} の生徒を対象にします。`
    return target.studentIds.map((studentId) => studentNameById[studentId] ?? studentId).join('\n')
  }

  const describeStudentList = (studentIds: string[]) => studentIds.map((studentId) => studentNameById[studentId] ?? studentId)

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
              <p className="basic-data-subcopy">上にあるルールほど優先されます。「上へ」「下へ」で順序を変更できます。</p>
            </div>
          </div>

          <div className="auto-assign-rule-grid">
            {rules.map((rule, index) => {
              const draftType = resolveDraftType(rule.key)
              const draftGrade = resolveDraftGrade(rule.key)
              const selectedStudentIds = resolveDraftStudentIds(rule.key)
              const includeNames = describeStudentList(rule.includeStudentIds)
              const excludeNames = describeStudentList(rule.excludeStudentIds)
              const includeDraftStudentId = resolveDraftIncludeStudentId(rule.key)
              const excludeDraftStudentId = resolveDraftExcludeStudentId(rule.key)

              return (
                <section key={rule.key} className="basic-data-section-card auto-assign-rule-card" data-testid={`auto-assign-rule-card-${rule.key}`}>
                  <div className="basic-data-section-header">
                    <div className="basic-data-card-head">
                      <h3>{rule.label}</h3>
                    </div>
                    <div className="auto-assign-rule-meta">
                      <span className="status-chip" data-testid={`auto-assign-rule-priority-${rule.key}`}>優先 {index + 1}</span>
                      <div className="basic-data-row-actions">
                        <button className="secondary-button slim" type="button" onClick={() => moveRule(rule.key, 'up')} disabled={index === 0} data-testid={`auto-assign-move-up-${rule.key}`}>上へ</button>
                        <button className="secondary-button slim" type="button" onClick={() => moveRule(rule.key, 'down')} disabled={index === rules.length - 1} data-testid={`auto-assign-move-down-${rule.key}`}>下へ</button>
                      </div>
                    </div>
                  </div>

                  <div className="auto-assign-target-list" data-testid={`auto-assign-rule-targets-${rule.key}`}>
                    {rule.targets.length === 0 ? (
                      <div className="auto-assign-target-empty">まだ対象がありません。</div>
                    ) : rule.targets.map((target) => (
                      <div key={target.id} className="auto-assign-target-chip-wrap">
                        <span className="selection-pill auto-assign-target-chip" title={describeTargetTooltip(target)}>{describeTarget(target)}</span>
                        <button className="secondary-button slim" type="button" onClick={() => removeTarget(rule.key, target.id)} data-testid={`auto-assign-remove-target-${rule.key}-${target.id}`}>削除</button>
                      </div>
                    ))}
                  </div>

                  <div className="auto-assign-target-editor">
                    <div className="basic-data-form-grid">
                      <label className="basic-data-inline-field basic-data-inline-field-medium">
                        <span>対象種別</span>
                        <select
                          value={draftType}
                          onChange={(event) => setDraftTypes((current) => ({ ...current, [rule.key]: event.target.value as TargetDraftType }))}
                          data-testid={`auto-assign-target-type-${rule.key}`}
                        >
                          <option value="all">全員</option>
                          <option value="grade">学年別</option>
                          <option value="students">個人複数</option>
                        </select>
                      </label>

                      {draftType === 'grade' ? (
                        <label className="basic-data-inline-field basic-data-inline-field-medium">
                          <span>学年</span>
                          <select
                            value={draftGrade}
                            onChange={(event) => setDraftGrades((current) => ({ ...current, [rule.key]: event.target.value as AutoAssignTargetGrade }))}
                            data-testid={`auto-assign-target-grade-${rule.key}`}
                          >
                            {gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                          </select>
                        </label>
                      ) : null}

                      <button className="primary-button" type="button" onClick={() => addTarget(rule)} data-testid={`auto-assign-add-target-${rule.key}`}>対象を追加</button>
                    </div>

                    {draftType === 'students' ? (
                      <div className="auto-assign-student-picker" data-testid={`auto-assign-student-picker-${rule.key}`}>
                        {visibleStudents.map((student) => {
                          const isSelected = selectedStudentIds.includes(student.id)
                          return (
                            <button
                              key={student.id}
                              className={`secondary-button slim auto-assign-student-toggle${isSelected ? ' active' : ''}`}
                              type="button"
                              onClick={() => toggleStudent(rule.key, student.id)}
                              data-testid={`auto-assign-student-toggle-${rule.key}-${student.id}`}
                              aria-pressed={isSelected}
                            >
                              {studentNameById[student.id]}
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>

                  <section className="auto-assign-exception-panel">
                    <div className="basic-data-card-head">
                      <h4>個人例外</h4>
                    </div>

                    <div className="auto-assign-exception-grid">
                      <div className="auto-assign-exception-column">
                        <div className="auto-assign-exception-head">
                          <strong>対象外から追加する個人</strong>
                        </div>
                        <div className="basic-data-form-grid">
                          <label className="basic-data-inline-field basic-data-inline-field-medium">
                            <span>個人追加</span>
                            <select
                              value={includeDraftStudentId}
                              onChange={(event) => setDraftIncludeStudentIds((current) => ({ ...current, [rule.key]: event.target.value }))}
                              data-testid={`auto-assign-include-student-${rule.key}`}
                            >
                              <option value="">生徒を選択</option>
                              {visibleStudents.map((student) => (
                                <option key={student.id} value={student.id}>{studentNameById[student.id]}</option>
                              ))}
                            </select>
                          </label>
                          <button className="secondary-button slim" type="button" onClick={() => addRuleException(rule, 'include')} data-testid={`auto-assign-include-add-${rule.key}`}>追加</button>
                        </div>
                        <div className="auto-assign-exception-list" data-testid={`auto-assign-include-list-${rule.key}`}>
                          {includeNames.length === 0 ? <div className="auto-assign-target-empty">まだ追加個人はありません。</div> : includeNames.map((name, includeIndex) => (
                            <div key={`${rule.key}_include_${rule.includeStudentIds[includeIndex]}`} className="auto-assign-target-chip-wrap">
                              <span className="selection-pill auto-assign-target-chip">{name}</span>
                              <button className="secondary-button slim" type="button" onClick={() => removeRuleException(rule.key, 'include', rule.includeStudentIds[includeIndex])} data-testid={`auto-assign-include-remove-${rule.key}-${rule.includeStudentIds[includeIndex]}`}>削除</button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="auto-assign-exception-column">
                        <div className="auto-assign-exception-head">
                          <strong>対象内から除外する個人</strong>
                        </div>
                        <div className="basic-data-form-grid">
                          <label className="basic-data-inline-field basic-data-inline-field-medium">
                            <span>個人除外</span>
                            <select
                              value={excludeDraftStudentId}
                              onChange={(event) => setDraftExcludeStudentIds((current) => ({ ...current, [rule.key]: event.target.value }))}
                              data-testid={`auto-assign-exclude-student-${rule.key}`}
                            >
                              <option value="">生徒を選択</option>
                              {visibleStudents.map((student) => (
                                <option key={student.id} value={student.id}>{studentNameById[student.id]}</option>
                              ))}
                            </select>
                          </label>
                          <button className="secondary-button slim" type="button" onClick={() => addRuleException(rule, 'exclude')} data-testid={`auto-assign-exclude-add-${rule.key}`}>除外</button>
                        </div>
                        <div className="auto-assign-exception-list" data-testid={`auto-assign-exclude-list-${rule.key}`}>
                          {excludeNames.length === 0 ? <div className="auto-assign-target-empty">まだ除外個人はありません。</div> : excludeNames.map((name, excludeIndex) => (
                            <div key={`${rule.key}_exclude_${rule.excludeStudentIds[excludeIndex]}`} className="auto-assign-target-chip-wrap">
                              <span className="selection-pill auto-assign-target-chip">{name}</span>
                              <button className="secondary-button slim" type="button" onClick={() => removeRuleException(rule.key, 'exclude', rule.excludeStudentIds[excludeIndex])} data-testid={`auto-assign-exclude-remove-${rule.key}-${rule.excludeStudentIds[excludeIndex]}`}>削除</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                </section>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}