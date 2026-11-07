export type LessonType = 'extra' | 'regular' | 'makeup' | 'special' | 'trial'

export type TeacherType = 'normal' | 'substitute' | 'outside'

export type GradeLabel =
  | '小1'
  | '小2'
  | '小3'
  | '小4'
  | '小5'
  | '小6'
  | '中1'
  | '中2'
  | '中3'
  | '高1'
  | '高2'
  | '高3'

export type SubjectLabel = '英' | '数' | '算' | '算国' | '国' | '理' | '生' | '物' | '化' | '社' | '理社'

// 出欠記録の種別。
// ★'holiday'(2026-09-16・INV-06): 休日設定で授業が消えたコマの**表示専用**記録。在庫は休日設定の時点で
//   台帳/振替先へ返却済みなので、**会計上は 'moved' と完全に同じ扱い(=無視)** にすること。
//   在庫戻し(HOLIDAY_STOCK_RETURNABLE_STATUSES)・消化(collectMakeupUsageByKey)・義務
//   (computeOutstandingAbsenceOrigins)・台帳確定(resolveMakeupStatusOriginToMaterialize)・日程表の回数表の
//   どれかで absent/attended と同じ側に入れると二重計上になる(INV-06 違反)。status の分岐を足すときは
//   必ず 'moved' と同じ側へ入れる。
export type StudentStatusKind = 'absent' | 'absent-no-makeup' | 'attended' | 'moved' | 'holiday'

export type EditedFromRegular = {
  subject: SubjectLabel
  dateKey: string
  slotNumber: number
  /** 編集で新たに積んだ通常授業の抑止キー(既にあったときは無し＝外さない)。 */
  addedOccurrenceKey?: string
  /**
   * 先に科目だけ編集していた(数→国)テンプレの授業を振替・増コマにしたとき、テンプレの科目(数)で新たに積んだ抑止キー
   * (INV-12 2026-11-07・機能フラグ ON／OFF とも)。通常へ戻したら addedOccurrenceKey と一緒に外す。
   */
  addedTemplateOccurrenceKey?: string
  /** 科目を変えたときに積んだ、元の科目の振替の抑止(在庫キー)。 */
  addedMakeupSuppressionKey?: string
}

/**
 * 出自の印（docs/spec-template-conflict-v2.md §1-1）。置いた瞬間に付く 2 値。読み手は placementOrigin.ts の resolveStudentOrigin を通す
 * （印の無い旧データは §7 の推定で読む）。テンプレ＝テンプレの展開で置いた授業（同じ日の中で動かしたものを含む）／手入力＝人の操作で置いたもの。
 */
export type PlacementOriginMark = 'template' | 'manual'

export type StudentEntry = {
  id: string
  /** 出自の印（§1-1・機能フラグ templateDiffApply の教室で付ける）。無ければ推定（placementOrigin.ts）。 */
  origin?: PlacementOriginMark
  name: string
  managedStudentId?: string
  grade: GradeLabel
  birthDate?: string
  noteSuffix?: string
  makeupSourceDate?: string
  makeupSourceLabel?: string
  sameDayMoveSourceDate?: string
  sameDayMoveSourceLabel?: string
  specialSessionId?: string
  specialStockSource?: 'session' | 'manual'
  manualAdded?: boolean
  // 生徒メニュー「編集」で区分を振替へ変えた印(2026-10-27・INV-06)。振替元の無いあいだは未消化を消化しない
  // (isStockNeutralEditedMakeup)。manualAdded とは別にする(手打ちの警告・格納不可・時限つき返却などを持ち込まない)。
  editedToMakeup?: boolean
  // 「編集」で振替にした元の通常授業(2026-10-27・INV-03/INV-06)。テンプレの通常授業から変えたときだけ持つ。
  // 編集で積んだ抑止(元の授業の抑止キー・科目を変えたときの元科目の振替抑止)を、振替 → 通常 の編集し直しで外すために控える。
  editedFromRegular?: EditedFromRegular
  // 同日移動の写し(旧テンプレの通常授業を日の中で手で動かしたもの)への、テンプレ保存が付ける注意の印(オーナー決定 2026-11-01・A-12・
  // spec-template-behavior §H Q36)。写しは手入力データとして残し、superseded＝同じ日の別のコマにテンプレが同じ授業を置く／stale＝テンプレでは
  // この日にこの授業が無い、を盤面で緑＋注意文で知らせる。テンプレ保存のたびに付け直す(状態が変われば消える)。日程表・PDF・回数には出ない。
  templateCopyNotice?: 'superseded' | 'stale'
  /**
   * 丸ごと振替の付け替え（docs/spec-template-conflict-v2.md §3・§1-1 #17・段 4）で、移動元 D のテンプレを移動先 D' に展開した授業の印（値は D）。
   * 出自＝テンプレ（付け替え）＝青字にしない・再マージが D の新テンプレに追従させる。予定数は D の月で数える（決定記録 3）。
   * 別の日へ動かすと外れる（prepareStudentForMove）。読み手は wholeDayTransferPair.ts の isWholeDayPairExpandedStudent を通す。
   */
  wholeDayPairSourceDate?: string
  /**
   * §9-20（2026-11-05）: 付け替えの作成で移動元 D から D' の同じ席へ移した手入力の印。解除でこの印のものだけ D の元の席へ戻す
   * （D' で後から手で置いた手入力は D' に残す）。restore は移す前の区分・振替元・印（prepareStudentForMove が書き換える項目だけ）。
   * 別の席・別の日へ動かすと外れる（prepareStudentForMove）。
   */
  wholeDayPairMovedFrom?: {
    dateKey: string
    /** 移した先（D' の時限・机番号・席）。解除は今の位置がこれと同じときだけ戻す（D' の中で動かした・並べ替えた授業は D' に残す・再監査 要修正-1）。 */
    slotNumber?: number
    deskIndex?: number
    seat?: number
    /** D の元の机の授業 ID（解除で机に授業が無ければこの ID で作り直す＝作成→解除で元の形）。 */
    lessonId?: string
    restore: Partial<Pick<StudentEntry, 'origin' | 'lessonType' | 'makeupSourceDate' | 'makeupSourceLabel' | 'sameDayMoveSourceDate' | 'sameDayMoveSourceLabel'>>
  }
  warning?: string
  warningHighlight?: boolean
  // 出席不可コマに配置された生徒か。生徒名の赤文字ハイライトはこのフラグのみで判定する
  // (他の警告はセル背景=黄とツールチップで示し、名前は赤くしない。オーナー指示 2026-07-02)。
  warningUnavailableHighlight?: boolean
  subject: SubjectLabel
  lessonType: LessonType
  teacherType: TeacherType
}

// 休日設定で「未消化在庫へ返した内容」の控え(2026-09-20 オーナー確定・INV-06)。
// 休日**解除**を休日設定の逆操作(席へ復元＋在庫巻き戻し)にするため、`reconcileHolidayDeskStockReturns` が
// 返した会計をそのまま `holiday` 記録へ焼き込み、解除側はこの控えだけを見て巻き戻す。
// ★再導出しない理由: 同じ `holiday` 記録でも「配置授業から作った」ものと「出席済み記録から変換した」もので
//   設定時の会計が違い(前者は無条件に origin を積む・後者は台帳に origin があれば積まない)、記録だけからは
//   区別できない。推測で巻き戻すと誤増/誤減のどちらかになる。
// ★`kind:'none'`(返していない)も必ず入れる。**控えが無い = この改定より前に作られた記録**で、
//   巻き戻せないので解除で復元しない(安全側・件数だけ知らせる)という判別に使う。
export type HolidayStockReturnStamp = {
  /** 'makeup'=振替 origin を1件積んだ / 'lecture'=講習在庫 +1 と origin を積んだ / 'none'=在庫へ返していない。 */
  kind: 'none' | 'makeup' | 'lecture'
  /** 積んだ origin の日付(振替=元の通常授業日 / 講習=未消化講習の origin 日)。 */
  originDateKey?: string
  /** 積んだ origin の時限(分かるときだけ。振替は時限なし=同日ワイルドカード)。 */
  originSlotNumber?: number
  /** 未管理生徒の表示名フォールバックを**この休日設定で新規に**足したか(解除で消すかの判定)。 */
  fallbackAdded?: boolean
}

export type StudentStatusEntry = {
  id: string
  studentId: string
  /** 記録を付けた生徒の出自の印（記録を外して席へ戻すときに生徒へ戻す。記録そのものは常に手入力）。 */
  origin?: PlacementOriginMark
  sourceManagedLesson: boolean
  name: string
  managedStudentId?: string
  grade: GradeLabel
  birthDate?: string
  noteSuffix?: string
  makeupSourceDate?: string
  makeupSourceLabel?: string
  sameDayMoveSourceDate?: string
  sameDayMoveSourceLabel?: string
  specialSessionId?: string
  specialStockSource?: 'session' | 'manual'
  manualAdded?: boolean
  editedToMakeup?: boolean
  editedFromRegular?: EditedFromRegular
  subject: SubjectLabel
  lessonType: LessonType
  teacherType: TeacherType
  teacherName: string
  dateKey: string
  slotNumber: number
  moveDestinationDateKey?: string
  moveDestinationSlotNumber?: number
  recordedAt: string
  status: StudentStatusKind
  /**
   * `status==='holiday'` のときだけ持つ「休日設定で在庫へ返した内容」の控え(2026-09-20)。
   * 休日解除の巻き戻しが設定時と厳密に対称になるようにするための唯一の根拠。
   */
  holidayStockReturn?: HolidayStockReturnStamp
  /**
   * `status==='moved'` のうち、**丸ごと振替（とテンプレ保存の追従 Q40-2 / Q40-9）が作った**移動元記録の印（2026-10-26・決定記録 46・regression-reviewer M-A）。
   * 時限変更の追従（Q40-9）が「丸ごと振替の 1 対 1 の組」とみなす根拠。1 コマの別日 D&D（computeStudentMove）の記録には付けない＝室長が置き先を選んだ授業を動かさない（INV-02）。
   * 印の無い旧データは、振替の授業の ID（丸ごと振替が付ける `daymove_<振替元の日>_…`）で組を確かめる。
   */
  wholeDayTransfer?: boolean
  /** 付け替えで展開した授業の印を、記録（D' で休みにしたなど）を外して席へ戻すときに戻すために控える（StudentEntry.wholeDayPairSourceDate）。 */
  wholeDayPairSourceDate?: string
  /**
   * 丸ごと振替の付け替え（段 4）で移動元 D に作った表示専用の「休)」記録（status='moved'）。再マージのたびに D のテンプレから作り直し、
   * 解除で外す。会計を持たない。出欠記録としては数えない（解除・付け替えの判定・cellsHaveNonDerivedStatusEntries）。
   */
  wholeDayPairDerived?: boolean
  /** 付け替えの記録が属する組の移動先 D'（在庫の自動発生が D' 自身のテンプレを数えない判定に使う・§9-21 の休みは振替先を持たないのでここだけで読む）。 */
  wholeDayPairTargetDate?: string
  sourceLessonId: string
  sourceLessonNote?: string
  sourceLessonWarning?: string
}

export type DeskLesson = {
  id: string
  warning?: string
  note?: string
  studentSlots: [StudentEntry | null, StudentEntry | null]
}

export type DeskCell = {
  id: string
  teacher: string
  manualTeacher?: boolean
  teacherAssignmentSource?: 'manual' | 'manual-replaced' | 'schedule-registration' | 'deleted'
  teacherAssignmentSessionId?: string
  teacherAssignmentTeacherId?: string
  /**
   * この机に居た日程表登録(QR 自動割振り・schedule-registration)の講師を、同じコマの別の机にテンプレが置く同じ講師に寄せて外した記録
   * (2026-10-15・spec-template-behavior Q21-9 例外 1 の絞り込み・`findQrTeacherDesksSupersededByTemplate`)。
   * 起動時の自己修復(reconcileSubmittedTeacherPlacements)はこれを「その講習でその講師は配置済み」と数える。数えないと、その講習の QR 机が
   * 全部テンプレに寄せられた講師を「提出済みなのに未配置」と誤判定し、手で講師を替えた(manual-replaced)コマへ置き直す(INV-02 の 2026-08-02 と同型)。
   * 外す側(差分反映・再マージ)が同じ形で書く。消さない(QR 机が 1 つでも残る講師を触らないのと同じ扱い)。
   */
  scheduleRegistrationSupersededByTemplate?: { sessionId: string; teacherId: string }
  /**
   * テンプレ差分反映（Q41-13・オーナー指示 2026-10-22）が「テンプレの机に手置き講師が居るため、同じコマの空き机へずらして置いた講師」の印。
   * 盤面画面で講師欄を緑にして見分けるためだけに使う（保留ではない・操作の制限なし・PDF には出さない）。
   * teacher がこの机の講師と一致し、かつ非 manual のときだけ有効（講師が替わった／手で置き直した後の古い印は表示に使わない＝isShiftedTemplateTeacherDesk）。
   */
  templateTeacherShift?: { teacher: string; fromDeskIndex: number }
  /**
   * 講師の休み（docs/spec-template-conflict-v2.md §2-4・段 3・機能フラグ templateDiffApply の教室だけ書く）。講師欄のメニューの「休み」で付ける手入力の記録。
   * 休みにした講師の名前と ID を残し、机の teacher は空にする（講師日程表・PDF・保護者 QR は盤面の写しなので講師なしの机として出る・INV-13 の考え方）。
   * そのコマ（日付×時限）のどの机にも、テンプレはこの講師を置かない（休みが勝つ・判定は teacherRest.ts の isTeacherRestedInCell）。
   * 別の講師を手で置いても記録は残る（teacher にその講師）。解除は同じボタンをもう一度押す（記録を消す）。削除記録（teacherAssignmentSource='deleted'）とは別。
   * sessionId: 日程表登録（QR）の講師を休みにしたときの講習 ID（起動時の自己修復が「室長が外した」と数え、置き直さないため）。
   */
  teacherRest?: { teacher: string; teacherId?: string; sessionId?: string }
  /**
   * 講師欄の緑 2 行で「下段(手入力)の講師を採用する」を選んだとき、この机で取り下げたテンプレの講師（名前と ID）
   * （docs/spec-template-conflict-v2.md §4-1 の講師欄版・2026-11-07 開発用教室の操作ログ・確認リスト tp-64 / tp-69 / tp-70）。
   * adopted は採用した手置き講師（名前と ID）。机の講師が採用した講師本人の間だけ、テンプレ保存（差分反映）と再マージ（講師だけのテンプレ机を空き机へ置く所）は
   * 取り下げた講師をこの机・空き机に置かない＝採用した手置き講師の 1 行のまま（INV-02 / INV-03）。講師を手で替えた・入替で別の講師が来た机では効かない。
   * 判定は templateDiffApply.ts の isTemplateTeacherDeclinedAtDesk 1 か所。テンプレがこの机に別の講師を置いた・講師を外した・記録が効かなくなった反映で消える。
   */
  templateTeacherDeclined?: { teacher: string; teacherId?: string; adopted?: { teacher: string; teacherId?: string } }
  /**
   * 確認リストの「準備する」（docs/spec-developer-report.md §E-2-4-2・開発用教室とテスト教室だけ）が置いた講師の印。
   * 「後片づけ」（checklistPrepTemplate.ts の cleanupChecklistPrepBoard）が消す講師の見分けにだけ使う（画面・日程表・PDF には出さない）。
   * 講師の項目と一緒に動く（保留の下の行の講師へ移る・「手入力の講師を採用」で戻る・テンプレの講師に替わると外れる）。
   * 室長が講師メニューで講師を置き直したら外れる（setManualTeacherAssignment・あとで手で替えた講師は後片づけで消さない＝INV-02）。
   */
  checklistPrepTeacher?: true
  /**
   * テンプレ作成の画面の机（buildTemplateBoardCells が作る・盤面の週には入らない）だけが持つ、確認リストの準備の印
   * （RegularLessonTemplateDesk.checklistPrepTeacherId の写し・§E-2-4-3）。convertTemplateCellsToTemplate が、今の講師が同じときだけテンプレへ戻す。
   */
  checklistPrepTemplateTeacherId?: string
  teacherUnavailableWarning?: boolean
  memoSlots?: [string | null, string | null]
  /** §9-20: 付け替えの作成で移動元 D から移したメモ（席ごとに D と移した本文）。解除は今のメモが同じ本文のときだけ D の同じ席へ戻す（再監査 要修正-2）。 */
  wholeDayPairMovedMemoFrom?: [{ dateKey: string; text: string } | null, { dateKey: string; text: string } | null]
  /**
   * §9-20: 付け替えの作成で移動元 D から移した手置き講師（D と移す前の講師欄の中身）。解除は今の講師が同じ講師（名前・ID）のときだけ D の同じ机へ
   * 移す前の中身で戻す（D' で後から替えた講師は D' に残す・再監査 要修正-2）。
   */
  wholeDayPairMovedTeacherFrom?: { dateKey: string; teacher: string; teacherId?: string; block: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource' | 'teacherAssignmentSessionId' | 'teacherAssignmentTeacherId' | 'teacherUnavailableWarning'> }
  statusSlots?: [StudentStatusEntry | null, StudentStatusEntry | null]
  lesson?: DeskLesson
}

export type SlotCell = {
  id: string
  dateKey: string
  dayLabel: string
  dateLabel: string
  slotLabel: string
  slotNumber: number
  timeLabel: string
  isOpenDay: boolean
  desks: DeskCell[]
}

export type OpenIssue = {
  id: string
  category: '通常残' | '未解決振替'
  student: string
  teacher: string
  dateLabel: string
  detail: string
}