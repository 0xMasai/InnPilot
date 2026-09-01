import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure unit tests: no Firestore emulator, no network, no credentials.
    // Tool handlers take their data through the injectable ToolDeps, which
    // is exactly what makes the security properties testable in isolation.
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
