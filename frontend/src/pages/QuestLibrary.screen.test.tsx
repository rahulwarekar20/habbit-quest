/** Screen tests: the Quest library, where a grown-up adds, pauses and removes a child's quests. */
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defaultState, PIN, startFakeServer } from "../test/fakeServer";
import { renderApp } from "../test/renderApp";

const questsPanel = async (count: string) => {
  const heading = await screen.findByRole("heading", { name: `Alex's quests (${count})` });
  return within(heading.closest("section")!);
};

describe("the Quest library", () => {
  it("lists the child's quests with their times", async () => {
    startFakeServer();
    renderApp("/quests/c1");

    const panel = await questsPanel("2/6");
    expect(panel.getByText("Wake up on time")).toBeInTheDocument();
    expect(panel.getByLabelText("Time for Brush teeth")).toHaveValue("07:15");
  });

  it("adds one quest with the PIN while preserving saved empty goals and paused schedules", async () => {
    const server = startFakeServer();
    server.state.plans.c1[0].status = "paused";
    server.state.plans.c1[0].days = ["mon", "wed"];
    const paused = structuredClone(server.state.plans.c1[0]);
    const savedGoal = { goal_id: "hqg-saved", title: "An independently saved goal", status: "active" as const, reason: null, recommended_habit_ids: [], options: [] };
    server.state.savedGoals = { c1: [savedGoal] };
    const { user } = renderApp("/quests/c1");

    await user.click(await screen.findByRole("button", { name: "Add Read before bed to Alex" }));
    expect(server.sent("POST", /\/children\/c1\/habits$/)).toHaveLength(0);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("4-digit PIN"), PIN);
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    const panel = await questsPanel("3/6");
    expect(panel.getByText("Read before bed")).toBeInTheDocument();
    expect(await screen.findByText("Read before bed added to Alex's quests.")).toBeInTheDocument();
    expect(server.sent("POST", /\/children\/c1\/habits$/).map(c => c.body)).toEqual([{ habit_id: "story-time", pin: PIN }]);
    expect(server.sent("PUT", /\/children\/c1\/plan$/)).toHaveLength(0);
    expect(server.sent("PATCH", /\/child-habits\//)).toHaveLength(0);
    expect(server.state.savedGoals.c1).toEqual([savedGoal]);
    expect(server.state.plans.c1[0]).toEqual(paused);
    expect(server.state.plans.c1.map(h => h.habit_id)).toEqual(["wake", "brush-teeth", "story-time"]);
    expect(panel.getByLabelText("Time for Read before bed")).toHaveValue("19:30");
  });

  it("does not add a quest when the parent cancels the PIN", async () => {
    const server = startFakeServer();
    const { user } = renderApp("/quests/c1");
    await user.click(await screen.findByRole("button", { name: "Add Read before bed to Alex" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(server.sent("POST", /\/children\/c1\/habits$/)).toHaveLength(0);
    expect(server.state.plans.c1).toHaveLength(2);
  });

  it("adds without a PIN when the family has disabled it", async () => {
    const server = startFakeServer(defaultState({ pin: null }));
    const { user } = renderApp("/quests/c1");
    await user.click(await screen.findByRole("button", { name: "Add Read before bed to Alex" }));
    await questsPanel("3/6");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.sent("POST", /\/children\/c1\/habits$/)[0].body).toEqual({ habit_id: "story-time" });
  });

  it("pauses and resumes a quest", async () => {
    const server = startFakeServer();
    const { user } = renderApp("/quests/c1");

    const row = within((await (await questsPanel("2/6")).findByText("Wake up on time")).closest("li")!);
    await user.click(row.getByRole("button", { name: "Pause" }));
    expect(await row.findByText(/Paused/)).toBeInTheDocument();
    await user.click(row.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(row.queryByText(/Paused/)).not.toBeInTheDocument());

    expect(server.sent("PATCH", /\/child-habits\/c1-wake$/).map((c) => c.body)).toEqual([{ status: "paused" }, { status: "active" }]);
  });

  it("removes a quest", async () => {
    const server = startFakeServer();
    const { user } = renderApp("/quests/c1");

    const row = within((await (await questsPanel("2/6")).findByText("Brush teeth")).closest("li")!);
    await user.click(row.getByRole("button", { name: "Remove" }));

    const panel = await questsPanel("1/6");
    expect(panel.queryByText("Brush teeth")).not.toBeInTheDocument();
    expect(server.state.plans.c1.map((h) => h.habit_id)).toEqual(["wake"]);
  });

  it("shows the server's reason when a change is refused", async () => {
    const server = startFakeServer();
    server.on("PATCH", /\/child-habits\//, () => ({ status: 422, body: { detail: "A plan can have at most 6 active quests." } }));
    const { user } = renderApp("/quests/c1");

    const row = within((await (await questsPanel("2/6")).findByText("Wake up on time")).closest("li")!);
    await user.click(row.getByRole("button", { name: "Pause" }));

    expect(await screen.findByText("A plan can have at most 6 active quests.")).toBeInTheDocument();
    expect(row.queryByText(/Paused/)).not.toBeInTheDocument();
  });
});
