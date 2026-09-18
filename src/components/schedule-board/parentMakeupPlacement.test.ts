// 保護者からの休み連絡「振替先を今決める」(docs/spec-parent-portal.md §0-5)の配置判定。
// レビュー指摘(2026-09-19)の 2 点を固定する:
//  (1) 振替元の選択は時限まで見る(同日同科目 2 コマで別コマを指さない・INV-06/INV-11)。ただし選択トークンは在庫行自身の値で作る
//      (台帳へ日付だけで積まれた通常授業の休みに `日付#限` を渡すと一致せず、最古の振替元へ黙ってフォールバックする)。
//  (2) 配置モードへ入るかは**その科目の在庫行**の残数で決める(生徒単位の合計で見ない)。
import { describe, expect, it } from 'vitest'
import { buildOriginToken, resolveRemainingOriginToken } from './makeupStock'
import { resolveParentMakeupPlacement, resolveSelectedMakeupOrigin } from './ScheduleBoardScreen'

describe('resolveRemainingOriginToken', () => {
  it('同じ日に元コマが 2 つあるとき、時限まで一致する行を選ぶ(先頭の時限に落とさない)', () => {
    const entry = { remainingOriginDates: ['2026-09-20', '2026-09-20'], remainingOriginSlots: [3, 5] }
    expect(resolveRemainingOriginToken(entry, '2026-09-20', 5)).toBe(buildOriginToken('2026-09-20', 5))
    expect(resolveRemainingOriginToken(entry, '2026-09-20', 3)).toBe(buildOriginToken('2026-09-20', 3))
  })

  // 通常授業の休みは台帳へ日付だけで積まれる(appendMakeupOrigin の 3 引数呼び・既存仕様)。
  it('時限なしで積まれた行しか無ければ、その行のトークン(=素の日付)を返す', () => {
    const entry = { remainingOriginDates: ['2026-09-10', '2026-09-20'], remainingOriginSlots: [null, null] }
    expect(resolveRemainingOriginToken(entry, '2026-09-20', 3)).toBe('2026-09-20')
  })

  it('その日付が残っていなければ null(最古へ付け替えない)', () => {
    expect(resolveRemainingOriginToken({ remainingOriginDates: ['2026-09-10'], remainingOriginSlots: [4] }, '2026-09-20', 3)).toBeNull()
    expect(resolveRemainingOriginToken({ remainingOriginDates: [] }, '2026-09-20', 3)).toBeNull()
  })

  it('時限が読めない(null)ときは同じ日付の先頭。remainingOriginSlots が無い旧データでも動く', () => {
    expect(resolveRemainingOriginToken({ remainingOriginDates: ['2026-09-20', '2026-09-20'], remainingOriginSlots: [3, 5] }, '2026-09-20', null)).toBe(buildOriginToken('2026-09-20', 3))
    expect(resolveRemainingOriginToken({ remainingOriginDates: ['2026-09-20'] }, '2026-09-20', 3)).toBe('2026-09-20')
  })

  // 返したトークンは、配置時の権威関数 resolveSelectedMakeupOrigin が**必ず同じ行**に解決できること(往復の保証)。
  it('返したトークンを resolveSelectedMakeupOrigin へ渡すと、最古ではなく選んだ行に解決される', () => {
    const base = { remainingOriginLabels: ['9/10(木) 4限', '9/20(日) 3限', '9/20(日) 5限'], remainingOriginReasonLabels: ['休み', '休み', '休み'], nextOriginDate: '2026-09-10', nextOriginLabel: '9/10(木) 4限', nextOriginReasonLabel: '休み' }
    const withSlots = { ...base, remainingOriginDates: ['2026-09-10', '2026-09-20', '2026-09-20'], remainingOriginSlots: [4, 3, 5] }
    expect(resolveSelectedMakeupOrigin(withSlots, resolveRemainingOriginToken(withSlots, '2026-09-20', 5))).toMatchObject({ originDate: '2026-09-20', originLabel: '9/20(日) 5限' })
    const withoutSlots = { ...base, remainingOriginDates: ['2026-09-10', '2026-09-20', '2026-09-20'], remainingOriginSlots: [null, null, null] }
    expect(resolveSelectedMakeupOrigin(withoutSlots, resolveRemainingOriginToken(withoutSlots, '2026-09-20', 5))).toMatchObject({ originDate: '2026-09-20', originLabel: '9/20(日) 3限' })
    // ★素朴に buildOriginToken(日付, 限) を渡すと時限なしの行に一致せず、最古(9/10)へフォールバックする = この関数が要る理由。
    expect(resolveSelectedMakeupOrigin(withoutSlots, buildOriginToken('2026-09-20', 5))).toMatchObject({ originDate: '2026-09-10' })
  })
})

describe('resolveParentMakeupPlacement', () => {
  const grouped = [{ stockStudentKey: 's001', displayName: '青木', balance: 2 }, { stockStudentKey: 's002', displayName: '田中', balance: 1 }]
  const raw = (key: string, balance: number, dates: string[], slots: (number | null)[]) => ({ key, balance, remainingOriginDates: dates, remainingOriginSlots: slots })

  it('その科目の在庫行に残数があれば、生徒のグループ行・在庫キー・振替元トークンを返す', () => {
    const result = resolveParentMakeupPlacement({
      groupedEntries: grouped,
      rawEntries: [raw('s001__英', 1, ['2026-09-20'], [3]), raw('s001__数', 1, ['2026-09-12'], [2])],
      stockKey: 's001__英', originDate: '2026-09-20', originSlotNumber: 3,
    })
    expect(result).toEqual({ entry: grouped[0], rawKey: 's001__英', originToken: buildOriginToken('2026-09-20', 3) })
  })

  // 生徒単位の合計(英 0 + 数 2 = 2)で見ると配置モードへ入り、在庫の裏付けが無い英の振替が盤面に置かれる。
  it('その科目の残数が 0 以下なら、他の科目に残数があっても配置モードへ入らない', () => {
    const rawEntries = [raw('s001__英', 0, [], []), raw('s001__数', 2, ['2026-09-12', '2026-09-13'], [2, 2])]
    expect(resolveParentMakeupPlacement({ groupedEntries: grouped, rawEntries, stockKey: 's001__英', originDate: '2026-09-20', originSlotNumber: 3 })).toBeNull()
    expect(resolveParentMakeupPlacement({ groupedEntries: grouped, rawEntries: [raw('s001__英', -1, [], [])], stockKey: 's001__英', originDate: '2026-09-20', originSlotNumber: 3 })).toBeNull()
  })

  it('休みにしたコマの日付が残り振替元に無い(先取りとの相殺)なら入らない。最古の振替元へ付け替えない(INV-11)', () => {
    const rawEntries = [raw('s001__英', 1, ['2026-09-05'], [3])]
    expect(resolveParentMakeupPlacement({ groupedEntries: grouped, rawEntries, stockKey: 's001__英', originDate: '2026-09-20', originSlotNumber: 3 })).toBeNull()
  })

  it('在庫行・グループ行が見つからなければ入らない', () => {
    expect(resolveParentMakeupPlacement({ groupedEntries: grouped, rawEntries: [], stockKey: 's001__英', originDate: '2026-09-20', originSlotNumber: 3 })).toBeNull()
    expect(resolveParentMakeupPlacement({ groupedEntries: [], rawEntries: [raw('s001__英', 1, ['2026-09-20'], [3])], stockKey: 's001__英', originDate: '2026-09-20', originSlotNumber: 3 })).toBeNull()
  })
})
