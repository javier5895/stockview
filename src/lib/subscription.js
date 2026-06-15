import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

// Firestore path: users/{uid}  →  { subscriptionStatus, planId, stripeCustomerId, ... }

export function subscribeSubscription(uid, cb) {
  const ref = doc(db, 'users', uid)
  return onSnapshot(ref, snap => {
    const data = snap.data() ?? {}
    cb({
      status:     data.subscriptionStatus ?? 'free',   // 'free' | 'active' | 'past_due' | 'cancelled'
      planId:     data.planId ?? null,
      customerId: data.stripeCustomerId ?? null,
    })
  })
}

export function isPro(subscription) {
  return subscription?.status === 'active'
}
