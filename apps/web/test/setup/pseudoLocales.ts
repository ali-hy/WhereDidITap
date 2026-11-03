// web-unit globalSetup (A-310): writes the pseudo-locale catalogs (F-207) before the tests run, so
// TP-11.6's ar-XB never depends on an earlier build.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writePseudoLocales } from "../../scripts/pseudoLocales.js";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default function setup(): void {
  writePseudoLocales({
    enCatalogPath: path.join(WEB_DIR, "src/i18n/messages/en.json"),
    outDir: path.join(WEB_DIR, "src/i18n/generated"),
  });
}
