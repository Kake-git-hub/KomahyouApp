// バックアップ取り込み時のファイル読み取り。Google Drive のミラーは gzip(.json.gz)で保存される(2026-09-04・
// 15GB 上限対策)ため、解凍せずそのまま取り込めるようにする。判定は拡張子ではなく **gzip のマジックバイト**
// (1f 8b)で行う(拡張子を付け替えられても正しく扱う)。非圧縮の JSON は従来どおりテキストとして読む。

const GZIP_MAGIC = [0x1f, 0x8b] as const

export function isGzipBytes(head: Uint8Array): boolean {
  return head.length >= 2 && head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1]
}

export async function readBackupFileText(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  if (!isGzipBytes(head)) return file.text()
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('このブラウザは gzip の解凍に対応していません。解凍してから読み込んでください。')
  }
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}
