import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const distribution = fileURLToPath(new URL("../dist", import.meta.url));
await rm(distribution, { recursive: true, force: true });
