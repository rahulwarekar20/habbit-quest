/** Coach response timings include reset waits after Send, and exclude historical replies. */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachMessage, CoachReply, CoachThread } from "../lib/api";
import { markCoachFresh } from "../lib/storage";
import { startFakeServer } from "../test/fakeServer";
import { renderApp } from "../test/renderApp";

let clock = 0;

beforeEach(() => {
  clock = 0;
  Element.prototype.scrollTo = vi.fn();
  // Keep user interactions and screen queries on real time; only response-clock ticks are controlled.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const message = (id: number, role: CoachMessage["role"], content: string): CoachMessage => ({
  id, role, content, sources: [], no_habit_match: false, created_at: new Date().toISOString(),
});

function coachApi(initial: CoachMessage[] = [], delayReset = false) {
  startFakeServer();
  const otherFetch = globalThis.fetch;
  let thread: CoachThread = { messages: initial, suggestions: [] };
  let finishReset!: () => void;
  const reset = new Promise<void>((resolve) => { finishReset = resolve; });
  const pending: { text: string; resolve: (reply: Response) => void }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    if (!new URL(url, "http://api.test").pathname.endsWith("/coach/messages")) return otherFetch(url, init);
    if (init.method === "DELETE") {
      if (delayReset) { delayReset = false; await reset; }
      thread = { messages: [], suggestions: [] };
      return new Response(null, { status: 204 });
    }
    if (init.method === "POST") {
      const text = (JSON.parse(init.body as string) as { text: string }).text;
      return new Promise<Response>((resolve) => pending.push({ text, resolve }));
    }
    return new Response(JSON.stringify(thread));
  });
  return {
    pending, finishReset,
    answer(text: string) {
      const call = pending.shift()!;
      const nextId = (thread.messages.at(-1)?.id ?? 0) + 1;
      thread = { messages: [...thread.messages, message(nextId, "parent", call.text), message(nextId + 1, "coach", text)], suggestions: [] };
      const reply: CoachReply = { ...thread, reply: text, safety: null, mapped_by: "ai" };
      call.resolve(new Response(JSON.stringify(reply)));
    },
  };
}

function send(text: string) {
  fireEvent.change(screen.getByLabelText("Message the habit coach"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

describe("coach response seconds", () => {
  it("suggests a setting from the message, sends it, and respects a parent's override", async () => {
    const server = startFakeServer();
    server.on("GET", /\/coach\/messages$/, () => ({ messages: [], suggestions: [] }));
    server.on("POST", /\/coach\/messages$/, () => ({ messages: [], suggestions: [], reply: "A small step.", safety: null, mapped_by: "ai" }));
    const { user } = renderApp("/coach/c1");
    markCoachFresh("c1");
    const input = await screen.findByLabelText("Message the habit coach");
    fireEvent.change(input, { target: { value: "Screen time is hard to stop" } });
    expect(screen.getByRole("radio", { name: "Online" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(server.sent("POST", /\/coach\/messages$/)[0].body).toMatchObject({ setting: "online" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Home" })).toBeEnabled());
    await user.click(screen.getByRole("radio", { name: "Home" }));
    fireEvent.change(input, { target: { value: "Screen time again" } });
    expect(screen.getByRole("radio", { name: "Home" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(server.sent("POST", /\/coach\/messages$/)[1].body).toMatchObject({ setting: "home" }));
  });

  it("includes the initial reset, retains each reply's duration and clears on New chat", async () => {
    const api = coachApi([], true);
    renderApp("/coach/c1");
    await screen.findByLabelText("Message the habit coach");
    await act(async () => send("Bedtime is difficult."));

    clock = 5000;
    act(() => vi.advanceTimersByTime(5000));
    expect(api.pending).toHaveLength(0);
    expect(screen.getByRole("timer")).toHaveTextContent("Waiting 5.0s");
    await act(async () => api.finishReset());
    await waitFor(() => expect(api.pending).toHaveLength(1));
    expect(screen.getByRole("timer")).toHaveTextContent("Waiting 5.0s");

    clock = 6100;
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("timer")).toHaveTextContent("Waiting 6.1s");
    clock = 6240;
    await act(async () => api.answer("Try a short wind-down routine."));
    expect(await screen.findByText("Response in 6.2s")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();

    await act(async () => send("Something easier, please."));
    await waitFor(() => expect(api.pending).toHaveLength(1));
    clock = 6950;
    await act(async () => api.answer("Start with one small step."));
    expect(await screen.findByText("Response in 0.7s")).toBeInTheDocument();
    expect(screen.getByText("Response in 6.2s")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await waitFor(() => expect(screen.queryByText(/Response in/)).not.toBeInTheDocument());
  });

  it("does not invent timings for historical replies and shows failed request time", async () => {
    const api = coachApi([message(1, "parent", "Earlier question"), message(2, "coach", "Earlier answer")]);
    renderApp("/coach/c1");
    markCoachFresh("c1");
    expect(await screen.findByText("Earlier answer")).toBeInTheDocument();
    expect(screen.queryByText(/Response in/)).not.toBeInTheDocument();
    await act(async () => send("A new question."));
    await waitFor(() => expect(api.pending).toHaveLength(1));
    clock = 1800;
    await act(async () => api.pending.shift()!.resolve(new Response(JSON.stringify({ detail: "Service unavailable" }), { status: 500 })));
    expect(await screen.findByText("Request failed after 1.8s")).toBeInTheDocument();
    expect(screen.getByLabelText("Message the habit coach")).toHaveValue("A new question.");
    expect(screen.getByText("Earlier answer")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
});
