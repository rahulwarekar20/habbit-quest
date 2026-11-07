/**
 * Renders the whole app (state provider, router, pages) for a screen test, as main.tsx does, at a given route.
 * Pair it with startFakeServer(): the app's real API client talks to the fake through `fetch`.
 *
 * Importing this file also prepares jsdom for the app: it adds the jest-dom matchers, fills in the browser
 * features jsdom lacks, resets storage, the address and the API client's state after every test, and fails a
 * test whose screens sent a request the fake API does not know.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import App from "../App";
import { resetWakeState } from "../lib/api";
import { clearCoachContext } from "../lib/coachContext";
import { saveCaregiverToken } from "../lib/storage";
import { StoreProvider } from "../lib/store";
import { activeServer, stopFakeServer } from "./fakeServer";

beforeEach(() => {
  // Expanded-buddy journeys opt in explicitly; old screens remain deterministic with local rollout envs.
  vi.stubEnv("VITE_BUDDY_CATALOG_ENABLED", "false");
  localStorage.setItem("habitquest.generation.u1.details", "true");
  // jsdom does not lay pages out or scroll, and has no media queries.
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  const unknown = activeServer()?.unhandled ?? [];
  stopFakeServer();
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
  resetWakeState();
  clearCoachContext();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  // A request the fake doesn't answer means a screen was tested against a 404 it would never get for real.
  if (unknown.length) throw new Error(`The fake API has no route for: ${[...new Set(unknown)].join(", ")}`);
});

/** Opens the app at `route` (e.g. "/parent"), signed in as the fake parent unless `signedIn` is false. */
export function renderApp(route: string, { signedIn = true } = {}) {
  if (signedIn) saveCaregiverToken("parent-token", 3600);
  window.location.hash = route;
  const user = userEvent.setup();
  const view = render(
    <StoreProvider>
      <App />
    </StoreProvider>
  );
  return { user, ...view };
}
