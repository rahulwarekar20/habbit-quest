import { setGenerationOwner } from "../lib/generationPreferences";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { GuidanceText } from "./GuidanceText";
import { GenerationProgress } from "./AiParts";

afterEach(cleanup);
beforeEach(() => { setGenerationOwner("guidance-test"); localStorage.setItem("habitquest.generation.guidance-test.details", "true"); });

it("keeps numbered steps, follow-up text and bullets in the reviewed order without interpreting HTML", () => {
  const { container } = render(<GuidanceText text={'Start small.\n1. Choose a cue.\n2. Try one step.\nAsk for help.\n- Pause when needed.\n<img src=x onerror=alert(1)>'} />);
  expect([...container.firstElementChild!.children].map((el) => el.tagName)).toEqual(["P", "OL", "P", "UL", "P"]);
  expect(screen.getAllByRole("list")).toHaveLength(2);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
});

it("shows server-confirmed stages and elapsed time, with no simulated progress", () => {
  const { rerender } = render(<GenerationProgress timing={{ state: "waiting", elapsedMs: 20000 }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for the server");
  expect(screen.getByRole("timer")).toHaveTextContent("20.0s");
  rerender(<GenerationProgress timing={{ state: "waiting", elapsedMs: 25000, stages: [{ stage: "embedding", elapsed_ms: 50 }, { stage: "pinecone", elapsed_ms: 1550 }] }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Searching Pinecone");
  expect(screen.getByText("1.5s")).toBeInTheDocument();
  expect(screen.queryByText("Writing guidance and selecting goals")).not.toBeInTheDocument();
});
