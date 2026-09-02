import "dotenv/config";
import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function main() {
  const email = process.argv[2] || "test@innpilot.com";
  const password = process.argv[3] || "Password123!";

  console.log(`Attempting to create or authenticate test user: ${email}`);

  let user;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    user = cred.user;
    console.log(`✓ User created successfully with UID: ${user.uid}`);
  } catch (err: any) {
    if (err.code === "auth/email-already-in-use") {
      console.log(`User already exists, attempting to sign in...`);
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        user = cred.user;
        console.log(`✓ User signed in successfully with UID: ${user.uid}`);
      } catch (signInErr: any) {
        console.error("Sign-in error:", signInErr.message);
        process.exit(1);
      }
    } else {
      console.error("Failed to create user:", err.message);
      process.exit(1);
    }
  }

  if (user) {
    try {
      const userRef = doc(db, "users", user.uid);
      await setDoc(
        userRef,
        {
          uid: user.uid,
          email: user.email,
          name: "Test Administrator",
          role: "super_admin",
          hotelId: "hotel_demo_01",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      console.log(`✓ Firestore users/${user.uid} document updated/verified as super_admin.`);
    } catch (dbErr: any) {
      console.warn("Notice when writing user document (may require admin SDK or rules):", dbErr.message);
    }
  }

  console.log(`\n========================================`);
  console.log(`Credentials:`);
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
  console.log(`========================================\n`);
}

main().catch(console.error);
