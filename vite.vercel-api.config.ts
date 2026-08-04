import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { workflow } from "workflow/vite";

export default defineConfig({
  // GitHub Pages owns every browser asset. Vercel contains only the API and
  // durable hidden-label workflow.
  publicDir: false,
  appType: "custom",
  plugins: [nitro(), workflow()],
  nitro: {
    serverDir: "./server",
    renderer: false,
    noPublicDir: true,
    ignore: ["routes/app-core.js.get.ts"],
  },
  build: {
    sourcemap: true,
  },
});
