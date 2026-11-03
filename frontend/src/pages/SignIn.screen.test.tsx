/** Screen tests: signing in, first-time family setup, and who may open the grown-up pages. */
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEV_PASSWORD, defaultState, startFakeServer } from "../test/fakeServer";
import { renderApp } from "../test/renderApp";

describe("signing in", () => {
  it("sends a signed-out visitor from a grown-up page to sign-in", async () => {
    startFakeServer();
    renderApp("/parent", { signedIn: false });
    expect(await screen.findByRole("heading", { name: "Welcome to HabbitQuest" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/login");
  });

  it("signs in with the development login and opens the dashboard", async () => {
    vi.stubEnv("VITE_DEV_LOGIN", "true");
    const server = startFakeServer();
    const { user } = renderApp("/login", { signedIn: false });

    await user.click(await screen.findByRole("button", { name: "Developer login" }));
    await user.type(screen.getByLabelText("Shared password"), DEV_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: /, Pat$/ })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/parent");
    expect(server.sent("POST", /\/auth\/token$/)[0].body).toEqual({ username: "parent", password: DEV_PASSWORD });
  });

  it("shows the server's message for a wrong password and stays on sign-in", async () => {
    vi.stubEnv("VITE_DEV_LOGIN", "true");
    startFakeServer();
    const { user } = renderApp("/login", { signedIn: false });

    await user.click(await screen.findByRole("button", { name: "Developer login" }));
    await user.type(screen.getByLabelText("Shared password"), "not-it");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Incorrect username or password")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/login");
  });

  it("hides the development login unless it is switched on", async () => {
    vi.stubEnv("VITE_DEV_LOGIN", "false"); // a local .env.local may switch it on
    startFakeServer();
    renderApp("/login", { signedIn: false });
    await screen.findByRole("heading", { name: "Welcome to HabbitQuest" });
    expect(screen.queryByRole("button", { name: "Developer login" })).not.toBeInTheDocument();
  });
});

describe("first-time setup", () => {
  it("creates a family, then asks for the first child", async () => {
    const server = startFakeServer(defaultState({ empty: true }));
    const { user } = renderApp("/parent");

    await user.type(await screen.findByLabelText("Family name"), "The Rivera family");
    await user.type(screen.getByLabelText("Your name"), "Sam");
    await user.click(screen.getByRole("button", { name: "Create family" }));

    expect(await screen.findByRole("heading", { name: "Who's going on quests?" })).toBeInTheDocument();
    const [created] = server.sent("POST", /^\/v1\/families$/);
    expect(created.body).toMatchObject({ name: "The Rivera family", display_name: "Sam", role: "mother" });
    expect(created.body).not.toHaveProperty("pin"); // the PIN is optional and was left empty
  });

  it("refuses a PIN that is not four digits before sending anything", async () => {
    const server = startFakeServer(defaultState({ empty: true }));
    const { user } = renderApp("/welcome");

    await user.type(await screen.findByLabelText("Family name"), "The Rivera family");
    await user.type(screen.getByLabelText("Your name"), "Sam");
    await user.type(screen.getByLabelText("Parent PIN, 4 digits, optional"), "12");
    await user.click(screen.getByRole("button", { name: "Create family" }));

    expect(await screen.findByText("A parent PIN needs exactly 4 digits, or leave it empty.")).toBeInTheDocument();
    await waitFor(() => expect(server.sent("POST", /^\/v1\/families$/)).toHaveLength(0));
  });
});
