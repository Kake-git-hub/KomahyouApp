// @vitest-environment jsdom
// 画面フック(Phase 1 T1-5・docs/spec-multi-tenant.md §11)の回帰固定。
//  1. 既定(追加ボタン/項目なし)では盤面ツールバーとメニューの DOM が従来と同じ(data-company-* が一切出ない)。
//  2. 会社プロファイルに登録があれば、質問・要望ボタンの右／既存メニューの下・ログアウトの上に出て、
//     押すとコアの内部 state ではなく { classroomName, weekStartDate } だけを受け取る。
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  companyProfile as realCompanyProfile,
  EMPTY_COMPANY_SCREEN_EXTENSIONS,
  type CompanyProfile,
  type CompanyScreenActionContext,
  type CompanyScreenExtensions,
} from './profile'

// プロファイルを差し替え可能にする(既定は本物 = 追加なし)。vi.mock は巻き上げられるので保持体は vi.hoisted で先に作る。
const mockedProfile = vi.hoisted(() => ({ current: null as CompanyProfile | null }))
vi.mock('@company/profile', async (importOriginal) => {
  const original = await importOriginal<typeof import('@company/profile')>()
  return {
    ...original,
    get companyProfile() {
      return mockedProfile.current ?? original.companyProfile
    },
  }
})

import { AppMenu } from '../components/navigation/AppMenu'
import { BoardToolbar } from '../components/schedule-board/BoardToolbar'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function withExtensions(extensions: CompanyScreenExtensions): CompanyProfile {
  return { ...realCompanyProfile, screenExtensions: extensions }
}

const noop = () => {}

function toolbarProps() {
  return {
    weekLabel: '2026/03/23〜03/29',
    weekStartDate: '2026-03-23',
    statusMessage: '',
    lectureStockTotalCount: 0,
    isLectureStockOpen: false,
    makeupStockTotalCount: 0,
    isMakeupStockOpen: false,
    isMakeupMoveActive: false,
    isPrintingPdf: false,
    isStudentScheduleOpen: false,
    isTeacherScheduleOpen: false,
    hasSelectedStudent: false,
    canUndo: false,
    canRedo: false,
    canGoPrevWeek: true,
    canGoNextWeek: true,
    isTemplateMode: false,
    onUndo: noop,
    onRedo: noop,
    onOpenSortMenu: noop,
    onReportToDeveloper: noop,
    onGoPrevWeek: noop,
    onGoNextWeek: noop,
    onJumpToDate: noop,
    onToggleLectureStock: noop,
    onToggleMakeupStock: noop,
    onOpenStudentSchedule: noop,
    onOpenTeacherSchedule: noop,
    onOpenRegularTemplate: noop,
    onPrintPdf: noop,
    onCancelSelection: noop,
    onOpenBasicData: noop,
    onOpenSpecialData: noop,
    onOpenAutoAssignRules: noop,
    onOpenBackupRestore: noop,
    onLogout: noop,
    undoSnapshotLabel: null,
    classroomName: '日大前校',
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  mockedProfile.current = null
})

function render(element: ReturnType<typeof createElement>) {
  act(() => root.render(element))
}

function click(element: Element | null) {
  expect(element).not.toBeNull()
  act(() => {
    element!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('盤面ツールバーの追加ボタン', () => {
  it('既定(登録なし)では追加ボタンが出ない(DOM 不変)', () => {
    expect(realCompanyProfile.screenExtensions).toBe(EMPTY_COMPANY_SCREEN_EXTENSIONS)
    render(createElement(BoardToolbar, toolbarProps()))
    expect(container.querySelectorAll('[data-company-button]').length).toBe(0)
    expect(container.querySelector('[data-testid="board-report-developer-button"]')).not.toBeNull()
  })

  it('登録があれば質問・要望ボタンの直後に並び、押すと教室名と表示週の開始日だけを受け取る', () => {
    const onClick = vi.fn<(context: CompanyScreenActionContext) => void>()
    mockedProfile.current = withExtensions({
      boardToolbarButtons: [{ id: 'co-report', label: '会社レポート', title: '会社レポートを開く', onClick }],
      appMenuItems: [],
    })
    render(createElement(BoardToolbar, toolbarProps()))
    const button = container.querySelector('[data-company-button="co-report"]')
    expect(button).not.toBeNull()
    expect(button!.textContent).toBe('会社レポート')
    expect(button!.getAttribute('title')).toBe('会社レポートを開く')
    expect(button!.previousElementSibling?.getAttribute('data-testid')).toBe('board-report-developer-button')
    click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith({ classroomName: '日大前校', weekStartDate: '2026-03-23' })
  })

  it('テンプレート編集モードでは追加ボタンを出さない(テンプレ操作バーは会社差の対象外)', () => {
    mockedProfile.current = withExtensions({
      boardToolbarButtons: [{ id: 'co-report', label: '会社レポート', onClick: noop }],
      appMenuItems: [],
    })
    render(createElement(BoardToolbar, { ...toolbarProps(), isTemplateMode: true, onTemplateClose: noop }))
    expect(container.querySelectorAll('[data-company-button]').length).toBe(0)
  })
})

describe('メニューの追加項目', () => {
  function openMenu() {
    click(container.querySelector('[data-testid="menu-button"]'))
  }

  it('既定(登録なし)では既存 5 項目＋ログアウトだけ(DOM 不変)', () => {
    render(createElement(AppMenu, {
      currentScreen: 'board',
      onNavigate: noop,
      buttonTestId: 'menu-button',
      footerActionLabel: 'ログアウト',
      onFooterActionClick: noop,
    }))
    openMenu()
    const items = Array.from(container.querySelectorAll('.menu-dropdown-list .menu-link-button')).map((element) => element.textContent)
    expect(items).toEqual(['コマ表', '基本データ', '特別講習データ', '自動割振ルール', 'バックアップ/復元/初期設定', 'ログアウト'])
    expect(container.querySelectorAll('[data-company-menu-item]').length).toBe(0)
  })

  it('登録があれば既存項目の下・ログアウトの上に出て、押すと閉じて教室名だけを受け取る', () => {
    const onClick = vi.fn<(context: CompanyScreenActionContext) => void>()
    mockedProfile.current = withExtensions({
      boardToolbarButtons: [],
      appMenuItems: [{ id: 'co-summary', label: '会社集計', onClick }],
    })
    render(createElement(AppMenu, {
      currentScreen: 'board',
      onNavigate: noop,
      buttonTestId: 'menu-button',
      footerActionLabel: 'ログアウト',
      onFooterActionClick: noop,
      classroomName: '緑が丘校',
    }))
    openMenu()
    const items = Array.from(container.querySelectorAll('.menu-dropdown-list .menu-link-button')).map((element) => element.textContent)
    expect(items).toEqual(['コマ表', '基本データ', '特別講習データ', '自動割振ルール', 'バックアップ/復元/初期設定', '会社集計', 'ログアウト'])
    click(container.querySelector('[data-company-menu-item="co-summary"]'))
    expect(onClick).toHaveBeenCalledWith({ classroomName: '緑が丘校', weekStartDate: '' })
    expect(container.querySelector('.menu-dropdown-list')).toBeNull()
  })
})
