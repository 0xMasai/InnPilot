/**
 * Single Firebase Admin app instance, shared by every module in this
 * package — mirrors the frontend's single `db`/`auth` exports in
 * `firebase.ts`, but on the Admin SDK, which bypasses `firestore.rules`
 * entirely. That's expected and fine here: the Permission Guard is what
 * enforces authorization on this side, not the security rules.
 *
 * Initialization is LAZY. The app is built on first use, not at module
 * import, so a missing or malformed FIREBASE_SERVICE_ACCOUNT surfaces as a
 * handled error inside a request (a clean 500 with a request id, logged by
 * the gateway) instead of throwing during import and crashing the whole
 * serverless function with an opaque FUNCTION_INVOCATION_FAILED — which
 * otherwise takes down even the OPTIONS/CORS preflight and every careful
 * error path with it. `db` and `adminApp` remain drop-in exports via lazy
 * proxies, so no call site changes.
 *
 * Credentials are resolved in this order, so the same code runs on a
 * generic serverless host (Vercel/Netlify/etc.) and on Google infra:
 *
 *   1. FIREBASE_SERVICE_ACCOUNT — the service-account JSON itself, as an
 *      environment variable. This is the portable option: most hosts have
 *      no Google metadata server, and a JSON blob in an env var is what
 *      their secret stores accept. Base64 is also accepted, since some
 *      dashboards mangle multi-line values.
 *   2. Application Default Credentials — GOOGLE_APPLICATION_CREDENTIALS
 *      pointing at a key file, or the ambient service account when running
 *      on Google infrastructure. This is the default and needs no config.
 *
 * The service-account key is a full bypass of every security rule in this
 * project. It belongs in the host's secret store, never in the repo — the
 * root .gitignore already blocks `*serviceAccountKey*.json`.
 */
import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import type { App, AppOptions } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { Auth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

function parseServiceAccount(raw: string): Record<string, unknown> {
  const text = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Deliberately does not echo the value — it is a private key.
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is not valid service-account JSON (or base64 of it)."
    );
  }
}

function credentialOptions(): AppOptions {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) {
    return { credential: applicationDefault() };
  }

  const serviceAccount = parseServiceAccount(raw);
  return {
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id as string | undefined,
  };
}

let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;

/**
 * The one Admin app, built on first use and reused thereafter. Any
 * credential problem throws here, at request time, where the gateway's
 * try/catch turns it into a logged, non-opaque failure — never at import.
 */
function ensureApp(): App {
  if (cachedApp) return cachedApp;
  cachedApp = getApps().length ? getApps()[0] : initializeApp(credentialOptions());
  return cachedApp;
}

/** Firestore, lazily. */
export function getDb(): Firestore {
  if (!cachedDb) cachedDb = getFirestore(ensureApp());
  return cachedDb;
}

/** Admin Auth, lazily. */
export function getAdminAuth(): Auth {
  return getAuth(ensureApp());
}

/**
 * Backwards-compatible lazy exports. Every existing `db.collection(...)`,
 * `db.batch()`, `db.runTransaction(...)`, `getAuth(adminApp)` and
 * `adminApp.options` call site keeps working unchanged, but nothing
 * initializes until the first property is read. Methods are bound to the
 * real instance so they run against it (private fields and all).
 */
export const db: Firestore = new Proxy({} as Firestore, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});

export const adminApp: App = new Proxy({} as App, {
  get(_target, prop) {
    const real = ensureApp() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});
