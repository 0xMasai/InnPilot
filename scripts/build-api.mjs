import { build } from "esbuild";

await build({
  entryPoints: ["api/ai-chat.ts"],
  outfile: "dist/api/ai-chat.js",

  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",

  sourcemap: true,

  external: [
    "firebase-admin",
    "node:*"
  ],

  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);'
  }
});

console.log("✓ Bundled api/ai-chat");