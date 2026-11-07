// Test settings for `npm test` (vitest), on top of vite.config.ts. Kept apart because vitest 2 types its
// options against its own copy of Vite, which differs from the app's.
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Keep Node's Web Storage globals from masking jsdom's storage in newer Node releases.
const storageArgs = process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
  ? ["--no-experimental-webstorage"] : [];

export default mergeConfig(viteConfig, defineConfig({
  test: {
    poolOptions: {
      forks: { execArgv: storageArgs },
      threads: { execArgv: storageArgs },
    },
    // Screen tests render pages, so they need a browser-like DOM; the logic tests run in plain Node.
    environmentMatchGlobs: [["src/**/*.screen.test.tsx", "jsdom"]],
    exclude: ["e2e/**", "node_modules/**", "dist/**"], // e2e/ holds the Playwright browser tests
  },
}));
