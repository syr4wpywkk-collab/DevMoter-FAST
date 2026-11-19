import { defineConfig, type Plugin } from "vite";
import { resolveBuildId } from "./scripts/build-id.mjs";

const buildId = resolveBuildId();

// dist/build.json lets the host report which bundle it serves.
function buildManifest(): Plugin {
  return {
    name: "devmoter-build-manifest",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "build.json", source: `${JSON.stringify({ build: buildId || null })}\n` });
    }
  };
}

export default defineConfig({
  define: {
    __DEVMOTER_BUILD__: JSON.stringify(buildId)
  },
  plugins: [buildManifest()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  },
  build: {
    target: "es2022"
  }
});
