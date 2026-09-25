import { writeOfflineWorker } from "./scripts/offline-worker.mjs";
import { defineConfig } from "vite";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

let outputDirectory = resolve("dist");

export default defineConfig({
  plugins: [
    {
      name: "exclude-obsolete-dxf",
      configResolved(config) { outputDirectory = resolve(config.root, config.build.outDir); },
      async closeBundle() {
        await rm(resolve(outputDirectory, "assets/testr2.dxf"), { force: true });
        await writeOfflineWorker(outputDirectory);
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
