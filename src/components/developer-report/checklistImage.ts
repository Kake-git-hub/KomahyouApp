// 確認リストに貼る画像の読み込みと縮小(2026-10-14 オーナー要望「確認リストにスクショで画像毎保存できるようにしたい」)。
//
// スクリーンショット(Win+Shift+S などでクリップボードに入る PNG)は 1 枚で数 MB になるので、長辺 1600px の JPEG に縮めてから
// 下書き(localStorage)・送信(Cloud Function → Storage)へ回す。縮小は canvas で行う。
// DOM(Image / canvas / FileReader)に触る部分は依存を引数で受け取り、純関数の部分(対象ファイルの選別・結果の形)をテストで固定する。

import { DEVELOPER_REPORT_ATTACHMENT_MIME_TYPES, type DeveloperReportAttachmentMimeType } from '../../utils/developerReport'

/** 縮小後の長辺(px)。盤面の文字が読める大きさと、1 枚 1MB 以内の両立。 */
export const CHECKLIST_IMAGE_MAX_EDGE = 1600
/** JPEG の品質。 */
export const CHECKLIST_IMAGE_JPEG_QUALITY = 0.82
/** 貼り付け(ファイル名が無い)ときの表示名。 */
export const CHECKLIST_IMAGE_PASTED_NAME = '貼り付け'

export function isSupportedChecklistImageType(type: string): type is DeveloperReportAttachmentMimeType {
  return (DEVELOPER_REPORT_ATTACHMENT_MIME_TYPES as readonly string[]).includes(type)
}

/** ファイル一覧(input[type=file] の files・貼り付けの clipboardData.files)から画像だけを拾う。 */
export function pickChecklistImageFiles(files: ArrayLike<File> | null | undefined): File[] {
  if (!files) return []
  return Array.from(files).filter((file) => file.type.startsWith('image/'))
}

/** 縮小後のサイズ(長辺を maxEdge に収める・拡大はしない)。 */
export function resolveChecklistImageSize(width: number, height: number, maxEdge: number = CHECKLIST_IMAGE_MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge || longest <= 0) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
  const ratio = maxEdge / longest
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
}

export type ChecklistImageBitmap = { width: number; height: number; source: CanvasImageSource; close?: () => void }

export type ChecklistImageDeps = {
  /** 画像ファイルを描画できる形にする(既定: createImageBitmap)。 */
  loadBitmap: (file: File) => Promise<ChecklistImageBitmap>
  /** 描画先の canvas を作る(既定: document.createElement('canvas'))。 */
  createCanvas: (width: number, height: number) => HTMLCanvasElement
}

function defaultDeps(): ChecklistImageDeps {
  return {
    loadBitmap: async (file) => {
      const bitmap = await createImageBitmap(file)
      return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() }
    },
    createCanvas: (width, height) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      return canvas
    },
  }
}

/**
 * 画像ファイルを長辺 maxEdge の JPEG data URL にする。読めない・描けないときは例外(呼び出し側が理由を出す)。
 * PNG のスクリーンショットも JPEG にする(透過は白地になる・盤面のスクショには十分)。
 */
export async function shrinkChecklistImageToDataUrl(
  file: File,
  deps: ChecklistImageDeps = defaultDeps(),
  options: { maxEdge?: number; quality?: number } = {},
): Promise<{ name: string; dataUrl: string; width: number; height: number }> {
  const bitmap = await deps.loadBitmap(file)
  try {
    const size = resolveChecklistImageSize(bitmap.width, bitmap.height, options.maxEdge ?? CHECKLIST_IMAGE_MAX_EDGE)
    const canvas = deps.createCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('画像を縮小できませんでした(canvas が使えません)。')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(bitmap.source, 0, 0, size.width, size.height)
    const dataUrl = canvas.toDataURL('image/jpeg', options.quality ?? CHECKLIST_IMAGE_JPEG_QUALITY)
    if (!dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('画像を JPEG にできませんでした。')
    return { name: file.name?.trim() || CHECKLIST_IMAGE_PASTED_NAME, dataUrl, width: size.width, height: size.height }
  } finally {
    bitmap.close?.()
  }
}

/** 下書き内で一意な添付 id(時刻＋乱数・個人情報なし)。 */
export function createChecklistAttachmentId(now: number = Date.now(), random: number = Math.random()): string {
  return `att-${now.toString(36)}-${Math.floor(random * 1_679_616).toString(36).padStart(4, '0')}`
}
