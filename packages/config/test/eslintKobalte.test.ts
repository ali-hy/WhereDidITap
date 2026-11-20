// F-1's Kobalte dialog imports (A-540): TP-0.36, plus extra cases ending in "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { errorsIn, lintFixture } from "./support/lintFixture.js";

const FILE = "apps/web/src/x.tsx";

/** A-540's message, exactly as F-1 states it. */
const MESSAGE =
  "Import Kobalte dialogs as a namespace: import * as Dialog from '@kobalte/core/dialog' (or * as AlertDialog from '@kobalte/core/alert-dialog'). The named Dialog and AlertDialog exports are one shared object (A-540).";

/** `importLine`, then an export that uses its binding `name` (so nothing is unused). */
const fixture = (importLine: string, name: string): string =>
  `${importLine};\n\nexport const used = ${name};\n`;

/** The errors (severity 2) for FILE, as rule and message. */
async function errorsFor(importLine: string, name: string) {
  const messages = await lintFixture({ [FILE]: fixture(importLine, name) });
  return errorsIn(messages, FILE).map((m) => ({ ruleId: m.ruleId, message: m.message }));
}

describe("F-1 Kobalte dialog imports (A-540)", () => {
  describe("TP-0.36", () => {
    it.each([
      ["1", 'import { Dialog } from "@kobalte/core/dialog"', "Dialog"],
      ["2", 'import { AlertDialog } from "@kobalte/core/alert-dialog"', "AlertDialog"],
      ["3", 'import { Dialog } from "@kobalte/core"', "Dialog"],
    ])(
      "TP-0.36 (%s) %s: exactly one no-restricted-syntax error with A-540's message",
      async (_id, importLine, name) => {
        const errors = await errorsFor(importLine, name);

        expect(errors).toEqual([{ ruleId: "no-restricted-syntax", message: MESSAGE }]);
      },
    );

    it.each([
      ["4", 'import * as Dialog from "@kobalte/core/dialog"', "Dialog"],
      ["5", 'import * as AlertDialog from "@kobalte/core/alert-dialog"', "AlertDialog"],
      ["6", 'import { Combobox } from "@kobalte/core/combobox"', "Combobox"],
    ])("TP-0.36 (%s) %s: no error", async (_id, importLine, name) => {
      const errors = await errorsFor(importLine, name);

      expect(errors).toEqual([]);
    });
  });

  // TP-0.36x (added): F-1's selector matches the imported name on all three sources, so the root's
  // AlertDialog and an aliased Dialog (still the shared object) are reported too.
  describe("TP-0.36x: other named dialog imports", () => {
    it.each([
      ['import { AlertDialog } from "@kobalte/core"', "AlertDialog"],
      ['import { Dialog as KobalteDialog } from "@kobalte/core/dialog"', "KobalteDialog"],
    ])(
      "TP-0.36x: %s is exactly one no-restricted-syntax error with A-540's message",
      async (importLine, name) => {
        const errors = await errorsFor(importLine, name);

        expect(errors).toEqual([{ ruleId: "no-restricted-syntax", message: MESSAGE }]);
      },
    );
  });
});
