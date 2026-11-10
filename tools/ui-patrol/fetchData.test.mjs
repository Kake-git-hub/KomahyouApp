// tools/ui-patrol/fetchData.mjs(本番のバックアップを読み取りだけで取る)を固定する。
// ★最重要の保証: 道具が出す通信は GET と Firestore の :runQuery への POST だけ。偽の fetch に出た通信を数えて確かめる。
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CLASSROOMS, assertReadOnlyRequest, buildClassroomBackupRequest, buildLatestBackupKeyRequest, fetchClassroomBackup, parseLatestBackupKey,
} from './fetchData.mjs'

const RUN_QUERY = 'https://firestore.googleapis.com/v1/projects/komahyouapp-prod/databases/(default)/documents/workspaces/main:runQuery'
const STORAGE = 'https://storage.googleapis.com/storage/v1/b/komahyouapp-prod.firebasestorage.app/o/'

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer }
}

function bytesResponse(text, status = 200) {
  const bytes = new TextEncoder().encode(text)
  return { ok: status >= 200 && status < 300, status, json: async () => ({}), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}

function latestBody(key = '2026-11-10T23-45', layout = 'per-classroom-v1') {
  return [{ document: { name: `projects/komahyouapp-prod/databases/(default)/documents/workspaces/main/workspaceAutoBackupSummaries/${key}`, fields: { layout: { stringValue: layout } } } }]
}

function makeFakeFetch({ latest = latestBody(), file = bytesResponse('GZ'), fileStatus } = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' })
    if (String(url).endsWith(':runQuery')) return jsonResponse(latest)
    return fileStatus ? bytesResponse('', fileStatus) : file
  }
  return { fetchImpl, calls }
}

describe('assertReadOnlyRequest(読み取りだけ)', () => {
  it('読み取りだけ: GET と :runQuery への POST は通す', () => {
    expect(() => assertReadOnlyRequest({ url: `${STORAGE}x?alt=media`, method: 'GET' })).not.toThrow()
    expect(() => assertReadOnlyRequest({ url: RUN_QUERY, method: 'POST' })).not.toThrow()
  })

  it('読み取りだけ: PUT・PATCH・DELETE・ほかの POST(例 :commit・cloudfunctions.net)は throw', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(() => assertReadOnlyRequest({ url: `${STORAGE}x`, method })).toThrow()
    }
    expect(() => assertReadOnlyRequest({ url: 'https://firestore.googleapis.com/v1/projects/komahyouapp-prod/databases/(default)/documents:commit', method: 'POST' })).toThrow()
    expect(() => assertReadOnlyRequest({ url: 'https://firestore.googleapis.com/v1/projects/komahyouapp-prod/databases/(default)/documents:batchWrite', method: 'POST' })).toThrow()
    expect(() => assertReadOnlyRequest({ url: 'https://asia-northeast1-komahyouapp-prod.cloudfunctions.net/saveClassroomSnapshotViaFunction', method: 'POST' })).toThrow()
    expect(() => assertReadOnlyRequest({ url: `${STORAGE}x`, method: 'POST' })).toThrow()
  })

  it('読み取りだけ: 知らないホストは throw(GET でも)', () => {
    expect(() => assertReadOnlyRequest({ url: 'https://example.com/x', method: 'GET' })).toThrow()
    expect(() => assertReadOnlyRequest({ url: 'https://evil.googleapis.com.example.com/x', method: 'GET' })).toThrow()
    expect(() => assertReadOnlyRequest({ url: 'not a url', method: 'GET' })).toThrow()
  })

  it('読み取りだけ: メソッドの大文字小文字・省略でごまかせない', () => {
    expect(() => assertReadOnlyRequest({ url: `${STORAGE}x`, method: 'put' })).toThrow()
    expect(() => assertReadOnlyRequest({ url: `${STORAGE}x` })).not.toThrow()
  })
})

describe('最新の時点とバックアップの取得', () => {
  it('既定の教室は本番 2 校', () => {
    expect(DEFAULT_CLASSROOMS.map((room) => room.id)).toEqual(['5w5OMueETerSKrSf14HC', 'KzFnOQoTFLsCxwUp1tvh'])
  })

  it('最新の時点: runQuery の結果から key と layout を読む。結果が空なら null', () => {
    expect(parseLatestBackupKey(latestBody('2026-11-10T23-45'))).toEqual({ key: '2026-11-10T23-45', layout: 'per-classroom-v1' })
    expect(parseLatestBackupKey([{ readTime: '2026-11-10T00:00:00Z' }])).toBeNull()
    expect(parseLatestBackupKey([])).toBeNull()
    expect(parseLatestBackupKey(null)).toBeNull()
    const request = buildLatestBackupKeyRequest()
    expect(request.method).toBe('POST')
    expect(request.url).toBe(RUN_QUERY)
    expect(JSON.parse(request.body).structuredQuery.limit).toBe(1)
  })

  it('教室ファイルの要求は Storage の GET(alt=media・パスは符号化)', () => {
    const request = buildClassroomBackupRequest('2026-11-10T23-45', '5w5OMueETerSKrSf14HC')
    expect(request.method).toBe('GET')
    expect(request.url).toBe(`${STORAGE}${encodeURIComponent('workspace-auto-backups/main/15min/2026-11-10T23-45/5w5OMueETerSKrSf14HC.json.gz')}?alt=media`)
  })

  it('取得: 偽の fetch に出た通信は :runQuery 1 回と GET 1 回だけ。key 指定なら GET 1 回だけ', async () => {
    const latest = makeFakeFetch()
    const result = await fetchClassroomBackup({ token: 't', classroomId: '5w5OMueETerSKrSf14HC', fetchImpl: latest.fetchImpl })
    expect(result.key).toBe('2026-11-10T23-45')
    expect(Buffer.from(result.buffer).toString()).toBe('GZ')
    expect(latest.calls.map((call) => call.method)).toEqual(['POST', 'GET'])
    expect(latest.calls[0].url.endsWith(':runQuery')).toBe(true)

    const pinned = makeFakeFetch()
    await fetchClassroomBackup({ token: 't', classroomId: '5w5OMueETerSKrSf14HC', key: '2026-11-09T03-00', fetchImpl: pinned.fetchImpl })
    expect(pinned.calls).toHaveLength(1)
    expect(pinned.calls[0].method).toBe('GET')
    expect(pinned.calls[0].url).toContain(encodeURIComponent('15min/2026-11-09T03-00/'))
  })

  it('取得: layout が教室別でない・HTTP 403・最新が無いは分かる文で throw', async () => {
    const legacy = makeFakeFetch({ latest: latestBody('2026-11-10T23-45', 'legacy') })
    await expect(fetchClassroomBackup({ token: 't', classroomId: 'c', fetchImpl: legacy.fetchImpl })).rejects.toThrow('教室別の形ではありません')
    const denied = makeFakeFetch({ fileStatus: 403 })
    await expect(fetchClassroomBackup({ token: 't', classroomId: 'c', key: '2026-11-10T23-45', fetchImpl: denied.fetchImpl })).rejects.toThrow('403')
    const partial = makeFakeFetch({ fileStatus: 206 })
    await expect(fetchClassroomBackup({ token: 't', classroomId: 'c', key: '2026-11-10T23-45', fetchImpl: partial.fetchImpl })).rejects.toThrow('206')
    const noContent = makeFakeFetch({ fileStatus: 204 })
    await expect(fetchClassroomBackup({ token: 't', classroomId: 'c', key: '2026-11-10T23-45', fetchImpl: noContent.fetchImpl })).rejects.toThrow('204')
    const empty = makeFakeFetch({ latest: [] })
    await expect(fetchClassroomBackup({ token: 't', classroomId: 'c', fetchImpl: empty.fetchImpl })).rejects.toThrow('最新')
  })
})
