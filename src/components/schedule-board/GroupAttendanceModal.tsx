import { useMemo, useState } from 'react'
import { openGroupAttendancePrint } from './groupAttendanceHtml'

export type GroupAttendanceRoster = { id: string; name: string }

type GroupAttendanceModalProps = {
  dateLabel: string
  bandTimeLabel: string
  subject: string
  teacherName?: string
  schoolName?: string
  // 参加提出した中3（名簿の初期メンバー）。
  participants: GroupAttendanceRoster[]
  // 手動追加できる中3（在籍中の中3全員）。既に名簿にいる生徒はモーダル側で除外する。
  grade9Candidates: GroupAttendanceRoster[]
  initialAbsentIds: string[]
  initialAddedIds: string[]
  onSave: (absentIds: string[], addedIds: string[]) => void
  onCancel: () => void
}

// spec-group-lesson §B: 集団授業の出席者モーダル。
// デフォルト全員出席・欠席者だけクリックで欠席・手動追加・PDF印刷・キャンセルで破棄。
// 出欠の入力点はこのモーダルのみ（盤面の groupClassEntries に保存される）。
export function GroupAttendanceModal({
  dateLabel,
  bandTimeLabel,
  subject,
  teacherName,
  schoolName,
  participants,
  grade9Candidates,
  initialAbsentIds,
  initialAddedIds,
  onSave,
  onCancel,
}: GroupAttendanceModalProps) {
  const [absentIds, setAbsentIds] = useState<Set<string>>(() => new Set(initialAbsentIds))
  const [addedIds, setAddedIds] = useState<string[]>(() => initialAddedIds.filter((id, index, self) => self.indexOf(id) === index))

  const candidateNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of grade9Candidates) map.set(entry.id, entry.name)
    for (const entry of participants) map.set(entry.id, entry.name)
    return map
  }, [grade9Candidates, participants])

  // 名簿 = 参加提出者 ＋ 手動追加（id 重複排除・participants 優先順）。
  const attendees = useMemo(() => {
    const seen = new Set<string>()
    const list: GroupAttendanceRoster[] = []
    for (const entry of participants) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      list.push(entry)
    }
    for (const id of addedIds) {
      if (seen.has(id)) continue
      seen.add(id)
      list.push({ id, name: candidateNameById.get(id) ?? id })
    }
    return list
  }, [participants, addedIds, candidateNameById])

  const shownIds = useMemo(() => new Set(attendees.map((entry) => entry.id)), [attendees])
  const addableCandidates = useMemo(
    () => grade9Candidates.filter((candidate) => !shownIds.has(candidate.id)),
    [grade9Candidates, shownIds],
  )

  const presentCount = attendees.filter((entry) => !absentIds.has(entry.id)).length
  const absentCount = attendees.length - presentCount

  const toggleAbsent = (id: string) => {
    setAbsentIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addCandidate = (id: string) => {
    if (!id) return
    setAddedIds((current) => (current.includes(id) ? current : [...current, id]))
  }

  const removeAdded = (id: string) => {
    setAddedIds((current) => current.filter((entry) => entry !== id))
    setAbsentIds((current) => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  const handleSave = () => {
    // 名簿に残っている生徒の欠席だけを保存（手動追加を外した生徒の欠席は捨てる）。
    const cleanedAbsentIds = attendees.filter((entry) => absentIds.has(entry.id)).map((entry) => entry.id)
    onSave(cleanedAbsentIds, addedIds)
  }

  const handlePrint = () => {
    openGroupAttendancePrint({
      schoolName,
      dateLabel,
      bandTimeLabel,
      subject,
      teacherName,
      attendees: attendees.map((entry) => ({ name: entry.name, present: !absentIds.has(entry.id) })),
    })
  }

  return (
    <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div className="auto-assign-modal group-attendance-modal" role="dialog" aria-modal="true" data-testid="group-attendance-modal" style={{ minWidth: 360, maxWidth: 440 }}>
        <div className="auto-assign-modal-title">出席者一覧</div>
        <div className="student-menu-meta">{`${dateLabel} / 集団 ${bandTimeLabel}`}</div>
        <div className="student-menu-meta">{`${subject}${teacherName ? ` / ${teacherName}` : ''}`}</div>
        <div className="student-menu-help-text">デフォルトは全員出席です。欠席者だけクリックして欠席にしてください。</div>

        <div className="group-attendance-list" data-testid="group-attendance-list">
          {attendees.length === 0 ? (
            <div className="group-attendance-empty">参加者がいません。下の「中3を追加」から追加できます。</div>
          ) : (
            attendees.map((entry) => {
              const isAbsent = absentIds.has(entry.id)
              const isAdded = addedIds.includes(entry.id) && !participants.some((p) => p.id === entry.id)
              return (
                <div key={entry.id} className={`group-attendance-row${isAbsent ? ' is-absent' : ''}`}>
                  <button
                    type="button"
                    className="group-attendance-toggle"
                    onClick={() => toggleAbsent(entry.id)}
                    data-testid={`group-attendance-toggle-${entry.id}`}
                  >
                    <span className="group-attendance-name">{entry.name}</span>
                    <span className={`group-attendance-status${isAbsent ? ' absent' : ' present'}`}>{isAbsent ? '欠席' : '出席'}</span>
                  </button>
                  {isAdded ? (
                    <button type="button" className="group-attendance-remove" onClick={() => removeAdded(entry.id)} aria-label="名簿から外す" title="名簿から外す">×</button>
                  ) : null}
                </div>
              )
            })
          )}
        </div>

        <div className="group-attendance-summary" data-testid="group-attendance-summary">{`出席 ${presentCount} 名 / 欠席 ${absentCount} 名`}</div>

        <div className="student-menu-section">
          <label className="student-menu-label" htmlFor="group-attendance-add">中3を追加</label>
          <select
            id="group-attendance-add"
            className="student-menu-select"
            value=""
            onChange={(event) => { addCandidate(event.target.value); event.target.value = '' }}
            disabled={addableCandidates.length === 0}
            data-testid="group-attendance-add-select"
          >
            <option value="">{addableCandidates.length === 0 ? '追加できる中3がいません' : '追加する中3を選択'}</option>
            {addableCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
          </select>
        </div>

        <div className="student-menu-section student-menu-actions">
          <button type="button" className="primary-button" onClick={handleSave} data-testid="group-attendance-save">保存</button>
          <button type="button" className="secondary-button" onClick={handlePrint} data-testid="group-attendance-print">PDF印刷</button>
          <button type="button" className="secondary-button" onClick={onCancel} data-testid="group-attendance-cancel">キャンセル</button>
        </div>
      </div>
    </div>
  )
}
