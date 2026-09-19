import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 契約時環境の復旧ワークフロー(.github/workflows/restore-baseline.yml)が、通常デプロイの
// ワークフローとズレていないかを検査する回帰防止テスト。
//
// なぜ必要か: restore-baseline.yml は deploy-firebase-hosting.yml / deploy-functions.yml と
// 同じ「ビルド→env 注入→firebase deploy」を、**指定した ref(契約時タグ)で**行う複製である。
// 今後の改造で通常デプロイ側にだけ必須 secret や必須 VITE 変数が増えると、復旧ワークフローは
// 「いざ本番を戻したいその瞬間」に初めて失敗する(=普段は誰も実行しないので気付けない)。
// ここでズレを CI の赤として即座に見えるようにする。docs/runbooks/contract-baseline-arch.md §8。

const workflowDir = resolve('.github/workflows')
const read = (name) => readFileSync(resolve(workflowDir, name), 'utf8')

const restore = read('restore-baseline.yml')
const hostingDeploy = read('deploy-firebase-hosting.yml')
const functionsDeploy = read('deploy-functions.yml')
const stagingDeploy = read('deploy-staging.yml')
const markStable = read('mark-stable.yml')
const runbook = readFileSync(resolve('docs/runbooks/contract-baseline-arch.md'), 'utf8')

// `${{ secrets.NAME }}` を列挙する。
function secretNames(text) {
  return new Set([...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))
}

// フロント env の fail-closed チェックが要求する VITE キー(required 配列)を取り出す。
function requiredViteKeys(text) {
  const match = text.match(/const required = \[([^\]]+)\]/)
  if (!match) return []
  return [...match[1].matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]).sort()
}

describe('restore-baseline.yml が通常デプロイとズレていないこと', () => {
  it('本番デプロイが使う secret をすべて参照している(新しい secret の取り込み漏れ検知)', () => {
    const restoreSecrets = secretNames(restore)
    for (const name of secretNames(hostingDeploy)) {
      expect(restoreSecrets, `deploy-firebase-hosting.yml の secrets.${name} が restore-baseline.yml に無い`).toContain(name)
    }
    for (const name of secretNames(functionsDeploy)) {
      expect(restoreSecrets, `deploy-functions.yml の secrets.${name} が restore-baseline.yml に無い`).toContain(name)
    }
  })

  it('staging へ復旧するための secret も参照している(訓練経路が死なない)', () => {
    const restoreSecrets = secretNames(restore)
    for (const name of ['STAGING_FIREBASE_WEB_ENV', 'STAGING_FIREBASE_SERVICE_ACCOUNT', 'STAGING_STORAGE_BUCKET']) {
      expect(secretNames(stagingDeploy)).toContain(name)
      expect(restoreSecrets, `staging 用 secrets.${name} が restore-baseline.yml に無い`).toContain(name)
    }
  })

  it('フロント env の必須 VITE キーが本番デプロイと一致する(必須変数の追加漏れ検知)', () => {
    expect(requiredViteKeys(restore)).toEqual(requiredViteKeys(hostingDeploy))
    expect(requiredViteKeys(restore).length).toBeGreaterThan(0)
  })

  it('main を書き換えない(version bump も push もしない)', () => {
    expect(restore).not.toMatch(/bump-version\.mjs/)
    expect(restore).not.toMatch(/git push/)
    expect(restore).not.toMatch(/git commit/)
    // 通常デプロイ側は逆に bump と push を持っている(前提が崩れたらこのテストの意味も変わる)。
    expect(hostingDeploy).toMatch(/bump-version\.mjs/)
    expect(hostingDeploy).toMatch(/git push origin HEAD:main/)
  })

  it('手動実行のみで、push では絶対に発火しない', () => {
    const onBlock = restore.slice(restore.indexOf('\non:'), restore.indexOf('permissions:'))
    expect(onBlock).toMatch(/workflow_dispatch:/)
    expect(onBlock).not.toMatch(/\bpush:/)
    expect(onBlock).not.toMatch(/schedule:/)
  })

  it('本番へ出すには confirm 文字列が必要(誤操作の fail-closed)', () => {
    expect(restore).toMatch(/RESTORE komahyouapp-prod/)
    expect(restore).toMatch(/Guard production confirmation/)
  })

  it('hosting / functions / rules の 3 経路を出せる', () => {
    expect(restore).toMatch(/--only hosting\b/)
    expect(restore).toMatch(/--only functions\b/)
    expect(restore).toMatch(/--only firestore:rules,storage\b/)
  })

  it('ライブ検証(verify-firebase-hosting)を通常デプロイと同じく行う', () => {
    expect(restore).toMatch(/verify-firebase-hosting\.mjs/)
    expect(hostingDeploy).toMatch(/verify-firebase-hosting\.mjs/)
  })

  it('復旧の第一候補 stable を案内している(二段構えの明示)', () => {
    expect(restore).toMatch(/stable/)
    expect(runbook).toMatch(/stable/)
  })

  it('既定 ref が Runbook の契約時タグと一致する', () => {
    const defaultRef = restore.match(/default: '(contract\/[^']+)'/)?.[1]
    expect(defaultRef, 'restore-baseline.yml の ref 既定値が contract/ タグでない').toBeTruthy()
    expect(runbook, `Runbook に ${defaultRef} の記載が無い`).toContain(defaultRef)
    // Runbook の §1 台帳とワークフローが同じタグを指していること(基準点更新時の片側更新を防ぐ)。
    const runbookTag = runbook.match(/基準タグ[^|]*\| \*\*`(contract\/[^`]+)`\*\*/)?.[1]
    expect(runbookTag).toBe(defaultRef)
  })
})

describe('known-good(直近の正常版)の印が仕組みとして成立していること', () => {
  it('本番デプロイが release/vX.Y.Z タグを自動で打つ(版とコミットを Git で結ぶ)', () => {
    expect(hostingDeploy).toMatch(/release\/v\$\{VERSION\}/)
    // デプロイ成功後のタグ付け失敗で run を赤にしない(緑=本当に成功の原則を壊さない)。
    const tagStep = hostingDeploy.slice(hostingDeploy.indexOf('Tag this release'))
    expect(tagStep).toMatch(/continue-on-error: true/)
    // 既存タグは作り直さない(release/* は不動の記録)。
    expect(tagStep).toMatch(/ls-remote --exit-code --tags origin/)
  })

  it('stable は手動ワークフローでだけ進む(push・定期実行では動かない)', () => {
    const onBlock = markStable.slice(markStable.indexOf('\non:'), markStable.indexOf('permissions:'))
    expect(onBlock).toMatch(/workflow_dispatch:/)
    expect(onBlock).not.toMatch(/\bpush:/)
    expect(onBlock).not.toMatch(/schedule:/)
  })

  it('stable を契約時タグへ進めさせない(床を動かさない)', () => {
    expect(markStable).toMatch(/contract\/\*\)/)
    expect(markStable).toMatch(/契約時タグ/)
  })

  it('main の履歴に無いコミットを known-good にしない', () => {
    expect(markStable).toMatch(/merge-base --is-ancestor .* origin\/main/)
  })

  it('stable の更新は印の移動に限る(release\/* と contract\/* を消さない)', () => {
    expect(markStable).toMatch(/git push --force origin refs\/tags\/stable/)
    expect(markStable).not.toMatch(/push .*--delete/)
    expect(markStable).not.toMatch(/tag -d/)
  })
})
