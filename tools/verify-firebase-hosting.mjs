import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      result[key] = 'true'
      continue
    }
    result[key] = next
    index += 1
  }
  return result
}

function readDefaultProjectId() {
  try {
    const text = readFileSync(resolve('.firebaserc'), 'utf8')
    const config = JSON.parse(text)
    return config.projects?.default?.trim() || ''
  } catch {
    return ''
  }
}

function extractAssetPaths(indexHtml) {
  const matches = indexHtml.match(/\/(assets\/[^"']+\.(?:js|css))/g) ?? []
  return Array.from(new Set(matches.map((match) => (match.startsWith('/') ? match : `/${match}`))))
}

async function sleep(ms) {
  await new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
    },
  })

  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
    cacheControl: response.headers.get('cache-control') ?? '',
    lastModified: response.headers.get('last-modified') ?? '',
  }
}

async function verifyOnce({ siteUrl, distDir }) {
  const localIndexHtml = readFileSync(resolve(distDir, 'index.html'), 'utf8')
  const assetPaths = extractAssetPaths(localIndexHtml)
  if (assetPaths.length === 0) {
    throw new Error('Local dist/index.html does not contain any hashed asset paths.')
  }

  const probeUrl = `${siteUrl.replace(/\/$/, '')}/?deployCheck=${Date.now()}`
  const liveIndex = await fetchText(probeUrl)
  if (!liveIndex.ok) {
    throw new Error(`Fetching live index failed (${liveIndex.status}).`)
  }

  const missingAssets = assetPaths.filter((assetPath) => !liveIndex.text.includes(assetPath))
  if (missingAssets.length > 0) {
    throw new Error(`Live index does not reference the latest build assets yet. Missing: ${missingAssets.join(', ')}. cache-control=${liveIndex.cacheControl || '(none)'} last-modified=${liveIndex.lastModified || '(none)'}`)
  }

  if (!/(no-store|no-cache|max-age=0)/i.test(liveIndex.cacheControl)) {
    throw new Error(`Live index cache-control is still stale-friendly: ${liveIndex.cacheControl || '(none)'}`)
  }

  return {
    assetPaths,
    cacheControl: liveIndex.cacheControl,
    lastModified: liveIndex.lastModified,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const projectId = args.project?.trim() || readDefaultProjectId() || 'komahyouapp-prod'
  const siteUrl = args.site?.trim() || `https://${projectId}.web.app`
  const distDir = args.dist?.trim() || 'dist'
  const retries = Math.max(0, Number(args.retries ?? '20'))
  const retryDelayMs = Math.max(250, Number(args.retryDelayMs ?? '3000'))

  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await verifyOnce({ siteUrl, distDir })
      console.log(`Firebase Hosting live verification passed: site=${siteUrl} cache-control=${result.cacheControl} last-modified=${result.lastModified} assets=${result.assetPaths.length}`)
      return
    } catch (error) {
      lastError = error
      if (attempt === retries) break
      const message = error instanceof Error ? error.message : String(error)
      console.log(`Live verification pending (${attempt + 1}/${retries + 1}): ${message}`)
      await sleep(retryDelayMs)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})