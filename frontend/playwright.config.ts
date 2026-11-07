/**
 * Browser tests (Playwright): the real app in Chromium against the real backend and database, with the backend's
 * fake AI. `npm run e2e` starts the API on :8000 and the dev server on :5180 unless they are already running
 * (locally they usually are; in CI they are always started fresh).
 *
 * The backend needs DEV_LOGIN=true, a JWT_SECRET and a database with the migrations applied (backend/.env
 * locally, the workflow's env in CI). Each test signs in as a new development-login parent, so tests never share
 * a family. See e2e/helpers.ts for where the shared password comes from.
 */
import { defineConfig, devices } from "@playwright/test";

const API = "http://127.0.0.1:8000";
const APP = "http://localhost:5180"; // localhost, not 127.0.0.1: the API's CORS setting allows this origin

export default defineConfig({
  testDir: "e2e",
  // The buddy suite starts its own API and app (playwright.buddies.config.ts), so it is left out here.
  testIgnore: ["buddy-catalog.spec.ts"],
  fullyParallel: false, // one shared API and its sign-in rate limit; the tests are few and quick
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  use: {
    baseURL: APP,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "uv run python -m uvicorn habitquest_backend.main:app --host 127.0.0.1 --port 8000",
      cwd: "../backend",
      url: `${API}/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npx vite --port 5180 --strictPort",
      url: APP,
      reuseExistingServer: !process.env.CI,
      env: { VITE_API_URL: API, VITE_DEV_LOGIN: "true" },
      timeout: 120_000,
    },
  ],
});
