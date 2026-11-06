/** The saved plan links by child + goal ID, never by the order of nearby goal cards. */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import source from "../../e2e/fixtures/coach-goal.json";
import type { GeneratedHabitDraft } from "../lib/api";
import { defaultState, startFakeServer } from "../test/fakeServer";
import { renderApp } from "../test/renderApp";

const draft: GeneratedHabitDraft = {
  title: "Point to a tricky part", description: "Ask one question.", kid_title: "My little question", kid_hint: "Find a tricky part.",
  instruction: "Point to a tricky part and ask for help.", steps: ["Choose your work.", "Point to a tricky part.", "Ask for help."],
  emoji_key: "speech_balloon", why: "A specific question helps.", parent_setup: "Sit nearby.", strategy: "specific question", estimated_seconds: 60,
  materials: [], help_text: "Can we try this together?", cue: "When homework starts", completion: "You asked for help.", recurrence: "weekly",
  parent_guidance: { prepare: "Keep the work nearby.", coach: "Listen to the question.", if_hard: "Let them point.", observe: "Notice the attempt." },
};

function setup() {
  const state = defaultState({ pin: null });
  state.children.push({ ...state.children[0], id: "c2", name: "Robin" });
  state.plans.c2 = [];
  state.plans.c1.push({ ...state.plans.c1[0], id: "assigned-question", habit_id: "my-ai-question", goal_id: source.goal_id, title: draft.title, kid_title: draft.kid_title });
  state.savedGoals = { c1: [
    { goal_id: "hqg-unrelated", title: "An unrelated saved goal", status: "active", reason: null, recommended_habit_ids: [], options: [] },
    { goal_id: source.goal_id, title: source.title, status: "active", reason: null, recommended_habit_ids: [], options: [] },
  ] };
  const server = startFakeServer(state);
  server.on("GET", /\/children\/c1\/habits\/my-ai-question\/details$/, () => ({ habit_id: "my-ai-question", goal_id: source.goal_id, source: source.source_ref, draft }));
  server.on("GET", /\/children\/c1\/goals\/[^/]+\/source$/, () => source);
  return server;
}

describe("saved plan goal links", () => {
  it("opens only the chosen goal's habits and returns to the full plan without changing assignments", async () => {
    const server = setup();
    const { user } = renderApp("/quests/c1");
    const row = (await screen.findByText(draft.title)).closest("li")!;
    await user.click(within(row).getByRole("link", { name: `Goal: ${source.title}` }));
    const focus = await screen.findByRole("region", { name: "Selected goal" });
    expect(within(focus).getByRole("heading", { name: source.title })).toBeInTheDocument();
    expect(within(focus).getByText("1 habit linked to this goal.")).toBeInTheDocument();
    const panel = screen.getByRole("heading", { name: "Alex's quests (3/6)" }).closest("section")!;
    expect(within(panel).queryByText("Wake up on time")).not.toBeInTheDocument();
    expect(within(panel).getByText(draft.title)).toBeInTheDocument();
    await user.click(within(focus).getByRole("button", { name: "Read goal details" }));
    expect((await within(await screen.findByRole("dialog")).findAllByText(source.kid.description)).length).toBeGreaterThan(0);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("link", { name: "Show all habits" }));
    expect(await within(panel).findByText("Wake up on time")).toBeInTheDocument();
    expect(server.calls.filter(call => call.method !== "GET")).toEqual([]);
  });

  it("shows approved habit media and its exact source goal in a dialog, and does not reuse another child's plan", async () => {
    const server = setup();
    const { user } = renderApp(`/quests/c1/goal/${source.goal_id}`);
    await screen.findByText(draft.title);
    await user.click(screen.getByRole("tab", { name: "By goal" }));
    await user.click(await screen.findByRole("button", { name: "Read habit details" }));
    const dialog = within(await screen.findByRole("dialog", { name: draft.kid_title }));
    expect(await dialog.findByText(draft.instruction)).toBeInTheDocument();
    const goalLink = dialog.getByRole("link", { name: source.kid.title });
    expect(goalLink).toHaveAttribute("href", `#/quests/c1/goal/${source.goal_id}`);
    await user.click(goalLink);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Robin/ }));
    expect(await screen.findByRole("heading", { name: "Robin's quests (0/6)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Read habit details" })).not.toBeInTheDocument();
    expect(server.calls.filter(call => call.method !== "GET")).toEqual([]);
  });

  it("rejects habit details belonging to a different goal instead of showing the wrong goal", async () => {
    const server = setup();
    server.on("GET", /\/children\/c1\/habits\/my-ai-question\/details$/, () => ({ habit_id: "my-ai-question", goal_id: "hqg-other", source: source.source_ref, draft }));
    const { user } = renderApp(`/quests/c1/goal/${source.goal_id}`);
    await user.click(await screen.findByRole("button", { name: "Read habit details" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("do not match this habit's saved goal");
    expect(screen.queryByText(draft.instruction)).not.toBeInTheDocument();
  });

  it("does not substitute another goal when a link is not part of the child's saved plan", async () => {
    setup();
    renderApp(`/quests/c2/goal/${source.goal_id}`);
    expect(await screen.findByText("This goal is not in Robin's saved plan.")).toBeInTheDocument();
    expect(screen.queryByText(draft.title)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Read goal details" })).not.toBeInTheDocument();
  });
});
