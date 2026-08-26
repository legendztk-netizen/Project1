import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const persistState = process.env.CLOUDFLARE_PERSIST_PATH
  ? { path: process.env.CLOUDFLARE_PERSIST_PATH }
  : true;

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    cloudflare({ persistState, viteEnvironment: { name: "ssr" } }),
    reactRouter(),
  ],
});
