import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { memoryLocalCache, initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "local-development-placeholder",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "localhost",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "innpilot-dev",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "innpilot-dev.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "000000000000",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:000000000000:web:000000000000",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);

// Explicitly use Firestore's memory-only cache. The web SDK already defaults
// to memory cache when no persistent cache is configured, but making this
// explicit prevents a future persistence change from causing development
// records to survive a reload unexpectedly.
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
});

if (import.meta.env.DEV) {
  console.info("[Firebase runtime]", {
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
    storageBucket: firebaseConfig.storageBucket,
    firestoreCache: "memory-only",
  });
}

export const auth = getAuth(app);
export const storage = getStorage(app);
