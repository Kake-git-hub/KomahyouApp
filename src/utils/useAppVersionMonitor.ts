import { useEffect, useRef } from 'react'

const VERSION_ENDPOINT = '/version.json'
const RELOAD_GUARD_STORAGE_KEY = 'app-version-auto-reload-guard'

type VersionPayload = {
  version?: unknown
  buildAt?: unknown
}

async function fetchRemoteVersion(): Promise<string | null> {
  try {
    const response = await fetch(`${VERSION_ENDPOINT}?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'omit',
    })
    if (!response.ok) return null
    const payload = (await response.json()) as VersionPayload
    if (typeof payload.version === 'string' && payload.version.trim()) {
      return payload.version.trim()
    }
    return null
  } catch {
    return null
  }
}

function reloadToLatestVersion(version: string) {
  if (typeof window === 'undefined') return
  try {
    const target = new URL(window.location.href)
    target.searchParams.set('v', version)
    window.location.replace(target.toString())
  } catch {
    window.location.reload()
  }
}

/**
 * Checks /version.json once at app open. If the deployed version differs from the
 * loaded bundle version, performs an automatic page reload (?v=<latest>) so the
 * browser fetches the new index.html and assets.
 *
 * A short-lived sessionStorage guard prevents reload loops in case the deployed
 * bundle still reports an older version than version.json (mismatch should self-heal
 * on next deploy, but the guard avoids hammering the page).
 */
export function useAppVersionMonitor(currentVersion: string) {
  const didCheckRef = useRef(false)

  useEffect(() => {
    if (didCheckRef.current) return
    didCheckRef.current = true

    void (async () => {
      const remote = await fetchRemoteVersion()
      if (!remote || remote === currentVersion) return

      // Reload-loop guard: if we already auto-reloaded for this remote version in
      // this tab session, do not reload again.
      try {
        const guard = window.sessionStorage.getItem(RELOAD_GUARD_STORAGE_KEY)
        if (guard === remote) return
        window.sessionStorage.setItem(RELOAD_GUARD_STORAGE_KEY, remote)
      } catch {
        // sessionStorage may be blocked; proceed without guard.
      }

      reloadToLatestVersion(remote)
    })()
  }, [currentVersion])
}
