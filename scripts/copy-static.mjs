import { cp, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../src/server/projects/migrations", import.meta.url));
const destination = fileURLToPath(new URL("../dist/server/projects/migrations", import.meta.url));

try {
  await stat(source);
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
