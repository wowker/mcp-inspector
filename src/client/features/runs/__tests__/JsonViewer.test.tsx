// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { JsonViewer } from "../JsonViewer.js";

describe("JsonViewer", () => {
  afterEach(() => cleanup());

  it("keeps very wide documents collapsed until the user asks to render their rows", () => {
    const value = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`key-${index}`, index]));
    render(<JsonViewer value={value} label="大型 JSON" />);

    expect(screen.queryByText(/^key-0/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 JSON" }));
    expect(screen.getByText(/^key-0/)).toBeVisible();
  });
});
