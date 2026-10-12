// The web app's Vite configuration (§8.1): F-22's development server, F-207's pseudo-locales and
// F-221's build number.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import { writePseudoLocales } from "./scripts/pseudoLocales.js";

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));

/** F-207: writes src/i18n/generated/{en-XA,ar-XB}.json when VITE_PSEUDO_LOCALES=1. */
function budmonPseudoLocales(enabled: boolean): Plugin {
  const enCatalogPath = path.join(WEB_DIR, "src/i18n/messages/en.json");
  const write = () => {
    writePseudoLocales({ enCatalogPath, outDir: path.join(WEB_DIR, "src/i18n/generated") });
  };
  return {
    name: "budmon-pseudo-locales",
    buildStart() {
      if (enabled) write();
    },
    // In dev, an edited English catalog regenerates the pseudo catalogs.
    handleHotUpdate(ctx) {
      if (enabled && path.resolve(ctx.file) === enCatalogPath) write();
    },
  };
}

/**
 * A-342: the MSW worker script for the fixture pages, emitted from the installed msw only when
 * VITE_FIXTURES=1 (served in dev the same way), so production builds never contain it.
 */
function budmonFixtures(enabled: boolean): Plugin {
  const workerSource = () =>
    readFileSync(createRequire(import.meta.url).resolve("msw/mockServiceWorker.js"), "utf8");
  return {
    name: "budmon-fixtures",
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use("/mockServiceWorker.js", (_req, res) => {
        res.setHeader("content-type", "text/javascript");
        res.end(workerSource());
      });
    },
    generateBundle() {
      if (!enabled) return;
      this.emitFile({ type: "asset", fileName: "mockServiceWorker.js", source: workerSource() });
    },
  };
}

/** F-221: VITE_BUILD_NUMBER from BUDMON_BUILD_NUMBER (default 0), and dist/version.json. */
function budmonVersion(): Plugin {
  const raw = process.env["BUDMON_BUILD_NUMBER"] ?? "0";
  if (!/^\d{1,9}$/.test(raw)) throw new Error("BUDMON_BUILD_NUMBER must be 1 to 9 digits");
  const buildNumber = Number.parseInt(raw, 10);
  return {
    name: "budmon-version",
    config: () => ({
      define: { "import.meta.env.VITE_BUILD_NUMBER": JSON.stringify(String(buildNumber)) },
    }),
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ buildNumber }),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, WEB_DIR, "VITE_");
  const pseudo = (process.env["VITE_PSEUDO_LOCALES"] ?? env["VITE_PSEUDO_LOCALES"]) === "1";
  const fixtures = (process.env["VITE_FIXTURES"] ?? env["VITE_FIXTURES"]) === "1";
  const e2eApi = `http://127.0.0.1:${process.env["E2E_API_PORT"] ?? "8787"}`;
  return {
    plugins: [
      solid(),
      tailwindcss(),
      budmonPseudoLocales(pseudo),
      budmonFixtures(fixtures),
      budmonVersion(),
    ],
    // F-222 (A-329): `vite preview` in e2e:serve proxies the in-process API (A-395: its port).
    preview: {
      proxy: {
        "^/api(/|$)": { target: e2eApi, changeOrigin: false },
        "^/dev/objects(/|$)": { target: e2eApi, changeOrigin: false },
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        // F-22: exactly /api and /health and their subpaths (a bare prefix would match /apifoo).
        "^/api(/|$)": { target: "http://127.0.0.1:3000", changeOrigin: false },
        "^/health(/|$)": { target: "http://127.0.0.1:3000", changeOrigin: false },
      },
    },
  };
});
