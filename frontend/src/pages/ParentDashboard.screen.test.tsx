/** A saved plan is not the same list as the habits scheduled for today. */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import presentation from "../data/catalogPresentation.json";
import type { DayName, PlanHabit } from "../lib/api";
import { defaultState, startFakeServer } from "../test/fakeServer";
import { renderApp } from "../test/renderApp";

const weekdays: DayName[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const otherDay = weekdays[(new Date().getUTCDay() + 1) % 7];
const sourceGoal = Object.values(presentation.goals)[0];

function twoChildren() {
  const state = defaultState({ pin: null });
  state.children.push({ ...state.children[0], id: "c2", name: "Robin", buddy: "owl" });
  const generated = (child: string, suffix: string, title: string, changes: Partial<PlanHabit> = {}): PlanHabit => ({
    ...state.plans.c1[0], id: `${child}-${suffix}`, habit_id: `my-ai-${suffix}`, title, kid_title: title,
    goal_id: sourceGoal.goalId, icon: "fluent:seedling", ...changes,
  });
  state.plans.c1.push(generated("c1", "garden", "Water my little garden", { days: [otherDay] }));
  state.plans.c1.push(generated("c1", "pause", "My calm corner", { status: "paused" }));
  state.plans.c2 = [generated("c2", "book", "Read a tiny story")];
  state.savedGoals = Object.fromEntries(["c1", "c2"].map(id => [id, [{
    goal_id: sourceGoal.goalId, title: sourceGoal.title, status: "active", reason: null, recommended_habit_ids: [], options: [],
  }]]));
  return state;
}

const childCard = async (name: string) => within(await screen.findByRole("article", { name: `${name}'s dashboard` }));

describe("dashboard assigned plans", () => {
  it("shows two children's own generated and catalog assignments, separating today, other days and paused habits", async () => {
    const server = startFakeServer(twoChildren());
    renderApp("/parent");
    const alex = await childCard("Alex");
    const robin = await childCard("Robin");
    expect(await alex.findByText("4 habits assigned")).toBeInTheDocument();
    expect(await robin.findByText("1 habit assigned")).toBeInTheDocument();
    const today = within(alex.getByRole("region", { name: "Alex's quests today" }));
    expect(today.getByText("Rise and shine")).toBeInTheDocument();
    expect(today.getByText("Sparkly teeth")).toBeInTheDocument();
    expect(today.queryByText("Water my little garden")).not.toBeInTheDocument();
    const upcoming = within(alex.getByRole("region", { name: "Alex's other days" }));
    expect(upcoming.getByText("Water my little garden")).toBeInTheDocument();
    expect(upcoming.queryByText("To do")).not.toBeInTheDocument();
    expect(upcoming.queryByRole("button")).not.toBeInTheDocument();
    const paused = within(alex.getByRole("region", { name: "Alex's paused" }));
    expect(paused.getByText("My calm corner")).toBeInTheDocument();
    expect(paused.queryByText("To do")).not.toBeInTheDocument();
    expect(robin.getByText("Read a tiny story")).toBeInTheDocument();
    expect(robin.queryByText("Water my little garden")).not.toBeInTheDocument();
    expect(alex.queryByText("Read a tiny story")).not.toBeInTheDocument();
    expect(alex.getByText("Age 8 · 0 of 2 today")).toBeInTheDocument();
    expect(robin.getByText("Age 8 · 0 of 1 today")).toBeInTheDocument();
    expect(within(alex.getByRole("list", { name: "Saved goals" })).getByRole("img", { name: sourceGoal.alt })).toHaveAttribute("src", sourceGoal.image);
    expect(server.sent("GET", /\/children\/c[12]\/plan$/)).toHaveLength(2);
    expect(server.calls.filter(call => call.method !== "GET")).toEqual([]);
  });

  it("puts habits before Goals and links each habit by its own goal id, not the first saved goal", async () => {
    const state = twoChildren();
    const secondGoal = Object.values(presentation.goals).find(goal => goal.title !== sourceGoal.title)!;
    const unrelatedGoal = Object.values(presentation.goals).find(goal => goal.title !== sourceGoal.title && goal.title !== secondGoal.title)!;
    state.plans.c1[3].goal_id = secondGoal.goalId;
    state.savedGoals!.c1 = [unrelatedGoal, secondGoal, sourceGoal].map(goal => ({
      goal_id: goal.goalId, title: goal.title, status: "active", reason: null, recommended_habit_ids: [], options: [],
    }));
    const server = startFakeServer(state);
    renderApp("/parent");
    const alex = await childCard("Alex");
    const robin = await childCard("Robin");
    await alex.findByText("4 habits assigned");
    const otherDays = within(alex.getByRole("region", { name: "Alex's other days" }));
    expect(otherDays.getByRole("link", { name: `Goal for Water my little garden: ${sourceGoal.title}` })).toHaveAttribute("href", `#/quests/c1/goal/${sourceGoal.goalId}`);
    const paused = within(alex.getByRole("region", { name: "Alex's paused" }));
    expect(paused.getByRole("link", { name: `Goal for My calm corner: ${secondGoal.title}` })).toHaveAttribute("href", `#/quests/c1/goal/${secondGoal.goalId}`);
    expect(robin.getByRole("link", { name: `Goal for Read a tiny story: ${sourceGoal.title}` })).toHaveAttribute("href", `#/quests/c2/goal/${sourceGoal.goalId}`);
    expect(alex.getAllByRole("heading", { level: 4 }).map(heading => heading.textContent)).toEqual(["Habits", "Today", "Other days", "Paused", "Goals"]);
    const goals = within(alex.getByRole("list", { name: "Saved goals" }));
    expect(goals.getByRole("link", { name: `View ${unrelatedGoal.title} in Alex's plan` })).toHaveTextContent("Saved · no habits yet");
    expect(goals.getByRole("link", { name: `View ${sourceGoal.title} in Alex's plan` })).toHaveTextContent("1 linked habit");
    expect(goals.getByRole("link", { name: `View ${secondGoal.title} in Alex's plan` })).toHaveTextContent("1 linked habit");
    expect(otherDays.queryByText(unrelatedGoal.title)).not.toBeInTheDocument();
    expect(paused.queryByText(sourceGoal.title)).not.toBeInTheDocument();
    server.state.plans.c1 = server.state.plans.c1.filter(habit => habit.habit_id !== "my-ai-garden");
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(alex.getByText("3 habits assigned")).toBeInTheDocument());
    expect(goals.getByRole("link", { name: `View ${sourceGoal.title} in Alex's plan` })).toHaveTextContent("Saved · no habits yet");
    expect(goals.getByRole("link", { name: `View ${secondGoal.title} in Alex's plan` })).toHaveTextContent("1 linked habit");
    expect(robin.getByRole("link", { name: `Goal for Read a tiny story: ${sourceGoal.title}` })).toBeInTheDocument();
  });

  it("never assigns an unrelated saved goal as a fallback when goal details are missing", async () => {
    const state = twoChildren();
    state.plans.c1 = [{ ...state.plans.c1[2], goal_id: "missing-goal" }];
    startFakeServer(state);
    renderApp("/parent");
    const alex = await childCard("Alex");
    await alex.findByText("1 habit assigned");
    const otherDays = within(alex.getByRole("region", { name: "Alex's other days" }));
    expect(otherDays.getByRole("link", { name: "Goal for Water my little garden: Goal details unavailable" })).toHaveAttribute("href", "#/quests/c1/goal/missing-goal");
    expect(otherDays.queryByText(sourceGoal.title)).not.toBeInTheDocument();
    const goals = within(alex.getByRole("list", { name: "Saved goals" }));
    expect(goals.getByRole("link", { name: "View Goal details unavailable in Alex's plan" })).toHaveTextContent("1 linked habit");
    expect(goals.getByRole("link", { name: `View ${sourceGoal.title} in Alex's plan` })).toHaveTextContent("Saved · no habits yet");
  });

  it("keeps assigned habits visible on a rest day without making them actionable today", async () => {
    const state = twoChildren();
    state.plans.c1 = [state.plans.c1[2]];
    startFakeServer(state);
    renderApp("/parent");
    const alex = await childCard("Alex");
    expect(await alex.findByText("1 habit assigned")).toBeInTheDocument();
    expect(alex.getByText("Age 8 · 0 of 0 today")).toBeInTheDocument();
    expect(alex.getByText(/Rest day. Next quests on/)).toBeInTheDocument();
    expect(alex.getByText("Water my little garden")).toBeInTheDocument();
    expect(alex.queryByText("To do")).not.toBeInTheDocument();
    expect(alex.queryByText(/No habits assigned/)).not.toBeInTheDocument();
  });

  it("explains when a second child has saved goals but no assigned habits", async () => {
    const state = twoChildren();
    state.plans.c2 = [];
    startFakeServer(state);
    renderApp("/parent");
    const robin = await childCard("Robin");
    expect(await robin.findByText("0 habits assigned")).toBeInTheDocument();
    expect(robin.getByText(/No habits assigned to Robin yet/)).toBeInTheDocument();
    expect(within(robin.getByRole("list", { name: "Saved goals" })).getByText(sourceGoal.title)).toBeInTheDocument();
    expect(robin.getByText("Saved · no habits yet")).toBeInTheDocument();
    expect(robin.queryByText("Water my little garden")).not.toBeInTheDocument();
  });

  it("refreshes saved assignments on return from the library and after a full reload", async () => {
    const server = startFakeServer(defaultState({ pin: null }));
    const view = renderApp("/quests/c1");
    await view.user.click(await screen.findByRole("button", { name: "Add Read before bed to Alex" }));
    await screen.findByRole("heading", { name: "Alex's quests (3/6)" });
    await view.user.click(screen.getByRole("link", { name: "Dashboard" }));
    let alex = await childCard("Alex");
    expect(await alex.findByText("3 habits assigned")).toBeInTheDocument();
    expect(alex.getByText("Story time")).toBeInTheDocument();

    await view.user.click(alex.getByRole("link", { name: "Quests" }));
    const planPanel = (await screen.findByRole("heading", { name: "Alex's quests (3/6)" })).closest("section")!;
    const row = within(planPanel).getByText("Read before bed").closest("li")!;
    await view.user.click(within(row).getByRole("button", { name: "Remove" }));
    await screen.findByRole("heading", { name: "Alex's quests (2/6)" });
    await view.user.click(screen.getByRole("link", { name: "Dashboard" }));
    alex = await childCard("Alex");
    expect(await alex.findByText("2 habits assigned")).toBeInTheDocument();
    expect(alex.queryByText("Story time")).not.toBeInTheDocument();
    view.unmount();
    renderApp("/parent");
    alex = await childCard("Alex");
    expect(await alex.findByText("2 habits assigned")).toBeInTheDocument();
    expect(alex.getByText("Rise and shine")).toBeInTheDocument();
    expect(server.state.plans.c1).toHaveLength(2);
  });

  it("retains another child's loaded plan when a refresh fails and refreshes assignments on window focus", async () => {
    const server = startFakeServer(twoChildren());
    renderApp("/parent");
    const alex = await childCard("Alex");
    const robin = await childCard("Robin");
    await alex.findByText("4 habits assigned");
    await robin.findByText("1 habit assigned");
    server.state.plans.c1 = server.state.plans.c1.filter(h => h.habit_id !== "my-ai-garden");
    server.on("GET", /\/children\/c2\/(plan|today|extras)$/, () => ({ status: 503, body: { detail: "Temporarily unavailable" } }));
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(alex.getByText("3 habits assigned")).toBeInTheDocument());
    expect(alex.queryByText("Water my little garden")).not.toBeInTheDocument();
    expect(robin.getByText("1 habit assigned")).toBeInTheDocument();
    expect(robin.getByText("Read a tiny story")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Some dashboard details could not be refreshed");
  });

  it("does not blank successful child data when an extras request fails on initial load", async () => {
    const server = startFakeServer(twoChildren());
    server.on("GET", /\/children\/c2\/extras$/, () => ({ status: 503, body: { detail: "Extras unavailable" } }));
    renderApp("/parent");
    const alex = await childCard("Alex");
    const robin = await childCard("Robin");
    expect(await alex.findByText("4 habits assigned")).toBeInTheDocument();
    expect(await robin.findByText("1 habit assigned")).toBeInTheDocument();
    expect(robin.getByText("Read a tiny story")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Extras unavailable");
  });
});
