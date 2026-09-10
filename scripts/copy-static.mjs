import { cp, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationDirectories = ["projects/migrations", "registry/migrations"];

for (const directory of migrationDirectories) {
  const source = fileURLToPath(new URL(`../src/server/${directory}`, import.meta.url));
  const destination = fileURLToPath(new URL(`../dist/server/${directory}`, import.meta.url));
  try {
    await stat(source);
    await mkdir(destination, { recursive: true });
    await cp(source, destination, { recursive: true });
    const sourceEntries = (await readdir(source)).filter((name) => name.endsWith(".sql")).sort();
    const destinationEntries = (await readdir(destination)).filter((name) => name.endsWith(".sql")).sort();
    if (JSON.stringify(sourceEntries) !== JSON.stringify(destinationEntries)) {
      throw new Error(`Bundled ${directory} files do not match source migrations`);
    }
    for (const name of sourceEntries) {
      const [sourceBytes, destinationBytes] = await Promise.all([
        readFile(join(source, name)),
        readFile(join(destination, name)),
      ]);
      if (!sourceBytes.equals(destinationBytes)) {
        throw new Error(`Bundled migration differs from source: ${directory}/${name}`);
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
