// OAuth を使わずに請求メールを準備するためのヘルパー。
// 請求書PDFはブラウザのダウンロードで保存し、Gmail の作成画面（宛先・件名・本文を事前入力）を
// 新しいタブで開く。PDF はユーザーが作成画面に手動で添付する運用。

export function buildGmailComposeUrl(params: { to: string; subject: string; body: string; cc?: string }) {
  const search = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: params.to,
    su: params.subject,
    body: params.body,
  })
  if (params.cc) search.set('cc', params.cc)
  return `https://mail.google.com/mail/?${search.toString()}`
}

export function openGmailCompose(params: { to: string; subject: string; body: string; cc?: string }) {
  const url = buildGmailComposeUrl(params)
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) {
    throw new Error('Gmail の作成画面を開けませんでした。ブラウザのポップアップブロックを解除してください。')
  }
}

// OAuthで作成した下書きを Gmail で開く（compose ポップアップ表示ですぐ送信できる）。
// messageId は Gmail API の下書き作成レスポンスの message.id（16進のメッセージID）。
export function openGmailDraft(messageId: string) {
  const url = `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(messageId)}`
  // ポップアップブロック時も下書き自体は作成済みのため、失敗しても致命的ではない。
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // クリック直後に revoke すると一部ブラウザでDLが中断するため遅延して解放する。
    window.setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
}
