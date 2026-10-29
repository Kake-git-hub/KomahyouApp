// @vitest-environment jsdom
// 「質問・要望」を別タブで開く(2026-10-29 オーナー指示「質問・要望ボタンのページは別タブで開くようにして。
// AI 回答を見ながら画面操作する可能性があるので」・全教室)。
// App と同じ組み立て(useDeveloperReportWindow ＋ DeveloperReportModal を別タブへ createPortal・開けなければ元の画面のモーダル)を
// 小さな画面で描き、開く/移る/閉じる/教室切替/送信中に閉じた後の結果を固定する。別タブは jsdom の iframe の window で代用する。

import { act, createElement, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { DEVELOPER_REPORT_UI_TEXT } from '../../utils/developerReport'
import { DeveloperReportModal } from './DeveloperReportModal'
import { DEVELOPER_REPORT_WINDOW_BODY_CLASS, DEVELOPER_REPORT_WINDOW_NAME, DEVELOPER_REPORT_WINDOW_ROOT_ID, buildDeveloperReportWindowTitle, isDetachedWindowOpen } from './developerReportWindow'
import { useDeveloperReportWindow } from './useDeveloperReportWindow'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Send = (note: string) => Promise<string>

/** 描画のたびに「その描画の resetKey で前の回が見えていたか」を残す(切り替えた直後の 1 回の描画を見るため)。 */
const renderLog: Array<{ resetKey: string; sessionResetKey: string | null; hasTarget: boolean }> = []

function Harness({ resetKey, send }: { resetKey: string; send: Send }) {
  const report = useDeveloperReportWindow({ classroomName: '開発用教室', resetKey })
  renderLog.push({ resetKey, sessionResetKey: report.session?.resetKey ?? null, hasTarget: report.target !== null })
  const content = report.session
    ? createElement(DeveloperReportModal, {
      key: report.session.openId,
      presentation: report.target ? 'window' : 'modal',
      windowBlocked: report.session.windowBlocked,
      classroomName: '開発用教室',
      sending: report.session.sending,
      resultMessage: report.session.resultMessage,
      onSubmit: (note: string) => { void report.runSubmit(() => send(note)) },
      onClose: report.close,
    })
    : null
  return createElement(
    Fragment,
    null,
    createElement('button', { type: 'button', 'data-testid': 'open-report', onClick: report.open }),
    content && report.target ? createPortal(content, report.target.root) : null,
    report.target ? null : content,
  )
}

// React の onChange を通すため、値は setter 経由で入れて input を流す。
function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value')!.set!
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('useDeveloperReportWindow(質問・要望の別タブ)', () => {
  let container: HTMLDivElement
  let root: Root
  let frame: HTMLIFrameElement
  let popup: Window
  let popupClose: Mock<() => void>
  let popupFocus: Mock<() => void>
  let openSpy: ReturnType<typeof vi.spyOn>
  let send: Mock<Send>

  const render = (resetKey = 'C1|u1') => {
    act(() => {
      root.render(createElement(Harness, { resetKey, send }))
    })
  }
  const clickOpen = () => act(() => container.querySelector<HTMLButtonElement>('[data-testid="open-report"]')!.click())
  const popupDoc = () => popup.document
  const popupNote = () => popupDoc().querySelector<HTMLTextAreaElement>('[data-testid="developer-report-note"]')

  beforeEach(() => {
    renderLog.length = 0
    frame = document.createElement('iframe')
    document.body.append(frame)
    popup = frame.contentWindow!
    popupClose = vi.fn<() => void>(() => {
      Object.defineProperty(popup, 'closed', { value: true, configurable: true })
    })
    popupFocus = vi.fn<() => void>()
    popup.close = popupClose
    popup.focus = popupFocus
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => popup)
    send = vi.fn<Send>(async () => '受け付けました（受付番号 r-1）')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    render()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    frame.remove()
    vi.restoreAllMocks()
  })

  it('押すと別タブ(名前付き)に描かれ、元の画面にはモーダルも覆いも出ない', () => {
    clickOpen()
    expect(openSpy).toHaveBeenCalledWith('', DEVELOPER_REPORT_WINDOW_NAME)
    expect(popupDoc().title).toBe('質問・要望（開発用教室）')
    expect(popupDoc().documentElement.className).toBe(DEVELOPER_REPORT_WINDOW_BODY_CLASS)
    const modal = popupDoc().querySelector(`#${DEVELOPER_REPORT_WINDOW_ROOT_ID} [data-testid="developer-report-modal"]`)
    expect(modal?.getAttribute('data-presentation')).toBe('window')
    expect(popupDoc().querySelector('.auto-assign-modal-overlay')).toBeNull()
    expect(popupDoc().querySelector('[data-testid="developer-report-window-hint"]')?.textContent).toBe(DEVELOPER_REPORT_UI_TEXT.windowHint)
    expect(container.querySelector('[data-testid="developer-report-modal"]')).toBeNull()
    expect(container.querySelector('.auto-assign-modal-overlay')).toBeNull()
    expect(popupFocus).toHaveBeenCalled()
  })

  it('別タブで書いて送ると同じ送信口に届き、結果(AI の回答を含む文)は別タブに出る', async () => {
    send.mockResolvedValueOnce('受け付けました。\n― 自動回答 ―\n振替は生徒メニューの「移動」から。')
    clickOpen()
    act(() => typeInto(popupNote()!, '振替の仕方は？'))
    await act(async () => {
      popupDoc().querySelector<HTMLButtonElement>('[data-testid="developer-report-submit"]')!.click()
    })
    expect(send).toHaveBeenCalledWith('振替の仕方は？')
    expect(popupDoc().querySelector('[data-testid="developer-report-result"]')?.textContent).toContain('振替は生徒メニューの「移動」から。')
    expect(container.querySelector('[data-testid="developer-report-result"]')).toBeNull()
  })

  it('別タブを開いたままもう一度押すと、タブを増やさずそのタブへ移る(同じ名前で前に出す・書きかけは消えない)', () => {
    clickOpen()
    act(() => typeInto(popupNote()!, '書きかけ'))
    popupFocus.mockClear()
    clickOpen()
    // 2 回目は同じ名前の window.open(ブラウザが同じタブを前に出す)＋ focus だけ。文書は作り直さない。
    expect(openSpy).toHaveBeenCalledTimes(2)
    expect(openSpy).toHaveBeenLastCalledWith('', DEVELOPER_REPORT_WINDOW_NAME)
    expect(popupFocus).toHaveBeenCalledTimes(1)
    expect(popupDoc().querySelectorAll(`#${DEVELOPER_REPORT_WINDOW_ROOT_ID}`)).toHaveLength(1)
    expect(popupNote()!.value).toBe('書きかけ')
  })

  it('閉じたのにまだ気づいていない(pagehide も見張りもまだ)タブなら、押したときに新しく開き直す', () => {
    clickOpen()
    act(() => typeInto(popupNote()!, '書きかけ'))
    Object.defineProperty(popup, 'closed', { value: true, configurable: true })
    popupFocus.mockClear()
    clickOpen()
    Object.defineProperty(popup, 'closed', { value: false, configurable: true })
    expect(openSpy).toHaveBeenCalledTimes(2)
    expect(popupNote()!.value).toBe('')
  })

  it('「キャンセル」「閉じる」で別タブも閉じ、次に押すとまっさらで開く', () => {
    clickOpen()
    act(() => typeInto(popupNote()!, '書きかけ'))
    act(() => popupDoc().querySelector<HTMLButtonElement>('[data-testid="developer-report-cancel"]')!.click())
    expect(popupClose).toHaveBeenCalled()
    Object.defineProperty(popup, 'closed', { value: false, configurable: true })
    clickOpen()
    expect(openSpy).toHaveBeenCalledTimes(2)
    expect(popupNote()!.value).toBe('')
  })

  it('別タブを × で閉じたら(pagehide)入力ごと閉じ、元の画面にモーダルは出ない', () => {
    clickOpen()
    act(() => {
      Object.defineProperty(popup, 'closed', { value: true, configurable: true })
      popup.dispatchEvent(new Event('pagehide'))
    })
    expect(container.querySelector('[data-testid="developer-report-modal"]')).toBeNull()
    Object.defineProperty(popup, 'closed', { value: false, configurable: true })
    clickOpen()
    expect(openSpy).toHaveBeenCalledTimes(2)
  })

  it('元のタブを閉じる/再読み込みする(pagehide)ときは別タブも閉じる', () => {
    clickOpen()
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(popupClose).toHaveBeenCalled()
  })

  it('ポップアップを止められたら元の画面のモーダルで開き、別タブを開けなかった一言を出す', () => {
    openSpy.mockImplementation(() => null)
    clickOpen()
    const modal = container.querySelector('.auto-assign-modal-overlay [data-testid="developer-report-modal"]')
    expect(modal?.getAttribute('data-presentation')).toBe('modal')
    expect(container.querySelector('[data-testid="developer-report-window-blocked"]')?.textContent).toBe(DEVELOPER_REPORT_UI_TEXT.windowBlockedNotice)
    expect(container.querySelector('[data-testid="developer-report-window-hint"]')).toBeNull()
  })

  it('教室を切り替えた・ログアウトした(resetKey が変わった)ら別タブを閉じ、書きかけは切り替え先へ持ち越さない(INV-08)', () => {
    clickOpen()
    act(() => typeInto(popupNote()!, '教室1の質問'))
    render('C2|u1')
    expect(popupClose).toHaveBeenCalled()
    expect(container.querySelector('[data-testid="developer-report-modal"]')).toBeNull()
    Object.defineProperty(popup, 'closed', { value: false, configurable: true })
    clickOpen()
    expect(popupNote()!.value).toBe('')
  })

  it('教室を切り替えた直後の描画から、前の回(書きかけ・回答)を描かない(閉じる effect を待たない)', () => {
    clickOpen()
    act(() => typeInto(popupNote()!, '教室1の質問'))
    renderLog.length = 0
    render('C2|u1')
    const firstWithNewKey = renderLog.find((entry) => entry.resetKey === 'C2|u1')
    expect(firstWithNewKey).toEqual({ resetKey: 'C2|u1', sessionResetKey: null, hasTarget: false })
  })

  it('同じ教室でもユーザーが変わったら(ログアウト・アカウント切替)閉じる', () => {
    clickOpen()
    act(() => typeInto(popupNote()!, '前のユーザーの書きかけ'))
    render('C1|u2')
    expect(popupClose).toHaveBeenCalled()
    Object.defineProperty(popup, 'closed', { value: false, configurable: true })
    clickOpen()
    expect(popupNote()!.value).toBe('')
  })

  it('送信の組み立てで例外が出ても「送信中」のまま固まらず、送れなかったことを出して閉じられる', async () => {
    send.mockImplementationOnce(async () => { throw new Error('教室データを組み立てられませんでした') })
    clickOpen()
    act(() => typeInto(popupNote()!, '質問'))
    await act(async () => {
      popupDoc().querySelector<HTMLButtonElement>('[data-testid="developer-report-submit"]')!.click()
    })
    expect(popupDoc().querySelector('[data-testid="developer-report-result"]')?.textContent).toContain('送れませんでした: 教室データを組み立てられませんでした')
    const close = popupDoc().querySelector<HTMLButtonElement>('[data-testid="developer-report-close"]')!
    expect(close.disabled).toBe(false)
    act(() => close.click())
    expect(popupClose).toHaveBeenCalled()
  })

  it('送信中に別タブを閉じたら、あとで結果が返っても元の画面にモーダルを出さない(報告は送れている)', async () => {
    let finish: (message: string) => void = () => {}
    send.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve }))
    clickOpen()
    act(() => typeInto(popupNote()!, '質問'))
    act(() => popupDoc().querySelector<HTMLButtonElement>('[data-testid="developer-report-submit"]')!.click())
    expect(send).toHaveBeenCalledTimes(1)
    act(() => {
      Object.defineProperty(popup, 'closed', { value: true, configurable: true })
      popup.dispatchEvent(new Event('pagehide'))
    })
    await act(async () => {
      finish('受け付けました')
    })
    expect(container.querySelector('[data-testid="developer-report-modal"]')).toBeNull()
    expect(container.querySelector('[data-testid="developer-report-result"]')).toBeNull()
  })
})

describe('developerReportWindow の補助', () => {
  it('題名は「質問・要望（教室名）」・教室名が無ければ「質問・要望」だけ', () => {
    expect(buildDeveloperReportWindowTitle('日大前校')).toBe('質問・要望（日大前校）')
    expect(buildDeveloperReportWindowTitle('  ')).toBe('質問・要望')
  })

  it('開いているかは閉じた／触れない window を閉じたとみなす', () => {
    expect(isDetachedWindowOpen(null)).toBe(false)
    expect(isDetachedWindowOpen({ win: { closed: false } as Window })).toBe(true)
    expect(isDetachedWindowOpen({ win: { closed: true } as Window })).toBe(false)
    const throwing = { get closed() { throw new Error('cross-origin') } } as unknown as Window
    expect(isDetachedWindowOpen({ win: throwing })).toBe(false)
  })
})
