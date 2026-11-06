import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingPicker } from "./SettingPicker";

afterEach(cleanup);

it("offers labeled Fluent icon radios with a visible suggestion and an explicit override", () => {
  const change = vi.fn(), reset = vi.fn();
  const { rerender } = render(<SettingPicker value="home" onChange={change} rationale="This sounds like a home routine." automatic onAutomatic={reset} />);
  expect(screen.getAllByRole("radio")).toHaveLength(5);
  expect(screen.getByRole("radio", { name: "Home" })).toBeChecked();
  expect(screen.getByText(/Suggested: Home/)).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "School" }));
  expect(change).toHaveBeenCalledWith("school");
  rerender(<SettingPicker value="school" onChange={change} rationale="A routine" automatic={false} onAutomatic={reset} allowed={["home", "school"]} />);
  expect(screen.getByRole("radio", { name: "Online" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Use suggested setting" }));
  expect(reset).toHaveBeenCalledOnce();
});
