import { homedir } from "node:os";
import { join } from "node:path";

export function resolveDefaultDataRoot(options: {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
} = {}): string {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();

  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Application Support", "DSers MCP Inspector");
  }

  if (platform === "win32") {
    const appData = environment.APPDATA;
    if (appData === undefined || appData.trim().length === 0) {
      throw new Error("APPDATA is required to locate DSers MCP Inspector data");
    }
    return join(appData, "DSers MCP Inspector");
  }

  const dataHome = environment.XDG_DATA_HOME?.trim();
  return join(
    dataHome && dataHome.length > 0 ? dataHome : join(homeDirectory, ".local", "share"),
    "DSers MCP Inspector",
  );
}

export function resolveRegistryPath(dataRoot: string): string {
  return join(dataRoot, "registry.sqlite");
}

export function resolveProjectDatabasePath(dataRoot: string, projectId: string): string {
  return join(dataRoot, "projects", projectId, "project.sqlite");
}
