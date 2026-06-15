import { initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut,
  onAuthStateChanged,
  updatePassword,
} from 'firebase/auth'
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'

// ─── Paste your Firebase project config here ──────────────────────────────
// console.firebase.google.com → your project → Project Settings → Your apps
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app  = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db   = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()

// ─── Auth helpers ──────────────────────────────────────────────────────────
export const signInGoogle     = () => signInWithPopup(auth, googleProvider)
export const signInEmail      = (email, pw) => signInWithEmailAndPassword(auth, email, pw)
export const signUpEmail      = (email, pw) => createUserWithEmailAndPassword(auth, email, pw)
export const resetPassword        = (email) => sendPasswordResetEmail(auth, email)
export const updateUserPassword   = (newPw)  => updatePassword(auth.currentUser, newPw)
export const logOut           = () => signOut(auth)
export const onAuthChange = (cb) => onAuthStateChanged(auth, async (user) => {
  if (user) {
    const ref = doc(db, 'users', user.uid)
    const snap = await getDoc(ref)
    if (!snap.exists()) {
      await setDoc(ref, {
        email: user.email,
        subscriptionStatus: 'free',
        createdAt: serverTimestamp(),
      })
    }
  }
  cb(user)
})

// Magic link (email code)
const ACTION_CODE_SETTINGS = {
  url: window.location.origin + '/?emailSignIn=1',
  handleCodeInApp: true,
}
export const sendMagicLink = (email) => {
  localStorage.setItem('emailForSignIn', email)
  return sendSignInLinkToEmail(auth, email, ACTION_CODE_SETTINGS)
}
export const completeMagicLink = () => {
  if (!isSignInWithEmailLink(auth, window.location.href)) return Promise.resolve(null)
  let email = localStorage.getItem('emailForSignIn')
  if (!email) email = window.prompt('Please enter your email to confirm sign-in:')
  return signInWithEmailLink(auth, email, window.location.href)
    .then(r => { localStorage.removeItem('emailForSignIn'); return r })
}
