import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { workflow } from "workflow/vite";

export default defineConfig({
  // GitHub Pages owns the browser application. Vercel builds only the API,
  // durable workflow, and their server dependencies.
  publicDir: false,
  appType: "custom",
  plugins: [nitro(), workflow()],
  nitro: {
    serverDir: "./server",
    renderer: false,
  },
  build: {
    sourcemap: true,
  },
});
