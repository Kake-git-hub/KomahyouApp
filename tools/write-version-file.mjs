import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const distDir = resolve('dist')
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true })
}
const payload = {
  version: pkg.version,
  buildAt: new Date().toISOString(),
}
writeFileSync(resolve(distDir, 'version.json'), JSON.stringify(payload, null, 2), 'utf8')
console.log(`Wrote dist/version.json (version=${payload.version})`)
