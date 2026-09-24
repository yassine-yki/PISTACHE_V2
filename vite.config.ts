import { defineConfig } from "vite";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    {
      name: "exclude-obsolete-dxf",
      async closeBundle() {
        await rm(resolve("dist/assets/testr2.dxf"), { force: true });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 4173,
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
