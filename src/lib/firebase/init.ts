import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { isFirebaseConfigured } from './env'

let appInstance: FirebaseApp | null = null

function firebaseOptions() {
  return {
    apiKey: (import.meta.env.VITE_FIREBASE_API_KEY ?? '').trim(),
    authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim(),
    projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '').trim(),
    storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '').trim(),
    messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '').trim(),
    appId: (import.meta.env.VITE_FIREBASE_APP_ID ?? '').trim(),
  }
}

export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase não configurado (faltam VITE_FIREBASE_* no .env).')
  }
  if (!appInstance) {
    appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseOptions())
  }
  return appInstance
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp())
}

export function getFirebaseDb(): Firestore {
  return getFirestore(getFirebaseApp())
}
