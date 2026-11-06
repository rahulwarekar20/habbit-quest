import "../test/renderApp";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { startFakeServer } from "../test/fakeServer";
import { saveCaregiverToken } from "../lib/storage";
import { generationHistory, recordGeneration, setGenerationOwner } from "../lib/generationPreferences";
import { GenerationSettings } from "./GenerationSettings";
import { GenerationProgress } from "./AiParts";

it("persists seconds per account and keeps real stages visible while timing details are off", () => {
  setGenerationOwner("timing-owner");
  recordGeneration("Habit generation", { state: "complete", elapsedMs: 8400, stages: [{ stage: "habit_generation", elapsed_ms: 10 }, { stage: "complete", elapsed_ms: 8300 }] });
  expect(generationHistory()[0].elapsedMs).toBe(8400);
  setGenerationOwner("someone-else"); expect(generationHistory()).toEqual([]);
  setGenerationOwner("timing-owner"); expect(generationHistory()).toHaveLength(1);
  const view = render(<GenerationProgress timing={{ state: "waiting", elapsedMs: 2400, stages: [{ stage: "embedding", elapsed_ms: 20 }] }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Creating the search embedding");
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  view.rerender(<GenerationProgress timing={{ state: "waiting", elapsedMs: 3400, stages: [{ stage: "embedding", elapsed_ms: 20 }, { stage: "pinecone", elapsed_ms: 2400 }] }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Searching Pinecone");
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
});

it("shows family credits without operator cap controls and remembers the seconds toggle", async () => {
  const server = startFakeServer(); saveCaregiverToken("parent-token", 3600); setGenerationOwner("u1");
  server.on("GET", /\/families\/f1\/ai\/budget$/, () => ({ allowance: 100, used: 6, pending: 2, remaining: 92, overage: 0, reset_at: "2026-11-06T05:00:00Z", enforced: false, show_costs: false, activity_quotes: { coach: 2, habit_batch: 1 }, policy_revision: 1 }));
  act(() => recordGeneration("Habit Coach", { state: "complete", elapsedMs: 12345, stages: [] }));
  const view = render(<GenerationSettings familyId="f1" />);
  await screen.findByLabelText("6 / 100 credits used");
  expect(screen.getByText("2 pending")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "6 of 100 credits used; 92 left; 2 pending");
  expect(screen.getByLabelText("Demo mode · limits are not enforced")).toBeInTheDocument();
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(server.sent("GET", /^\/v1\/ai\/budget$/)).toHaveLength(0);
  expect(server.sent("PATCH", /\/ai\/budget$/)).toHaveLength(0);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox"));
  view.unmount(); render(<GenerationSettings familyId="f1" />);
  expect(screen.getByRole("checkbox")).toBeChecked();
  await waitFor(() => expect(screen.getByText("Response in 12.3s")).toBeInTheDocument());
});
