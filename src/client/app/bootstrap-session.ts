const SESSION_KEY = "mcp-inspector-session";

export function consumeBootstrapSession(): string | null {
  const url = new URL(window.location.href);
  const bootstrapSession = url.searchParams.get("session");

  if (bootstrapSession !== null) {
    sessionStorage.setItem(SESSION_KEY, bootstrapSession);
    url.searchParams.delete("session");
    history.replaceState(history.state, "", url);
  }

  return bootstrapSession ?? sessionStorage.getItem(SESSION_KEY);
}
