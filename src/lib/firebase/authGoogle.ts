import {
  browserLocalPersistence,
  getRedirectResult,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth'
import { DRIVE_OAUTH_SCOPE_URLS } from '../drive/driveOAuthScopes'
import { isRnWebViewEmbed } from '../drive/googleAuth'
import { getFirebaseAuth } from './init'

const REDIRECT_PENDING = 'REDIRECT_PENDING'

export class FirebaseGoogleRedirectPending extends Error {
  constructor() {
    super(REDIRECT_PENDING)
    this.name = 'FirebaseGoogleRedirectPending'
  }
}

function googleProvider(): GoogleAuthProvider {
  const p = new GoogleAuthProvider()
  /* Sem `prompt`: re-login costuma ser silencioso se a sessão Google já autorizou o app. */
  p.addScope('profile')
  p.addScope('email')
  /* Mesmo fluxo OAuth do Firebase: token do Drive vem em `credentialFromResult` → um popup a menos. */
  for (const s of DRIVE_OAUTH_SCOPE_URLS) {
    p.addScope(s)
  }
  return p
}

/** Resultado do login Google no Firebase (inclui access token OAuth quando os escopos foram aceitos). */
export type FirebaseGoogleSignIn = {
  user: User
  oauthAccessToken: string | null
}

/** Sessão Firebase persiste entre visitas (local). Chame cedo no app. */
export async function ensureFirebaseAuthPersistence(): Promise<void> {
  await setPersistence(getFirebaseAuth(), browserLocalPersistence)
}

export async function signInWithGoogle(): Promise<FirebaseGoogleSignIn> {
  const auth = getFirebaseAuth()
  await ensureFirebaseAuthPersistence()
  const provider = googleProvider()

  if (isRnWebViewEmbed()) {
    await signInWithRedirect(auth, provider)
    throw new FirebaseGoogleRedirectPending()
  }

  const result = await signInWithPopup(auth, provider)
  const cred = GoogleAuthProvider.credentialFromResult(result)
  return {
    user: result.user,
    oauthAccessToken: cred?.accessToken ?? null,
  }
}

/** Após `signInWithRedirect`, chamar na página de login. */
export async function completeGoogleRedirectSignIn(): Promise<FirebaseGoogleSignIn | null> {
  const auth = getFirebaseAuth()
  await ensureFirebaseAuthPersistence()
  const result = await getRedirectResult(auth)
  if (!result) return null
  const cred = GoogleAuthProvider.credentialFromResult(result)
  return {
    user: result.user,
    oauthAccessToken: cred?.accessToken ?? null,
  }
}

export async function signOutFirebase(): Promise<void> {
  try {
    await signOut(getFirebaseAuth())
  } catch {
    /* ignore */
  }
}

export function isRedirectPendingError(e: unknown): boolean {
  return e instanceof FirebaseGoogleRedirectPending
}
