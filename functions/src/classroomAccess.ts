// callable の「この教室を触ってよいか」判定(純関数)。Firestore 読み取りは呼び出し側(index.ts)が行い、
// ここは受け取った事実だけで決める(テスト可能にするため)。
//
// ⚠️ 越境ガード(2026-09-16・複数会社展開 Phase 0 / T0-3):
// 以前は role === 'developer' なら classroomId を一切検証していなかったため、開発者アカウントは
// 「別ワークスペース(会社)の教室 ID」や「存在しない教室 ID」を渡しても会員検査を通過していた。
// workspaces/{ws}/classrooms/{classroomId} の存在を確認することで、教室 ID が必ず**その会社の中**を
// 指すようにする。manager 経路は assignedClassroomId === classroomId で既に会社内へ束縛されているので
// 読み取りを増やさない(= 既存の保存経路の挙動・コストを変えない)。
// この判定を「単純化」して developer 素通りに戻さないこと(会社の壁が消える)。

export type ClassroomAccessMemberInput = {
  role?: string | null
  assignedClassroomId?: string | null
}

export type ClassroomAccessDecision =
  | { allowed: true; via: 'developer' | 'assigned-manager' }
  | { allowed: false; reason: 'classroom-not-found' | 'forbidden' }

// developer 経路だけ教室ドキュメントの存在確認が要る(manager 経路は追加読み取り不要)。
export function requiresClassroomExistenceCheck(member: ClassroomAccessMemberInput | undefined | null) {
  return member?.role === 'developer'
}

/**
 * @param classroomExists developer 経路のときだけ渡す(未確認 = undefined は「存在しない」と同じ扱い＝fail closed)。
 */
export function resolveClassroomAccessDecision(
  member: ClassroomAccessMemberInput | undefined | null,
  classroomId: string,
  classroomExists?: boolean,
): ClassroomAccessDecision {
  if (member?.role === 'developer') {
    // 開発者でも「この会社に実在する教室」でなければ通さない(越境・打ち間違いをここで止める)。
    return classroomExists === true
      ? { allowed: true, via: 'developer' }
      : { allowed: false, reason: 'classroom-not-found' }
  }
  // 既存の室長判定は厳密一致(assignedClassroomId !== classroomId なら拒否)。ここを緩めない。
  if (member?.assignedClassroomId === classroomId) {
    return { allowed: true, via: 'assigned-manager' }
  }
  return { allowed: false, reason: 'forbidden' }
}
