import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import live from './firebase-config.json'

const env = import.meta.env
export const emulated = env.VITE_FIREBASE_EMULATORS === 'true'
const config = emulated
  ? {
      apiKey: 'demo-shuon-key',
      authDomain: 'demo-shuon.firebaseapp.com',
      projectId: 'demo-shuon',
      appId: '1:123456:web:demo',
    }
  : {
      apiKey: env.VITE_FIREBASE_API_KEY || live.apiKey,
      projectId: env.VITE_FIREBASE_PROJECT_ID || live.projectId,
      authDomain:
        env.VITE_FIREBASE_AUTH_DOMAIN ||
        (location.hostname === live.projectId + '.web.app' ? location.hostname : live.authDomain),
      appId: env.VITE_FIREBASE_APP_ID || live.appId,
    }
const app = initializeApp(config)
export const auth = getAuth(app)
export const db = getFirestore(app)
if (emulated) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
export async function login() {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  await signInWithPopup(auth, provider)
}
export const logout = () => signOut(auth)
