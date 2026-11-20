import { defineConfig, type Plugin } from "vite";
import { resolveBuildId } from "./scripts/build-id.mjs";
import { stampBuiltServiceWorker } from "./scripts/service-worker-cache.mjs";

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

// public/sw.js is copied verbatim; stamp its cache name with the build id.
function serviceWorkerCacheVersion(): Plugin {
  let root = ".";
  let outDir = "dist";
  return {
    name: "devmoter-service-worker-cache-version",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    async writeBundle() {
      await stampBuiltServiceWorker(root, outDir, buildId);
    }
  };
}

export default defineConfig({
  define: {
    __DEVMOTER_BUILD__: JSON.stringify(buildId)
  },
  plugins: [buildManifest(), serviceWorkerCacheVersion()],
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
