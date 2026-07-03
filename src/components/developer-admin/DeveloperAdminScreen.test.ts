import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RESTORE_MODAL_IRREVERSIBLE_WARNING } from './DeveloperAdminScreen'

describe('サーバーバックアップ復元モーダルの不可逆警告 (spec-save-restore §4・仕様監査 領域2 A3・2026-07-04)', () => {
  it('警告文言が「上書き」と「元に戻せません」を明示する(仕様の警告必須要件)', () => {
    expect(RESTORE_MODAL_IRREVERSIBLE_WARNING).toContain('上書き')
    expect(RESTORE_MODAL_IRREVERSIBLE_WARNING).toContain('元に戻せません')
  })

  it('復元選択モーダルが警告定数を表示している(定義に加えJSX内で使用されている)', () => {
    const source = readFileSync(new URL('./DeveloperAdminScreen.tsx', import.meta.url), 'utf8')
    const usages = source.split('RESTORE_MODAL_IRREVERSIBLE_WARNING').length - 1
    // 1回目=定数定義、2回目以降=モーダルでの表示。表示側が消えたらここで検知する。
    expect(usages).toBeGreaterThanOrEqual(2)
  })
})
