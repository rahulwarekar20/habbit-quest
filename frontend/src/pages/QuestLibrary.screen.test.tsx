/** Screen tests: the Quest library, where a grown-up adds, pauses and removes a child's quests. */
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { startFakeServer } from "../test/fakeServer";
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

  it("adds a quest from Add quests, with its goal", async () => {
    const server = startFakeServer();
    const { user } = renderApp("/quests/c1");

    await user.click(await screen.findByRole("button", { name: "Add Read before bed to Alex" }));

    const panel = await questsPanel("3/6");
    expect(panel.getByText("Read before bed")).toBeInTheDocument();
    expect(await screen.findByText("Read before bed added to Alex's quests.")).toBeInTheDocument();
    const [put] = server.sent("PUT", /\/children\/c1\/plan$/);
    expect(put.body).toMatchObject({ goals: expect.arrayContaining(["mornings", "bedtime"]) });
    expect((put.body as { habits: { habit_id: string }[] }).habits.map((h) => h.habit_id)).toEqual(["wake", "brush-teeth", "story-time"]);
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
