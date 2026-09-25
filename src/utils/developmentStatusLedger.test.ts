// 進行中テーマ台帳の整合テスト。台帳が実装(機能フラグの scope)と食い違ったまま残るのを防ぐ。

import { describe, expect, it } from 'vitest'

import {
  DEVELOPMENT_STATUS_LEDGER,
  DEVELOPMENT_STATUS_STAGES,
  DEVELOPMENT_STATUS_STAGE_LABELS,
} from './developmentStatusLedger'
import { featureRolloutRegistry } from './featureRollout'

describe('進行中テーマ台帳(developmentStatusLedger)', () => {
  it('id が一意で、全項目が題名・要約・次の一手・根拠・見直し日を持つ', () => {
    const ids = DEVELOPMENT_STATUS_LEDGER.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of DEVELOPMENT_STATUS_LEDGER) {
      expect(entry.id, entry.id).toMatch(/^[a-z0-9-]+$/u)
      expect(entry.title.trim().length, entry.id).toBeGreaterThan(0)
      expect(entry.summary.trim().length, entry.id).toBeGreaterThan(0)
      expect(entry.nextAction.trim().length, entry.id).toBeGreaterThan(0)
      expect(entry.references.length, entry.id).toBeGreaterThan(0)
      expect(entry.updatedOn, entry.id).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
      expect(DEVELOPMENT_STATUS_STAGES, entry.id).toContain(entry.stage)
    }
  })

  it('全段階に日本語ラベルがある', () => {
    for (const stage of DEVELOPMENT_STATUS_STAGES) {
      expect(DEVELOPMENT_STATUS_STAGE_LABELS[stage].trim().length).toBeGreaterThan(0)
    }
  })

  it('紐づく機能フラグは実在し、全教室へ昇格済み(all-classrooms)のフラグを「先行中」の行に残さない', () => {
    for (const entry of DEVELOPMENT_STATUS_LEDGER) {
      for (const key of entry.featureKeys ?? []) {
        const feature = featureRolloutRegistry[key]
        expect(feature, `${entry.id}: ${key}`).toBeDefined()
        // 昇格したのに台帳が「開発用教室で先行中／確認リスト結果待ち／オーナー判断待ち」のままなら台帳の更新漏れ。
        if (entry.stage === 'development-only' || entry.stage === 'awaiting-checklist' || entry.stage === 'awaiting-owner') {
          expect(feature.scope, `${entry.id}: ${key} は昇格済み。台帳の行を消すか段階を変える`).not.toBe('all-classrooms')
        }
      }
    }
  })

  it('development-only / staging-environment のフラグはすべて台帳に載っている(先行機能の取りこぼし防止)', () => {
    const covered = new Set(DEVELOPMENT_STATUS_LEDGER.flatMap((entry) => [...(entry.featureKeys ?? [])]))
    for (const [key, feature] of Object.entries(featureRolloutRegistry)) {
      if (feature.scope === 'all-classrooms') continue
      expect(covered.has(key as never), `${key}(${feature.scope}) を台帳へ載せる`).toBe(true)
    }
  })
})
