import { copyFile } from "node:fs/promises";

await copyFile(new URL("../src/app.js", import.meta.url), new URL("../dist/app.js", import.meta.url));
