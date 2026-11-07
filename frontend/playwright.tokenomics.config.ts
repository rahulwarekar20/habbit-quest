/** Synthetic tokenomics UI verification needs only Vite; every API request is intercepted. */
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e", testMatch: "tokenomics-admin.spec.ts", fullyParallel: false, retries: 0,
  reporter: "list", timeout: 60_000,
  use: { baseURL: "http://localhost:5180", trace: "off", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npx vite --port 5180 --strictPort", url: "http://localhost:5180", reuseExistingServer: true, timeout: 60_000 },
});
