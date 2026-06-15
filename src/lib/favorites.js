import {
  doc, collection, setDoc, deleteDoc,
  onSnapshot, serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'

// Firestore path: users/{uid}/favorites/{ticker}

function favRef(uid, ticker) {
  return doc(db, 'users', uid, 'favorites', ticker.toUpperCase())
}

export function addFavorite(uid, ticker, name) {
  return setDoc(favRef(uid, ticker), {
    ticker: ticker.toUpperCase(),
    name,
    addedAt: serverTimestamp(),
  })
}

export function removeFavorite(uid, ticker) {
  return deleteDoc(favRef(uid, ticker))
}

// Returns an unsubscribe function; calls cb with { map: {ticker: {name}}, set: Set }
export function subscribeFavorites(uid, cb) {
  const ref = collection(db, 'users', uid, 'favorites')
  return onSnapshot(ref, snap => {
    const map = {}
    snap.docs.forEach(d => { map[d.id] = d.data() })
    cb({ map, set: new Set(Object.keys(map)) })
  })
}
