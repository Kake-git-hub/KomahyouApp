import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CLIENT_ERROR_AUTO_REPORT_MARKER,
  CLIENT_ERROR_AUTO_REPORT_SESSION_LIMIT,
  CLIENT_ERROR_GATE_STORAGE_KEY,
  CLIENT_ERROR_MESSAGE_LIMIT,
  CLIENT_ERROR_TRACE_LIMIT_PER_KEY,
  decideClientErrorTrace,
  loadClientErrorAutoReportGateState,
  saveClientErrorAutoReportGateState,
  buildClientErrorAutoReportNote,
  buildClientErrorDedupeKey,
  buildClientErrorTraceSummary,
  createClientErrorAutoReportGateState,
  decideClientErrorAutoReport,
  describeClientError,
  handleCapturedClientError,
  installClientErrorCapture,
  isClientErrorAutoReportNote,
  isIgnorableClientError,
  resetClientErrorCaptureState,
  setClientErrorAutoReporter,
} from './clientErrorCapture'
import { DEVELOPER_REPORT_NOTE_LIMIT } from './developerReport'
import { clearOperationTraceMemory, peekOperationTrace, setOperationTraceClassroomId } from './operationTrace'

const context = { appVersion: '1.5.625', screen: 'board', url: 'https://example.test/#board' }

describe('describeClientError(捕まえた例外の正規化)', () => {
  it('Error なら名前・文・スタックを取り、ErrorEvent の位置も添える', () => {
    const error = new TypeError('x is undefined')
    const info = describeClientError({ source: 'window-error', error, filename: 'https://app/assets/index-abc.js', lineno: 12, colno: 34 })
    expect(info.source).toBe('window-error')
    expect(info.name).toBe('TypeError')
    expect(info.message).toBe('x is undefined')
    expect(info.location).toBe('https://app/assets/index-abc.js:12:34')
    expect(info.stack).toContain('TypeError: x is undefined')
  })

  it('文字列・オブジェクト・null の拒否理由でも落ちず、文を切り詰める', () => {
    expect(describeClientError({ source: 'unhandled-rejection', error: 'plain text' }).message).toBe('plain text')
    expect(describeClientError({ source: 'unhandled-rejection', error: { code: 'E1' } }).message).toBe('{"code":"E1"}')
    expect(describeClientError({ source: 'unhandled-rejection', error: null }).message).toBe('(詳細なし)')
    expect(describeClientError({ source: 'window-error', message: 'from event' }).message).toBe('from event')
    const long = describeClientError({ source: 'window-error', error: new Error('y'.repeat(1000)) })
    expect(long.message).toHaveLength(CLIENT_ERROR_MESSAGE_LIMIT)
    expect(long.message.endsWith('…')).toBe(true)
  })

  it('React の componentStack はスタックに続ける', () => {
    const info = describeClientError({ source: 'react-render', error: new Error('render'), componentStack: '\n    at BoardGrid\n    at App' })
    expect(info.stack).toContain('component stack:')
    expect(info.stack).toContain('at BoardGrid')
  })
})

describe('isIgnorableClientError(別の仕組みで扱う失敗と情報の無いものは送らない)', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://app/assets/App-123.js',
    'Importing a module script failed.',
    'Loading chunk 12 failed.',
    'ChunkLoadError: Loading CSS chunk 3 failed',
    'ResizeObserver loop completed with undelivered notifications.',
    'Script error.',
    '',
    '(詳細なし)',
  ])('%s は無視', (message) => {
    expect(isIgnorableClientError({ message })).toBe(true)
  })

  it('普通の例外は無視しない', () => {
    expect(isIgnorableClientError({ message: "Cannot read properties of undefined (reading 'desks')" })).toBe(false)
  })
})

describe('痕跡の要約・重複キー・本文', () => {
  const info = describeClientError({ source: 'window-error', error: Object.assign(new TypeError("Cannot read properties of undefined (reading 'desks')"), { stack: "TypeError: Cannot read properties of undefined (reading 'desks')\n    at mergeManagedWeek (https://app/assets/index-abc.js:10:20)\n    at App (https://app/assets/index-abc.js:30:40)" }), filename: 'https://app/assets/index-abc.js', lineno: 10, colno: 20 })

  it('痕跡の 1 行は出どころ・名前・文・位置だけ(生徒名は入らない)', () => {
    expect(buildClientErrorTraceSummary(info)).toBe("画面の例外(window.onerror): TypeError: Cannot read properties of undefined (reading 'desks') (https://app/assets/index-abc.js:10:20)")
  })

  it('重複キーは出どころ・名前・文の先頭・最初のフレームで決まり、同じエラーは同じキー', () => {
    const key = buildClientErrorDedupeKey(info)
    expect(key).toContain('window-error|TypeError|')
    expect(key).toContain('at mergeManagedWeek')
    expect(buildClientErrorDedupeKey({ ...info })).toBe(key)
    expect(buildClientErrorDedupeKey({ ...info, source: 'react-render' })).not.toBe(key)
  })

  it('本文は先頭行が目印で、出どころ・エラー・場所・画面と版・スタックを含み、2000 字を超えない', () => {
    const note = buildClientErrorAutoReportNote(info, context)
    const lines = note.split('\n')
    expect(lines[0].startsWith(CLIENT_ERROR_AUTO_REPORT_MARKER)).toBe(true)
    expect(note).toContain('出どころ: 画面の例外(window.onerror)')
    expect(note).toContain("エラー: TypeError: Cannot read properties of undefined (reading 'desks')")
    expect(note).toContain('場所: https://app/assets/index-abc.js:10:20')
    expect(note).toContain('画面: board / 版: 1.5.625 / URL: https://example.test/#board')
    expect(note).toContain('スタック:')
    expect(isClientErrorAutoReportNote(note)).toBe(true)
    expect(isClientErrorAutoReportNote('ふつうの質問です')).toBe(false)
    const huge = buildClientErrorAutoReportNote({ ...info, stack: 'z'.repeat(5000) }, context)
    expect(huge.length).toBeLessThanOrEqual(DEVELOPER_REPORT_NOTE_LIMIT)
  })

  it('目印はサーバー(functions/src/developerReport.ts)と同じ文字列(片方だけ変えると Issue が起票されてしまう)', () => {
    expect(CLIENT_ERROR_AUTO_REPORT_MARKER).toBe('[自動エラー報告]')
  })
})

describe('decideClientErrorAutoReport(重複と回数の歯止め)', () => {
  it('同じキーは 1 回、1 セッションで上限まで', () => {
    expect(CLIENT_ERROR_AUTO_REPORT_SESSION_LIMIT).toBe(3)
    const state = createClientErrorAutoReportGateState()
    expect(decideClientErrorAutoReport(state, 'a')).toBe(true)
    expect(decideClientErrorAutoReport(state, 'a')).toBe(false)
    expect(decideClientErrorAutoReport(state, 'b')).toBe(true)
    expect(decideClientErrorAutoReport(state, 'c')).toBe(true)
    expect(decideClientErrorAutoReport(state, 'd')).toBe(false)
    expect(state.sentCount).toBe(3)
  })
})

describe('handleCapturedClientError(入口)と installClientErrorCapture(window への取り付け)', () => {
  beforeEach(() => {
    resetClientErrorCaptureState()
    clearOperationTraceMemory()
    setOperationTraceClassroomId('c1')
  })
  afterEach(() => {
    resetClientErrorCaptureState()
    clearOperationTraceMemory()
    vi.unstubAllGlobals()
  })

  it('痕跡に kind error で残し、送信口があれば本文を 1 回だけ送る。無視対象は痕跡にも残さない', async () => {
    const submit = vi.fn((_note: string) => Promise.resolve({ ok: true }))
    setClientErrorAutoReporter({ submit, context: () => context })
    const info = describeClientError({ source: 'unhandled-rejection', error: new Error('boom') })
    expect(handleCapturedClientError(info)).toBe('reported')
    expect(handleCapturedClientError(info)).toBe('deduped')
    expect(submit).toHaveBeenCalledTimes(1)
    expect(String(submit.mock.calls[0][0]).startsWith(CLIENT_ERROR_AUTO_REPORT_MARKER)).toBe(true)
    const trace = peekOperationTrace('c1')
    expect(trace.map((entry) => entry.kind)).toEqual(['error', 'error'])
    expect(trace[0].summary).toContain('boom')
    expect(handleCapturedClientError(describeClientError({ source: 'window-error', message: 'Script error.' }))).toBe('ignored')
    expect(peekOperationTrace('c1')).toHaveLength(2)
  })

  it('送信口が無ければ痕跡だけ。送信が拒否されても例外は外へ出ない', async () => {
    expect(handleCapturedClientError(describeClientError({ source: 'window-error', error: new Error('no reporter') }))).toBe('traced-only')
    setClientErrorAutoReporter({ submit: () => Promise.reject(new Error('offline')), context: () => context })
    expect(handleCapturedClientError(describeClientError({ source: 'window-error', error: new Error('rejects') }))).toBe('reported')
    setClientErrorAutoReporter({ submit: () => { throw new Error('sync throw') }, context: () => context })
    expect(handleCapturedClientError(describeClientError({ source: 'window-error', error: new Error('throws') }))).toBe('reported')
    await Promise.resolve()
  })

  it('window の error / unhandledrejection を捕まえ、外すと捕まえない', () => {
    const listeners = new Map<string, (event: unknown) => void>()
    const target = {
      addEventListener: (type: string, listener: (event: unknown) => void) => { listeners.set(type, listener) },
      removeEventListener: (type: string) => { listeners.delete(type) },
    }
    const seen: string[] = []
    const uninstall = installClientErrorCapture(target, (info) => { seen.push(`${info.source}:${info.message}`) })
    expect([...listeners.keys()].sort()).toEqual(['error', 'unhandledrejection'])
    listeners.get('error')?.({ message: 'ev message', error: new Error('ev error'), filename: 'f.js', lineno: 1, colno: 2 })
    listeners.get('unhandledrejection')?.({ reason: new Error('rejected') })
    listeners.get('unhandledrejection')?.(undefined)
    expect(seen).toEqual(['window-error:ev error', 'unhandled-rejection:rejected', 'unhandled-rejection:(詳細なし)'])
    uninstall()
    expect(listeners.size).toBe(0)
  })
})

describe('歯止めの永続化(M-2)・再入(テスト案 4)・痕跡の間引き(L-2)', () => {
  beforeEach(() => {
    resetClientErrorCaptureState()
    clearOperationTraceMemory()
    setOperationTraceClassroomId('c1')
  })
  afterEach(() => {
    resetClientErrorCaptureState()
    clearOperationTraceMemory()
    vi.unstubAllGlobals()
  })

  function installSessionStorage(initial: Record<string, string> = {}) {
    const store = new Map<string, string>(Object.entries(initial))
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    }
    vi.stubGlobal('window', { sessionStorage: storage, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
    return store
  }

  it('load/save: 保存した重複キーと送った数を戻し、壊れていれば空から始める', () => {
    const storage = { getItem: () => JSON.stringify({ keys: ['a', 'b'], sentCount: 2 }), setItem: () => {} }
    const state = loadClientErrorAutoReportGateState(storage)
    expect([...state.seenKeys]).toEqual(['a', 'b'])
    expect(state.sentCount).toBe(2)
    expect(loadClientErrorAutoReportGateState({ getItem: () => '{broken', setItem: () => {} }).sentCount).toBe(0)
    expect(loadClientErrorAutoReportGateState(null).seenKeys.size).toBe(0)
    const saved: string[] = []
    saveClientErrorAutoReportGateState({ getItem: () => null, setItem: (_k, v) => { saved.push(v) } }, state)
    expect(JSON.parse(saved[0])).toEqual({ keys: ['a', 'b'], sentCount: 2 })
    // setItem が投げても落ちない(容量超過)。
    expect(() => saveClientErrorAutoReportGateState({ getItem: () => null, setItem: () => { throw new Error('quota') } }, state)).not.toThrow()
  })

  it('再読み込み(メモリの状態を捨てる)を跨いでも、同じエラーは送らず、上限 3 通も引き継ぐ', () => {
    const store = installSessionStorage()
    const submit = vi.fn((_note: string) => Promise.resolve({ ok: true }))
    setClientErrorAutoReporter({ submit, context: () => context })
    const info = describeClientError({ source: 'react-render', error: new Error('render boom') })
    expect(handleCapturedClientError(info)).toBe('reported')
    expect(store.has(CLIENT_ERROR_GATE_STORAGE_KEY)).toBe(true)
    // 再読み込み相当: モジュールの状態だけ捨てる(sessionStorage は残る)。
    resetClientErrorCaptureState()
    setClientErrorAutoReporter({ submit, context: () => context })
    expect(handleCapturedClientError(info)).toBe('deduped')
    expect(handleCapturedClientError(describeClientError({ source: 'window-error', error: new Error('two') }))).toBe('reported')
    expect(handleCapturedClientError(describeClientError({ source: 'window-error', error: new Error('three') }))).toBe('reported')
    resetClientErrorCaptureState()
    setClientErrorAutoReporter({ submit, context: () => context })
    expect(handleCapturedClientError(describeClientError({ source: 'window-error', error: new Error('four') }))).toBe('deduped')
    expect(submit).toHaveBeenCalledTimes(3)
  })

  it('送信口の中で入口が再び呼ばれても重ねて走らない(無限ループにならない)', () => {
    installSessionStorage()
    let nested: string | null = null
    setClientErrorAutoReporter({
      submit: () => {
        nested = handleCapturedClientError(describeClientError({ source: 'unhandled-rejection', error: new Error('nested') }))
        throw new Error('sync failure inside submit')
      },
      context: () => context,
    })
    expect(handleCapturedClientError(describeClientError({ source: 'window-error', error: new Error('outer') }))).toBe('reported')
    expect(nested).toBe('ignored')
    // 入口が終わったあとは通常どおり受け付ける。
    expect(handleCapturedClientError(describeClientError({ source: 'window-error', error: new Error('after') }))).toBe('reported')
  })

  it('同じエラーの痕跡は 5 件までで、以後は痕跡に残さない(履歴を押し流さない)', () => {
    installSessionStorage()
    expect(CLIENT_ERROR_TRACE_LIMIT_PER_KEY).toBe(5)
    const state = createClientErrorAutoReportGateState()
    for (let index = 0; index < 5; index += 1) expect(decideClientErrorTrace(state, 'k')).toBe(true)
    expect(decideClientErrorTrace(state, 'k')).toBe(false)
    expect(decideClientErrorTrace(state, 'other')).toBe(true)
    const info = describeClientError({ source: 'window-error', error: new Error('loop') })
    for (let index = 0; index < 8; index += 1) handleCapturedClientError(info)
    expect(peekOperationTrace('c1').filter((entry) => entry.kind === 'error')).toHaveLength(5)
  })
})
