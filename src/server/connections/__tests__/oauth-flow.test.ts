import { describe, expect, it, vi } from "vitest";
import { OAuthCallbackError, OAuthFlowCoordinator } from "../oauth-flow.js";

describe("OAuthFlowCoordinator", () => {
  it("accepts one matching callback state and resumes the pending authorization", async () => {
    let opened = "";
    const coordinator = new OAuthFlowCoordinator({
      redirectUrl: () => "http://127.0.0.1:3000/oauth/callback",
      openAuthorizationUrl: (url) => { opened = url; },
    });
    const finishAuth = vi.fn(async () => undefined);
    const provider = coordinator.provider("connection-1", () => ({ finishAuth } as never));
    const state = await provider.state!();
    const redirect = provider.redirectToAuthorization(new URL(`https://auth.example/authorize?state=${state}`));
    await vi.waitFor(() => expect(opened).toContain("auth.example"));

    await expect(coordinator.complete(new URLSearchParams({ state, code: "safe-code" }))).resolves.toBe("connection-1");
    await expect(redirect).resolves.toBeUndefined();
    expect(finishAuth).toHaveBeenCalledOnce();
    await expect(coordinator.complete(new URLSearchParams({ state, code: "replay" })))
      .rejects.toBeInstanceOf(OAuthCallbackError);
  });

  it("rejects an expired state without exchanging its code", async () => {
    let now = 0;
    const coordinator = new OAuthFlowCoordinator({
      redirectUrl: () => "http://127.0.0.1:3000/oauth/callback",
      openAuthorizationUrl: () => undefined,
      now: () => now,
    });
    const finishAuth = vi.fn(async () => undefined);
    const provider = coordinator.provider("connection-1", () => ({ finishAuth } as never));
    const state = await provider.state!();
    const redirect = provider.redirectToAuthorization(new URL("https://auth.example/authorize"));
    await Promise.resolve();
    now = 600_001;
    await expect(coordinator.complete(new URLSearchParams({ state, code: "code" }))).rejects.toThrow(/expired|invalid/i);
    expect(finishAuth).not.toHaveBeenCalled();
    void Promise.resolve(redirect).catch(() => undefined);
  });

  it("keeps tokens server-side and removes them when the connection is cleared", async () => {
    const coordinator = new OAuthFlowCoordinator({
      redirectUrl: () => "http://127.0.0.1:3000/oauth/callback",
      openAuthorizationUrl: () => undefined,
    });
    const provider = coordinator.provider("connection-1", () => ({ finishAuth: vi.fn() } as never));
    await provider.saveTokens({ access_token: "secret", token_type: "bearer" });
    expect((await provider.tokens())?.access_token).toBe("secret");
    coordinator.clear("connection-1");
    const replacement = coordinator.provider("connection-1", () => ({ finishAuth: vi.fn() } as never));
    expect(await replacement.tokens()).toBeUndefined();
  });

  it("cancels a pending authorization when its connection is cleared", async () => {
    const coordinator = new OAuthFlowCoordinator({
      redirectUrl: () => "http://127.0.0.1:3000/oauth/callback",
      openAuthorizationUrl: () => undefined,
    });
    const provider = coordinator.provider("connection-1", () => ({ finishAuth: vi.fn() } as never));
    await provider.state!();
    const pending = Promise.resolve(provider.redirectToAuthorization(new URL("https://auth.example/authorize")));
    await Promise.resolve();
    coordinator.clear("connection-1");
    await expect(pending).rejects.toThrow(/cancelled/i);
  });
});
