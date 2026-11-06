// 保留（2 行・緑）の机で「押した行だけ」に選択中の枠を付ける規則の回帰防止テスト。
// オーナー指示 2026-11-06（確認リスト tp-64 受付 20261105-234609713）「上の行クリック時は誰もハイライトされず、下の行クリック時は両方ハイライト
// されてしまっています。クリックしている行だけハイライトして。」— v1.5.689 は 11/5 のフリーメモを「上段と下段の両方」と読み違えていた。
//
// 固定すること:
//   1. 保留の席の上段の生徒を押して生徒メニューが開いている間 → その席の上段だけ
//   2. 下段（生徒・メモ・記録・狭い画面の帯）を押して保留メニューが開いている間 → その席の下段だけ
//   3. 上段が空の席を押して／上段の生徒メニューの「保留を片づける」から保留メニューを開いたとき → 押した上段だけ
//   4. 講師欄の下段の講師名を押して講師の 2 択が開いている間 → 講師欄の下段だけ
//   5. メニューを閉じれば消える・テンプレ編集中は出さない

import { describe, expect, it } from 'vitest'

import { resolveOpenedPendingRowHighlight } from './templatePendingRowHighlight'

const CELL = '2026-11-04_5'
const DESK = `${CELL}_desk_1`

describe('押した行だけに選択中の枠を付ける（tp-64・2026-11-06）', () => {
  it('1. 保留の席の上段の生徒メニューが開いている間は、その席の上段だけ', () => {
    expect(resolveOpenedPendingRowHighlight({
      isTemplateMode: false,
      pendingDeskMenu: null,
      studentMenuPendingUpperSeat: { cellId: CELL, deskId: DESK, seatIndex: 1 },
    })).toEqual({ kind: 'seat', cellId: CELL, deskId: DESK, seatIndex: 1, row: 'upper' })
  })

  it('2. 下段を押して保留メニューが開いている間は、その席の下段だけ', () => {
    expect(resolveOpenedPendingRowHighlight({
      isTemplateMode: false,
      pendingDeskMenu: { cellId: CELL, deskId: DESK, pressed: { row: 'lower', seatIndex: 0 } },
      studentMenuPendingUpperSeat: null,
    })).toEqual({ kind: 'seat', cellId: CELL, deskId: DESK, seatIndex: 0, row: 'lower' })
  })

  it('3. 上段の空席・「保留を片づける」から開いた保留メニューは、押した上段だけ', () => {
    expect(resolveOpenedPendingRowHighlight({
      isTemplateMode: false,
      pendingDeskMenu: { cellId: CELL, deskId: DESK, pressed: { row: 'upper', seatIndex: 1 } },
      studentMenuPendingUpperSeat: null,
    })).toEqual({ kind: 'seat', cellId: CELL, deskId: DESK, seatIndex: 1, row: 'upper' })
  })

  it('4. 講師の 2 択（target=teacher）が開いている間は、講師欄の下段だけ（席の枠は付けない）', () => {
    expect(resolveOpenedPendingRowHighlight({
      isTemplateMode: false,
      pendingDeskMenu: { cellId: CELL, deskId: DESK, target: 'teacher' },
      studentMenuPendingUpperSeat: null,
    })).toEqual({ kind: 'teacher-lower', cellId: CELL, deskId: DESK })
    // 押した行の印が残っていても講師の 2 択なら講師欄の下段
    expect(resolveOpenedPendingRowHighlight({
      isTemplateMode: false,
      pendingDeskMenu: { cellId: CELL, deskId: DESK, target: 'teacher', pressed: { row: 'lower', seatIndex: 0 } },
      studentMenuPendingUpperSeat: null,
    })).toEqual({ kind: 'teacher-lower', cellId: CELL, deskId: DESK })
  })

  it('5. メニューを閉じれば枠は無い。テンプレ編集中は出さない', () => {
    expect(resolveOpenedPendingRowHighlight({ isTemplateMode: false, pendingDeskMenu: null, studentMenuPendingUpperSeat: null })).toBeNull()
    expect(resolveOpenedPendingRowHighlight({
      isTemplateMode: true,
      pendingDeskMenu: { cellId: CELL, deskId: DESK, pressed: { row: 'lower', seatIndex: 0 } },
      studentMenuPendingUpperSeat: { cellId: CELL, deskId: DESK, seatIndex: 0 },
    })).toBeNull()
    expect(resolveOpenedPendingRowHighlight({
      isTemplateMode: true,
      pendingDeskMenu: { cellId: CELL, deskId: DESK, target: 'teacher' },
      studentMenuPendingUpperSeat: null,
    })).toBeNull()
  })

  it('押した行の分からない保留メニュー（pressed なし）は枠を付けない（違う行を光らせない）', () => {
    expect(resolveOpenedPendingRowHighlight({
      isTemplateMode: false,
      pendingDeskMenu: { cellId: CELL, deskId: DESK },
      studentMenuPendingUpperSeat: null,
    })).toBeNull()
  })

  it('保留メニューが開いていればそちらを優先する（生徒メニューの上段の枠と同時には出さない）', () => {
    expect(resolveOpenedPendingRowHighlight({
      isTemplateMode: false,
      pendingDeskMenu: { cellId: CELL, deskId: DESK, pressed: { row: 'lower', seatIndex: 0 } },
      studentMenuPendingUpperSeat: { cellId: CELL, deskId: DESK, seatIndex: 0 },
    })).toEqual({ kind: 'seat', cellId: CELL, deskId: DESK, seatIndex: 0, row: 'lower' })
  })
})
