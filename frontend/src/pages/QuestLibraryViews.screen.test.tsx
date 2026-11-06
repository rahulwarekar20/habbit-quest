/** The optional goal view preserves exact assignment links and the default quest controls. */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import source from "../../e2e/fixtures/coach-goal.json";
import type { PlanGoal } from "../lib/api";
import { defaultState, startFakeServer } from "../test/fakeServer";
import { renderApp } from "../test/renderApp";

const saved = (goal_id: string, title: string): PlanGoal => ({
  goal_id, title, status: "active", reason: null, recommended_habit_ids: [], options: [],
});

function setup() {
  const state = defaultState({ pin: null });
  state.children.push({ ...state.children[0], id: "c2", name: "Robin" });
  state.plans.c2 = [];
  state.savedGoals = { c1: [saved(source.goal_id, source.title), saved("same-title", source.title),
    saved("empty-goal", "A goal for later"), { ...saved("suggested-only", "Not in the plan"), status: "suggested" }] };
  const base = state.plans.c1[0];
  state.plans.c1.push(
    { ...base, id: "question", habit_id: "my-ai-question", goal_id: source.goal_id, title: "Ask about a tricky part" },
    { ...base, id: "other", habit_id: "other", goal_id: "same-title", title: "Another goal's quest" },
    { ...base, id: "orphan", habit_id: "orphan", goal_id: "missing-goal", title: "Keep my saved quest" },
  );
  return startFakeServer(state);
}

describe("Quest Library view tabs", () => {
  it("defaults to Quests and supports keyboard switching without writing or generating", async () => {
    const server = setup();
    const { user } = renderApp("/quests/c1");
    const quests = await screen.findByRole("tab", { name: "Quests", selected: true });
    expect(await screen.findByRole("heading", { name: "Alex's quests (5/6)" })).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel", { name: "Quests" })).getAllByRole("listitem")).toHaveLength(5);
    quests.focus();
    await user.keyboard("{ArrowRight}");
    const goals = screen.getByRole("tab", { name: "By goal", selected: true });
    expect(goals).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "By goal" })).toBeInTheDocument();
    await user.keyboard("{Home}");
    expect(quests).toHaveFocus();
    expect(quests).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}{ArrowLeft}");
    expect(quests).toHaveFocus();
    expect(quests).toHaveAttribute("aria-selected", "true");
    expect(server.calls.filter(call => call.method !== "GET")).toEqual([]);
    expect(server.calls.some(call => /habit-drafts|\/source$/.test(call.path))).toBe(false);
  });

  it("groups by exact IDs, keeps empty goals and missing metadata, and reads the matching source", async () => {
    const server = setup();
    server.on("GET", /\/children\/c1\/goals\/[^/]+\/source$/, () => source);
    const { user } = renderApp("/quests/c1");
    await screen.findByText("Ask about a tricky part");
    await user.click(screen.getByRole("tab", { name: "By goal" }));
    const sameName = screen.getAllByRole("article", { name: source.title });
    expect(sameName).toHaveLength(2);
    const question = within(sameName.find(card => within(card).queryByText("Ask about a tricky part"))!);
    expect(question.queryByText("Another goal's quest")).not.toBeInTheDocument();
    expect(question.getByText("Ages 6–8")).toBeInTheDocument();
    expect(question.getByRole("img", { name: /Ask one learning question/ })).toHaveAttribute("src", expect.stringContaining(".512.png"));
    expect(within(screen.getByRole("article", { name: "A goal for later" })).getByText("No quests assigned to this goal yet.")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Not in the plan" })).not.toBeInTheDocument();
    const missing = within(screen.getByRole("article", { name: "Goal details unavailable" }));
    expect(missing.getByText("Keep my saved quest")).toBeInTheDocument();
    expect(missing.getByText(/Goal information is unavailable/)).toBeInTheDocument();
    await user.click(question.getByRole("button", { name: "Read goal details" }));
    expect((await within(await screen.findByRole("dialog")).findAllByText(source.kid.description)).length).toBeGreaterThan(0);
    expect(server.sent("GET", /\/source$/)[0].path).toContain(`/children/c1/goals/${source.goal_id}/source`);
    expect(server.calls.filter(call => call.method !== "GET")).toEqual([]);
  });

  it("edits schedules, pauses, resumes, adds and removes quests while preserving the other view", async () => {
    const server = startFakeServer(defaultState({ pin: null }));
    server.state.savedGoals = { c1: [saved("keep-empty", "Keep this empty goal")] };
    const { user } = renderApp("/quests/c1");
    await screen.findByRole("heading", { name: "Alex's quests (2/6)" });
    await user.click(screen.getByRole("tab", { name: "By goal" }));
    const group = within(screen.getByRole("article", { name: "Smoother mornings" }));
    const row = within(group.getByText("Wake up on time").closest("li")!);
    fireEvent.change(row.getByLabelText("Time for Wake up on time"), { target: { value: "08:10" } });
    fireEvent.blur(row.getByLabelText("Time for Wake up on time"));
    await waitFor(() => expect(server.state.plans.c1[0].cue_time).toBe("08:10"));
    await user.selectOptions(row.getByLabelText("Days for Wake up on time"), "School days");
    await waitFor(() => expect(server.state.plans.c1[0].days).toEqual(["mon", "tue", "wed", "thu", "fri"]));
    await user.click(row.getByRole("button", { name: "Pause" }));
    expect(await row.findByText(/Paused/)).toBeInTheDocument();
    await user.click(row.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(row.queryByText(/Paused/)).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Add Read before bed to Alex" }));
    const bedtime = within(await screen.findByRole("article", { name: "Calmer bedtimes" }));
    expect(bedtime.getByText("Read before bed")).toBeInTheDocument();
    await user.click(bedtime.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Calmer bedtimes" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: "Quests" }));
    const flat = within(screen.getByRole("tabpanel", { name: "Quests" }));
    expect(flat.getByLabelText("Time for Wake up on time")).toHaveValue("08:10");
    expect(flat.getByLabelText("Days for Wake up on time")).toHaveValue("School days");
    expect(flat.queryByText("Read before bed")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "By goal" }));
    expect(screen.getByRole("article", { name: "Keep this empty goal" })).toBeInTheDocument();
    expect(server.sent("PUT", /\/plan$/)).toEqual([]);
  });

  it("keeps goal-focused links filtered in both views and resets to Quests for another child", async () => {
    const server = setup();
    const { user } = renderApp(`/quests/c1/goal/${source.goal_id}`);
    await screen.findByText("Ask about a tricky part");
    await user.click(screen.getByRole("tab", { name: "By goal" }));
    expect(within(screen.getByRole("tabpanel")).getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByText("Another goal's quest")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Show all habits" }));
    expect(await screen.findByText("Another goal's quest")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Robin/ }));
    expect(await screen.findByRole("heading", { name: "Robin's quests (0/6)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Quests", selected: true })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "By goal" }));
    expect(screen.getByText(/No goals in this plan yet/)).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("Ask about a tricky part")).not.toBeInTheDocument();
    expect(server.calls.filter(call => call.method !== "GET")).toEqual([]);
  });
});
