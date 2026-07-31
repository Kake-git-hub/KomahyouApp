#!/usr/bin/env node
// INV-06 の修正（2026-07-31・移動しただけの振替コマを休みにすると未消化振替から消滅する）で、
// **どの生徒のどのコマが未消化振替に戻るか**を配信前に洗い出す読み取り専用スクリプト。
//
// 使い方:
//   1) アプリの「バックアップ/復元」画面で対象教室を開き、「バックアップを書き出す」で JSON を保存する
//      （書き出しは読み取りのみ。Firestore へは何も書きません）
//   2) node tools/vanished-makeup-report.mjs <保存したJSON> [<別教室のJSON> ...] [--csv 出力先.csv]
//
// 出力: 生徒・科目ごとの増分と、その内訳（休みにした日／振替元日／増える・増えない理由）。
// 判定は盤面画面と同じ計算（buildMakeupStockEntries）を修正前後の2通りで回した差分。
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ENTRY_PATH = path.join(import.meta.dirname, 'vanishedMakeupReportEntry.ts')

function parseArgs(argv) {
  const files = []
  let csvPath = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--csv') {
      csvPath = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') return { help: true, files, csvPath }
    files.push(arg)
  }
  return { help: false, files, csvPath }
}

async function loadReporter() {
  const { build } = await import('esbuild')
  // 出力先はリポジトリ配下（node_modules/.cache）に置く。依存パッケージは external のままにするので、
  // 実行時に repo の node_modules から解決される必要があるため（tmpdir に置くと解決できない）。
  const outDir = await mkdtemp(path.join(import.meta.dirname, '..', 'node_modules', '.cache', 'vanished-makeup-'))
  const outfile = path.join(outDir, 'report.mjs')
  await build({
    entryPoints: [ENTRY_PATH],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
    loader: { '.css': 'empty' },
    // qrcode / xlsx などの CJS パッケージはバンドルすると dynamic require で落ちるため外に出す。
    packages: 'external',
  })
  const module = await import(pathToFileURL(outfile).href)
  return { buildReportFromSnapshot: module.buildReportFromSnapshot, cleanup: () => rm(outDir, { recursive: true, force: true }) }
}

function formatSlot(row) {
  return row.absentSlotNumber ? `${row.absentDateKey} ${row.absentSlotNumber}限` : row.absentDateKey
}

function printReport(label, report) {
  console.log(`\n================ ${label} ================`)
  console.log(`未消化振替が増えるコマ: ${report.increasedTotal} コマ / 対象生徒(科目単位): ${report.totals.length} 件`)

  if (report.totals.length > 0) {
    console.log('\n--- 生徒・科目ごとの増分 ---')
    console.table(report.totals.map((total) => ({
      生徒: total.studentName,
      科目: total.subject,
      修正前の残: total.balanceBefore,
      修正後の残: total.balanceAfter,
      増分: total.increase,
    })))
  }

  if (report.rows.length > 0) {
    console.log('\n--- 休みにした振替コマの内訳（全件） ---')
    console.table(report.rows.map((row) => ({
      生徒: row.studentName,
      科目: row.subject,
      休みにしたコマ: formatSlot(row),
      振替元: row.makeupSourceLabel ?? row.makeupSourceDate,
      増える: row.willIncrease ? '○' : '',
      理由: row.reason,
    })))
  } else {
    console.log('\n休みにされた振替コマはありませんでした（この教室では未消化振替は増えません）。')
  }
}

function toCsv(reportsByLabel) {
  const header = ['教室', '生徒', '科目', '休みにした日', '限', '振替元日', '振替元ラベル', '増える', '理由']
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const lines = [header.map(escape).join(',')]
  for (const [label, report] of reportsByLabel) {
    for (const row of report.rows) {
      lines.push([
        label, row.studentName, row.subject, row.absentDateKey, row.absentSlotNumber ?? '',
        row.makeupSourceDate, row.makeupSourceLabel ?? '', row.willIncrease ? '○' : '', row.reason,
      ].map(escape).join(','))
    }
  }
  return `﻿${lines.join('\n')}\n`
}

async function main() {
  const { help, files, csvPath } = parseArgs(process.argv.slice(2))
  if (help || files.length === 0) {
    console.log('使い方: node tools/vanished-makeup-report.mjs <バックアップJSON> [...] [--csv 出力先.csv]')
    process.exitCode = help ? 0 : 1
    return
  }

  const { buildReportFromSnapshot, cleanup } = await loadReporter()
  const reportsByLabel = []
  try {
    for (const file of files) {
      const snapshot = JSON.parse(await readFile(file, 'utf8'))
      // 書き出し JSON に教室名フィールドは無いので、日程表ヘッダの校舎名→ファイル名の順で見出しにする。
      const label = snapshot.classroomSettings?.scheduleHeader?.schoolName || path.basename(file)
      const report = buildReportFromSnapshot(snapshot)
      reportsByLabel.push([label, report])
      printReport(label, report)
    }
  } finally {
    await cleanup()
  }

  const grandTotal = reportsByLabel.reduce((sum, [, report]) => sum + report.increasedTotal, 0)
  console.log(`\n合計: ${grandTotal} コマが未消化振替に戻ります（対象 ${reportsByLabel.length} 教室）。`)

  if (csvPath) {
    await writeFile(csvPath, toCsv(reportsByLabel), 'utf8')
    console.log(`CSV を書き出しました: ${csvPath}`)
  }
}

await main()
