import { generationHistory, setGenerationOwner } from "../lib/generationPreferences";
import type { ProgressListener } from "../lib/api/generationProgress";
/** Screen checks for response seconds: live waits, settled requests and timer cleanup. */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResponseTime, useResponseTimer } from "./AiParts";

let clock = 0;

beforeEach(() => {
  setGenerationOwner("timer-test");
  localStorage.setItem("habitquest.generation.timer-test.details", "true");
  clock = 0;
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function Timer({ request }: { request: (onProgress: ProgressListener) => Promise<void> }) {
  const { timing, measure, clear } = useResponseTimer();
  return <>
    <button onClick={() => { void measure(request).catch(() => {}); }}>Request</button>
    <button onClick={clear}>Clear</button>
    <ResponseTime timing={timing} />
  </>;
}

describe("response time", () => {
  it("shows elapsed seconds quietly and freezes the final round-trip time", async () => {
    const request = deferred();
    render(<Timer request={() => request.promise} />);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(screen.getByRole("timer")).toHaveTextContent("Waiting 0.0s");
    expect(screen.getByRole("timer")).toHaveAttribute("aria-live", "off");

    clock = 2300;
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("timer")).toHaveTextContent("Waiting 2.3s");
    clock = 2480;
    await act(async () => request.resolve());
    expect(screen.getByText("Response in 2.5s")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    clock = 8000;
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByText("Response in 2.5s")).toBeInTheDocument();
  });

  it("times a failure, then starts a new request from zero", async () => {
    const failed = deferred();
    const next = deferred();
    const request = vi.fn().mockReturnValueOnce(failed.promise).mockReturnValueOnce(next.promise);
    render(<Timer request={request} />);
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    clock = 1600;
    await act(async () => failed.reject(new Error("Unavailable")));
    expect(screen.getByText("Request failed after 1.6s")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(screen.queryByText(/failed after/)).not.toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("Waiting 0.0s");
    clock = 1950;
    await act(async () => next.resolve());
    expect(screen.getByText("Response in 0.3s")).toBeInTheDocument();
  });

  it("clears a wait and ignores its eventual completion", async () => {
    const request = deferred();
    render(<Timer request={() => request.promise} />);
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    clock = 5000;
    await act(async () => request.resolve());
    expect(screen.queryByText(/Response in/)).not.toBeInTheDocument();
  });

  it("removes the ticking interval when the screen unmounts", async () => {
    const request = deferred();
    let progress!: ProgressListener;
    const { unmount } = render(<Timer request={onProgress => { progress = onProgress; return request.promise; }} />);
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    setGenerationOwner("another-account");
    progress({ stage: "saving", elapsed_ms: 2000 });
    clock = 2200;
    await act(async () => request.resolve());
    expect(vi.getTimerCount()).toBe(0);
    expect(generationHistory("timer-test")[0]).toMatchObject({ elapsedMs: 2200, stages: [{ stage: "saving", elapsed_ms: 2000 }] });
    expect(generationHistory("another-account")).toEqual([]);
  });
});
