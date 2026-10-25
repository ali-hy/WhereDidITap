// TP-0.22: F-1 rule 4 web rules smoke (A-12, A-13, A-18). One fixture with one violation per
// configured web rule, linted under ESLint 10: every rule reports, nothing crashes, and
// `formatjs/enforce-id` isn't active.
import { describe, expect, it } from "vitest";
import { lintFixture } from "./support/lintFixture.js";

const FILE = "apps/web/src/smoke.tsx";

const WEB_RULES = [
  "formatjs/enforce-default-message",
  "formatjs/no-literal-string-in-jsx",
  "formatjs/no-invalid-icu",
  "budmon/message-id",
  "budmon/no-physical-tailwind",
  "budmon/icon-from-registry",
  "jsx-a11y/alt-text",
  "jsx-a11y/control-has-associated-label",
  "jsx-a11y/label-has-associated-control",
  "jsx-a11y/aria-props",
  "jsx-a11y/aria-proptypes",
  "jsx-a11y/aria-role",
  "jsx-a11y/role-has-required-aria-props",
  "jsx-a11y/tabindex-no-positive",
];

const MALFORMED_ICU = '"{count, plural, one {x}"';

// One violation per rule; the comment on each line names the rule it targets.
const SMOKE = `import { Home } from "lucide-solid"; // budmon/icon-from-registry

interface Descriptor {
  id?: string;
  defaultMessage?: string;
}
declare function t(descriptor: Descriptor): string;
declare function defineMessage(descriptor: Descriptor): Descriptor;
declare const label: Descriptor;

export const icon = Home;
export const noDefault = t({ id: "a.b" }); // formatjs/enforce-default-message
export const noId = t({ defaultMessage: "x" }); // budmon/message-id
export const badIcu = defineMessage({
  id: "a.c",
  defaultMessage: ${MALFORMED_ICU}, // formatjs/no-invalid-icu
});

export function Smoke(): unknown {
  return (
    <main>
      <p>Hello</p>
      <div class="ml-2">{t(label)}</div>
      <img src="a" />
      <button type="button" />
      <label />
      <div aria-foo="1">{t(label)}</div>
      <div aria-hidden="maybe">{t(label)}</div>
      <div role="datepicker">{t(label)}</div>
      <div role="checkbox">{t(label)}</div>
      <div tabindex={1}>{t(label)}</div>
    </main>
  );
}
`;

describe("TP-0.22: web lint smoke", () => {
  it("TP-0.22: every configured web rule reports on the fixture, nothing crashes, and enforce-id isn't active", async () => {
    // lintFixture throws on a crashed run or any message with fatal: true.
    const messages = await lintFixture({ [FILE]: SMOKE });
    const reported = messages[FILE] ?? [];
    const ruleIds = new Set(reported.map((m) => m.ruleId));

    expect(reported.filter((m) => m.fatal === true)).toEqual([]);
    expect(WEB_RULES.filter((rule) => !ruleIds.has(rule))).toEqual([]);
    expect(ruleIds.has("formatjs/enforce-id")).toBe(false);
  });

  it("TP-0.22: formatjs/no-invalid-icu reports on the malformed message's defaultMessage", async () => {
    const messages = await lintFixture({ [FILE]: SMOKE });
    const defaultMessageLine =
      SMOKE.split("\n").findIndex((line) => line.includes(`defaultMessage: ${MALFORMED_ICU}`)) + 1;

    const icuReports = (messages[FILE] ?? []).filter((m) => m.ruleId === "formatjs/no-invalid-icu");

    expect(icuReports.map((m) => m.line)).toEqual([defaultMessageLine]);
  });
});
