const requestId = "00000000-0000-4000-8000-000000009901";
const completed = {
  version: 1,
  type: "completed",
  arguments: {},
  variables: {},
  stagedEnvironment: [],
};

process.on("message", (message) => {
  if (message?.type !== "start") return;
  if (message.source === "duplicate-host-call") {
    const hostCall = {
      version: 1,
      type: "host-call",
      requestId,
      capability: "tools.call",
      input: { server: "current", name: "lookup", arguments: {} },
    };
    process.send?.(hostCall);
    process.send?.(hostCall);
    process.send?.(completed);
    return;
  }
  if (message.source === "too-many-logs") {
    process.send?.({
      version: 1,
      type: "log",
      level: "info",
      message: "first",
      line: null,
      column: null,
    });
    process.send?.({
      version: 1,
      type: "log",
      level: "info",
      message: "second",
      line: null,
      column: null,
    });
    process.send?.(completed);
    return;
  }
  if (message.source === "unexpected-direction") {
    process.send?.(message);
    process.send?.(completed);
  }
});
