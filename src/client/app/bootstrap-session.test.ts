// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";
import { consumeBootstrapSession } from "./bootstrap-session.js";

describe("consumeBootstrapSession", () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, "", "/");
  });

  test("never reads or persists a session credential from the URL", () => {
    history.replaceState(null, "", "/workspace?project=one&session=secret#tools");

    expect(consumeBootstrapSession()).toBeNull();
    expect(sessionStorage.getItem("mcp-inspector-session")).toBeNull();
    expect(location.pathname).toBe("/workspace");
    expect(location.search).toBe("?project=one&session=secret");
    expect(location.hash).toBe("#tools");
  });

  test("does not reuse a session credential from browser storage", () => {
    sessionStorage.setItem("mcp-inspector-session", "existing");

    expect(consumeBootstrapSession()).toBeNull();
    expect(location.search).toBe("");
  });
});
