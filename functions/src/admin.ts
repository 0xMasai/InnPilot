/**
 * Single Firebase Admin app instance, shared by every module in this
 * package — mirrors the frontend's single `db`/`auth` exports in
 * `firebase.ts`, but on the Admin SDK, which bypasses `firestore.rules`
 * entirely. That's expected and fine here: the Permission Guard is what
 * enforces authorization on this side, not the security rules.
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
import type { AppOptions } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

export const adminApp = getApps().length ? getApps()[0] : initializeApp(credentialOptions());
export const db = getFirestore(adminApp);
