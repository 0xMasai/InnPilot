import { build } from "esbuild";

await build({
  entryPoints: ["functions/ai-chat.ts"],
  outfile: "api/ai-chat.js",

  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",          // matches api/package.json {"type":"commonjs"}; inlines jose
  sourcemap: false,

  // Inline firebase-admin (and jwks-rsa + jose) so there is NO runtime require(ESM).
  // Externalize only the heavy Google Cloud packages esbuild can't bundle cleanly;
  // they are CJS, have no jose problem, and Vercel includes them via require tracing.
  external: ["@google-cloud/firestore", "@google-cloud/storage"],
});

console.log("✓ Bundled functions/ai-chat.ts -> api/ai-chat.js");