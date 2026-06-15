import { initializeApp, deleteApp, getApp, getApps } from 'firebase/app'
import { EmailAuthProvider, connectAuthEmulator, getAuth, createUserWithEmailAndPassword, onAuthStateChanged, reauthenticateWithCredential, sendPasswordResetEmail as firebaseSendPasswordResetEmail, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'
import { getFirebaseBackendConfig, isFirebaseAdminFunctionsEnabled } from './config'

const emulatorConnected = { auth: false, firestore: false }

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

function shouldUseEmulators() {
  return typeof import.meta !== 'undefined'
    && import.meta.env?.VITE_FIREBASE_USE_EMULATOR === 'true'
}

export function getFirebaseAuthInstance() {
  const app = getFirebaseApp()
  if (!app) return null
  const auth = getAuth(app)
  if (shouldUseEmulators() && !emulatorConnected.auth) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    emulatorConnected.auth = true
  }
  return auth
}

let firestoreInstance: Firestore | null = null

export function getFirebaseFirestoreInstance() {
  const app = getFirebaseApp()
  if (!app) return null
  if (!firestoreInstance) {
    // 企業プロキシ/ファイアウォール環境では WebChannel ストリームが切断され
    // 「INTERNAL ASSERTION FAILED: Unexpected state」でリスナーが全停止する。
    // autoDetectLongPolling を有効にし、必要な環境だけ long-polling へ自動フォールバックさせる
    // (通常環境は従来通り WebChannel のまま)。initializeFirestore は1度だけ呼べるため
    // 既に初期化済み(HMR等)なら getFirestore にフォールバックする。
    try {
      firestoreInstance = initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
    } catch {
      firestoreInstance = getFirestore(app)
    }
    if (shouldUseEmulators() && !emulatorConnected.firestore) {
      connectFirestoreEmulator(firestoreInstance, '127.0.0.1', 8080)
      emulatorConnected.firestore = true
    }
  }
  return firestoreInstance
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

export async function ensureFirebaseAuthenticatedUser() {
  const auth = getFirebaseAuthInstance()
  const currentUser = auth?.currentUser ?? null
  if (!currentUser) {
    throw new Error('Firebase のログイン状態が確認できません。再ログイン後にもう一度実行してください。')
  }

  await currentUser.getIdToken(true)
  return currentUser
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

export async function sendFirebasePasswordResetEmail(email: string) {
  const auth = getFirebaseAuthInstance()
  if (!auth) throw new Error('Firebase 設定が不足しているため、パスワードリセットメールを送信できません。')
  auth.languageCode = 'ja'
  await firebaseSendPasswordResetEmail(auth, email)
}

export async function reauthenticateFirebaseUser(password: string) {
  const auth = getFirebaseAuthInstance()
  const currentUser = auth?.currentUser
  if (!currentUser || !currentUser.email) {
    throw new Error('Firebase のログイン状態が確認できません。再ログイン後にもう一度実行してください。')
  }
  const credential = EmailAuthProvider.credential(currentUser.email, password)
  await reauthenticateWithCredential(currentUser, credential)
}

export async function createFirebaseAuthUser(email: string, password: string): Promise<string> {
  const config = getFirebaseBackendConfig()
  if (!config.enabled) throw new Error('Firebase 設定が無効のため、ユーザーを作成できません。')

  const secondaryApp = initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
  }, '__provision_' + Date.now())

  try {
    const secondaryAuth = getAuth(secondaryApp)
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password)
    await signOut(secondaryAuth)
    return credential.user.uid
  } finally {
    await deleteApp(secondaryApp)
  }
}