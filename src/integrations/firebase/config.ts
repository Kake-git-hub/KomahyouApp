export type ExternalBackendMode = 'local' | 'firebase'

export type FirebaseBackendConfig = {
  mode: ExternalBackendMode
  enabled: boolean
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
  workspaceKey: string
  adminFunctionsEnabled: boolean
  functionsRegion: string
}

function readEnvValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function getFirebaseBackendConfig(): FirebaseBackendConfig {
  const explicitMode = readEnvValue(import.meta.env.VITE_EXTERNAL_BACKEND_MODE).toLowerCase()
  const apiKey = readEnvValue(import.meta.env.VITE_FIREBASE_API_KEY)
  const authDomain = readEnvValue(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN)
  const projectId = readEnvValue(import.meta.env.VITE_FIREBASE_PROJECT_ID)
  const storageBucket = readEnvValue(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET)
  const messagingSenderId = readEnvValue(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID)
  const appId = readEnvValue(import.meta.env.VITE_FIREBASE_APP_ID)
  const workspaceKey = readEnvValue(import.meta.env.VITE_FIREBASE_WORKSPACE_KEY)
  const adminFunctionsEnabled = readEnvValue(import.meta.env.VITE_FIREBASE_ENABLE_FUNCTIONS).toLowerCase() === 'true'
  const functionsRegion = readEnvValue(import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION) || 'asia-northeast1'
  const enabled = explicitMode === 'local'
    ? false
    : explicitMode === 'firebase' || Boolean(apiKey && authDomain && projectId && appId && workspaceKey)

  return {
    mode: enabled ? 'firebase' : 'local',
    enabled,
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    workspaceKey,
    adminFunctionsEnabled,
    functionsRegion,
  }
}

export function isFirebaseBackendEnabled() {
  return getFirebaseBackendConfig().enabled
}

export function isFirebaseAdminFunctionsEnabled() {
  const config = getFirebaseBackendConfig()
  return config.enabled && config.adminFunctionsEnabled
}