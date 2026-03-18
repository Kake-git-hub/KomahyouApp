export function getMemoLineCount(label: string) {
  return Math.max(1, label.replace(/\r/g, '').split('\n').length)
}

export function getMemoLineHeight(fontSize: number) {
  if (fontSize <= 6) return 1.08
  if (fontSize <= 7) return 1.12
  return 1.16
}

export function getMemoFontSize(label: string) {
  const normalized = label.replace(/\r/g, '')
  const lines = getMemoLineCount(normalized)
  const longestLine = Math.max(...normalized.split('\n').map((line) => line.length), 0)
  const effectiveLength = Math.max(longestLine, Math.ceil(normalized.length / Math.min(lines, 2)))

  if (effectiveLength <= 8) return 9
  if (effectiveLength <= 12) return 8
  if (effectiveLength <= 16) return 7
  if (effectiveLength <= 22) return 6
  return 5.4
}

export function getMemoTextMetrics(label: string) {
  const fontSize = getMemoFontSize(label)
  return {
    fontSize,
    lineHeight: getMemoLineHeight(fontSize),
  }
}

export function getMemoTextStyle(label: string) {
  const { fontSize, lineHeight } = getMemoTextMetrics(label)
  return {
    fontSize: `${fontSize}px`,
    lineHeight: String(lineHeight),
  }
}