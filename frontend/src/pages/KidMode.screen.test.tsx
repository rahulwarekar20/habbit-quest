import catalog from "../data/catalogPresentation.json";
/** Screen tests: kid mode, from handing over the device to "I did it!" and back to the grown-ups' pages. */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PIN, startFakeServer } from "../test/fakeServer";
import { renderApp } from "../test/renderApp";

const questCard = async (kidTitle: string) =>
  within((await screen.findByRole("heading", { name: kidTitle })).closest("article")!);

describe("kid mode", () => {
  it("loads accepted generated steps with the kid token and displays only child wording", async () => {
    const server = startFakeServer();
    const habit = server.state.plans.c1[0];
    habit.habit_id = "my-ai-example";
    const goal = catalog.goals["learning-homework--ask-about-one-stuck-spot--a6-8"];
    let detailToken: string | null = null;
    server.on("GET", /\/kid\/habits\/my-ai-example\/details$/, (_m, _body, token) => {
      detailToken = token;
      return { habit_id: habit.habit_id, goal_id: goal.goalId, title: habit.kid_title,
        instruction: "Choose one small step together.", steps: ["Point to a tricky part.", "Ask for help."],
        materials: ["Paper"], cue: "When you start", completion: "You asked for help.", help_text: "Can we try together?",
        parent_guidance: "Private parent coaching must not render.",
      };
    });
    const { user } = renderApp("/parent");
    await user.click(await screen.findByRole("button", { name: "Open kid mode" }));
    const card = await questCard("Rise and shine");

    expect(await card.findByText("Point to a tricky part.")).toBeInTheDocument();
    expect(detailToken).toBe("kid:c1");
    const reference = card.getByRole("complementary", { name: "Your goal" });
    expect(within(reference).getByText(goal.title)).toBeInTheDocument();
    expect(within(reference).getByRole("img")).toHaveAttribute("src", goal.image);
    expect(screen.queryByText("Private parent coaching must not render.")).not.toBeInTheDocument();
    await user.click(card.getByText("Things to have ready and help"));
    expect(server.sent("GET", /\/details$/)).toHaveLength(1);
  });

  it("opens today's quests for the only child, and sends I did it! with the kid token", async () => {
    const server = startFakeServer();
    const { user } = renderApp("/parent");

    await user.click(await screen.findByRole("button", { name: "Open kid mode" }));
    const card = await questCard("Rise and shine");
    await user.click(card.getByRole("button", { name: "I did it!" }));

    expect(await card.findByText("Waiting for a grown-up")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/kid/c1");
    expect(server.state.status["c1-wake"]).toBe("submitted");
    expect(server.sent("POST", /\/kid\/completions$/)[0].body).toEqual({ child_habit_id: "c1-wake" });
    // The kid screens use the kid token from the session the grown-up started.
    expect(server.sent("POST", /\/children\/c1\/kid-session$/)).toHaveLength(1);
  });

  it("asks for the parent PIN before a grown-up page, then shows what the child sent", async () => {
    const server = startFakeServer();
    const { user } = renderApp("/parent");
    await user.click(await screen.findByRole("button", { name: "Open kid mode" }));
    await user.click((await questCard("Rise and shine")).getByRole("button", { name: "I did it!" }));
    await screen.findByText("Waiting for a grown-up");

    window.location.hash = "/parent";
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("This page is for grown-ups.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("4-digit PIN"), PIN);
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    const approvals = within((await screen.findByRole("heading", { name: "Waiting for your OK" })).closest("section")!);
    expect(await approvals.findByText("Wake up on time")).toBeInTheDocument();
    expect(server.sent("POST", /\/pin\/verify$/)).toHaveLength(1);
  });

  it("sends a child who cancels the PIN back to their quests", async () => {
    startFakeServer();
    const { user } = renderApp("/parent");
    await user.click(await screen.findByRole("button", { name: "Open kid mode" }));
    await questCard("Rise and shine");

    window.location.hash = "/rewards";
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("heading", { name: "Rise and shine" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/kid/c1");
  });

  it("shows a quest a grown-up approved as done", async () => {
    const server = startFakeServer();
    server.state.status["c1-wake"] = "approved";
    const { user } = renderApp("/parent");

    await user.click(await screen.findByRole("button", { name: "Open kid mode" }));
    const card = await questCard("Rise and shine");

    expect(card.getByText("Spark earned!")).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "I did it!" })).not.toBeInTheDocument();
    expect((await questCard("Sparkly teeth")).getByRole("button", { name: "I did it!" })).toBeInTheDocument();
  });

  it("asks a child with their own PIN for it, and refuses a wrong one", async () => {
    const server = startFakeServer();
    server.state.children.push({ ...server.state.children[0], id: "c2", name: "Bea", has_pin: true });
    server.state.plans.c2 = [];
    server.on("POST", /\/children\/c2\/kid-session$/, (_m, body) =>
      (body as { pin?: string }).pin === "4321"
        ? { access_token: "kid:c2", token_type: "bearer", expires_in: 3600, child: { id: "c2", name: "Bea" } }
        : { status: 403, body: { detail: "Wrong PIN" } });
    const { user } = renderApp("/parent");

    await user.click(await screen.findByRole("button", { name: "Open kid mode" }));
    await user.click(await screen.findByRole("button", { name: /Bea/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Hi, Bea!")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("4-digit PIN"), "1111");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    expect(await within(dialog).findByText("That PIN isn't right. Try again.")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/kid");
  });
});

it("keeps habits scheduled on other days visible without a completion button", async () => {
  const server = startFakeServer();
  const goal = catalog.goals["learning-homework--ask-about-one-stuck-spot--a6-8"];
  server.on("GET", /\/kid\/today$/, () => ({ child: { id: "c1", name: "Alex", buddy: "fox", world: "camp" }, day: "2026-11-05", welcome_back: false, rest_day: true, next_quest_day: "2026-11-06", progress: { sparks: 0, pending_sparks: 0, level: 1, level_name: "Camp Sprout", world: "camp", unlocked_tier: 1, next_level_at: 30, next_landmark: null }, points: 0, habits: [], streak: 0, week: {}, upcoming_habits: [{ habit_id: "my-ai-other-day", kid_title: "A question for Friday", kid_hint: "Ask for help", icon: "fluent:book", cue_time: "18:00", days: ["mon", "wed", "fri"] }] }));
  server.on("GET", /\/kid\/habits\/my-ai-other-day\/details$/, () => ({ habit_id: "my-ai-other-day", goal_id: goal.goalId, title: "A question for Friday", instruction: "Point to one tricky part.", steps: ["Find a tricky part.", "Ask for help."], materials: [], cue: "When homework starts", completion: "You asked for help.", help_text: "Can we try together?" }));
  const { user } = renderApp("/parent");
  await user.click(await screen.findByRole("button", { name: "Open kid mode" }));
  const otherDays = await screen.findByRole("region", { name: "Habits for other days" });
  expect(within(otherDays).getByText("A question for Friday")).toBeInTheDocument();
  expect(within(otherDays).getByText("Mon, Wed, Fri · 18:00")).toBeInTheDocument();
  expect(within(otherDays).queryByRole("button", { name: "I did it!" })).not.toBeInTheDocument();
  expect(server.sent("POST", /\/kid\/completions$/)).toHaveLength(0);
});
