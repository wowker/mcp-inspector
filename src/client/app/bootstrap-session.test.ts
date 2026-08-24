// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";
import { consumeBootstrapSession } from "./bootstrap-session.js";

describe("consumeBootstrapSession", () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, "", "/");
  });

  test("moves the query token into session storage and removes it from the URL", () => {
    history.replaceState(null, "", "/workspace?project=one&session=secret#tools");

    expect(consumeBootstrapSession()).toBe("secret");
    expect(sessionStorage.getItem("dsers-inspector-session")).toBe("secret");
    expect(location.pathname).toBe("/workspace");
    expect(location.search).toBe("?project=one");
    expect(location.hash).toBe("#tools");
  });

  test("reuses the current tab session when the query token is absent", () => {
    sessionStorage.setItem("dsers-inspector-session", "existing");

    expect(consumeBootstrapSession()).toBe("existing");
    expect(location.search).toBe("");
  });
});
