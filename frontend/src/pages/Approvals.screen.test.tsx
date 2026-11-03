/** Screen tests: approving quests on the dashboard, and the parent PIN that guards it. */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PIN, defaultState, startFakeServer, type FakeServer } from "../test/fakeServer";
import { renderApp } from "../test/renderApp";

/** Alex has marked "Wake up on time" done and it waits for a grown-up. */
function waiting(server: FakeServer) {
  server.state.status["c1-wake"] = "submitted";
}

const approvalsPanel = async () => {
  const heading = await screen.findByRole("heading", { name: "Waiting for your OK" });
  return within(heading.closest("section")!);
};

describe("approving quests", () => {
  it("lists what is waiting, and approves it after the PIN", async () => {
    const server = startFakeServer();
    waiting(server);
    const { user } = renderApp("/parent");

    const panel = await approvalsPanel();
    expect(await panel.findByText("Wake up on time")).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: /Approve/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText('Approve "Wake up on time" for Alex.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("4-digit PIN"), PIN);
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    expect(await panel.findByText(/When your child taps/)).toBeInTheDocument(); // the list is empty again
    expect(server.sent("POST", /\/completions\/done-c1-wake\/approve$/)).toHaveLength(1);
    expect(server.state.status["c1-wake"]).toBe("approved");
    expect(server.state.points.c1).toBe(50); // 40 + the quest's 10 points
  });

  it("keeps the quest waiting when the PIN is wrong", async () => {
    const server = startFakeServer();
    waiting(server);
    const { user } = renderApp("/parent");

    const panel = await approvalsPanel();
    await user.click(await panel.findByRole("button", { name: /Approve/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("4-digit PIN"), "9999");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    expect(await within(dialog).findByText("That PIN isn't right. Try again.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.sent("POST", /\/approve$/)).toHaveLength(0);
    expect(panel.getByText("Wake up on time")).toBeInTheDocument();
  });

  it("sends a quest back with Not yet", async () => {
    const server = startFakeServer();
    waiting(server);
    const { user } = renderApp("/parent");

    const panel = await approvalsPanel();
    await user.click(await panel.findByRole("button", { name: "Not yet" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("4-digit PIN"), PIN);
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    expect(await panel.findByText(/When your child taps/)).toBeInTheDocument();
    expect(server.state.status["c1-wake"]).toBe("rejected");
    expect(server.state.points.c1).toBe(40);
  });

  it("does not ask for a PIN when the family has none", async () => {
    const server = startFakeServer(defaultState({ pin: null }));
    waiting(server);
    const { user } = renderApp("/parent");

    const panel = await approvalsPanel();
    await user.click(await panel.findByRole("button", { name: /Approve/ }));

    expect(await panel.findByText(/When your child taps/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.sent("POST", /\/pin\/verify$/)).toHaveLength(0);
  });

  it("shows the server's reason when another grown-up decided first", async () => {
    const server = startFakeServer(defaultState({ pin: null }));
    waiting(server);
    server.on("POST", /\/approve$/, () => ({ status: 409, body: { detail: "This quest has already been decided." } }));
    const { user } = renderApp("/parent");

    const panel = await approvalsPanel();
    await user.click(await panel.findByRole("button", { name: /Approve/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This quest has already been decided.");
  });
});
