/** Actual CRUD on an isolated disposable database; fake AI and public buddy images only. */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e", testMatch: "buddy-catalog.spec.ts", fullyParallel: false, workers: 1,
  retries: 0, reporter: "list", timeout: 90_000,
  use: { baseURL: "http://localhost:5182", channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", trace: "off", screenshot: "only-on-failure", actionTimeout: 20_000, navigationTimeout: 30_000,
    reducedMotion: process.env.BUDDY_QA_REDUCED_MOTION === "true" ? "reduce" : "no-preference" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: ".venv/bin/python scripts/run_buddy_browser_api.py", cwd: "../backend", url: "http://127.0.0.1:8002/health/ready", reuseExistingServer: false, timeout: 60_000 },
    { command: "npx vite --port 5182 --strictPort", url: "http://localhost:5182", reuseExistingServer: false, timeout: 60_000,
      env: { VITE_API_URL: "http://127.0.0.1:8002", VITE_BUDDY_CATALOG_ENABLED: "true", VITE_DEV_LOGIN: "true" } },
  ],
});
