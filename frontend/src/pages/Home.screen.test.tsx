import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { startFakeServer } from "../test/fakeServer";
import { renderApp } from "../test/renderApp";

describe("public Journey video", () => {
  it("scrolls from the Journey link without changing the app's hash route", async () => {
    startFakeServer();
    const { user } = renderApp("/", { signedIn: false });
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const links = within(nav).getAllByRole("link");
    const journey = within(nav).getByRole("link", { name: "Journey" });
    expect(links.indexOf(journey)).toBe(links.indexOf(within(nav).getByRole("link", { name: "For parents" })) + 1);
    const section = screen.getByRole("region", { name: "Journey" });
    const scroll = vi.spyOn(section, "scrollIntoView");

    await user.click(journey);

    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth" });
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("heading", { name: "Journey" })).toBeVisible();
  });

  it("offers user-controlled playback and captions without preloading the video", () => {
    startFakeServer();
    renderApp("/", { signedIn: false });
    const video = screen.getByLabelText("HabitQuest Journey: Little Habits, Big Adventures") as HTMLVideoElement;
    expect(video.controls).toBe(true);
    expect(video.preload).toBe("none");
    expect(video.autoplay).toBe(false);
    expect(video).toHaveAttribute("playsinline");
    expect(video.querySelector('source[type="video/mp4"]')).toHaveAttribute("src", expect.stringMatching(/^https:\/\/habbit-quest-assets\.s3\.us-east-1\.amazonaws\.com\//));
    expect(video.querySelector('track[kind="captions"]')).not.toHaveAttribute("default");
    expect(screen.getByRole("link", { name: "Open video" })).toHaveAttribute("target", "_blank");
  });
});
