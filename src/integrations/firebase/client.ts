import { initializeApp, getApp, getApps } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'
import { getFirebaseBackendConfig, isFirebaseAdminFunctionsEnabled } from './config'

function getFirebaseApp() {
  const config = getFirebaseBackendConfig()
  if (!config.enabled) return null

  if (getApps().length > 0) return getApp()

  return initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  })
}

export function getFirebaseAuthInstance() {
  const app = getFirebaseApp()
  return app ? getAuth(app) : null
}

export function getFirebaseFirestoreInstance() {
  const app = getFirebaseApp()
  return app ? getFirestore(app) : null
}

export function getFirebaseFunctionsInstance() {
  if (!isFirebaseAdminFunctionsEnabled()) return null

  const app = getFirebaseApp()
  if (!app) return null

  const config = getFirebaseBackendConfig()
  return getFunctions(app, config.functionsRegion)
}

export function getFirebaseCurrentUser() {
  const auth = getFirebaseAuthInstance()
  return auth?.currentUser ?? null
}

export function subscribeToFirebaseAuthChanges(callback: (user: User | null) => void) {
  const auth = getFirebaseAuthInstance()
  if (!auth) return () => {}
  return onAuthStateChanged(auth, callback)
}

export async function signInToFirebaseWithPassword(email: string, password: string) {
  const auth = getFirebaseAuthInstance()
  if (!auth) throw new Error('Firebase 設定が不足しているため、外部ログインを開始できません。')

  const credential = await signInWithEmailAndPassword(auth, email, password)
  return credential.user
}

export async function signOutFromFirebase() {
  const auth = getFirebaseAuthInstance()
  if (!auth) return
  await signOut(auth)
}