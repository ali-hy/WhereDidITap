// F-1 rule 4's blocking accessibility rules (D-39, A-13, A-20, A-21). TP-11.22: each fixture is
// linted alone as apps/web/src/x.tsx (one directory per fixture), considering only jsx-a11y/*
// messages.
import { describe, expect, it } from "vitest";
import { errorRuleIds, lintFixture } from "./support/lintFixture.js";

const FILE = "apps/web/src/x.tsx";

const PRELUDE = `declare function t(descriptor: unknown): string;
declare const m: unknown;
declare function Icon(props: { name: string; label?: string }): unknown;
declare const f: () => void;
`;

const CASES: [string, string, string[]][] = [
  ["(1)", '<img src="a"/>', ["alt-text"]],
  ["(2)", '<img src="a" alt=""/>', []],
  ["(3)", '<button><Icon name="x"/></button>', ["control-has-associated-label"]],
  ["(4)", '<button><Icon name="x" label="Close"/></button>', []],
  ["(5)", "<button>{t(m)}</button>", []],
  ["(6)", '<Icon name="x"/>', []],
  ["(7)", "<label>Name</label>", ["label-has-associated-control"]],
  ["(8)", '<label for="a">Name</label>', []],
  ["(9)", '<label htmlFor="a">Name</label>', ["label-has-associated-control"]],
  ["(10)", '<label>Name<input id="a"/></label>', []],
  ["(11)", '<input id="a"/>', []],
  ["(12)", '<div aria-foo="1"/>', ["aria-props"]],
  ["(13)", '<div aria-hidden="maybe"/>', ["aria-proptypes"]],
  ["(14)", '<div role="banana"/>', ["aria-role"]],
  [
    "(15)",
    '<div role="checkbox"/>',
    ["control-has-associated-label", "role-has-required-aria-props"],
  ],
  ["(16)", "<div tabindex={1}/>", ["tabindex-no-positive"]],
  ["(17)", "<div onClick={f}/>", []],
];

/** Every jsx-a11y rule the cases above actually reported (review N-3: from ESLint, not CASES). */
const reportedByLint = new Set<string>();

describe("TP-11.22: the blocking jsx-a11y rules (F-1, A-13, A-20, A-21)", () => {
  it.each(CASES)("TP-11.22 %s %s: jsx-a11y reports %j", async (_n, jsx, expected) => {
    const messages = await lintFixture({
      [FILE]: `${PRELUDE}export const view = ${jsx};\n`,
    });

    const a11y = [
      ...new Set(
        errorRuleIds(messages, FILE)
          .filter((id): id is string => id?.startsWith("jsx-a11y/") === true)
          .map((id) => id.slice("jsx-a11y/".length)),
      ),
    ].sort();
    for (const rule of a11y) reportedByLint.add(rule);
    expect(a11y).toEqual([...expected].sort());
  });

  // Runs after the cases (Vitest runs a file's tests in order) and reads what ESLint reported.
  it("TP-11.22: each of the eight blocking rules reports at least once across the fixtures", () => {
    expect([...reportedByLint].sort()).toEqual(
      [
        "alt-text",
        "control-has-associated-label",
        "label-has-associated-control",
        "aria-props",
        "aria-proptypes",
        "aria-role",
        "role-has-required-aria-props",
        "tabindex-no-positive",
      ].sort(),
    );
  });
});
