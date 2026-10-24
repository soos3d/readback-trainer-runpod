import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // "server-only" throws outside a React Server bundle; tests get its empty variant.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**", "app/reducer.ts"],
      // Browser-only (getUserMedia, MediaRecorder): checked by hand in the browser, not in Node.
      exclude: ["lib/client/recorder.ts"],
      thresholds: { lines: 80 },
    },
  },
});
