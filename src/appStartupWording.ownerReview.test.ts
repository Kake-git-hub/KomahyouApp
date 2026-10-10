import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-10 アプリ内文言見直し(オーナー承認)。起動・ログイン・保存失敗・バックアップ画面などで
// 室長に見える文言から開発用語(Firebase / ワークスペース / JSON / IndexedDB / .env など)を外す。
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const app = read('./App.tsx')
const backupRestore = read('./components/backup-restore/BackupRestoreScreen.tsx')
const adminFunctions = read('./integrations/firebase/adminFunctions.ts')
const parentPortalClient = read('./integrations/firebase/parentPortal.ts')
const workspaceStore = read('./integrations/firebase/workspaceStore.ts')
const firebaseClient = read('./integrations/firebase/client.ts')
const appSnapshotRepository = read('./data/appSnapshotRepository.ts')

describe('App.tsx 起動・ログイン(#92〜#105 / #139〜#142)', () => {
  it('#92 仮ログイン画面の「認証方式をまだ確定していない」説明は出さない', () => {
    expect(app).not.toContain('認証方式をまだ確定していない')
    // 画面そのもの(アカウント選択)は残す。
    expect(app).toContain('<h1>仮ログイン</h1>')
  })

  it('#94 / #98 起動直後・二重タブ', () => {
    expect(app).toContain('<p>教室データを準備しています。</p>')
    expect(app).toContain('<p>コマ表は教室ごとに1つのタブでだけ使えます。</p>')
    expect(app).not.toContain('教室ワークスペースを準備')
    expect(app).not.toContain('データの整合性を保つため')
  })

  it('#101 / #102 / #105 ログイン・ログアウトに製品名を出さない', () => {
    expect(app).toContain("'ログインしました。教室データを読み込みます。'")
    expect(app).toContain("'ログインに失敗しました。'")
    expect(app).not.toContain('Firebase へログインしました')
    expect(app).not.toContain('Firebase ログインに失敗')
    expect(app).not.toContain('Firebase からログアウト')
  })

  it('#139〜#142 読み込み完了・失敗', () => {
    expect(app).toContain("'読み込めませんでした。少し待ってから開き直してください。'")
    expect(app).toContain("'教室データを読み込みました。'")
    expect(app).toContain("'教室データの読み込みに失敗しました。'")
    expect(app).not.toContain('現在の初期データで続行します')
    expect(app).not.toContain('教室ワークスペースを読み込みました')
    expect(app).not.toContain('Firebase からの読み込みに失敗')
  })
})

describe('App.tsx 保存失敗・競合の案内(#122 / #130 / #136)', () => {
  it('「バックアップJSON」を出さない', () => {
    expect(app).toContain("'念のためバックアップを自動でダウンロードしました。'")
    expect(app).toContain("'  1. このタブの内容をバックアップに書き出しました（ダウンロードフォルダ）'")
    expect(app).toContain("'保存できなかったため、バックアップを自動ダウンロードしました。'")
    // 文字列リテラル内に残っていないこと(コメント中の説明は対象外)。
    expect(app).not.toMatch(/['`][^'`\n]*バックアップJSON/)
  })
})

describe('App.tsx 確認ダイアログ・登録解除(#146 / #151 / #158)', () => {
  it('#146 登録解除の失敗は生徒・講師の 2 経路とも新文言', () => {
    const matches = app.match(/window\.alert\('登録解除できませんでした。通信状態を確認して、もう一度お試しください。'\)/g) ?? []
    expect(matches).toHaveLength(2)
    expect(app).not.toContain('講習提出のリセット(再提出可能化)に失敗しました')
  })

  it('#151 / #158 確認ダイアログの「？」は全角', () => {
    expect(app).toContain("'復元してよろしいですか？',")
    expect(app).not.toContain("'復元してよろしいですか?',")
    const initialImport = app.slice(app.indexOf("'基本データを初期取り込みします。'"), app.indexOf("'基本データの初期取り込みをキャンセルしました。'"))
    expect(initialImport).toContain("'続行しますか？',")
    expect(initialImport).not.toContain("'続行しますか?',")
  })
})

describe('バックアップ/復元画面(#380〜#394)', () => {
  it('見出し・説明を平易に', () => {
    expect(backupRestore).toContain('<h2>バックアップと初期設定</h2>')
    expect(backupRestore).toContain('バックアップ／復元、初期設定、Excel 管理をまとめています。')
    expect(backupRestore).toContain('<p>いまのデータをファイルに書き出します。</p>')
    expect(backupRestore).toContain('<p>書き出したファイルを読み込んで元に戻します。</p>')
    expect(backupRestore).toContain('<p>運用開始後に使う差分取り込みと Excel ツールです。</p>')
    expect(backupRestore).toContain('自動で取っているバックアップから時点を選び、いま開いている教室を戻します（直近{MANAGER_SELF_RESTORE_WINDOW_DAYS}日分）。')
  })

  it('旧文言(JSON・間引き・開発者目線の説明)を出さない・#391 は削除', () => {
    for (const old of ['データ保全と運用開始準備', 'JSON で書き出します', '書き出した JSON', '間引き', '集約しています', '開始準備と日々の更新を混同しない']) {
      expect(backupRestore, old).not.toContain(old)
    }
  })
})

describe('共通のエラー文(#506〜#518 / #527 / #528)', () => {
  it('#506〜#508 この端末の保存領域', () => {
    expect(appSnapshotRepository).toContain("'この端末の保存領域を開けませんでした。'")
    expect(appSnapshotRepository).toContain("'保存データの読み込みに失敗しました。'")
    expect(appSnapshotRepository).toContain("'保存データの書き込みに失敗しました。'")
    expect(appSnapshotRepository).toContain("'教室データの読み込みに失敗しました。'")
    expect(appSnapshotRepository).toContain("'教室データの書き込みに失敗しました。'")
    for (const old of ['IndexedDB を開けませんでした', '保存済みスナップショットの', "new Error('管理ワークスペース"]) {
      expect(appSnapshotRepository, old).not.toContain(old)
    }
  })

  it('#512 / #513 サーバー未接続(adminFunctions・保護者ポータル client)', () => {
    for (const source of [adminFunctions, parentPortalClient]) {
      expect(source).toContain("'サーバーに接続できません。通信状態を確認してください。'")
      expect(source).not.toContain('Firebase Functions を利用できません')
      expect(source).not.toContain('Firebase Firestore を利用できません')
    }
  })

  it('#514〜#517 起動時(.env・members・docs パスを画面に出さない。開発者向けは console.error に残す)', () => {
    expect(workspaceStore).toContain("'接続設定がされていません。開発者へご連絡ください。'")
    expect(workspaceStore).toContain("'このアカウントはこの教室に登録されていません。開発者へご連絡ください。'")
    expect(workspaceStore).toContain("'教室データが見つかりません。開発者へご連絡ください。'")
    expect(workspaceStore).toContain("'このブラウザでは開けません。Chrome か Edge の最新版でお使いください。'")
    expect(workspaceStore).toContain('console.error(`[workspaceStore] members ドキュメントがありません:')
    expect(workspaceStore).toContain('console.error(`[workspaceStore] workspace ドキュメントがありません:')
    for (const old of [
      'Firebase 設定が不足しています。 .env に接続情報を設定してください。',
      'このユーザーは対象ワークスペースに紐付いていません',
      '対象 workspace が Firestore に見つかりません',
      'Firebase 圧縮スナップショット読込に未対応',
    ]) {
      expect(workspaceStore, old).not.toContain(old)
    }
  })

  it('#518 ログイン状態', () => {
    expect(firebaseClient).toContain("'ログイン状態を確認できません。再ログインしてからもう一度お試しください。'")
    expect(firebaseClient).not.toContain('Firebase のログイン状態が確認できません')
  })

  it('#527 / #528 バックアップの展開', () => {
    expect(adminFunctions).toContain("'バックアップを開けませんでした。'")
    expect(adminFunctions).toContain("'このブラウザでは復元できません。Chrome か Edge の最新版でお使いください。'")
    expect(adminFunctions).not.toContain('サーバーバックアップの展開に失敗')
    expect(adminFunctions).not.toContain('圧縮バックアップの展開に対応していません')
  })
})
