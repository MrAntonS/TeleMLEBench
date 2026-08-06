import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { workflow } from "workflow/vite";

export default defineConfig({
  // GitHub Pages owns every browser asset. This Vercel build contains only
  // HTTP API routes, health metadata, and the durable scoring workflow.
  publicDir: false,
  appType: "custom",
  plugins: [nitro(), workflow()],
  nitro: {
    serverDir: "./server",
    renderer: false,
    ignore: ["routes/app-core.js.get.ts"],
  },
  build: {
    sourcemap: true,
  },
});
