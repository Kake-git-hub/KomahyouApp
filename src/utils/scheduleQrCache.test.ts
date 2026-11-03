import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 2026-11-03 オーナー報告(確認リストのメモ):「生徒日程表で指定した講習期間を開いて最新にした提出用QRを読み込むと
// 別の期間の講習が開かれている」。日程表の埋め込みスクリプト mergeCachedQrSvg が前の表示の QR 画像を**人の id だけ**で
// 次の表示へ写していたため、講習期間を切り替えて提出用トークンが変わっても前の期間の QR 画像が残った。
// 埋め込みスクリプトの関数本体を取り出して実行し、トークンが変わったら写さないことを固定する。
type Person = { id: string; submissionToken?: string; qrSvg?: string }
type Payload = { students: Person[]; teachers: Person[] }

function loadEmbeddedMergeCachedQrSvg() {
  const source = readFileSync(new URL('./scheduleHtml.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const keyFn = source.match(/function buildQrCacheKey\(person\)\s*\{[\s\S]*?\n {6}\}/)
  const mergeFn = source.match(/function mergeCachedQrSvg\(nextPayload\)\s*\{[\s\S]*?\n {6}\}/)
  expect(keyFn).toBeTruthy()
  expect(mergeFn).toBeTruthy()
  return new Function('DATA', 'nextPayload', `${keyFn![0]}\n${mergeFn![0]}\nmergeCachedQrSvg(nextPayload);`) as (data: Payload, next: Payload) => void
}

describe('日程表の QR 画像の使い回し(mergeCachedQrSvg)', () => {
  const merge = loadEmbeddedMergeCachedQrSvg()

  it('講習期間を切り替えてトークンが変わったら、前の期間の QR 画像を写さない', () => {
    const current: Payload = { students: [{ id: 's095', submissionToken: 'token-old', qrSvg: '<svg>old</svg>' }], teachers: [{ id: 't1', submissionToken: 'tt-old', qrSvg: '<svg>t-old</svg>' }] }
    const next: Payload = { students: [{ id: 's095', submissionToken: 'token-new' }], teachers: [{ id: 't1', submissionToken: 'tt-new' }] }
    merge(current, next)
    expect(next.students[0].qrSvg).toBeUndefined()
    expect(next.teachers[0].qrSvg).toBeUndefined()
  })

  it('同じトークンなら QR 画像を使い回す(作り直しの手間を省く)', () => {
    const current: Payload = { students: [{ id: 's095', submissionToken: 'token-a', qrSvg: '<svg>a</svg>' }], teachers: [] }
    const next: Payload = { students: [{ id: 's095', submissionToken: 'token-a' }], teachers: [] }
    merge(current, next)
    expect(next.students[0].qrSvg).toBe('<svg>a</svg>')
  })

  it('次の表示にトークンがまだ無い(発行待ち)なら前の画像を写さない', () => {
    const current: Payload = { students: [{ id: 's095', submissionToken: 'token-a', qrSvg: '<svg>a</svg>' }], teachers: [] }
    const next: Payload = { students: [{ id: 's095' }], teachers: [] }
    merge(current, next)
    expect(next.students[0].qrSvg).toBeUndefined()
  })
})
