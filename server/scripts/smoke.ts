/**
 * AI gateway smoke test — answers "is this deployment actually wired up?"
 *
 *   npm run smoke
 *
 * Reads configuration from the environment exactly as the gateway does,
 * then checks the two things that can only be verified with real
 * credentials:
 *
 *   1. Firebase Admin can authenticate and read Firestore (read-only —
 *      this script never writes a document).
 *   2. The configured AI provider answers, and honours the "no data access
 *      yet" instruction rather than inventing an occupancy figure.
 *
 * Locally it reads .env (git-ignored). To check a deployed environment,
 * run it with that environment's variables exported.
 *
 * Prints no credential values.
 */
import { adminApp, db } from "../admin";
import {
  getProvider,
  isProviderConfigured,
  resolveProviderConfig,
} from "../ai/provider";

const QUESTION = "What is our occupancy today?";
const NO_DATA_SYSTEM_PROMPT =
  "You are InnPilot AI, a hospitality operations assistant. You currently " +
  "have NO access to this hotel's data — no tools are connected. Never " +
  "state, estimate, or guess any operational or financial figure; say " +
  "plainly that data access is not connected yet.";

async function checkFirestore(): Promise<void> {
  console.log("\n[1/2] Firebase Admin");
  const credentialSource = process.env.FIREBASE_SERVICE_ACCOUNT
    ? "FIREBASE_SERVICE_ACCOUNT"
    : "application default credentials";
  console.log(`  credential source: ${credentialSource}`);

  const hotels = await db.collection("hotels").limit(5).get();
  console.log(
    `  ok — project ${adminApp.options.projectId ?? "(from credential)"}, ` +
      `${hotels.size} hotel(s) readable`
  );
}

async function checkProvider(): Promise<void> {
  console.log("\n[2/2] AI provider");

  if (!isProviderConfigured()) {
    throw new Error("AI_API_KEY is not set in this environment.");
  }

  const config = resolveProviderConfig();
  console.log(
    `  configured: ${config.provider} / ${config.model} ` +
      `(effort ${config.effort}, max ${config.maxTokens} tokens)`
  );

  const started = Date.now();
  const response = await getProvider().generate({
    system: NO_DATA_SYSTEM_PROMPT,
    messages: [{ role: "user", content: QUESTION }],
  });

  console.log(
    `  ok — ${Date.now() - started}ms, served by ${response.model}, ` +
      `stop reason "${response.stopReason}", ` +
      `${response.usage.inputTokens} in / ${response.usage.outputTokens} out`
  );
  console.log(`\n  Q: ${QUESTION}`);
  console.log(`  A: ${response.text}`);
  console.log(
    "\n  Check this by eye: the answer must decline to give a figure. " +
      "A number here means the model is fabricating and the system prompt " +
      "is not holding."
  );
}

try {
  console.log("InnPilot AI — gateway smoke test");
  await checkFirestore();
  await checkProvider();
  console.log("\nAll checks passed.");
} catch (err) {
  // Error messages here can carry request detail; print the shape, not a payload.
  const status = (err as { status?: number }).status;
  const { name, message } = err as Error;
  console.error(`\nFAILED: ${name}${status ? ` (${status})` : ""} — ${message}`);
  process.exitCode = 1;
}
