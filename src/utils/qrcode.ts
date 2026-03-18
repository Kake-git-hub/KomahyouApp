import QRCode from 'qrcode'

export function generateQrSvg(text: string, size = 60): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const modules = qr.modules
  const moduleCount = modules.size
  const cellSize = size / moduleCount
  let paths = ''

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!modules.get(row, col)) continue
      const x = col * cellSize
      const y = row * cellSize
      paths += `M${x},${y}h${cellSize}v${cellSize}h-${cellSize}z`
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><path d="${paths}" fill="#000"/></svg>`
}